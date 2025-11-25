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

function Root() {
  const wallets = React.useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  const [endpoint, setEndpoint] = React.useState(DEFAULT_RPC)
  React.useEffect(() => {
    ;(window as Window & typeof globalThis & { __APP_RPC_ENDPOINT?: string }).__APP_RPC_ENDPOINT =
      endpoint
  }, [endpoint])

  return (
    <HashRouter>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: 'processed' }}>
        <WalletProvider autoConnect wallets={wallets}>
          <WalletModalProvider>
            <App endpoint={endpoint} onChangeEndpoint={setEndpoint} />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </HashRouter>
  )
}

root.render(<Root />)
declare global {
  interface Window {
    __APP_RPC_ENDPOINT?: string
  }
}
