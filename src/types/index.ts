export interface VendorConfig {
    id: string;
    username: string; // Public Key
    password: string; // Private Key
    test: boolean;
    locale: string;
}

export interface Order {
    eid: string;
    amount: number;
    currency: string;
    description: string;
    metadata: any;
    returnUrl: string;
    pgMetadata: any;
    paymentMethod: string;
    locale: string;
}

export interface RefundOrder {
    amount: number;
    description: string;
    metadata: any;
}

export interface RefundOrderReturnType {
    id: string;
    transaction_date: string;
    status: string;
    visible_id: string;
    vendor: "bancard";
}

export interface RawTransaction {
    id: string;
    ids: string;
    presentment_currency: string;
    entity: string;
    status: string;
    transaction_date: string;
    description: string;
    metadata: any;
    payment_id: string;
    presentment_total_amount: number;
    visible_id: string;
    method: string;
    pg_user?: string;
    settlement_currency?: string;
    settlement_total_amount?: number;
    failure_message?: string;
    [key: string]: any;
}

export type CurrencyCode = "PYG" | "USD";

export interface Gateway {
    eid: string;
    id: string;
    type: string;
    name: string;
    username: string;
    description: string;
}
