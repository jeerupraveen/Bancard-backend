import express, { Request, Response } from 'express';
import {
    createTransaction,
    updateTransaction,
    refundTransaction,
    getStatus
} from '../controllers/bancardController';
import { createLogger } from '../utils/logger';

const router = express.Router();
const logger = createLogger('bancard-route', 'bancard.log');

// Create a new transaction (Single Buy)
router.post('/create', createTransaction);

// Handle Bancard confirmation (Webhook / Callback)
router.post('/update', updateTransaction);

// Refund a transaction
router.post('/refund/:transactionId', refundTransaction);

// Get transaction status
router.get('/status/:transactionId', getStatus);

// ── Webhook inspector ──────────────────────────────────────────────────────────
// Receives raw Bancard PG notifications, logs headers + body, responds OK.
router.post('/webhook', (req: Request, res: Response) => {
    logger.info('Webhook received', {
        headers: req.headers,
        body: req.body,
    });

    res.status(200).json({ status: 'ok' });
});

export default router;
