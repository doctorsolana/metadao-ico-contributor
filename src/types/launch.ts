export type LaunchState =
  | 'initialized'
  | 'live'
  | 'closed'
  | 'completed'
  | 'refunding'
  | 'unknown'

export interface LaunchRow {
  publicKey: string
  baseMint: string
  quoteMint: string
  version: 'v0.6' | 'v0.5'
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
}

