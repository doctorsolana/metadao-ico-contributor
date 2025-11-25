const SOLANA_USD_DECIMALS = 1_000_000

export const formatUsd = (raw?: string) => {
  if (!raw) return '—'
  try {
    const asNumber = Number(BigInt(raw)) / SOLANA_USD_DECIMALS
    if (!Number.isFinite(asNumber)) return '—'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(asNumber)
  } catch {
    return '—'
  }
}

