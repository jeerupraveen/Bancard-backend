import {
    CurrencyCode,
    RawTransaction,
    RefundOrder,
    RefundOrderReturnType,
    VendorConfig,
} from "@/types";
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

export const refundBancard = async (
    config: VendorConfig,
    trxnData: RawTransaction,
    refundOrder: RefundOrder
) => {
    const message = messageGenerator(config.locale);
    const shop_process_id = trxnData.id;

    // Token construction for rollback: md5(private_key + shop_process_id + "rollback" + "0.00")
    const tokenString = config.password + shop_process_id + "rollback" + "0.00";
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
    const url = `${baseUrl}/vpos/api/0.3/single_buy/rollback`;

    const { res, err } = await resilientFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res || !res.ok) {
        let errorMessage = err;
        try {
            if (res) {
                const errJson = await res.json();
                errorMessage = JSON.stringify(errJson);
            }
        } catch (e) {/* ignore */ }

        return {
            error: message("refund_order_creation_issue", errorMessage),
            status: status.EXPECTATION_FAILED,
        };
    }

    const responseJson: any = await res.json();
    if (responseJson.status !== "success") {
        return {
            error: message("refund_order_creation_issue", JSON.stringify(responseJson)),
            status: status.EXPECTATION_FAILED,
        };
    }

    // Record the refund/rollback in pg_transactions
    const { data: insertedRow, error } = await supabase
        .from("pg_transactions")
        .insert({
            entity: trxnData.entity,
            payment_id: "rollback-" + shop_process_id, // vPOS doesn't return a distinct ID for rollback
            pg_id: config.id,
            status: pstatus.vpos_rollback,
            transaction_date: new Date().toISOString(),
            pg_user: trxnData.pg_user,
            description: refundOrder.description,
            metadata: refundOrder.metadata,
            presentment_currency: trxnData.presentment_currency,
            presentment_total_amount: refundOrder.amount,
            presentment_net_amount: refundOrder.amount,
            settlement_currency: trxnData.settlement_currency,
            settlement_total_amount: refundOrder.amount,
            settlement_net_amount: refundOrder.amount,
            method: trxnData.method,
            is_refund: true,
            links_to: trxnData.id,
            visible_id: "ROLLBACK-" + shop_process_id
        })
        .select("*");

    if (error) {
        return {
            error: message("transaction_creation_error", error.message),
            status: status.SERVICE_UNAVAILABLE,
        };
    }

    const rawData = insertedRow[0];

    const response: RefundOrderReturnType = {
        id: rawData.id,
        transaction_date: rawData.transaction_date,
        status: istatus.get(rawData.status) || "non-existent-status",
        visible_id: rawData.visible_id,
        vendor: "bancard" as const,
    };

    return {
        data: {
            response: response,
            entity: rawData.entity,
            status: rawData.status,
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
                status: istatus.get(rawData.status) || "non-existent-status",
                visible_id: rawData.visible_id,
                vendor: "bancard" as const,
                method: rawData.method || "Online",
                type: "refund" as const,
            },
        },
        status: status.OK,
    };
};
