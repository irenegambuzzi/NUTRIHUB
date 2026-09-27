import { createClient } from '@supabase/supabase-js'

// .trim() guards against stray whitespace/newlines from pasting the
// value into a GitHub Actions secret, which otherwise breaks the
// Supabase client in hard-to-diagnose ways (e.g. Realtime auth).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
