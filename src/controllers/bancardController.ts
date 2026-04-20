
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
import { createLogger } from '../utils/logger';

import dotenv from 'dotenv';
dotenv.config();
const logger = createLogger("bancard-controller", "bancard.log");
const bancardApiLogger = createLogger("bancard-api", "bancard-api.log");

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

const formatBancardMessages = (messages: any[] = []) => {
    if (!Array.isArray(messages) || messages.length === 0) {
        return "";
    }

    return messages
        .map((message) => message?.dsc || message?.key || "")
        .filter(Boolean)
        .join("; ");
};

const serializeAxiosError = (error: any) => ({
    message: error?.message,
    status: error?.response?.status,
    data: error?.response?.data,
});

const summarizeOperation = (operation: Record<string, unknown>) => ({
    shop_process_id: operation.shop_process_id,
    amount: operation.amount,
    currency: operation.currency,
    description: operation.description,
    return_url: operation.return_url,
    cancel_url: operation.cancel_url,
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
        const baseUrl = config.test ? "https://vpos.infonet.com.py:8888" : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy`;
        logger.info("Creating Bancard transaction", {
            shop_process_id,
            amount: amountString,
            currency: order.currency,
            mode: config.test ? "test" : "production",
        });
        bancardApiLogger.info("Sending single_buy request", {
            url,
            operation: summarizeOperation(body.operation),
        });
        // 3. Call Bancard API
        let apiRes: any;
        let err: any;
        try {
            const response = await axios({
                url,
                data: body,
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });

            apiRes = response;
            bancardApiLogger.info("single_buy response received", {
                status: response.status,
                data: response.data,
            });
        } catch (error: any) {
            err = error;
            bancardApiLogger.error("single_buy request failed", serializeAxiosError(error));
        }
        if (err || !apiRes || apiRes.status !== 200) { // Axios throws on error, but we can double check status
            let errorMessage = err ? (err.response?.data ? JSON.stringify(err.response.data) : err.message) : "Unknown Error";
            logger.error("Bancard transaction creation failed", {
                shop_process_id,
                error: errorMessage,
            });

            savedTransaction.status = pstatus.vpos_failed;
            transaction.failure_message = errorMessage;
            await savedTransaction.save();

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("order_creation_failed", errorMessage),
            });
        }

        const responseJson: any = apiRes.data;
        if (responseJson.status !== "success") {
            savedTransaction.status = pstatus.vpos_failed;
            savedTransaction.failure_message = formatBancardMessages(responseJson.messages) || JSON.stringify(responseJson);
            await savedTransaction.save();
            logger.warn("Bancard returned a non-success create response", {
                shop_process_id,
                response: responseJson,
            });
            return res.status(status.EXPECTATION_FAILED).json({
                error: message("order_creation_failed", savedTransaction.failure_message),
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
        logger.info("Bancard transaction moved to processing", {
            shop_process_id,
            process_id,
            redirectUrl,
        });
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
        logger.error("Unexpected error while creating transaction", error);
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

        logger.info("Received Bancard confirmation callback", {
            shop_process_id,
            response_code,
            response_description,
        });

        // Validate Token: md5(private_key + shop_process_id + "confirm" + amount + currency)
        const tokenString = config.password + shop_process_id + "confirm" + amount + currency;
        const calculatedToken = cryptoJs.MD5(tokenString).toString();

        if (calculatedToken !== token) {
            logger.warn("Rejected Bancard confirmation because token validation failed", {
                shop_process_id,
            });
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
            logger.warn("Bancard confirmation received for unknown transaction", {
                shop_process_id,
            });
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_update_error", "Transaction not found"),
            });
        }

        logger.info("Transaction updated from Bancard confirmation", {
            shop_process_id,
            status: trxnStatus,
        });

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
        logger.error("Unexpected error while updating transaction", error);
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
            logger.warn("Refund requested for unknown transaction", {
                transactionId,
            });
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
        logger.info("Requesting Bancard rollback", {
            shop_process_id,
            mode: config.test ? "test" : "production",
        });
        bancardApiLogger.info("Sending rollback request", {
            url,
            operation: summarizeOperation(body.operation),
        });

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
            bancardApiLogger.info("rollback response received", {
                status: apiRes.status,
                data: apiRes.data,
            });
        } catch (error) {
            err = error;
            bancardApiLogger.error("rollback request failed", serializeAxiosError(error));
        }

        if (!apiRes || (apiRes.status < 200 || apiRes.status >= 300)) {
            let errorMessage = err ? err.message : "Unknown Error";
            try {
                if (apiRes && apiRes.data) {
                    errorMessage = JSON.stringify(apiRes.data);
                }
            } catch (e) { /* ignore */ }

            logger.error("Bancard rollback failed", {
                shop_process_id,
                error: errorMessage,
            });

            return res.status(status.EXPECTATION_FAILED).json({
                error: message("refund_order_creation_issue", errorMessage),
            });
        }

        const responseJson: any = apiRes.data;
        if (responseJson.status !== "success") {
            logger.warn("Bancard returned a non-success rollback response", {
                shop_process_id,
                response: responseJson,
            });
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
        logger.info("Refund transaction created", {
            shop_process_id,
            refundTransactionId: savedRefund.id,
        });

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
        logger.error("Unexpected error while refunding transaction", error);
        return res.status(500).json({ error: error.message });
    }
};

export const getStatus = async (req: Request, res: Response) => {
    try {
        const { transactionId } = req.params;
        const config = getVendorConfig();
        const message = messageGenerator(config.locale);

        const trxnData = await Transaction.findOne({ shop_process_id: transactionId });

        const shop_process_id = transactionId;
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
        const baseUrl = config.test
            ? "https://vpos.infonet.com.py:8888"
            : "https://vpos.infonet.com.py";
        const url = `${baseUrl}/vpos/api/0.3/single_buy/confirmations`;
        logger.info("Requesting Bancard transaction status", {
            shop_process_id,
            mode: config.test ? "test" : "production",
        });
        bancardApiLogger.info("Sending confirmations request", {
            url,
            operation: summarizeOperation(body.operation),
        });

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
            bancardApiLogger.info("confirmations response received", {
                status: apiRes.status,
                data: apiRes.data,
            });
        } catch (error) {
            err = error;
            bancardApiLogger.error("confirmations request failed", serializeAxiosError(error));
        }

        if (!apiRes) {
            logger.error("Unable to reach Bancard confirmations endpoint", {
                shop_process_id,
                error: err,
            });
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_status_issue", err ? err.message : "Network Error"),
            });
        }

        const responseJson: any = apiRes.data;

        if ((apiRes.status < 200 || apiRes.status >= 300) && responseJson?.status !== "error") {
            logger.warn("Bancard confirmations endpoint returned an unexpected status", {
                shop_process_id,
                statusCode: apiRes.status,
                response: responseJson,
            });
            return res.status(status.SERVICE_UNAVAILABLE).json({
                error: message("transaction_status_issue", `API returned ${apiRes.status}`),
            });
        }
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
                const bancardErrorMessage = formatBancardMessages(responseJson.messages) || JSON.stringify(responseJson.messages);
                if (isNotFound) {
                    newStatus = pstatus.vpos_failed;
                    failureMessage = bancardErrorMessage;
                } else {
                    newStatus = pstatus.vpos_failed;
                    failureMessage = bancardErrorMessage;
                }
            }
        }

        // Update DB
        if (trxnData && newStatus !== trxnData.status) {
            trxnData.status = newStatus;
            trxnData.failure_message = failureMessage;
            await trxnData.save();
            logger.info("Transaction status updated from Bancard check", {
                shop_process_id,
                status: newStatus,
                failure_message: failureMessage || null,
            });
        }

        const effectiveStatus = trxnData?.status ?? newStatus;
        const effectiveFailureMessage = trxnData?.failure_message ?? failureMessage;

        return res.status(status.OK).json({
            data: {
                response: responseJson,
                entity: trxnData?.entity,
                status: effectiveStatus,
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
                    status: istatus.get(effectiveStatus) || "non-existent-status",
                    visible_id: trxnData?.visible_id,
                    vendor: "bancard",
                    method: trxnData?.method || "Online",
                    type: "sale",
                    failure_message: effectiveFailureMessage,
                },
            },
        });

    } catch (error: any) {
        logger.error("Unexpected error while fetching transaction status", error);
        return res.status(500).json({ error: error.message });
    }
};
