import { createClient } from '@supabase/supabase-js'
import { withSessionRecovery } from './authFetch'

// .trim() guards against stray whitespace/newlines from pasting the
// value into a GitHub Actions secret, which otherwise breaks the
// Supabase client in hard-to-diagnose ways (e.g. Realtime auth).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

// The login session is kept on the device and refreshed automatically, and
// every request (tables, realtime, Storage, RPC) carries it. A request
// refused for an expired token refreshes the session and is sent once
// more (see authFetch.js and session.js).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: withSessionRecovery() },
})
