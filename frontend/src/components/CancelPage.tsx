import { useNavigate, useSearchParams } from 'react-router-dom'

export default function CancelPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const shopProcessId = searchParams.get('shop_process_id')

    return (
        <>
            <header className="page-header">
                <div className="logo-row">
                    <div className="logo-icon">🚫</div>
                    <h1>Payment Cancelled</h1>
                </div>
                <p>You cancelled the payment. No charge was made.</p>
            </header>

            <main className="checkout-card result-card" role="main">
                <div
                    className="status-badge"
                    style={{
                        background: 'rgba(255,107,114,0.10)',
                        border: '1px solid rgba(255,107,114,0.25)',
                        color: '#ff6b72',
                    }}
                >
                    <span className="status-icon">🚫</span>
                    <span>Payment Cancelled</span>
                </div>

                <div className="alert alert-error" role="alert">
                    <span className="alert-icon">ℹ️</span>
                    <span>
                        The payment was cancelled before completion.
                        {shopProcessId && (
                            <> Reference: <code className="tx-code">{shopProcessId}</code></>
                        )}
                    </span>
                </div>

                <div className="result-actions">
                    <button
                        id="retry-after-cancel-button"
                        className="btn-pay"
                        onClick={() => navigate('/')}
                    >
                        🔁 Try Again
                    </button>
                </div>

                <div className="security-footer">
                    <span className="lock-icon">🔐</span>
                    Secured by Bancard vPOS
                </div>
            </main>
        </>
    )
}
