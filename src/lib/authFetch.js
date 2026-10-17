// Requests to Supabase that are refused because the login token has
// expired ("JWT expired") get a fresh token and are sent once more.
// Nothing here imports the Supabase client: session.js plugs the refresh
// in (see setSessionRecovery), so the client can use this as its fetch.

const EXPIRED = /jwt expired|invalid jwt|jwt.*(expired|invalid)|token is expired|"?exp"? claim|PGRST30[123]/i

// Whether error text (a response body or an error message) says the login
// token has expired or isn't accepted.
export const isTokenExpiredText = (text) => EXPIRED.test(String(text ?? ''))

// Whether a Supabase error object is that.
export const isSessionError = (error) => Boolean(error) && (isTokenExpiredText(error.message) || /^PGRST30[123]$/.test(error.code ?? ''))

let recovery = { refresh: async () => null, rejected: () => {}, serverTime: () => {} }

// refresh(): resolves to a fresh access token, or null when there is none.
// rejected(): a request was refused even with a fresh token.
// serverTime(ms): the server's clock, from a response header.
export const setSessionRecovery = (next) => {
  recovery = { ...recovery, ...next }
}

const isAuthRequest = (input) => String(input?.url ?? input).includes('/auth/v1/')

// A fetch for the Supabase client: the normal one, plus one retry with a
// fresh token when a request was refused for an expired one.
export function withSessionRecovery(baseFetch = (...args) => fetch(...args)) {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    if (isAuthRequest(input)) return response
    const date = Date.parse(response.headers?.get?.('date') ?? '')
    if (Number.isFinite(date)) recovery.serverTime(date)
    if (![400, 401, 403].includes(response.status)) return response
    const text = await response.clone().text().catch(() => '')
    if (!isTokenExpiredText(text)) return response
    // A request that can't be repeated (a Request object) is left as it is.
    if (typeof input !== 'string' && !(input instanceof URL)) return response
    const token = await recovery.refresh()
    if (!token) return response
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const again = await baseFetch(input, { ...init, headers })
    if ([400, 401, 403].includes(again.status) && isTokenExpiredText(await again.clone().text().catch(() => ''))) recovery.rejected()
    return again
  }
}
