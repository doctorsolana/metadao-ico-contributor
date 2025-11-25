import React, { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { AnchorProvider } from '@coral-xyz/anchor'
import { LaunchpadClient } from '@metadaoproject/futarchy/v0.6'
import { LaunchpadClient as LaunchpadClientV05 } from '@metadaoproject/futarchy/v0.5'
import type { PublicKey } from '@solana/web3.js'
import { useNavigate } from 'react-router-dom'
import {
  fetchTokenMetadataBatch,
  type TokenMeta,
} from './utils/tokenMetadata'
import { formatUsd } from './utils/number'
import type { LaunchRow, LaunchState } from './types/launch'

const dummyWallet = {
  publicKey: null,
  signTransaction: async (tx: unknown) => tx,
  signAllTransactions: async (txs: unknown[]) => txs,
}

const shortPk = (value: string) =>
  value.length <= 10 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`

const deriveState = (stateObj?: Record<string, unknown>): LaunchState => {
  if (!stateObj) return 'unknown'
  if ('live' in stateObj) return 'live'
  if ('complete' in stateObj || 'completed' in stateObj) return 'completed'
  if ('initialized' in stateObj) return 'initialized'
  if ('closed' in stateObj) return 'closed'
  if ('refunding' in stateObj) return 'refunding'
  return 'unknown'
}

const serializeAccount = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value && typeof (value as { toBase58?: () => string }).toBase58 === 'function') {
    return (value as { toBase58: () => string }).toBase58()
  }

  if (
    value &&
    typeof (value as { toString?: () => string }).toString === 'function' &&
    (value as { toString: () => string }).toString() !== '[object Object]'
  ) {
    return (value as { toString: () => string }).toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeAccount(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        serializeAccount(val),
      ]),
    )
  }

  return value
}

const toLamportString = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') {
    const maybeOption = (value as Record<string, unknown>).some
    if (maybeOption !== undefined) {
      return toLamportString(maybeOption)
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

const toBigInt = (value?: string): bigint | null => {
  if (!value) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

const USDC_LAMPORTS = 1_000_000n
const MIN_GOAL_THRESHOLD = 1_000n * USDC_LAMPORTS
const MIN_RAISED_THRESHOLD = 100n * USDC_LAMPORTS

export const LaunchList = () => {
  const { connection } = useConnection()
  const navigate = useNavigate()
  const [rows, setRows] = useState<LaunchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState<LaunchState | 'all'>('all')
  const [sortField, setSortField] = useState<'goal' | 'raised'>('raised')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        const provider = new AnchorProvider(connection, dummyWallet as any, {})
        const client06 = LaunchpadClient.createClient({ provider })
        const client05 = LaunchpadClientV05.createClient({ provider })

        const [accounts06, accounts05] = await Promise.all([
          (client06 as any).launchpad.account.launch.all().catch(() => []),
          (client05 as any).launchpad.account.launch.all().catch(() => []),
        ])

        const mapped: LaunchRow[] = [
          ...accounts06.map((entry: LaunchAccountEntry) =>
            mapLaunchEntry(entry, 'v0.6'),
          ),
          ...accounts05.map((entry: LaunchAccountEntry) =>
            mapLaunchEntry(entry, 'v0.5'),
          ),
        ]

        const mints = Array.from(
          new Set(
            mapped
              .flatMap((row) => [row.baseMint, row.quoteMint])
              .filter(Boolean),
          ),
        )

        let metadata: Record<string, TokenMeta> = {}
        try {
          metadata = await fetchTokenMetadataBatch(mints)
        } catch {
          metadata = {}
        }

        const enriched = mapped.map((row) => {
          const baseMeta = metadata[row.baseMint]
          const quoteMeta = metadata[row.quoteMint]
          const raw = row.rawAccount as Record<string, unknown> | undefined
          const fallbackName =
            typeof raw?.['tokenName'] === 'string'
              ? (raw['tokenName'] as string)
              : undefined
          const fallbackSymbol =
            typeof raw?.['tokenSymbol'] === 'string'
              ? (raw['tokenSymbol'] as string)
              : undefined

          return {
            ...row,
            tokenName: baseMeta?.name ?? fallbackName,
            tokenSymbol: baseMeta?.symbol ?? fallbackSymbol,
            logoURI: baseMeta?.logoURI,
            quoteSymbol: quoteMeta?.symbol ?? 'USDC',
            quoteLogoURI: quoteMeta?.logoURI,
          }
        })

        if (!cancelled) {
          setRows(enriched)
          console.info('[launches] fetched', enriched.length)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setError('Unable to load launches right now.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [connection])

  const filtered = rows.filter((row) => {
    if (stateFilter !== 'all' && row.state !== stateFilter) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const getValue = (row: LaunchRow) => {
      if (sortField === 'goal') return row.goalAmount ? BigInt(row.goalAmount) : BigInt(0)
      return row.totalCommitted ? BigInt(row.totalCommitted) : BigInt(0)
    }
    const delta = getValue(a) - getValue(b)
    if (delta === BigInt(0)) return 0
    if (sortDir === 'asc') {
      return delta < BigInt(0) ? -1 : 1
    }
    return delta > BigInt(0) ? -1 : 1
  })

  return (
    <section className="launch-list">
      <header className="launch-header">
        <span>Launches</span>
        <span className="muted">
          {loading ? 'Loading…' : `${filtered.length} shown`}
        </span>
      </header>

      <div className="launch-filter">
        <label>
          Status
          <select
            value={stateFilter}
            onChange={(event) =>
              setStateFilter(event.currentTarget.value as LaunchState | 'all')
            }
          >
            <option value="all">All</option>
            <option value="initialized">Initialized</option>
            <option value="live">Live</option>
            <option value="closed">Closed</option>
            <option value="completed">Completed</option>
            <option value="refunding">Refunding</option>
          </select>
        </label>

        <label>
          Sort field
          <select
            value={sortField}
            onChange={(event) =>
              setSortField(event.currentTarget.value as 'goal' | 'raised')
            }
          >
            <option value="raised">Raised amount</option>
            <option value="goal">Goal amount</option>
          </select>
        </label>

        <label>
          Sort direction
          <select
            value={sortDir}
            onChange={(event) =>
              setSortDir(event.currentTarget.value as 'asc' | 'desc')
            }
          >
            <option value="desc">High → Low</option>
            <option value="asc">Low → High</option>
          </select>
        </label>
      </div>

      {error && <p className="muted">{error}</p>}

      {!loading && sorted.length === 0 && !error ? (
        <p className="muted">No launches detected.</p>
      ) : (
        <div>
          {sorted.map((row) => (
            <article
              key={row.publicKey}
              className="launch-row"
              onClick={() => {
                console.info('[launches] selected', row.publicKey, row.rawAccount)
                navigate(`/launch/${row.publicKey}`, { state: row })
              }}
            >
              <div className="launch-name">
                <div className="token-avatar">
                  {row.logoURI ? (
                    <img src={row.logoURI} alt="" />
                  ) : (
                    <span>
                      {(row.tokenSymbol ??
                        row.tokenName ??
                        row.baseMint
                      )
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <div>{row.tokenSymbol?.trim() || row.tokenName?.trim() || shortPk(row.baseMint)}</div>
                  <div className="muted tiny">
                    Base {shortPk(row.baseMint)} · Quote {shortPk(row.quoteMint)}
                  </div>
                  <div className="muted tiny">
                    Raised {formatUsd(row.totalCommitted)} / {formatUsd(row.goalAmount)}
                  </div>
                </div>
              </div>
              <div className="badge-row">
                {row.isLikelyTest && (
                  <span className="warning-pill">Likely a test account</span>
                )}
                <span className="muted status">{row.state}</span>
              </div>
            </article>
          ))}
        </div>
      )}

    </section>
  )
}

type LaunchAccount = Record<string, any>

type LaunchAccountEntry = {
  publicKey: PublicKey | string
  account: LaunchAccount | undefined
}

const mapLaunchEntry = (
  entry: LaunchAccountEntry,
  version: 'v0.6' | 'v0.5',
): LaunchRow => {
  const account: LaunchAccount = entry.account ?? {}
  const pk: PublicKey | string = entry.publicKey
  const baseMint =
    account.baseMint?.toBase58?.() ??
    account.tokenMint?.toBase58?.() ??
    String(account.baseMint ?? account.tokenMint ?? '')
  const quoteMint =
    account.quoteMint?.toBase58?.() ??
    account.usdcMint?.toBase58?.() ??
    String(account.quoteMint ?? account.usdcMint ?? '')

  const state = deriveState(account.state as Record<string, unknown>)
  const totalCommitted = toLamportString(account.totalCommittedAmount)
  const goalAmount =
    toLamportString(account.minimumRaiseAmount) ??
    toLamportString(account.finalRaiseAmount)
  const acceptedAmount = toLamportString(account.finalRaiseAmount)

  const goalBig = toBigInt(goalAmount)
  const totalBig = toBigInt(totalCommitted)
  const isLikelyTest =
    (goalBig !== null && goalBig < MIN_GOAL_THRESHOLD) ||
    (totalBig !== null && totalBig < MIN_RAISED_THRESHOLD)

  return {
    publicKey: typeof pk === 'string' ? pk : pk.toBase58(),
    baseMint,
    quoteMint,
    version,
    state,
    totalCommitted,
    goalAmount,
    acceptedAmount,
    isLikelyTest,
    rawAccount: serializeAccount(account) as Record<string, unknown>,
  }
}

