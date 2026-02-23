import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

// ─── Types ───────────────────────────────────────────────────────────────────
type TxStatus = 'loading' | 'success' | 'processing' | 'failed' | 'error'

interface TransactionData {
    id: string
    currency: string
    description: string
    payment_id: string
    total_amount: number | string
    transaction_date: string
    status: string
    visible_id: string
    vendor: string
    method: string
    type: string
}

const STATUS_CONFIG: Record<TxStatus, { icon: string; label: string; colorVar: string; bg: string; border: string }> = {
    loading: { icon: '⏳', label: 'Verifying…', colorVar: '#8899aa', bg: 'rgba(136,153,170,0.10)', border: 'rgba(136,153,170,0.25)' },
    success: { icon: '✅', label: 'Payment Successful', colorVar: '#5cb85c', bg: 'rgba(92,184,92,0.12)', border: 'rgba(92,184,92,0.30)' },
    processing: { icon: '🔄', label: 'Processing…', colorVar: '#f0ad4e', bg: 'rgba(240,173,78,0.12)', border: 'rgba(240,173,78,0.30)' },
    failed: { icon: '❌', label: 'Payment Failed', colorVar: '#ff6b72', bg: 'rgba(255,107,114,0.12)', border: 'rgba(255,107,114,0.30)' },
    error: { icon: '⚠️', label: 'Verification Error', colorVar: '#ff6b72', bg: 'rgba(255,107,114,0.12)', border: 'rgba(255,107,114,0.30)' },
}

// ──────────────────────────────────────────────────────────────────────────────
export default function SuccessPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const shopProcessId = searchParams.get('shop_process_id')

    const [txStatus, setTxStatus] = useState<TxStatus>('loading')
    const [txData, setTxData] = useState<TransactionData | null>(null)
    const [rawStatus, setRawStatus] = useState<string>('')
    const [failureMsg, setFailureMsg] = useState<string>('')
    const [errorMsg, setErrorMsg] = useState<string>('')
    const [retryCount, setRetryCount] = useState(0)

    const fetchStatus = useCallback(async () => {
        if (!shopProcessId) {
            setTxStatus('error')
            setErrorMsg('No shop_process_id found in URL. Cannot verify payment.')
            return
        }

        setTxStatus('loading')
        setErrorMsg('')

        try {
            const res = await fetch(
                `http://localhost:3000/api/bancard/status/${shopProcessId}`
            )
            const json = await res.json()

            if (!res.ok) {
                throw new Error(json.error || `Server error ${res.status}`)
            }

            const tx: TransactionData = json?.data?.transaction
            const dbStatus: string = json?.data?.status ?? ''
            setTxData(tx ?? null)
            setRawStatus(dbStatus)

            // Map internal pstatus codes→UI states
            if (dbStatus.includes('success') || dbStatus === 'paid') {
                setTxStatus('success')
            } else if (dbStatus.includes('fail') || dbStatus.includes('error') || dbStatus.includes('decline')) {
                setTxStatus('failed')
                setFailureMsg(tx?.status || 'Transaction was declined.')
            } else {
                // still processing — could poll again
                setTxStatus('processing')
            }
        } catch (err: any) {
            setTxStatus('error')
            setErrorMsg(err.message || 'Failed to fetch transaction status.')
        }
    }, [shopProcessId])

    // Initial fetch on mount
    useEffect(() => {
        fetchStatus()
    }, [fetchStatus])

    // Auto-refresh if still processing (up to 5 retries, every 4s)
    useEffect(() => {
        if (txStatus !== 'processing' || retryCount >= 5) return
        const timer = setTimeout(() => {
            setRetryCount(c => c + 1)
            fetchStatus()
        }, 4000)
        return () => clearTimeout(timer)
    }, [txStatus, retryCount, fetchStatus])

    const cfg = STATUS_CONFIG[txStatus]

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '—'
        try {
            return new Intl.DateTimeFormat('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(new Date(dateStr))
        } catch {
            return dateStr
        }
    }

    const formatAmount = (amount?: number | string, currency?: string) => {
        if (amount === undefined || amount === null) return '—'
        const num = typeof amount === 'string' ? parseFloat(amount) : amount
        if (isNaN(num)) return String(amount)
        try {
            return new Intl.NumberFormat('es-PY', {
                style: 'currency',
                currency: currency || 'PYG',
                minimumFractionDigits: 0,
            }).format(num)
        } catch {
            return `${currency || 'PYG'} ${num.toLocaleString()}`
        }
    }

    return (
        <>
            {/* Page header */}
            <header className="page-header">
                <div className="logo-row">
                    <div className="logo-icon">{cfg.icon}</div>
                    <h1>{cfg.label}</h1>
                </div>
                <p>
                    {shopProcessId
                        ? <>Transaction ID: <code className="tx-code">{shopProcessId}</code></>
                        : 'No transaction reference found'}
                </p>
            </header>

            <main className="checkout-card result-card" role="main">

                {/* ── Status badge ── */}
                <div
                    className="status-badge"
                    style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.colorVar }}
                >
                    <span className="status-icon">{cfg.icon}</span>
                    <span>{cfg.label}</span>
                    {txStatus === 'processing' && retryCount < 5 && (
                        <span className="pulse-dot" />
                    )}
                </div>

                {/* ── Loading skeleton ── */}
                {txStatus === 'loading' && (
                    <div className="skeleton-list">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="skeleton-row">
                                <div className="skeleton-label" />
                                <div className="skeleton-value" style={{ width: `${55 + i * 10}px` }} />
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Error state ── */}
                {txStatus === 'error' && (
                    <div className="alert alert-error" role="alert">
                        <span className="alert-icon">⚠️</span>
                        <span>{errorMsg}</span>
                    </div>
                )}

                {/* ── Processing message ── */}
                {txStatus === 'processing' && (
                    <div className="alert" style={{ background: 'rgba(240,173,78,0.10)', border: '1px solid rgba(240,173,78,0.25)', color: '#f0ad4e' }}>
                        <span className="alert-icon">🔄</span>
                        <span>
                            Your payment is being processed by Bancard.
                            {retryCount < 5
                                ? ` Checking again in 4 s… (${retryCount + 1}/5)`
                                : ' Please check back later or contact support.'}
                        </span>
                    </div>
                )}

                {/* ── Failure message ── */}
                {txStatus === 'failed' && failureMsg && (
                    <div className="alert alert-error" role="alert">
                        <span className="alert-icon">❌</span>
                        <span>{failureMsg}</span>
                    </div>
                )}

                {/* ── Transaction detail rows ── */}
                {txData && txStatus !== 'loading' && (
                    <div className="tx-detail-list">
                        <div className="tx-divider">Transaction Details</div>

                        <TxRow label="Amount" value={formatAmount(txData.total_amount, txData.currency)} accent />
                        <TxRow label="Description" value={txData.description || '—'} />
                        <TxRow label="Date" value={formatDate(txData.transaction_date)} />
                        <TxRow label="Payment ID" value={txData.payment_id || '—'} mono />
                        <TxRow label="Method" value={txData.method || 'Online'} />
                        <TxRow label="Type" value={txData.type || 'sale'} />
                        <TxRow label="Vendor" value={txData.vendor || 'Bancard'} />
                        {txData.visible_id && (
                            <TxRow label="Visible ID" value={txData.visible_id} mono />
                        )}
                        <TxRow label="Status" value={txData.status || rawStatus || '—'} />
                    </div>
                )}

                {/* ── Actions ── */}
                <div className="result-actions">
                    {(txStatus === 'failed' || txStatus === 'error') && (
                        <button
                            id="retry-payment-button"
                            className="btn-pay"
                            onClick={() => navigate('/')}
                        >
                            🔁 Try Again
                        </button>
                    )}

                    {txStatus === 'processing' && (
                        <button
                            id="refresh-status-button"
                            className="btn-pay"
                            onClick={() => { setRetryCount(0); fetchStatus() }}
                        >
                            🔄 Refresh Status
                        </button>
                    )}

                    <button
                        id="new-payment-button"
                        className="btn-pay"
                        onClick={() => navigate('/')}
                        style={
                            txStatus === 'success'
                                ? undefined
                                : { background: 'rgba(255,255,255,0.08)', boxShadow: 'none' }
                        }
                    >
                        {txStatus === 'success' ? '🏠 Back to Home' : '← Back to Home'}
                    </button>
                </div>

                <div className="security-footer">
                    <span className="lock-icon">🔐</span>
                    Secured by Bancard vPOS — Reference: {shopProcessId || 'N/A'}
                </div>
            </main>
        </>
    )
}

// ── Small helper row component ─────────────────────────────────────────────────
function TxRow({
    label,
    value,
    accent = false,
    mono = false,
}: {
    label: string
    value: string
    accent?: boolean
    mono?: boolean
}) {
    return (
        <div className="tx-row">
            <span className="tx-row-label">{label}</span>
            <span
                className="tx-row-value"
                style={{
                    color: accent ? 'var(--brand-primary)' : undefined,
                    fontFamily: mono ? 'monospace' : undefined,
                    fontWeight: accent ? 600 : undefined,
                    fontSize: accent ? '1.05rem' : undefined,
                }}
            >
                {value}
            </span>
        </div>
    )
}
