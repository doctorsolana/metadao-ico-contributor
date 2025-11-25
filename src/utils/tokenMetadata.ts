const getHeliusEndpoint = () => {
  if (typeof window !== 'undefined' && (window as any).__APP_RPC_ENDPOINT) {
    return (window as any).__APP_RPC_ENDPOINT as string
  }
  return undefined
}

export type TokenMeta = {
  name: string
  symbol: string
  logoURI: string
}

const KNOWN_TOKEN_DATA: Record<string, TokenMeta> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    name: 'USD Coin',
    symbol: 'USDC',
    logoURI:
      'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
}

export async function fetchTokenMetadataBatch(
  mints: string[],
): Promise<Record<string, TokenMeta>> {
  const unique = Array.from(new Set(mints)).filter(Boolean)
  const result: Record<string, TokenMeta> = {}
  const toFetch: string[] = []

  for (const mint of unique) {
    const preset = KNOWN_TOKEN_DATA[mint]
    if (preset) {
      result[mint] = preset
    } else {
      toFetch.push(mint)
    }
  }

  if (!toFetch.length) return result
  const heliusEndpoint = getHeliusEndpoint()
  if (!heliusEndpoint || !heliusEndpoint.includes('helius')) {
    toFetch.forEach((mint) => {
      result[mint] = { name: '', symbol: '', logoURI: '' }
    })
    return result
  }

  try {
    const response = await fetch(heliusEndpoint, {
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
    const { result: heliusResult } = await response.json()

    for (const asset of heliusResult || []) {
      const mint = asset?.id
      if (!mint) continue
      const content = asset.content
      const metadata = content?.metadata
      const links = content?.links

      result[mint] = {
        name: metadata?.name || '',
        symbol: metadata?.symbol || '',
        logoURI: links?.image || '',
      }
    }
  } catch (err) {
    console.error('fetchTokenMetadataBatch error:', err)
    toFetch.forEach((mint) => {
      if (!result[mint]) result[mint] = { name: '', symbol: '', logoURI: '' }
    })
  }

  return result
}

export async function fetchTokenMetadataSingle(
  mintAddress: string,
): Promise<TokenMeta> {
  if (KNOWN_TOKEN_DATA[mintAddress]) return KNOWN_TOKEN_DATA[mintAddress]
  const heliusEndpoint = getHeliusEndpoint()
  if (!heliusEndpoint || !heliusEndpoint.includes('helius')) {
    return { name: '', symbol: '', logoURI: '' }
  }
  try {
    const response = await fetch(heliusEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'token-single',
        method: 'getAsset',
        params: { id: mintAddress, displayOptions: { showFungible: true } },
      }),
    })
    const { result } = await response.json()
    const content = result?.content
    if (!content) return { name: '', symbol: '', logoURI: '' }

    let name: string = content?.metadata?.name || ''
    let symbol: string = content?.metadata?.symbol || ''
    let logoURI: string = content?.links?.image || ''

    const jsonUri: string | undefined = content?.json_uri
    if (!logoURI && jsonUri) {
      try {
        const metaResp = await fetch(jsonUri)
        const meta = await metaResp.json()
        if (meta?.image) logoURI = meta.image
        if (!name && meta?.name) name = meta.name
        if (!symbol && meta?.symbol) symbol = meta.symbol
      } catch {}
    }
    return { name, symbol, logoURI }
  } catch (err) {
    console.error('fetchTokenMetadataSingle error:', err)
    return { name: '', symbol: '', logoURI: '' }
  }
}

