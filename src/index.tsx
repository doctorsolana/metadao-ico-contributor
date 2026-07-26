import './polyfills'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import '@solana/wallet-adapter-react-ui/styles.css'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

const DEFAULT_RPC = 'https://elset-q80z7v-fast-mainnet.helius-rpc.com'
const RPC_STORAGE_KEY = 'metadao-ico-contributor:rpc'

const loadStoredEndpoint = () => {
  try {
    return window.localStorage.getItem(RPC_STORAGE_KEY) ?? DEFAULT_RPC
  } catch {
    return DEFAULT_RPC
  }
}

function Root() {
  const wallets = React.useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  const [endpoint, setEndpoint] = React.useState(loadStoredEndpoint)

  const changeEndpoint = React.useCallback((next: string) => {
    setEndpoint(next)
    try {
      window.localStorage.setItem(RPC_STORAGE_KEY, next)
    } catch {
      // Private-mode storage failures only cost persistence, not function.
    }
  }, [])

  return (
    <HashRouter>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
        <WalletProvider autoConnect wallets={wallets}>
          <WalletModalProvider>
            <App endpoint={endpoint} onChangeEndpoint={changeEndpoint} />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </HashRouter>
  )
}

root.render(<Root />)
