import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { startOfflineSync } from './lib/offlineActions'
import { startAppUpdates } from './pwa'
import { isSignedIn, startAuth, whenSignedIn } from './lib/auth'
import { flush, setFlushGate } from './lib/offlineQueue'

// Login first: offline changes are sent only with a session, as soon as
// one starts (and changes made offline last time, if any).
setFlushGate(isSignedIn)
whenSignedIn(() => flush())
startAuth()
startOfflineSync()
// Watches for new versions of the app.
startAppUpdates()

// GitHub Pages serves static files with no server-side rewrites, so a
// path-based router would 404 on refresh/deep-link. HashRouter keeps
// all routing client-side (e.g. /NUTRIHUB/#/profiles) with zero extra
// server config needed.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
