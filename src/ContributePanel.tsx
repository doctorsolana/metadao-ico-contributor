import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { BN } from '@coral-xyz/anchor'
import { PublicKey, type ParsedAccountData } from '@solana/web3.js'
import type { LaunchRow, LaunchVersion } from './types/launch'
import {
  formatTokenAmount,
  formatUsd,
  parseUiAmountToRaw,
  raisePercent,
  rawTokenAmountToInput,
} from './utils/number'
import { toast } from 'react-toastify'
import { sendSmartTransaction } from './utils/sendSmartTransaction'
import { USDC_MINT } from './utils/tokenMetadata'
import {
  buildClaimTransaction,
  buildFundTransaction,
  createLaunchpadClient,
  createReadOnlyProvider,
  deriveAssociatedTokenAddress,
  fetchCommittedAmount,
  fetchLaunchAccount,
  fetchLaunchRowByAddress,
  isLaunchContributable,
  mapLaunchEntry,
  shortPk,
  toBigIntSafe,
} from './utils/launchpad'

export const ContributePanel = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { connection } = useConnection()
  const incomingLaunch = location.state as LaunchRow | undefined
  const [fetchedLaunch, setFetchedLaunch] = useState<LaunchRow | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)

  // Deep links and shared URLs carry no router state — fall back to fetching
  // the launch account by the :id address.
  useEffect(() => {
    if (incomingLaunch || !id) return
    let cancelled = false
    setFetchedLaunch(null)
    setLookupFailed(false)
    ;(async () => {
      const row = await fetchLaunchRowByAddress(connection, id)
      if (cancelled) return
      if (row) {
        setFetchedLaunch(row)
      } else {
        setLookupFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connection, id, incomingLaunch])

  const launch = incomingLaunch ?? fetchedLaunch

  if (!launch) {
    return (
      <aside className="contribute-panel">
        <header>
          <div className="header-controls">
            <button
              type="button"
              onClick={() => navigate('/', { replace: false })}
              className="btn btn-sm"
            >
              ← Back
            </button>
          </div>
          <h2>Launch {id ? shortPk(id) : ''}</h2>
        </header>
        <p className="muted small">
          {lookupFailed
            ? 'Launch not found on this RPC. Return to the list and select a campaign.'
            : 'Loading launch account…'}
        </p>
      </aside>
    )
  }

  return (
    <ContributePanelContent
      key={launch.publicKey}
      initialLaunch={launch}
    />
  )
}

const ContributePanelContent = ({
  initialLaunch,
}: {
  initialLaunch: LaunchRow
}) => {
  const navigate = useNavigate()
  const [launch, setLaunch] = useState(initialLaunch)
  const { connection } = useConnection()
  const wallet = useWallet()
  const { setVisible: setWalletModalVisible } = useWalletModal()
  const provider = useMemo(
    () => createReadOnlyProvider(connection),
    [connection],
  )
  const getClient = useCallback(
    (version: LaunchVersion) => createLaunchpadClient(version, provider),
    [provider],
  )
  const [myCommitted, setMyCommitted] = useState<string | null>(
    launch.myCommitted ?? null,
  )
  const [checkingContribution, setCheckingContribution] = useState(false)
  const [quoteDecimals, setQuoteDecimals] = useState<number | null>(null)
  const [quoteBalanceRaw, setQuoteBalanceRaw] = useState<string | null>(null)
  const [hasAuxiliaryFunds, setHasAuxiliaryFunds] = useState(false)
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)

  // Bumped whenever the wallet or RPC changes so in-flight responses for the
  // previous wallet can't overwrite the new wallet's figures.
  const refreshEpoch = useRef(0)
  useEffect(() => {
    refreshEpoch.current += 1
  }, [connection, wallet.publicKey])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now() / 1000)
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const handleClose = () => {
    navigate('/', { replace: false })
  }

  const launchPublicKey = useMemo(() => {
    try {
      return new PublicKey(launch.publicKey)
    } catch {
      return null
    }
  }, [launch.publicKey])

  const quoteMintKey = useMemo(() => {
    try {
      return launch.quoteMint ? new PublicKey(launch.quoteMint) : null
    } catch {
      return null
    }
  }, [launch.quoteMint])

  const refreshLaunchStats = useCallback(async () => {
    if (!launchPublicKey) return
    try {
      setSubmitting(true)
      const client = getClient(launch.version)
      const account = await fetchLaunchAccount(client, launchPublicKey)
      if (!account) throw new Error('Launch account not found on this RPC')
      const mapped = mapLaunchEntry(
        { publicKey: launchPublicKey, account },
        launch.version,
      )
      setLaunch((prev) => ({
        ...prev,
        ...mapped,
        tokenName: prev.tokenName,
        tokenSymbol: prev.tokenSymbol,
        logoURI: prev.logoURI,
        quoteSymbol: prev.quoteSymbol,
      }))
      setNow(Date.now() / 1000)
      toast.success('Launch data refreshed')
    } catch (error) {
      console.error('[contribute] refresh failed', error)
      toast.error(
        error instanceof Error ? error.message : 'Unable to refresh launch',
      )
    } finally {
      setSubmitting(false)
    }
  }, [getClient, launch.version, launchPublicKey])

  const refreshMyContribution = useCallback(async () => {
    if (!launchPublicKey || !wallet.publicKey) {
      setMyCommitted(null)
      return
    }

    const epoch = refreshEpoch.current
    setCheckingContribution(true)
    try {
      const client = getClient(launch.version)
      const committed = await fetchCommittedAmount(
        client,
        launchPublicKey,
        wallet.publicKey,
      )
      if (epoch !== refreshEpoch.current) return
      setMyCommitted(committed)
    } catch (error) {
      console.warn('[contribute] unable to fetch funding record', error)
      if (epoch !== refreshEpoch.current) return
      setMyCommitted(null)
    } finally {
      if (epoch === refreshEpoch.current) {
        setCheckingContribution(false)
      }
    }
  }, [getClient, launch.version, launchPublicKey, wallet.publicKey])

  useEffect(() => {
    refreshMyContribution()
  }, [refreshMyContribution])

  const refreshQuoteDecimals = useCallback(async () => {
    if (!quoteMintKey) return
    try {
      const info = await connection.getParsedAccountInfo(quoteMintKey)
      const parsed = info?.value?.data as any
      const decimals = parsed?.parsed?.info?.decimals
      if (typeof decimals === 'number') {
        setQuoteDecimals(decimals)
        return
      }
      throw new Error('Mint account did not include decimals')
    } catch (error) {
      console.warn('[contribute] unable to load decimals', error)
      // Guessing decimals scales the contribution by the wrong power of ten,
      // so only fall back for USDC, whose 6 is a known constant.
      setQuoteDecimals(launch.quoteMint === USDC_MINT ? 6 : null)
    }
  }, [connection, launch.quoteMint, quoteMintKey])

  const refreshQuoteBalance = useCallback(async () => {
    if (!wallet.publicKey || !quoteMintKey) {
      setQuoteBalanceRaw(null)
      setHasAuxiliaryFunds(false)
      return
    }
    const epoch = refreshEpoch.current
    try {
      // fundIx debits only the associated token account, so that is the
      // spendable balance; other token accounts for the mint are unusable here.
      const ata = deriveAssociatedTokenAddress(wallet.publicKey, quoteMintKey)
      const resp = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { mint: quoteMintKey },
        'confirmed',
      )
      let ataBalance = 0n
      let totalBalance = 0n
      for (const tokenAccount of resp.value) {
        const data = tokenAccount.account.data as ParsedAccountData
        const rawAmount = data.parsed?.info?.tokenAmount?.amount
        if (typeof rawAmount !== 'string') continue
        let parsedAmount: bigint
        try {
          parsedAmount = BigInt(rawAmount)
        } catch {
          continue
        }
        totalBalance += parsedAmount
        if (tokenAccount.pubkey.equals(ata)) {
          ataBalance = parsedAmount
        }
      }
      if (epoch !== refreshEpoch.current) return
      setQuoteBalanceRaw(ataBalance.toString())
      setHasAuxiliaryFunds(totalBalance > ataBalance)
    } catch (error) {
      console.warn('[contribute] unable to fetch balance', error)
      if (epoch !== refreshEpoch.current) return
      setQuoteBalanceRaw(null)
      setHasAuxiliaryFunds(false)
    }
  }, [connection, quoteMintKey, wallet.publicKey])

  useEffect(() => {
    refreshQuoteDecimals()
  }, [refreshQuoteDecimals])

  useEffect(() => {
    refreshQuoteBalance()
  }, [refreshQuoteBalance])

  const isCompleted = launch.state === 'completed'
  const canContributeNow = isLaunchContributable(launch, now)
  const quoteSymbol = launch.quoteSymbol ?? 'USDC'
  const commitmentLabel = myCommitted
    ? formatUsd(myCommitted, quoteDecimals ?? 6)
    : '—'
  const balanceLabel =
    quoteBalanceRaw !== null && quoteDecimals !== null
      ? formatTokenAmount(quoteBalanceRaw, quoteDecimals)
      : '—'
  const canClaim =
    isCompleted &&
    (toBigIntSafe(myCommitted ?? undefined) ?? 0n) > 0n &&
    Boolean(wallet.publicKey)

  const handleTransactionError = async (error: unknown, fallback: string) => {
    const signature = (error as { signature?: string })?.signature
    const message = error instanceof Error ? error.message : fallback
    if (signature) {
      // The transaction reached the network — never present that as a clean
      // failure, or the user may resubmit and pay twice.
      if ((error as { txError?: unknown }).txError) {
        toast.error(message, { autoClose: false })
      } else {
        toast.warning(message, { autoClose: false })
      }
      await refreshMyContribution()
      await refreshQuoteBalance()
    } else {
      toast.error(message)
    }
  }

  const handleContribute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isLaunchContributable(launch, Date.now() / 1000)) {
      toast.error('This launch is not open for contributions.')
      return
    }

    if (!wallet.publicKey) {
      setWalletModalVisible(true)
      return
    }

    if (quoteDecimals === null) {
      toast.error(
        `Could not load the ${quoteSymbol} mint decimals from this RPC. Refresh or switch RPC before contributing.`,
      )
      return
    }

    const rawAmountString = parseUiAmountToRaw(amount, quoteDecimals)
    if (!rawAmountString || BigInt(rawAmountString) <= 0n) {
      toast.error(
        `Enter a valid amount with up to ${quoteDecimals} decimal places.`,
      )
      return
    }

    if (
      quoteBalanceRaw !== null &&
      BigInt(rawAmountString) > BigInt(quoteBalanceRaw)
    ) {
      toast.error(`Your ${quoteSymbol} balance is too low.`)
      return
    }

    if (!launchPublicKey || !quoteMintKey) {
      toast.error('Launch not available.')
      return
    }

    try {
      setSubmitting(true)
      const client = getClient(launch.version)
      const legacy = await buildFundTransaction(client, {
        launch: launchPublicKey,
        amount: new BN(rawAmountString),
        funder: wallet.publicKey,
        quoteMint: quoteMintKey,
      })
      const txid = await sendSmartTransaction(
        connection,
        wallet as any,
        legacy.instructions,
      )
      console.info(`[contribute] sent ${amount} ${quoteSymbol}`, txid)
      toast.success(`Contributed ${amount} ${quoteSymbol} (${shortPk(txid)})`)
      setAmount('')
      await refreshMyContribution()
      await refreshQuoteBalance()
    } catch (error) {
      console.error('[contribute] failed', error)
      await handleTransactionError(error, 'Contribution failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMax = () => {
    if (quoteBalanceRaw !== null && quoteDecimals !== null) {
      setAmount(rawTokenAmountToInput(quoteBalanceRaw, quoteDecimals))
    }
  }

  const handleClaim = async () => {
    if (!canClaim || !launchPublicKey || !wallet.publicKey) {
      toast.error('Nothing to claim.')
      return
    }

    try {
      setSubmitting(true)
      const client = getClient(launch.version)
      const legacy = await buildClaimTransaction(client, {
        launch: launchPublicKey,
        baseMint: new PublicKey(launch.baseMint),
        funder: wallet.publicKey,
      })
      const txid = await sendSmartTransaction(
        connection,
        wallet as any,
        legacy.instructions,
      )
      console.info('[claim] success', txid)
      toast.success(`Claim submitted (${shortPk(txid)})`)
      await refreshMyContribution()
    } catch (error) {
      console.error('[claim] failed', error)
      await handleTransactionError(error, 'Claim failed')
    } finally {
      setSubmitting(false)
    }
  }

  const copyAddress = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Address copied')
    } catch {
      toast.error('Could not copy — use the raw account data below.')
    }
  }

  const addressRows = [
    { label: 'Launch', value: launch.publicKey },
    { label: 'Base mint', value: launch.baseMint },
    { label: 'Quote mint', value: launch.quoteMint },
  ].filter((row) => row.value)

  const getStateLabel = () => {
    if (canContributeNow) return 'Open for contribution'
    if (isCompleted) return 'Launch completed'
    if (launch.state === 'closed') return 'Launch closed'
    if (launch.state === 'initialized') return 'Not yet started'
    if (launch.state === 'refunding') return 'Refunding'
    return launch.state
  }

  return (
    <aside className="contribute-panel">
      <header>
        <div className="header-controls">
          <button type="button" onClick={handleClose} className="btn btn-sm">
            ← Back
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={refreshLaunchStats}
            disabled={!launchPublicKey || submitting}
            title="Refresh launch data"
          >
            ↻ Refresh
          </button>
        </div>
        <div>
          <p className="muted tiny">
            {getStateLabel()}
          </p>
          <h2>
            {launch.tokenSymbol ?? launch.tokenName ?? launch.publicKey}
            <span className="version-badge">{launch.version}</span>
          </h2>
        </div>
      </header>

      {launch.isLikelyTest && (
        <div className="warning-pill panel-status-pill">
          Likely a test account
        </div>
      )}

      {canContributeNow && (
        <div className="contribute-pill panel-status-pill">
          Open for contributions
        </div>
      )}

      <section className="contribute-panel__stats">
        <div>
          <p className="muted tiny">Raised</p>
          <strong>
            {formatUsd(launch.totalCommitted, quoteDecimals ?? 6)}
          </strong>
        </div>
        <div>
          <p className="muted tiny">
            {isCompleted ? 'Accepted raise' : 'Goal'}
          </p>
          <strong>
            {formatUsd(
              isCompleted
                ? launch.acceptedAmount ?? launch.goalAmount
                : launch.goalAmount,
              quoteDecimals ?? 6,
            )}
          </strong>
        </div>
      </section>

      {(() => {
        const pct = raisePercent(launch.totalCommitted, launch.goalAmount)
        if (pct === undefined) return null
        return (
          <div className="goal-progress">
            <div className="goal-progress__label muted tiny">
              <span>Progress to goal</span>
              <span>
                {pct >= 100 ? 'Goal reached' : `${Math.round(pct)}%`}
              </span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress to goal"
            >
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })()}

      <section className="address-list">
        <p className="muted tiny">
          Verify these against MetaDAO&apos;s official announcement before
          contributing.
        </p>
        {addressRows.map((row) => (
          <div key={row.label} className="address-row">
            <span className="muted tiny">{row.label}</span>
            <code title={row.value}>{shortPk(row.value)}</code>
            <span className="address-actions">
              <button
                type="button"
                className="link-button small-link"
                onClick={() => copyAddress(row.value)}
              >
                copy
              </button>
              <a
                className="link-button small-link"
                href={`https://solscan.io/account/${row.value}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                solscan ↗
              </a>
            </span>
          </div>
        ))}
      </section>

      <div className="commitment-pill">
        Your commitment: {commitmentLabel}{' '}
        {checkingContribution ? '(refreshing...)' : ''}
      </div>

      {isCompleted ? (
        <button
          className="btn btn-primary claim-button"
          disabled={!canClaim || submitting}
          onClick={handleClaim}
        >
          {submitting ? 'Processing…' : 'Claim tokens'}
        </button>
      ) : canContributeNow ? (
        <form className="contribute-form vertical" onSubmit={handleContribute}>
          <label htmlFor="contribute-amount" className="muted tiny">
            Amount ({quoteSymbol})
          </label>
          <input
            id="contribute-amount"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
          <small className="muted tiny">
            Balance: {balanceLabel}{' '}
            {quoteBalanceRaw !== null && quoteDecimals !== null ? (
              <button
                type="button"
                className="link-button small-link"
                onClick={handleMax}
              >
                max
              </button>
            ) : null}
          </small>
          {hasAuxiliaryFunds && (
            <small className="muted tiny">
              Some {quoteSymbol} sits outside your associated token account and
              cannot be contributed directly.
            </small>
          )}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Contribute'}
          </button>
        </form>
      ) : (
        <div className="contribute-closed">
          <p className="muted">
            {launch.state === 'initialized'
              ? 'This launch has not started yet. Check back later.'
              : launch.state === 'closed'
              ? 'This launch is closed and awaiting completion.'
              : launch.state === 'refunding'
              ? 'This launch is in refunding state. Contributors can claim refunds.'
              : launch.state === 'live'
              ? 'This launch has reached its deadline.'
              : 'Contributions are not available for this launch.'}
          </p>
        </div>
      )}

      <details className="contribute-panel__details">
        <summary>Raw account data</summary>
        <pre className="contribute-panel__meta">
          {JSON.stringify(launch.rawAccount ?? {}, null, 2)}
        </pre>
      </details>
    </aside>
  )
}
