import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
    presentment_currency: string;
    entity?: string;
    presentment_net_amount: number;
    pg_id: string;
    status: string;
    transaction_date: Date;
    description: string;
    metadata: any;
    return_url: string;
    pg_metadata: any;
    method: string;
    presentment_total_amount: number;
    settlement_total_amount: number;
    payment_id: string;
    settlement_currency: string;
    settlement_net_amount: number;
    visible_id: string;
    failure_message?: string;
    is_refund?: boolean;
    links_to?: string;
    pg_user?: string;
    shop_process_id?: string;
}

const TransactionSchema: Schema = new Schema({
    presentment_currency: { type: String, required: true },
    entity: { type: String, required: false, default: 'default' },
    presentment_net_amount: { type: Number, required: true },
    pg_id: { type: String, required: true },
    status: { type: String, required: true },
    transaction_date: { type: Date, default: Date.now },
    description: { type: String },
    metadata: { type: Schema.Types.Mixed }, // Arbitrary JSON
    return_url: { type: String },
    pg_metadata: { type: Schema.Types.Mixed },
    method: { type: String },
    presentment_total_amount: { type: Number },
    settlement_total_amount: { type: Number },
    payment_id: { type: String },
    settlement_currency: { type: String },
    settlement_net_amount: { type: Number },
    visible_id: { type: String }, // For Bancard rollback/refunds
    failure_message: { type: String },
    is_refund: { type: Boolean, default: false },
    links_to: { type: String }, // ID of the original transaction
    pg_user: { type: String },
    shop_process_id: { type: String, unique: true, sparse: true }, // Add shop_process_id
}, { timestamps: true });

// Add a virtual 'id' property that maps to '_id' to match Supabase behavior
TransactionSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        delete ret._id;
        // ret.id is automatically added by virtuals: true
    }
});

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
