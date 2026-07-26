import { AnchorProvider, type BN } from '@coral-xyz/anchor'
import type { Connection, Transaction } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { LaunchpadClient as LaunchpadClientV07 } from '@metadaoproject/futarchy/v0.7'
import { LaunchpadClient as LaunchpadClientV06 } from '@metadaoproject/futarchy/v0.6'
import { LaunchpadClient as LaunchpadClientV05 } from '@metadaoproject/futarchy/v0.5'
import type { LaunchRow, LaunchState, LaunchVersion } from '../types/launch'
import { fetchTokenMetadataBatch, type TokenMeta } from './tokenMetadata'

export type LaunchpadClientLike =
  | ReturnType<typeof LaunchpadClientV07.createClient>
  | ReturnType<typeof LaunchpadClientV06.createClient>
  | ReturnType<typeof LaunchpadClientV05.createClient>

export const LAUNCH_VERSIONS: LaunchVersion[] = ['v0.7', 'v0.6', 'v0.5']

const USDC_LAMPORTS = 1_000_000n
const MIN_GOAL_THRESHOLD = 1_000n * USDC_LAMPORTS
const MIN_RAISED_THRESHOLD = 100n * USDC_LAMPORTS

// Account reads never sign anything, so a keyless wallet is enough.
const readOnlyWallet = {
  publicKey: null,
  signTransaction: async (tx: unknown) => tx,
  signAllTransactions: async (txs: unknown[]) => txs,
}

export const createReadOnlyProvider = (connection: Connection) =>
  new AnchorProvider(connection, readOnlyWallet as any, {})

export const createLaunchpadClient = (
  version: LaunchVersion,
  provider: AnchorProvider,
): LaunchpadClientLike => {
  switch (version) {
    case 'v0.7':
      return LaunchpadClientV07.createClient({ provider })
    case 'v0.6':
      return LaunchpadClientV06.createClient({ provider })
    case 'v0.5':
    default:
      return LaunchpadClientV05.createClient({ provider })
  }
}

export const createLaunchpadClients = (provider: AnchorProvider) =>
  LAUNCH_VERSIONS.map((version) => ({
    version,
    client: createLaunchpadClient(version, provider),
  }))

/**
 * Every call that crosses into the SDK goes through the helpers below, so the
 * casts needed to bridge the three SDK versions' divergent types live in this
 * file only — components stay fully typed.
 */

type LaunchAccount = Record<string, any>

export type LaunchAccountEntry = {
  publicKey: PublicKey | string
  account: LaunchAccount | undefined
}

type LaunchAccountNamespace = {
  all(): Promise<LaunchAccountEntry[]>
  fetchNullable(address: PublicKey): Promise<LaunchAccount | null>
}

const launchAccounts = (client: LaunchpadClientLike): LaunchAccountNamespace =>
  (client as { launchpad: { account: { launch: LaunchAccountNamespace } } })
    .launchpad.account.launch

export const fetchAllLaunches = (
  client: LaunchpadClientLike,
): Promise<LaunchAccountEntry[]> => launchAccounts(client).all()

export const fetchLaunchAccount = (
  client: LaunchpadClientLike,
  launch: PublicKey,
): Promise<LaunchAccount | null> => launchAccounts(client).fetchNullable(launch)

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
)
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
)

// Same derivation as the SDK's getAssociatedTokenAddressSync — fundIx debits
// exactly this account, so balances must be read from it, not summed across
// every token account the wallet holds.
export const deriveAssociatedTokenAddress = (
  owner: PublicKey,
  mint: PublicKey,
): PublicKey =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]

// Same seeds as the SDK's getFundingRecordAddr in every version (utils/pda).
export const deriveFundingRecordAddress = (
  client: LaunchpadClientLike,
  launch: PublicKey,
  funder: PublicKey,
): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('funding_record'), launch.toBuffer(), funder.toBuffer()],
    client.getProgramId(),
  )[0]

/** Returns the funder's committed amount in raw quote units, '0' if no record. */
export const fetchCommittedAmount = async (
  client: LaunchpadClientLike,
  launch: PublicKey,
  funder: PublicKey,
): Promise<string> => {
  const address = deriveFundingRecordAddress(client, launch, funder)
  const record = await client.fetchFundingRecord(address).catch(() => null)
  return record?.committedAmount?.toString() ?? '0'
}

export type FundParams = {
  launch: PublicKey
  amount: BN
  funder: PublicKey
  quoteMint: PublicKey
}

export const buildFundTransaction = (
  client: LaunchpadClientLike,
  { launch, amount, funder, quoteMint }: FundParams,
): Promise<Transaction> => {
  // v0.5 takes positional args (quoteMint required); v0.6/v0.7 take one object
  // and would silently default quoteMint to mainnet USDC if omitted.
  if (client instanceof LaunchpadClientV05) {
    return client.fundIx(launch, amount, funder, quoteMint).transaction()
  }
  return client.fundIx({ launch, amount, funder, quoteMint }).transaction()
}

export const buildClaimTransaction = (
  client: LaunchpadClientLike,
  {
    launch,
    baseMint,
    funder,
  }: { launch: PublicKey; baseMint: PublicKey; funder: PublicKey },
): Promise<Transaction> => client.claimIx(launch, baseMint, funder).transaction()

export const deriveLaunchState = (
  stateObj?: Record<string, unknown>,
): LaunchState => {
  if (!stateObj) return 'unknown'
  if ('live' in stateObj) return 'live'
  if ('complete' in stateObj || 'completed' in stateObj) return 'completed'
  if ('initialized' in stateObj) return 'initialized'
  if ('closed' in stateObj) return 'closed'
  if ('refunding' in stateObj) return 'refunding'
  return 'unknown'
}

export const toLamportString = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('some' in record) {
      return toLamportString(record.some)
    }
    // BN and friends carry their own toString; plain objects only inherit
    // Object.prototype.toString, which would yield useless "[object Object]".
    if (
      typeof record.toString === 'function' &&
      record.toString !== Object.prototype.toString
    ) {
      try {
        return (record as { toString: () => string }).toString()
      } catch {
        return undefined
      }
    }
    return undefined
  }
  try {
    return String(value)
  } catch {
    return undefined
  }
}

export const toBigIntSafe = (value?: string): bigint | null => {
  if (!value) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (value == null) return undefined

  try {
    const numberValue =
      typeof value === 'object' &&
      typeof (value as { toNumber?: () => number }).toNumber === 'function'
        ? (value as { toNumber: () => number }).toNumber()
        : Number(value)
    return Number.isFinite(numberValue) ? numberValue : undefined
  } catch {
    return undefined
  }
}

export const getLaunchEndTimestamp = (
  account: Record<string, unknown>,
): number | undefined => {
  const startedAt = toFiniteNumber(account.unixTimestampStarted)
  const duration = toFiniteNumber(account.secondsForLaunch)
  return startedAt === undefined || duration === undefined
    ? undefined
    : startedAt + duration
}

export const isLaunchContributable = (
  launch: Pick<LaunchRow, 'state' | 'launchEndTimestamp'>,
  now = Date.now() / 1000,
): boolean =>
  launch.state === 'live' &&
  (launch.launchEndTimestamp === undefined || launch.launchEndTimestamp > now)

export const serializeAccount = (value: unknown): unknown => {
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

  // Arrays must recurse before the generic toString check below, which would
  // otherwise comma-join them into a single string.
  if (Array.isArray(value)) {
    return value.map((item) => serializeAccount(item))
  }

  if (
    value &&
    typeof (value as { toString?: () => string }).toString === 'function' &&
    (value as { toString: () => string }).toString() !== '[object Object]'
  ) {
    return (value as { toString: () => string }).toString()
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

export const shortPk = (value: string) =>
  value.length <= 10 ? value : `${value.slice(0, 4)}...${value.slice(-4)}`

export const mapLaunchEntry = (
  entry: LaunchAccountEntry,
  version: LaunchVersion,
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

  const state = deriveLaunchState(account.state as Record<string, unknown>)
  const totalCommitted = toLamportString(account.totalCommittedAmount)
  const goalAmount =
    toLamportString(account.minimumRaiseAmount) ??
    toLamportString(account.finalRaiseAmount)
  // v0.7 renamed the accepted-raise field to totalApprovedAmount; v0.6 uses
  // finalRaiseAmount; v0.5 has neither (callers fall back to goalAmount).
  const acceptedAmount =
    toLamportString(account.totalApprovedAmount) ??
    toLamportString(account.finalRaiseAmount)

  const goalBig = toBigIntSafe(goalAmount)
  const totalBig = toBigIntSafe(totalCommitted)
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
    launchEndTimestamp: getLaunchEndTimestamp(account),
    rawAccount: serializeAccount(account) as Record<string, unknown>,
  }
}

/** Attach token names/symbols/logos; falls back to on-chain fields on failure. */
export const enrichLaunchRows = async (
  rows: LaunchRow[],
  rpcEndpoint: string,
): Promise<LaunchRow[]> => {
  const mints = Array.from(
    new Set(rows.flatMap((row) => [row.baseMint, row.quoteMint]).filter(Boolean)),
  )

  let metadata: Record<string, TokenMeta> = {}
  try {
    metadata = await fetchTokenMetadataBatch(mints, rpcEndpoint)
  } catch {
    metadata = {}
  }

  return rows.map((row) => {
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
      tokenName: baseMeta?.name || fallbackName,
      tokenSymbol: baseMeta?.symbol || fallbackSymbol,
      logoURI: baseMeta?.logoURI,
      quoteSymbol: quoteMeta?.symbol || 'USDC',
    }
  })
}

/** Look a launch up by address across program versions (newest first). */
export const fetchLaunchRowByAddress = async (
  connection: Connection,
  address: string,
): Promise<LaunchRow | null> => {
  let launchKey: PublicKey
  try {
    launchKey = new PublicKey(address)
  } catch {
    return null
  }

  const provider = createReadOnlyProvider(connection)
  for (const version of LAUNCH_VERSIONS) {
    try {
      const client = createLaunchpadClient(version, provider)
      const account = await fetchLaunchAccount(client, launchKey)
      if (account) {
        const row = mapLaunchEntry({ publicKey: launchKey, account }, version)
        const [enriched] = await enrichLaunchRows([row], connection.rpcEndpoint)
        return enriched ?? row
      }
    } catch (error) {
      console.warn(`[launchpad] ${version} lookup failed for ${address}`, error)
    }
  }
  return null
}
