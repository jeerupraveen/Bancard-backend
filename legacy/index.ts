export class VendorBancard {
    readonly config: VendorConfig;
    readonly vendorType: VendorType = "bancard" as any; // Cast to any until VendorType is updated
    message: MessageFunction;

    constructor(config: VendorConfig) {
        this.config = config;
        this.message = messageGenerator(config.locale);
    }

    async fetchProviders(gateway: Gateway) {
        return {
            status: status.OK,
            data: {
                eid: gateway.eid,
                id: gateway.id,
                type: gateway.type,
                name: gateway.name,
                username: gateway.username,
                description: gateway.description,
            },
            error: undefined
        };
    }

    async create(order: Order) {
        return createBancard(this.config, order);
    }

    async status(transaction: RawTransaction) {
        return statusBancard(this.config, transaction);
    }

    async update(req: Request) {
        return updateBancard(this.config, req);
    }

    async cancel() {
        // Not implemented or needed if refund handles rollback
        return {
            status: status.NOT_IMPLEMENTED,
            error: this.message("cancel_order_issue", "Bancard"),
            data: undefined
        };
    }

    async refund(trxnData: RawTransaction, refundOrder: RefundOrder) {
        return refundBancard(this.config, trxnData, refundOrder);
    }

    async confirm(trxnData: RawTransaction) {
        return {
            status: status.BAD_REQUEST,
            error: this.message("confirm_not_needed"),
            data: undefined,
        };
    }

}
