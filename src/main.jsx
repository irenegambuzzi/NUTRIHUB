import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

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
