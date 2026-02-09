
import { Request, Response } from 'express';
import cryptoJs from 'crypto-js';
import Transaction, { ITransaction } from '../models/Transaction';
import {
    VendorConfig,
    Order,
    RefundOrder,
    RawTransaction,
    CurrencyCode,
    RefundOrderReturnType
} from '../types';
import {
    messageGenerator,
    pstatus,
    status,
    convertToHuman,
    resilientFetch,
    istatus
} from '../utils';

import dotenv from 'dotenv';
dotenv.config();

// Config from env or passed arguments.
// In the original code, config was passed to the function.
// For likely usage in an Express route, I'll extract it from env or req.
const getVendorConfig = (): VendorConfig => ({
    id: process.env.BANCARD_ID || '1',
    username: process.env.BANCARD_PUBLIC_KEY || '',
    password: process.env.BANCARD_PRIVATE_KEY || '',
    test: process.env.BANCARD_MODE === 'test',
    locale: 'en', // Default or from request
});

export const createTransaction = async (req: Request, res: Response) => {
    try {
        const order: Order = req.body;
        const config = getVendorConfig();
        const message = messageGenerator(order.locale || 'en');
        const startTime = new Date();

        // 1. Create initial transaction in DB
        const transaction = new Transaction({
            presentment_currency: order.currency,
            entity: order.eid,
            presentment_net_amount: order.amount,
            pg_id: config.id,
            status: pstatus.vpos_initiated,
            transaction_date: startTime,
            description: order.description,
            metadata: order.metadata,
            return_url: order.returnUrl,
            pg_metadata: order.pgMetadata,
            method: order.paymentMethod,
            presentment_total_amount: order.amount,
            settlement_total_amount: order.amount,
            payment_id: `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            settlement_currency: order.currency,
            settlement_net_amount: order.amount,
        });

        const savedTransaction = await transaction.save();

        if (!savedTransaction) {
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_creation_error", "Failed to save transaction"),
            });
        }

        const shop_process_id = savedTransaction.id; // Mongoose virtual getter for _id string
        const amountString = Number(convertToHuman(order.amount, order.currency)).toFixed(2);

        // 2. Generate Token
        // Token: md5(private_key + shop_process_id + amount + currency)
        const tokenString = config.password + shop_process_id + amountString + order.currency;
        const token = cryptoJs.MD5(tokenString).toString();

        const body = {
            public_key: config.username,
            operation: {
                token: token,
                shop_process_id: shop_process_id,
                amount: amountString,
                currency: order.currency,
                description: order.description?.substring(0, 20) || "",
                return_url: order.returnUrl,
                cancel_url: order.returnUrl,
            },
        };

        const baseUrl = config.test ? "https://vpos.infonet.com.py:8888" : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy`;
        console.log("URL", url);
        // 3. Call Bancard API
        const { res: apiRes, err } = await resilientFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!apiRes || !apiRes.ok) {
            let errorMessage = err;
            console.log("Error", err);
            try {
                if (apiRes) {
                    const errJson = await apiRes.json();
                    console.log("Error JSON", errJson);
                    errorMessage = JSON.stringify(errJson);
                }
            } catch (e) { /* ignore */ }

            savedTransaction.status = pstatus.vpos_failed;
            transaction.failure_message = errorMessage;
            await savedTransaction.save();

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("order_creation_failed", errorMessage),
            });
        }

        const responseJson: any = await apiRes.json();
        if (responseJson.status !== "success") {
            savedTransaction.status = pstatus.vpos_failed;
            await savedTransaction.save();
            return res.status(status.EXPECTATION_FAILED).json({
                error: message("order_creation_failed", JSON.stringify(responseJson)),
            });
        }

        const process_id = responseJson.process_id;

        // 4. Update transaction with process_id
        savedTransaction.payment_id = process_id;
        savedTransaction.status = pstatus.vpos_processing;
        await savedTransaction.save();

        const redirectParams = new URLSearchParams({
            process_id: process_id,
        });

        const redirectUrl = `${baseUrl}/payment/single_buy?${redirectParams.toString()}`;

        return res.status(status.OK).json({
            data: {
                response: { redirect_url: redirectUrl },
                entity: savedTransaction.entity,
                status: pstatus.vpos_processing,
                transaction: {
                    id: savedTransaction.id,
                    currency: savedTransaction.presentment_currency,
                    description: savedTransaction.description,
                    metadata: savedTransaction.metadata,
                    payment_id: process_id,
                    total_amount: convertToHuman(
                        savedTransaction.presentment_total_amount,
                        savedTransaction.presentment_currency as CurrencyCode
                    ),
                    transaction_date: savedTransaction.transaction_date,
                    status: istatus.get(pstatus.vpos_processing) || "processing",
                    visible_id: savedTransaction.visible_id,
                    vendor: "bancard",
                    method: savedTransaction.method || "Online",
                    type: "sale",
                },
            },
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const updateTransaction = async (req: Request, res: Response) => {
    try {
        const config = getVendorConfig();
        const message = messageGenerator(config.locale);
        const operation = req.body.operation;

        if (!operation) {
            return res.status(status.BAD_REQUEST).json({
                error: message("improper_update_request"),
            });
        }

        const {
            shop_process_id,
            amount,
            currency,
            token,
            response_code,
            response_description
        } = operation;

        // Validate Token: md5(private_key + shop_process_id + "confirm" + amount + currency)
        const tokenString = config.password + shop_process_id + "confirm" + amount + currency;
        const calculatedToken = cryptoJs.MD5(tokenString).toString();

        if (calculatedToken !== token) {
            return res.status(status.UNAUTHORIZED).json({
                error: message("invalid_token"),
            });
        }

        let trxnStatus = pstatus.vpos_failed;
        if (response_code === "00") {
            trxnStatus = pstatus.vpos_success;
        }

        const updatedTransaction = await Transaction.findByIdAndUpdate(
            shop_process_id,
            {
                status: trxnStatus,
                failure_message: response_code !== "00" ? response_description : null
            },
            { new: true }
        );

        if (!updatedTransaction) {
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_update_error", "Transaction not found"),
            });
        }

        return res.status(status.OK).json({
            data: {
                response: { status: "success" },
                entity: updatedTransaction.entity,
                status: trxnStatus,
                transaction: {
                    id: updatedTransaction.id,
                    currency: updatedTransaction.presentment_currency,
                    description: updatedTransaction.description,
                    metadata: updatedTransaction.metadata,
                    payment_id: updatedTransaction.payment_id,
                    total_amount: convertToHuman(
                        updatedTransaction.presentment_total_amount,
                        updatedTransaction.presentment_currency as CurrencyCode
                    ),
                    transaction_date: updatedTransaction.transaction_date,
                    status: istatus.get(trxnStatus) || "non-existent-status",
                    visible_id: updatedTransaction.visible_id,
                    vendor: "bancard",
                    method: updatedTransaction.method || "Online",
                    type: "sale",
                    failure_message: updatedTransaction.failure_message
                },
            },
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const refundTransaction = async (req: Request, res: Response) => {
    try {
        const { transactionId } = req.params;
        const refundOrder: RefundOrder = req.body;
        const config = getVendorConfig();
        const message = messageGenerator(config.locale);

        const originalTransaction = await Transaction.findById(transactionId);
        if (!originalTransaction) {
            return res.status(status.NOT_FOUND).json({ error: "Transaction not found" });
        }

        const shop_process_id = originalTransaction.id;

        // Token: md5(private_key + shop_process_id + "rollback" + "0.00")
        // Refund seems to be a rollback of the full amount or specific amount? 
        // Legacy code used "0.00" for rollback token generation regardless of amount.
        const tokenString = config.password + shop_process_id + "rollback" + "0.00";
        const token = cryptoJs.MD5(tokenString).toString();

        const body = {
            public_key: config.username,
            operation: {
                token: token,
                shop_process_id: shop_process_id,
            },
        };

        const baseUrl = config.test ? "https://vpos.infonet.com.py:8888" : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy/rollback`;

        const { res: apiRes, err } = await resilientFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!apiRes || !apiRes.ok) {
            let errorMessage = err;
            try {
                if (apiRes) {
                    const errJson = await apiRes.json();
                    errorMessage = JSON.stringify(errJson);
                }
            } catch (e) { /* ignore */ }

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("refund_order_creation_issue", errorMessage),
            });
        }

        const responseJson: any = await apiRes.json();
        if (responseJson.status !== "success") {
            return res.status(status.EXPECTATION_FAILED).json({
                error: message("refund_order_creation_issue", JSON.stringify(responseJson)),
            });
        }

        // Create Refund Transaction Record
        const refundTransaction = new Transaction({
            entity: originalTransaction.entity,
            payment_id: "rollback-" + shop_process_id,
            pg_id: config.id,
            status: pstatus.vpos_rollback,
            transaction_date: new Date(),
            pg_user: originalTransaction.pg_user,
            description: refundOrder.description,
            metadata: refundOrder.metadata,
            presentment_currency: originalTransaction.presentment_currency,
            presentment_total_amount: refundOrder.amount,
            presentment_net_amount: refundOrder.amount,
            settlement_currency: originalTransaction.settlement_currency,
            settlement_total_amount: refundOrder.amount,
            settlement_net_amount: refundOrder.amount,
            method: originalTransaction.method,
            is_refund: true,
            links_to: originalTransaction.id,
            visible_id: "ROLLBACK-" + shop_process_id
        });

        const savedRefund = await refundTransaction.save();

        const response: RefundOrderReturnType = {
            id: savedRefund.id,
            transaction_date: savedRefund.transaction_date.toISOString(),
            status: istatus.get(savedRefund.status) || "non-existent-status",
            visible_id: savedRefund.visible_id,
            vendor: "bancard",
        };

        return res.status(status.OK).json({
            data: {
                response: response,
                entity: savedRefund.entity,
                status: savedRefund.status,
                transaction: {
                    id: savedRefund.id,
                    currency: savedRefund.presentment_currency,
                    description: savedRefund.description,
                    metadata: savedRefund.metadata,
                    payment_id: savedRefund.payment_id,
                    total_amount: convertToHuman(
                        savedRefund.presentment_total_amount,
                        savedRefund.presentment_currency as CurrencyCode
                    ),
                    transaction_date: savedRefund.transaction_date,
                    status: istatus.get(savedRefund.status) || "non-existent-status",
                    visible_id: savedRefund.visible_id,
                    vendor: "bancard",
                    method: savedRefund.method || "Online",
                    type: "refund",
                },
            },
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};

export const getStatus = async (req: Request, res: Response) => {
    try {
        const { transactionId } = req.params;
        const config = getVendorConfig();
        const message = messageGenerator(config.locale);

        const trxnData = await Transaction.findById(transactionId);

        if (!trxnData) {
            return res.status(status.NOT_FOUND).json({ error: 'Transaction not found' });
        }

        const shop_process_id = trxnData.id;
        // Token: md5(private_key + shop_process_id + "get_confirmation")
        const tokenString = config.password + shop_process_id + "get_confirmation";
        const token = cryptoJs.MD5(tokenString).toString();

        const body = {
            public_key: config.username,
            operation: {
                token: token,
                shop_process_id: shop_process_id,
            },
        };

        const baseUrl = config.test
            ? "https://vpos.infonet.com.py:8888"
            : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy/confirmations`;

        const { res: apiRes, err } = await resilientFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!apiRes || !apiRes.ok) {
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_status_issue", err),
            });
        }

        const responseJson: any = await apiRes.json();

        let newStatus = pstatus.vpos_processing;
        let failureMessage = "";

        if (responseJson.status === "success" && responseJson.confirmation) {
            const conf = responseJson.confirmation;
            if (conf.response_code === "00") {
                newStatus = pstatus.vpos_success;
            } else {
                newStatus = pstatus.vpos_failed;
                failureMessage = conf.response_description || "Transaction declined";
            }
        } else if (responseJson.status === "error") {
            if (responseJson.messages) {
                const isNotFound = responseJson.messages.some((m: any) => m.key === "PaymentNotFoundError");
                if (isNotFound) {
                    newStatus = pstatus.vpos_processing;
                } else {
                    newStatus = pstatus.vpos_failed;
                    failureMessage = JSON.stringify(responseJson.messages);
                }
            }
        }

        // Update DB
        if (newStatus !== trxnData.status) {
            trxnData.status = newStatus;
            trxnData.failure_message = failureMessage;
            await trxnData.save();
        }

        return res.status(status.OK).json({
            data: {
                response: responseJson,
                entity: trxnData.entity,
                status: trxnData.status,
                transaction: {
                    id: trxnData.id,
                    currency: trxnData.presentment_currency,
                    description: trxnData.description,
                    metadata: trxnData.metadata,
                    payment_id: trxnData.payment_id,
                    total_amount: convertToHuman(
                        trxnData.presentment_total_amount,
                        trxnData.presentment_currency as CurrencyCode
                    ),
                    transaction_date: trxnData.transaction_date,
                    status: istatus.get(trxnData.status) || "non-existent-status",
                    visible_id: trxnData.visible_id,
                    vendor: "bancard",
                    method: trxnData.method || "Online",
                    type: "sale",
                },
            },
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};
