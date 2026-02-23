import express, { Request, Response } from 'express';
import {
    createTransaction,
    updateTransaction,
    refundTransaction,
    getStatus
} from '../controllers/bancardController';

const router = express.Router();

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
    console.log('\n══════════════════════════════════════════════════');
    console.log('📥  BANCARD WEBHOOK RECEIVED');
    console.log('══════════════════════════════════════════════════');

    console.log('\n── HEADERS ──────────────────────────────────────────');
    console.log(JSON.stringify(req.headers, null, 2));

    console.log('\n── BODY ─────────────────────────────────────────────');
    console.log(JSON.stringify(req.body, null, 2));

    console.log('\n══════════════════════════════════════════════════\n');

    res.status(200).json({ status: 'ok' });
});

export default router;
