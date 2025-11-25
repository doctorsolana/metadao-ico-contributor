import React from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Routes, Route, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { LaunchList } from './LaunchList'
import { ContributePanel } from './ContributePanel'
import 'react-toastify/dist/ReactToastify.css'

type AppProps = {
  endpoint: string
  onChangeEndpoint: (next: string) => void
}

const App = ({ endpoint, onChangeEndpoint }: AppProps) => {
  const [draft, setDraft] = React.useState(endpoint)
  const location = useLocation()

  React.useEffect(() => {
    setDraft(endpoint)
  }, [endpoint])

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    onChangeEndpoint(trimmed)
  }

  const showContribute = location.pathname.startsWith('/launch/')

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">MetaDAO ico contributor</span>
        <div className="topbar-controls">
          <form className="rpc-inline" onSubmit={onSubmit}>
            <input
              id="rpc-endpoint"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="RPC URL"
            />
            <button type="submit">Set</button>
          </form>
          <WalletMultiButton className="wallet-button" />
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<LaunchList />} />
          <Route path="/launch/:id" element={<LaunchList />} />
        </Routes>
      </main>

      {showContribute && (
        <Routes>
          <Route path="/launch/:id" element={<ContributePanel />} />
        </Routes>
      )}

      <ToastContainer position="bottom-right" />
    </div>
  )
}

export default App
