import express from 'express';
import {
    createTransaction,
    updateTransaction,
    refundTransaction,
    getStatus
} from '../controllers/bancardController';

const router = express.Router();

// Create a new transaction (Single Byte)
router.post('/create', createTransaction);

// Handle Bancard confirmation (Webhook / Callback)
router.post('/update', updateTransaction);

// Refund a transaction
router.post('/refund/:transactionId', refundTransaction);

// Get transaction status
router.get('/status/:transactionId', getStatus);

export default router;
