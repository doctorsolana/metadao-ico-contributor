const isHeliusEndpoint = (endpoint?: string): endpoint is string =>
  Boolean(endpoint && endpoint.includes('helius'))

export type TokenMeta = {
  name: string
  symbol: string
  logoURI: string
}

const emptyTokenMeta = (): TokenMeta => ({ name: '', symbol: '', logoURI: '' })
const tokenMetadataCache = new Map<string, TokenMeta>()

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/**
 * Logo URLs come from token metadata, i.e. arbitrary third parties. Only allow
 * https and inline data-image URLs so a malformed scheme can't slip into src.
 */
export const safeLogoURI = (uri?: string): string | undefined => {
  if (!uri) return undefined
  try {
    const parsed = new URL(uri)
    if (parsed.protocol === 'https:') return uri
    if (parsed.protocol === 'data:' && uri.startsWith('data:image/')) return uri
  } catch {
    return undefined
  }
  return undefined
}

const KNOWN_TOKEN_DATA: Record<string, TokenMeta> = {
  [USDC_MINT]: {
    name: 'USD Coin',
    symbol: 'USDC',
    logoURI:
      'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
}

export async function fetchTokenMetadataBatch(
  mints: string[],
  endpoint: string,
): Promise<Record<string, TokenMeta>> {
  const unique = Array.from(new Set(mints)).filter(Boolean)
  const result: Record<string, TokenMeta> = {}
  const toFetch: string[] = []

  for (const mint of unique) {
    const preset = KNOWN_TOKEN_DATA[mint]
    const cached = tokenMetadataCache.get(mint)
    if (preset || cached) {
      result[mint] = preset ?? cached!
    } else {
      toFetch.push(mint)
    }
  }

  if (!toFetch.length) return result
  if (!isHeliusEndpoint(endpoint)) {
    toFetch.forEach((mint) => {
      result[mint] = emptyTokenMeta()
    })
    return result
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-batch',
        method: 'getAssetBatch',
        params: {
          ids: toFetch,
          displayOptions: { showFungible: true },
        },
      }),
    })
    if (!response.ok) {
      throw new Error(`Metadata request failed with ${response.status}`)
    }

    const payload = await response.json()
    if (payload.error) {
      throw new Error(payload.error.message ?? 'Metadata RPC request failed')
    }

    for (const asset of payload.result || []) {
      const mint = asset?.id
      if (!mint) continue
      const content = asset.content
      const metadata = content?.metadata
      const links = content?.links

      const metadataResult = {
        name: metadata?.name || '',
        symbol: metadata?.symbol || '',
        logoURI: links?.image || '',
      }
      result[mint] = metadataResult
      tokenMetadataCache.set(mint, metadataResult)
    }
  } catch (err) {
    console.error('fetchTokenMetadataBatch error:', err)
    toFetch.forEach((mint) => {
      if (!result[mint]) result[mint] = emptyTokenMeta()
    })
  }

  return result
}
