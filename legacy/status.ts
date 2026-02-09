import { CurrencyCode, RawTransaction, VendorConfig } from "@/types";
import {
    convertToHuman,
    istatus,
    messageGenerator,
    pstatus,
    resilientFetch,
    status,
    supabase,
} from "@/utils";
import cryptoJs from "crypto-js";

export const statusBancard = async (
    config: VendorConfig,
    trxnData: RawTransaction
) => {
    const message = messageGenerator(config.locale);
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

    const { res, err } = await resilientFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res || !res.ok) {
        // If network error, return error
        return {
            error: message("transaction_status_issue", err),
            status: status.SERVICE_UNAVAILABLE,
        };
    }

    const responseJson: any = await res.json();

    let newStatus = pstatus.vpos_processing; // Default to processing if no confirmation yet
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
        // Check for PaymentNotFoundError
        if (responseJson.messages) {
            const isNotFound = responseJson.messages.some((m: any) => m.key === "PaymentNotFoundError");
            if (isNotFound) {
                // Still pending or abandoned
                newStatus = pstatus.vpos_processing; // Or initiated
            } else {
                newStatus = pstatus.vpos_failed;
                failureMessage = JSON.stringify(responseJson.messages);
            }
        }
    }

    // Update DB if status changed
    if (newStatus !== trxnData.status) {
        await supabase
            .from("pg_transactions")
            .update({ status: newStatus, failure_message: failureMessage })
            .eq("id", trxnData.id);

        trxnData.status = newStatus;
    }

    return {
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
                vendor: "bancard" as const,
                method: trxnData.method || "Online",
                type: "sale" as const,
            },
        },
        status: status.OK,
    };
};
