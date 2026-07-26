export type LaunchState =
  | 'initialized'
  | 'live'
  | 'closed'
  | 'completed'
  | 'refunding'
  | 'unknown'

export type LaunchVersion = 'v0.7' | 'v0.6' | 'v0.5'

export interface LaunchRow {
  publicKey: string
  baseMint: string
  quoteMint: string
  version: LaunchVersion
  state: LaunchState
  totalCommitted?: string
  goalAmount?: string
  acceptedAmount?: string
  tokenName?: string
  tokenSymbol?: string
  logoURI?: string
  myCommitted?: string
  quoteSymbol?: string
  isLikelyTest?: boolean
  rawAccount?: Record<string, unknown>
  /** Unix timestamp when contributions close, when available. */
  launchEndTimestamp?: number
}
