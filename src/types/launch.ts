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
  quoteLogoURI?: string
  isLikelyTest?: boolean
  rawAccount?: Record<string, unknown>
  /** Whether the user can contribute to this launch (state is 'live') */
  canContribute?: boolean
  /** Seconds remaining until launch closes (only when live) */
  secondsRemaining?: number
}

