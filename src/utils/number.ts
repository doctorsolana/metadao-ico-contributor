const CENTS_SCALE = 100n
const INTEGER_FORMATTER = new Intl.NumberFormat('en-US')

export const formatUsd = (raw?: string, decimals = 6) => {
  if (!raw || !Number.isInteger(decimals) || decimals < 0) return '—'
  try {
    const scale = 10n ** BigInt(decimals)
    const value = BigInt(raw)
    const sign = value < 0n ? '-' : ''
    const absolute = value < 0n ? -value : value
    const roundedCents = (absolute * CENTS_SCALE + scale / 2n) / scale
    const dollars = roundedCents / CENTS_SCALE
    const cents = (roundedCents % CENTS_SCALE).toString().padStart(2, '0')
    return `${sign}$${INTEGER_FORMATTER.format(dollars)}.${cents}`
  } catch {
    return '—'
  }
}

/** Raised/goal ratio in percent, clamped to [0, 100]; undefined when unknown. */
export const raisePercent = (
  raised?: string,
  goal?: string,
): number | undefined => {
  if (!raised || !goal) return undefined
  try {
    const raisedValue = BigInt(raised)
    const goalValue = BigInt(goal)
    if (goalValue <= 0n || raisedValue < 0n) return undefined
    return Math.min(100, Number((raisedValue * 1000n) / goalValue) / 10)
  } catch {
    return undefined
  }
}

export const parseUiAmountToRaw = (
  input: string,
  decimals: number,
): string | null => {
  const normalized = input.trim()
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    !/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)
  ) {
    return null
  }

  const [whole = '0', fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) return null

  const raw = `${whole || '0'}${fraction.padEnd(decimals, '0')}`.replace(
    /^0+(?=\d)/,
    '',
  )
  return raw || '0'
}

export const formatTokenAmount = (
  raw: string | null | undefined,
  decimals: number,
): string => {
  if (!raw || !Number.isInteger(decimals) || decimals < 0) return '—'

  try {
    const value = BigInt(raw)
    const sign = value < 0n ? '-' : ''
    const absolute = value < 0n ? -value : value
    const scale = 10n ** BigInt(decimals)
    const whole = INTEGER_FORMATTER.format(absolute / scale)
    const fraction =
      decimals > 0
        ? (absolute % scale)
            .toString()
            .padStart(decimals, '0')
            .replace(/0+$/, '')
        : ''
    return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
  } catch {
    return '—'
  }
}

export const rawTokenAmountToInput = (
  raw: string,
  decimals: number,
): string => {
  try {
    const value = BigInt(raw)
    const scale = 10n ** BigInt(decimals)
    const whole = value / scale
    const fraction =
      decimals > 0
        ? (value % scale)
            .toString()
            .padStart(decimals, '0')
            .replace(/0+$/, '')
        : ''
    return `${whole}${fraction ? `.${fraction}` : ''}`
  } catch {
    return ''
  }
}
