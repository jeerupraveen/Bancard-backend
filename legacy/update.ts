import { CurrencyCode, VendorConfig } from "@/types";
import {
    convertToHuman,
    istatus,
    messageGenerator,
    pstatus,
    status,
    supabase,
} from "@/utils";
import cryptoJs from "crypto-js";

export const updateBancard = async (config: VendorConfig, req: any) => {
    const message = messageGenerator(config.locale);
    const body = req.body;
    const operation = body.operation;

    if (!operation) {
        return {
            error: message("improper_update_request"),
            status: status.BAD_REQUEST,
        };
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
    // Ensure shop_process_id is treated as string if it's number
    const tokenString = config.password + shop_process_id.toString() + "confirm" + amount + currency;
    const calculatedToken = cryptoJs.MD5(tokenString).toString();

    if (calculatedToken !== token) {
        return {
            error: message("invalid_token"),
            status: status.UNAUTHORIZED
        };
    }

    // Determine status
    let trxnStatus = pstatus.vpos_failed;
    if (response_code === "00") {
        trxnStatus = pstatus.vpos_success;
    }

    // Update DB
    const { data: insertedRow, error } = await supabase
        .from("pg_transactions")
        .update({
            status: trxnStatus,
            failure_message: response_code !== "00" ? response_description : null
        })
        .eq("id", shop_process_id)
        .select("*");

    if (error || !insertedRow || insertedRow.length === 0) {
        return {
            error: message("transaction_update_error", error?.message || "Transaction not found"),
            status: status.SERVICE_UNAVAILABLE
        };
    }

    const rawData = insertedRow[0];

    return {
        data: {
            response: { status: "success" },
            entity: rawData.entity,
            status: trxnStatus,
            transaction: {
                id: rawData.id,
                currency: rawData.presentment_currency,
                description: rawData.description,
                metadata: rawData.metadata,
                payment_id: rawData.payment_id,
                total_amount: convertToHuman(
                    rawData.presentment_total_amount,
                    rawData.presentment_currency as CurrencyCode
                ),
                transaction_date: rawData.transaction_date,
                status: istatus.get(trxnStatus) || "non-existent-status",
                visible_id: rawData.visible_id,
                vendor: "bancard" as const,
                method: rawData.method || "Online",
                type: "sale" as const,
                failure_message: rawData.failure_message
            },
        },
        status: status.OK,
    };
};
