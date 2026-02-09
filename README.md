
# Bancard Backend

This is an Express.js server for Bancard integration.

## Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Variables:**
    Create a `.env` file in the root directory and add the following:
    ```env
    PORT=3000
    MONGODB_URI=mongodb://localhost:27017/bancard
    BANCARD_ID=your_id_here
    BANCARD_PUBLIC_KEY=your_public_key_here
    BANCARD_PRIVATE_KEY=your_private_key_here
    BANCARD_MODE=test # or production
    ```

3.  **Run Development Server:**
    ```bash
    npm run dev
    ```

4.  **Build and Run:**
    ```bash
    npm run build
    npm start
    ```

## API Endpoints

-   **Create Transaction:** `POST /api/bancard/create`
-   **Update Transaction (Webhook):** `POST /api/bancard/update`
-   **Refund Transaction:** `POST /api/bancard/refund/:transactionId`
-   **Get Status:** `GET /api/bancard/status/:transactionId`

## Database

By default, it connects to a local MongoDB instance at `mongodb://localhost:27017/bancard`. Ensure MongoDB is running.
