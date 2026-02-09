import cryptoJs from "crypto-js";
export const createBancard = async (config: VendorConfig, order: Order) => {
    const message = messageGenerator(order.locale);
    const startTime = new Date();

    // Insert into pg_transactions to get an ID for shop_process_id
    const { data: insertedRow, error } = await supabase
        .from("pg_transactions")
        .insert({
            presentment_currency: order.currency,
            entity: order.eid,
            presentment_net_amount: order.amount,
            pg_id: config.id,
            status: pstatus.vpos_initiated,
            transaction_date: startTime.toISOString(),
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
        })
        .select("*");

    if (error || !insertedRow || insertedRow.length === 0) {
        return {
            error: message("transaction_creation_error", error?.message || "Unknown error"),
            status: status.SERVICE_UNAVAILABLE,
        };
    }

    const rawData = insertedRow[0];
    const shop_process_id = rawData.id;
    // Amount formatted with 2 decimals
    const amountString = convertToHuman(order.amount, order.currency).toFixed(2);

    // Token generation: md5(private_key + shop_process_id + amount + currency)
    // Ensure shop_process_id is string
    const tokenString = config.password + shop_process_id.toString() + amountString + order.currency;
    const token = cryptoJs.MD5(tokenString).toString();

    const body = {
        public_key: config.username,
        operation: {
            token: token,
            shop_process_id: shop_process_id,
            amount: amountString,
            currency: order.currency,
            description: order.description.substring(0, 20),
            return_url: order.returnUrl,
            cancel_url: order.returnUrl,
        },
    };

    const baseUrl = config.test ? "https://vpos.infonet.com.py:8888" : "https://vpos.infonet.com.py";
    const url = `${baseUrl}/vpos/api/0.3/single_buy`;

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
        } catch (e) { /* ignore */ }

        // Update status to failed
        await supabase.from("pg_transactions").update({ status: pstatus.vpos_failed }).eq("id", rawData.id);

        return {
            error: message("order_creation_failed", errorMessage),
            status: status.EXPECTATION_FAILED,
        };
    }

    const responseJson: any = await res.json();
    if (responseJson.status !== "success") {
        await supabase.from("pg_transactions").update({ status: pstatus.vpos_failed }).eq("id", rawData.id);
        return {
            error: message("order_creation_failed", JSON.stringify(responseJson)),
            status: status.EXPECTATION_FAILED,
        };
    }

    const process_id = responseJson.process_id;

    // Update pg_transactions with payment_id = process_id and status processing
    await supabase
        .from("pg_transactions")
        .update({ payment_id: process_id, status: pstatus.vpos_processing })
        .eq("id", rawData.id);

    const redirectParams = new URLSearchParams({
        process_id: process_id,
    });

    const redirectUrl = `${baseUrl}/payment/single_buy?${redirectParams.toString()}`;

    return {
        data: {
            response: { redirect_url: redirectUrl },
            entity: rawData.entity,
            status: pstatus.vpos_processing,
            transaction: {
                id: rawData.id,
                currency: rawData.presentment_currency,
                description: rawData.description,
                metadata: rawData.metadata,
                payment_id: process_id,
                total_amount: convertToHuman(
                    rawData.presentment_total_amount,
                    rawData.presentment_currency as CurrencyCode
                ),
                transaction_date: rawData.transaction_date,
                status: istatus.get(pstatus.vpos_processing) || "processing",
                visible_id: rawData.visible_id,
                vendor: "bancard" as const, // We will need to update VendorType
                method: rawData.method || "Online",
                type: "sale" as const,
            },
        },
        status: status.OK,
    };
};
