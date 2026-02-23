import { useState, useEffect, useRef } from 'react'

// Declare the global Bancard object injected by bancard-checkout.js
declare global {
    interface Window {
        Bancard?: {
            Checkout: {
                createForm: (containerId: string, processId: string, options: object) => void;
                clean: () => void;
            };
            Cards: {
                createForm: (containerId: string, processId: string, options: object) => void;
                clean: () => void;
            };
            Confirmation: {
                loadPinPad: (containerId: string, aliasToken: string, options: object) => void;
                clean: () => void;
            };
        };
    }
}

// ─── Bancard Custom Styles ───────────────────────────────────────────────────
const bancardStyles = {
    'input-background-color': '#ffffff',
    'input-text-color': '#555555',
    'input-border-color': '#cccccc',
    'button-background-color': '#5cb85c',
    'button-text-color': '#ffffff',
    'button-border-color': '#4cae4c',
    'form-background-color': '#ffffff',
    'form-border-color': '#dddddd',
    'header-background-color': '#f5f5f5',
    'header-text-color': '#333333',
    'hr-border-color': '#eeeeee',
    'label-kyc-text-color': '#333333',
    'input-error-color': '#d9534f',
    'input-cvv-color': '#555555',
    'input-border-radius': '5px',
    'form-font-size': '1rem',
    'form-font-family': 'Inter, sans-serif',
    'floating-placeholder': 'true',
    'label-text-color': '#555555',
    'tab-main-color': '#5cb85c',       // active tab accent colour (green brand)
    'tab-background-color': '#f5f5f5', // tab bg — light grey so card logos are visible
};

const bancardOptions = { styles: bancardStyles };

// ─── Types ───────────────────────────────────────────────────────────────────
type Step = 'form' | 'checkout' | 'success' | 'cancel';

export default function App() {
    const [step, setStep] = useState<Step>('form');
    const [amount, setAmount] = useState('100000');
    const [description, setDescription] = useState('Pago Bancard');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [processId, setProcessId] = useState('');
    const iframeInitialised = useRef(false);

    // Mount Bancard form after processId is set and DOM is ready
    useEffect(() => {
        if (step !== 'checkout' || !processId || iframeInitialised.current) return;

        const tryMount = () => {
            if (window.Bancard) {
                iframeInitialised.current = true;
                window.Bancard.Checkout.createForm('iframe-container', processId, bancardOptions);
            } else {
                // Library not yet loaded — retry shortly
                setTimeout(tryMount, 200);
            }
        };
        tryMount();
    }, [step, processId]);

    // Clean up Bancard form when leaving checkout step
    useEffect(() => {
        return () => {
            if (window.Bancard) {
                try { window.Bancard.Checkout.clean(); } catch (_) { /* ignore */ }
            }
            iframeInitialised.current = false;
        };
    }, [step]);

    const handleCreatePayment = async () => {
        if (!amount || parseFloat(amount) <= 0) {
            setError('Please enter a valid amount.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const response = await fetch('http://localhost:3000/api/bancard/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    currency: 'PYG',
                    description,
                    returnUrl: `${window.location.origin}/success`,
                    cancelUrl: `${window.location.origin}/cancel`,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Payment initialisation failed');
            }

            // Backend returns process_id at top level, and also nested in data.data.transaction.payment_id
            const pid =
                data?.process_id ||
                data?.data?.process_id ||
                data?.data?.transaction?.payment_id;

            if (!pid) {
                throw new Error('No process_id received from server. Check backend response.');
            }

            iframeInitialised.current = false;
            setProcessId(pid);
            setStep('checkout');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBack = () => {
        iframeInitialised.current = false;
        setProcessId('');
        setError('');
        setStep('form');
    };

    // ─── Render: Payment Form ─────────────────────────────────────────────────
    if (step === 'form') {
        return (
            <>
                <header className="page-header">
                    <div className="logo-row">
                        <div className="logo-icon">💳</div>
                        <h1>Bancard Checkout</h1>
                    </div>
                    <p>Secure embedded payment powered by Bancard vPOS</p>
                </header>

                <main className="checkout-card" role="main">
                    <div className="card-title">
                        Payment Details
                        <span className="badge">Test Mode</span>
                    </div>

                    <div className="form-group">
                        <label htmlFor="description-input">Description</label>
                        <input
                            id="description-input"
                            type="text"
                            placeholder="e.g. Product purchase"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={20}
                        />
                    </div>

                    <div className="amount-row">
                        <div className="form-group">
                            <label htmlFor="amount-input">Amount</label>
                            <input
                                id="amount-input"
                                type="number"
                                placeholder="0"
                                value={amount}
                                min="1"
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>
                        <div className="currency-badge">PYG</div>
                    </div>

                    {error && (
                        <div className="alert alert-error" role="alert">
                            <span className="alert-icon">⚠️</span>
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="divider">Proceed to payment</div>

                    <button
                        id="pay-button"
                        className="btn-pay"
                        onClick={handleCreatePayment}
                        disabled={loading}
                    >
                        {loading ? (
                            <><span className="spinner" aria-hidden="true" />Initialising…</>
                        ) : (
                            '🔒  Pay with Bancard'
                        )}
                    </button>

                    <div className="security-footer">
                        <span className="lock-icon">🔐</span>
                        256-bit SSL encrypted &mdash; Your data is safe
                    </div>
                </main>
            </>
        );
    }

    // ─── Render: Embedded Bancard iFrame ──────────────────────────────────────
    if (step === 'checkout') {
        return (
            <>
                <header className="page-header">
                    <div className="logo-row">
                        <div className="logo-icon">💳</div>
                        <h1>Complete Payment</h1>
                    </div>
                    <p>Enter your card details below to finalise the transaction</p>
                </header>

                <main className="checkout-card" role="main">
                    <div className="card-title">
                        Secure Checkout
                        <span className="badge">vPOS</span>
                    </div>

                    {error && (
                        <div className="alert alert-error" role="alert">
                            <span className="alert-icon">⚠️</span>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Bancard embeds its iFrame here */}
                    <div className="bancard-iframe-wrapper">
                        <div id="iframe-container" />
                    </div>

                    <button
                        id="back-button"
                        className="btn-pay"
                        onClick={handleBack}
                        style={{ marginTop: '18px', background: 'rgba(255,255,255,0.08)', boxShadow: 'none' }}
                    >
                        ← Back to Amount
                    </button>

                    <div className="security-footer">
                        <span className="lock-icon">🔐</span>
                        Payment secured by Bancard vPOS
                    </div>
                </main>
            </>
        );
    }

    // ─── Render: Fallback ─────────────────────────────────────────────────────
    return null;
}
