
import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import cryptoJs from 'crypto-js';
import { createHash } from "crypto";
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

        // Generate shop_process_id before creating transaction
        const shop_process_id = Math.floor(100 + Math.random() * 900) + String(Date.now()).slice(-6);

        // 1. Create initial transaction in DB
        const transaction = new Transaction({
            shop_process_id: shop_process_id, // Store the ID used for Bancard
            presentment_currency: order.currency,
            entity: order.eid || 'default',   // Fallback when eid is not supplied (e.g. direct frontend)
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

        const amountString = Number(convertToHuman(order.amount, order.currency)).toFixed(2);

        // 2. Generate Token
        // Token: md5(private_key + shop_process_id + amount + currency)
        const tokenString = config.password + shop_process_id + amountString + order.currency;
        const token = createHash("md5").update(tokenString).digest("hex");
        console.log("Shop Process ID", shop_process_id);
        console.log("Token", token);

        const body = {
            public_key: config.username,
            operation: {
                token: token,
                shop_process_id: shop_process_id,
                amount: amountString,
                currency: order.currency,
                description: order.description?.substring(0, 20) || "TEST",
                return_url: `${order.returnUrl}?shop_process_id=${shop_process_id}`,
                cancel_url: `${order.returnUrl}?shop_process_id=${shop_process_id}`,
            },
        };
        console.log("Config Test", config.test);
        const baseUrl = config.test ? "https://vpos.infonet.com.py:8888" : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy`;
        console.log("URL", url);
        console.log("Body", body);
        // 3. Call Bancard API
        let apiRes: any;
        let err: any;
        try {
            const response = await axios({
                url,
                data: body,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                httpsAgent: new https.Agent({ family: 4 }), // Force IPv4
            });
            apiRes = response;
        } catch (error) {
            err = error;
        }
        console.log("API Response", apiRes ? apiRes.status : "No Response");
        console.log("Error", err ? err.message : "No Error");
        if (err || !apiRes || apiRes.status !== 200) { // Axios throws on error, but we can double check status
            let errorMessage = err ? (err.response?.data ? JSON.stringify(err.response.data) : err.message) : "Unknown Error";
            console.log("Error Message", errorMessage);

            savedTransaction.status = pstatus.vpos_failed;
            transaction.failure_message = errorMessage;
            await savedTransaction.save();

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("order_creation_failed", errorMessage),
            });
        }

        const responseJson: any = apiRes.data;
        console.log("Response JSON", responseJson);
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
        console.log("Redirect URL / Process ID", redirectUrl, process_id);
        return res.status(status.OK).json({
            // Top-level process_id for easy access by the JS checkout library integration
            process_id: process_id,
            data: {
                response: { redirect_url: redirectUrl },
                entity: savedTransaction.entity,
                status: pstatus.vpos_processing,
                process_id: process_id,
                transaction: {
                    id: savedTransaction.id,
                    shop_process_id: savedTransaction.shop_process_id,
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

        const updatedTransaction = await Transaction.findOneAndUpdate(
            { shop_process_id: shop_process_id },
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

        const originalTransaction = await Transaction.findOne({ shop_process_id: transactionId });
        if (!originalTransaction) {
            return res.status(status.NOT_FOUND).json({ error: "Transaction not found" });
        }

        const shop_process_id = originalTransaction.shop_process_id;

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

        let apiRes: any;
        let err: any;
        try {
            apiRes = await axios({
                url,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                data: body,
                httpsAgent: new https.Agent({ family: 4 }),
                validateStatus: () => true
            });
        } catch (error) {
            err = error;
        }

        if (!apiRes || (apiRes.status < 200 || apiRes.status >= 300)) {
            let errorMessage = err ? err.message : "Unknown Error";
            try {
                if (apiRes && apiRes.data) {
                    errorMessage = JSON.stringify(apiRes.data);
                }
            } catch (e) { /* ignore */ }

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("refund_order_creation_issue", errorMessage),
            });
        }

        const responseJson: any = apiRes.data;
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
        console.log(transactionId);
        const config = getVendorConfig();
        const message = messageGenerator(config.locale);

        const trxnData = await Transaction.findOne({ shop_process_id: transactionId });

        const shop_process_id = transactionId;
        console.log("shop_process_id", shop_process_id);
        console.log("config.password", config.password);
        // Token: md5(private_key + shop_process_id + "get_confirmation")
        const tokenString = config.password + shop_process_id + "get_confirmation";
        const token = createHash("md5").update(tokenString).digest("hex");

        const body = {
            public_key: config.username,
            operation: {
                token: token,
                shop_process_id: shop_process_id,
            },
        };
        console.log("body", body);
        const baseUrl = config.test
            ? "https://vpos.infonet.com.py:8888"
            : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy/confirmations`;
        console.log("url", url);

        let apiRes: any;
        let err: any;
        try {
            apiRes = await axios({
                url,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                data: body,
                httpsAgent: new https.Agent({ family: 4 }),
                validateStatus: () => true
            });
        } catch (error) {
            err = error;
        }

        if (!apiRes) {
            console.log("API Response Error", err);
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_status_issue", err ? err.message : "Network Error"),
            });
        }

        const responseJson: any = apiRes.data;

        if ((apiRes.status < 200 || apiRes.status >= 300) && responseJson?.status !== "error") {
            console.log("API Response", apiRes.status);
            console.log("Response JSON", responseJson);
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_status_issue", `API returned ${apiRes.status}`),
            });
        }
        console.log("Response JSON", responseJson);
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
        if (trxnData && newStatus !== trxnData.status) {
            trxnData.status = newStatus;
            trxnData.failure_message = failureMessage;
            await trxnData.save();
        }

        return res.status(status.OK).json({
            data: {
                response: responseJson,
                entity: trxnData?.entity,
                status: trxnData?.status,
                transaction: {
                    id: trxnData?.id,
                    currency: trxnData?.presentment_currency,
                    description: trxnData?.description,
                    metadata: trxnData?.metadata,
                    payment_id: trxnData?.payment_id,
                    total_amount: convertToHuman(
                        trxnData?.presentment_total_amount ?? 0,
                        trxnData?.presentment_currency as CurrencyCode
                    ),
                    transaction_date: trxnData?.transaction_date,
                    status: istatus.get(trxnData?.status ?? "") || "non-existent-status",
                    visible_id: trxnData?.visible_id,
                    vendor: "bancard",
                    method: trxnData?.method || "Online",
                    type: "sale",
                },
            },
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
};
