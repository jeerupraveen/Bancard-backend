
export const status = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    EXPECTATION_FAILED: 417,
    SERVICE_UNAVAILABLE: 503,
    NOT_IMPLEMENTED: 501,
};

export const pstatus = {
    vpos_initiated: "initiated",
    vpos_processing: "processing",
    vpos_success: "success",
    vpos_failed: "failed",
    vpos_rollback: "rollback",
};

export const istatus = new Map<string, string>([
    [pstatus.vpos_initiated, "initiated"],
    [pstatus.vpos_processing, "processing"],
    [pstatus.vpos_success, "success"],
    [pstatus.vpos_failed, "failed"],
    [pstatus.vpos_rollback, "rollback"],
]);

export const convertToHuman = (amount: number, currency: string): number => {
    // Basic implementation: if needed, adjust based on currency decimals
    // Standard currency handling usually divides by 100 for cents
    // But verify if input is already float. Code had .toFixed(2), so likely float.
    return amount;
};

export const messageGenerator = (locale: string) => {
    return (key: string, ...args: any[]) => {
        const messages: Record<string, string> = {
            transaction_creation_error: "Error creating transaction: " + args[0],
            order_creation_failed: "Order creation failed: " + args[0],
            transaction_status_issue: "Transaction status issue: " + args[0],
            improper_update_request: "Improper update request",
            invalid_token: "Invalid token",
            transaction_update_error: "Transaction update error: " + args[0],
            confirm_not_needed: "Confirmation not needed",
            refund_order_creation_issue: "Refund order creation issue: " + args[0],
            cancel_order_issue: "Cancel order issue",
        };
        return messages[key] || key;
    };
};

