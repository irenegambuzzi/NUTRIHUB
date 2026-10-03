import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { startOfflineSync } from './lib/offlineActions'
import { startAppUpdates } from './pwa'

// Sends changes made offline last time, if any.
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
