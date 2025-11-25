import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { AnchorProvider, BN } from '@coral-xyz/anchor'
import { LaunchpadClient } from '@metadaoproject/futarchy/v0.6'
import { LaunchpadClient as LaunchpadClientV05 } from '@metadaoproject/futarchy/v0.5'
import { PublicKey } from '@solana/web3.js'
import type { LaunchRow, LaunchState } from './types/launch'
import { formatUsd } from './utils/number'
import { Buffer } from 'buffer'
import { toast } from 'react-toastify'
import { sendSmartTransaction } from './utils/sendSmartTransaction'

const deriveState = (stateObj?: Record<string, unknown>): LaunchState => {
  if (!stateObj) return 'unknown'
  if ('live' in stateObj) return 'live'
  if ('complete' in stateObj || 'completed' in stateObj) return 'completed'
  if ('initialized' in stateObj) return 'initialized'
  if ('closed' in stateObj) return 'closed'
  if ('refunding' in stateObj) return 'refunding'
  return 'unknown'
}

const stringifyAmount = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object' && value !== null) {
    if ('some' in (value as Record<string, unknown>)) {
      return stringifyAmount((value as Record<string, unknown>).some)
    }
    if ('toString' in (value as Record<string, unknown>)) {
      try {
        return (value as { toString: () => string }).toString()
      } catch {
        return undefined
      }
    }
  }
  try {
    return String(value)
  } catch {
    return undefined
  }
}

export const ContributePanel = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const incomingLaunch = location.state as LaunchRow | undefined
  const [launch, setLaunch] = useState<LaunchRow | undefined>(incomingLaunch)
  useEffect(() => {
    setLaunch(incomingLaunch)
  }, [incomingLaunch])
  const { connection } = useConnection()
  const wallet = useWallet()

  const [myCommitted, setMyCommitted] = useState<string | null>(
    launch?.myCommitted ?? null,
  )
  const [checkingContribution, setCheckingContribution] = useState(false)
  const [quoteDecimals, setQuoteDecimals] = useState<number>(6)
  const [quoteBalance, setQuoteBalance] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleClose = () => {
    navigate('/', { replace: false })
  }

  if (!launch) {
    return (
      <aside className="contribute-panel">
        <header>
          <button type="button" onClick={handleClose} className="link-button">
            ← Back
          </button>
          <h2>Launch #{id?.slice(0, 4)}</h2>
        </header>
        <p className="muted small">
          Launch data unavailable. Return to the list and select a campaign.
        </p>
      </aside>
    )
  }

  const launchPublicKey = useMemo(() => {
    try {
      return new PublicKey(launch.publicKey)
    } catch {
      return null
    }
  }, [launch.publicKey])

  const refreshLaunchStats = useCallback(async () => {
    if (!launchPublicKey) return
    try {
      setSubmitting(true)
      const provider = new AnchorProvider(connection, wallet as any, {})
      const client =
        launch.version === 'v0.5'
          ? LaunchpadClientV05.createClient({ provider })
          : LaunchpadClient.createClient({ provider })
      const account = await (client as any).launchpad.account.launch.fetch(
        launchPublicKey,
      )
      setLaunch((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          totalCommitted:
            stringifyAmount(account.totalCommittedAmount) ?? prev.totalCommitted,
          goalAmount:
            stringifyAmount(account.minimumRaiseAmount) ??
            stringifyAmount(account.finalRaiseAmount) ??
            prev.goalAmount,
          acceptedAmount:
            stringifyAmount(account.finalRaiseAmount) ?? prev.acceptedAmount,
          state: deriveState(account.state as Record<string, unknown>),
        }
      })
      toast.success('Launch data refreshed')
    } catch (error) {
      console.error('[contribute] refresh failed', error)
      toast.error(
        error instanceof Error ? error.message : 'Unable to refresh launch',
      )
    } finally {
      setSubmitting(false)
    }
  }, [connection, launchPublicKey, wallet])

  const refreshMyContribution = useCallback(async () => {
    if (!launchPublicKey || !wallet.publicKey) {
      setMyCommitted(null)
      return
    }

    setCheckingContribution(true)
    try {
      const provider = new AnchorProvider(connection, wallet as any, {})
      const client =
        launch.version === 'v0.5'
          ? LaunchpadClientV05.createClient({ provider })
          : LaunchpadClient.createClient({ provider })
      const programId = client.getProgramId()
      const [fundingRecord] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('funding_record'),
          launchPublicKey.toBuffer(),
          wallet.publicKey.toBuffer(),
        ],
        programId,
      )
      const record = await (client as any)
        .fetchFundingRecord(fundingRecord)
        .catch(() => null)

      const committed = (record as any)?.committedAmount
      if (committed && typeof committed.toString === 'function') {
        setMyCommitted(committed.toString())
      } else {
        setMyCommitted('0')
      }
    } catch (error) {
      console.warn('[contribute] unable to fetch funding record', error)
      setMyCommitted(null)
    } finally {
      setCheckingContribution(false)
    }
  }, [connection, launchPublicKey, wallet.publicKey])

  useEffect(() => {
    refreshMyContribution()
  }, [refreshMyContribution])

  const refreshQuoteDecimals = useCallback(async () => {
    if (!launch.quoteMint) return
    try {
      const info = await connection.getParsedAccountInfo(
        new PublicKey(launch.quoteMint),
      )
      const parsed = info?.value?.data as any
      const decimals =
        parsed?.parsed?.info?.decimals ??
        parsed?.info?.decimals ??
        parsed?.data?.parsed?.info?.decimals
      if (typeof decimals === 'number') {
        setQuoteDecimals(decimals)
        return
      }
    } catch (error) {
      console.warn('[contribute] unable to load decimals', error)
    }
    setQuoteDecimals(6)
  }, [connection, launch.quoteMint])

  const refreshQuoteBalance = useCallback(async () => {
    if (!wallet.publicKey || !launch.quoteMint) {
      setQuoteBalance(null)
      return
    }
    try {
      const mint = new PublicKey(launch.quoteMint)
      const resp = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { mint },
        'confirmed',
      )
      const accountInfo = resp.value?.[0]?.account?.data?.parsed?.info
      const amount =
        accountInfo?.tokenAmount?.uiAmount ??
        accountInfo?.tokenAmount?.uiAmountString ??
        0
      setQuoteBalance(Number(amount) || 0)
    } catch (error) {
      console.warn('[contribute] unable to fetch balance', error)
      setQuoteBalance(null)
    }
  }, [connection, launch.quoteMint, wallet.publicKey])

  useEffect(() => {
    refreshQuoteDecimals()
  }, [refreshQuoteDecimals])

  useEffect(() => {
    refreshQuoteBalance()
  }, [refreshQuoteBalance])

  const isCompleted = launch.state === 'completed'
  const quoteSymbol = launch.quoteSymbol ?? 'USDC'
  const commitmentLabel = myCommitted ? formatUsd(myCommitted) : '—'
  const balanceLabel =
    quoteBalance !== null ? quoteBalance.toLocaleString() : '—'
  const canClaim =
    isCompleted &&
    myCommitted !== null &&
    Number(myCommitted) > 0 &&
    wallet.publicKey

  const handleContribute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCompleted) return

    if (!wallet.publicKey) {
      toast.error('Connect a wallet to contribute.')
      return
    }

    const uiAmount = Number(amount)
    if (!uiAmount || uiAmount <= 0) {
      toast.error('Enter a valid amount.')
      return
    }

    if (!launchPublicKey) {
      toast.error('Launch not available.')
      return
    }

    try {
      setSubmitting(true)
      const provider = new AnchorProvider(connection, wallet as any, {})
      const client =
        launch.version === 'v0.5'
          ? LaunchpadClientV05.createClient({ provider })
          : LaunchpadClient.createClient({ provider })
      const rawAmount = new BN(Math.round(uiAmount * 10 ** quoteDecimals))
      const methods = (client as any).fundIx({
        launch: launchPublicKey,
        amount: rawAmount,
        funder: wallet.publicKey,
      })
      const legacy = await methods.transaction()
      const txid = await sendSmartTransaction(
        connection,
        wallet as any,
        legacy.instructions,
      )
      console.info(`[contribute] sent ${uiAmount} ${quoteSymbol}`, txid)
      toast.success(`Contributed ${uiAmount} ${quoteSymbol}`)
      setAmount('')
      await refreshMyContribution()
      await refreshQuoteBalance()
    } catch (error) {
      console.error('[contribute] failed', error)
      toast.error(
        error instanceof Error ? error.message : 'Contribution failed',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleMax = () => {
    if (quoteBalance !== null) {
      setAmount(String(quoteBalance))
    }
  }

  const handleClaim = async () => {
    if (!canClaim || !launchPublicKey || !wallet.publicKey) {
      toast.error('Nothing to claim.')
      return
    }

    try {
      setSubmitting(true)
      const provider = new AnchorProvider(connection, wallet as any, {})
      const client =
        launch.version === 'v0.5'
          ? LaunchpadClientV05.createClient({ provider })
          : LaunchpadClient.createClient({ provider })
      const baseMint = new PublicKey(launch.baseMint)
      const methods = (client as any).claimIx(
        launchPublicKey,
        baseMint,
        wallet.publicKey,
      )
      const legacy = await methods.transaction()
      const txid = await sendSmartTransaction(
        connection,
        wallet as any,
        legacy.instructions,
      )
      console.info('[claim] success', txid)
      toast.success('Claim submitted.')
      await refreshMyContribution()
    } catch (error) {
      console.error('[claim] failed', error)
      toast.error(error instanceof Error ? error.message : 'Claim failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside className="contribute-panel">
      <header>
        <div className="header-controls">
          <button type="button" onClick={handleClose} className="back-button">
            ← Back
          </button>
          <button
            type="button"
            className="refresh-button"
            onClick={refreshLaunchStats}
            disabled={!launchPublicKey || submitting}
            title="Refresh launch data"
          >
            ↻ Refresh
          </button>
        </div>
        <div>
          <p className="muted tiny">
            {isCompleted ? 'Launch completed' : 'Contribute to'}
          </p>
          <h2>{launch.tokenSymbol ?? launch.tokenName ?? launch.publicKey}</h2>
        </div>
      </header>

      {launch.isLikelyTest && (
        <div className="warning-pill" style={{ marginBottom: '0.75rem' }}>
          Likely a test account
        </div>
      )}

      <section className="contribute-panel__stats">
        <div>
          <p className="muted tiny">Raised</p>
          <strong>{formatUsd(launch.totalCommitted)}</strong>
        </div>
        <div>
          <p className="muted tiny">
            {isCompleted ? 'Accepted raise' : 'Goal'}
          </p>
          <strong>
            {isCompleted
              ? formatUsd(launch.acceptedAmount ?? launch.goalAmount)
              : formatUsd(launch.goalAmount)}
          </strong>
        </div>
      </section>

      <div className="commitment-pill">
        Your commitment: {commitmentLabel}{' '}
        {checkingContribution ? '(refreshing...)' : ''}
      </div>

      {isCompleted ? (
        <button
          className="claim-button"
          disabled={!canClaim || submitting}
          onClick={handleClaim}
        >
          {submitting ? 'Processing…' : 'Claim tokens'}
        </button>
      ) : (
        <form className="contribute-form vertical" onSubmit={handleContribute}>
          <label htmlFor="contribute-amount" className="muted tiny">
            Amount ({quoteSymbol})
          </label>
          <input
            id="contribute-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.currentTarget.value)}
            disabled={isCompleted}
          />
          <small className="muted tiny">
            Balance: {balanceLabel}{' '}
            {quoteBalance !== null && !isCompleted ? (
              <button
                type="button"
                className="link-button small-link"
                onClick={handleMax}
              >
                max
              </button>
            ) : null}
          </small>
          <button type="submit" disabled={isCompleted || submitting}>
            {isCompleted ? 'Launch Complete' : submitting ? 'Submitting…' : 'Contribute'}
          </button>
        </form>
      )}

      <pre className="contribute-panel__meta">
        {JSON.stringify(launch.rawAccount ?? {}, null, 2)}
      </pre>
    </aside>
  )
}

