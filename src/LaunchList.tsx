import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { useNavigate } from 'react-router-dom'
import { safeLogoURI } from './utils/tokenMetadata'
import { formatUsd, raisePercent } from './utils/number'
import type { LaunchRow, LaunchState } from './types/launch'
import {
  createLaunchpadClients,
  createReadOnlyProvider,
  enrichLaunchRows,
  fetchAllLaunches,
  isLaunchContributable,
  mapLaunchEntry,
  shortPk,
  toBigIntSafe,
} from './utils/launchpad'

const PAGE_SIZE = 50
const VERSION_PRIORITY: Record<LaunchRow['version'], number> = {
  'v0.7': 3,
  'v0.6': 2,
  'v0.5': 1,
}

type ContributeFilter = 'all' | 'contributable' | 'non-contributable'
type SortOption = 'raised-desc' | 'raised-asc' | 'goal-desc' | 'goal-asc'

export const LaunchList = () => {
  const { connection } = useConnection()
  const navigate = useNavigate()
  const [rows, setRows] = useState<LaunchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [stateFilter, setStateFilter] = useState<LaunchState | 'all'>('all')
  const [contributeFilter, setContributeFilter] =
    useState<ContributeFilter>('all')
  const [sort, setSort] = useState<SortOption>('raised-desc')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now() / 1000)
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        const provider = createReadOnlyProvider(connection)
        const clients = createLaunchpadClients(provider)
        let successfulClientCount = 0

        const mapped: LaunchRow[] = (
          await Promise.all(
            clients.map(async ({ client, version }) => {
              try {
                const accounts = await fetchAllLaunches(client)
                successfulClientCount += 1
                return accounts.map((entry) => mapLaunchEntry(entry, version))
              } catch (clientError) {
                console.warn(
                  `[launches] unable to load ${version}`,
                  clientError,
                )
                return []
              }
            }),
          )
        ).flat()

        if (successfulClientCount === 0) {
          throw new Error('All launch account requests failed')
        }

        // Deduplicate by publicKey (prefer higher version)
        const deduped = new Map<string, LaunchRow>()
        for (const row of mapped) {
          const existing = deduped.get(row.publicKey)
          if (
            !existing ||
            VERSION_PRIORITY[row.version] > VERSION_PRIORITY[existing.version]
          ) {
            deduped.set(row.publicKey, row)
          }
        }

        const enriched = await enrichLaunchRows(
          Array.from(deduped.values()),
          connection.rpcEndpoint,
        )

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
  }, [connection, reloadNonce])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [contributeFilter, deferredSearch, sort, stateFilter])

  const sorted = useMemo(() => {
    const [sortField, sortDir] = sort.split('-') as [
      'raised' | 'goal',
      'asc' | 'desc',
    ]
    const filtered = rows.filter((row) => {
      const canContribute = isLaunchContributable(row, now)
      if (stateFilter !== 'all' && row.state !== stateFilter) return false
      if (contributeFilter === 'contributable' && !canContribute) return false
      if (contributeFilter === 'non-contributable' && canContribute) {
        return false
      }
      if (!deferredSearch) return true

      return [
        row.tokenName,
        row.tokenSymbol,
        row.publicKey,
        row.baseMint,
        row.quoteMint,
      ].some((value) => value?.toLowerCase().includes(deferredSearch))
    })

    return filtered.sort((a, b) => {
      const getValue = (row: LaunchRow) => {
        const raw =
          sortField === 'goal' ? row.goalAmount : row.totalCommitted
        return toBigIntSafe(raw) ?? 0n
      }
      const delta = getValue(a) - getValue(b)
      if (delta === 0n) return 0
      if (sortDir === 'asc') {
        return delta < 0n ? -1 : 1
      }
      return delta > 0n ? -1 : 1
    })
  }, [contributeFilter, deferredSearch, now, rows, sort, stateFilter])

  const contributableCount = useMemo(
    () => rows.filter((row) => isLaunchContributable(row, now)).length,
    [now, rows],
  )
  const visibleRows = sorted.slice(0, visibleCount)

  const getSecondsRemaining = (row: LaunchRow) => {
    if (
      !isLaunchContributable(row, now) ||
      row.launchEndTimestamp === undefined
    ) {
      return undefined
    }
    return Math.max(0, Math.floor(row.launchEndTimestamp - now))
  }

  return (
    <section className="launch-list">
      <header className="launch-header">
        <span>Launches</span>
        <div className="launch-header-actions">
          <span className="muted">
            {loading
              ? 'Loading…'
              : `Showing ${visibleRows.length} of ${sorted.length} · ${contributableCount} open`}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setReloadNonce((nonce) => nonce + 1)}
            disabled={loading}
            title="Reload launches"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      <div className="launch-filter">
        <label className="launch-search">
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Name, symbol, or address"
          />
        </label>

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
          Contribution
          <select
            value={contributeFilter}
            onChange={(event) =>
              setContributeFilter(event.currentTarget.value as ContributeFilter)
            }
          >
            <option value="all">All launches</option>
            <option value="contributable">Open for contribution</option>
            <option value="non-contributable">Not open</option>
          </select>
        </label>

        <label>
          Sort
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.currentTarget.value as SortOption)
            }
          >
            <option value="raised-desc">Raised · high → low</option>
            <option value="raised-asc">Raised · low → high</option>
            <option value="goal-desc">Goal · high → low</option>
            <option value="goal-asc">Goal · low → high</option>
          </select>
        </label>
      </div>

      {error && <p className="muted">{error}</p>}

      {!loading && sorted.length === 0 && !error ? (
        <p className="muted">No launches detected.</p>
      ) : (
        <>
          <div className="launch-rows">
            {visibleRows.map((row) => {
              const canContribute = isLaunchContributable(row, now)
              const secondsRemaining = getSecondsRemaining(row)
              const logoURI = safeLogoURI(row.logoURI)
              const pct = raisePercent(row.totalCommitted, row.goalAmount)
              return (
                <button
                  type="button"
                  key={row.publicKey}
                  className={`launch-row ${
                    canContribute ? 'launch-row--contributable' : ''
                  }`}
                  onClick={() => {
                    navigate(`/launch/${row.publicKey}`, { state: row })
                  }}
                >
                  <div className="launch-name">
                    <div className="token-avatar">
                      {logoURI ? (
                        <img
                          src={logoURI}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>
                          {(row.tokenSymbol ?? row.tokenName ?? row.baseMint)
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="launch-title">
                        {row.tokenSymbol?.trim() ||
                          row.tokenName?.trim() ||
                          shortPk(row.baseMint)}
                        <span className="version-badge">{row.version}</span>
                      </div>
                      <div className="muted tiny">
                        Base {shortPk(row.baseMint)} · Quote{' '}
                        {shortPk(row.quoteMint)}
                      </div>
                      <div className="muted tiny">
                        Raised {formatUsd(row.totalCommitted)} /{' '}
                        {formatUsd(row.goalAmount)}
                        {canContribute && pct !== undefined
                          ? ` · ${Math.round(pct)}% of goal`
                          : ''}
                      </div>
                    </div>
                  </div>
                  <div className="badge-row">
                    {canContribute && (
                      <span className="contribute-pill">Open</span>
                    )}
                    {secondsRemaining !== undefined && (
                      <span className="time-remaining">
                        {formatTimeRemaining(secondsRemaining)}
                      </span>
                    )}
                    {row.isLikelyTest && (
                      <span className="warning-pill">
                        Likely a test account
                      </span>
                    )}
                    <span className="muted status">{row.state}</span>
                  </div>
                </button>
              )
            })}
          </div>
          {visibleRows.length < sorted.length && (
            <button
              type="button"
              className="btn show-more-button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, sorted.length - visibleRows.length)} more
            </button>
          )}
        </>
      )}
    </section>
  )
}

const formatTimeRemaining = (seconds: number): string => {
  if (seconds <= 0) return 'Ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}
