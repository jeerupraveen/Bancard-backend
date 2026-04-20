import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import bancardRoutes from './routes/bancard';
import connectDB from './config/db';
import { logger, requestLogger } from './utils/logger';

const app: Express = express();

// Connect to Database
connectDB();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/api/bancard', bancardRoutes);

app.get('/callback', (req: Request, res: Response) => {
    const { status, description } = req.query;
    logger.info("Callback received", {
        query: req.query,
        body: req.body,
    });

    res.send(`
        <html>
            <head>
                <title>Payment Callback</title>
                <style>
                    body { font-family: sans-serif; padding: 2rem; }
                    .container { max-width: 600px; margin: 0 auto; border: 1px solid #ccc; padding: 2rem; border-radius: 8px; }
                    .status { font-weight: bold; color: ${status === 'success' ? 'green' : 'red'}; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Payment Callback Received</h1>
                    <p>Status: <span class="status">${status || 'Unknown'}</span></p>
                    <p>Description: ${description || 'No description provided'}</p>
                    <hr/>
                    <h3>Debug Info (Query Params):</h3>
                    <pre>${JSON.stringify(req.query, null, 2)}</pre>
                    <br/>
                    <a href="/">Back to Home</a>
                </div>
            </body>
        </html>
    `);
});

app.get('/', (req: Request, res: Response) => {
    res.send('Bancard Backend is running');
});

export default app;
