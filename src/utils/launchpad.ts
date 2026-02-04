import type { AnchorProvider } from '@coral-xyz/anchor'
import { LaunchpadClient as LaunchpadClientV07 } from '@metadaoproject/futarchy/v0.7'
import { LaunchpadClient as LaunchpadClientV06 } from '@metadaoproject/futarchy/v0.6'
import { LaunchpadClient as LaunchpadClientV05 } from '@metadaoproject/futarchy/v0.5'
import type { LaunchState, LaunchVersion } from '../types/launch'

export type LaunchpadClientLike =
  | ReturnType<typeof LaunchpadClientV07.createClient>
  | ReturnType<typeof LaunchpadClientV06.createClient>
  | ReturnType<typeof LaunchpadClientV05.createClient>

export const LAUNCH_VERSIONS: LaunchVersion[] = ['v0.7', 'v0.6', 'v0.5']

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
    if ('toString' in record) {
      try {
        return (record as { toString: () => string }).toString()
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

export const toBigIntSafe = (value?: string): bigint | null => {
  if (!value) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

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
