import React from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Route, Routes, useLocation } from 'react-router-dom'
import { ToastContainer, toast } from 'react-toastify'
import { LaunchList } from './LaunchList'
import 'react-toastify/dist/ReactToastify.css'

const ContributePanel = React.lazy(() =>
  import('./ContributePanel').then((module) => ({
    default: module.ContributePanel,
  })),
)

// React.lazy rethrows a failed chunk load during render; without a boundary
// that unmounts the entire app instead of just the panel.
class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <aside className="contribute-panel">
          <p className="muted small">
            The contribution panel failed to load (network hiccup or a fresh
            deploy). Reload the page to continue.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </aside>
      )
    }
    return this.props.children
  }
}

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
    // new Connection() throws on non-http(s) URLs, which would unmount the
    // whole app mid-render — reject bad input here instead.
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      toast.error('Enter a full RPC URL, including https://')
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      toast.error('RPC URL must use http or https.')
      return
    }
    onChangeEndpoint(trimmed)
    toast.success('RPC endpoint updated')
  }

  const showContribute = location.pathname.startsWith('/launch/')

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">MetaDAO ICO Contributor</span>
        <div className="topbar-controls">
          <form className="rpc-inline" onSubmit={onSubmit}>
            <input
              id="rpc-endpoint"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="RPC URL"
            />
            <button type="submit" className="btn btn-sm">
              Set
            </button>
          </form>
          <WalletMultiButton className="wallet-button" />
        </div>
      </header>

      <main>
        <LaunchList />
      </main>

      {showContribute && (
        <PanelErrorBoundary key={location.pathname}>
          <React.Suspense
            fallback={
              <aside className="contribute-panel">Loading launch…</aside>
            }
          >
            <Routes>
              <Route path="/launch/:id" element={<ContributePanel />} />
            </Routes>
          </React.Suspense>
        </PanelErrorBoundary>
      )}

      <ToastContainer position="bottom-right" />
    </div>
  )
}

export default App
