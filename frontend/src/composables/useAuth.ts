export function useAuth() {
  const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN
  const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID
  const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || `${window.location.origin}/callback`

  function login() {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
    })
    window.location.href = `${COGNITO_DOMAIN}/login?${params}`
  }

  function logout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('id_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    window.location.href = '/login'
  }

  async function handleCallback(code: string): Promise<void> {
    const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    })

    if (!res.ok) throw new Error('Token exchange failed')
    const tokens = await res.json()

    localStorage.setItem('access_token', tokens.access_token)
    if (tokens.id_token) localStorage.setItem('id_token', tokens.id_token)
    if (tokens.refresh_token) localStorage.setItem('refresh_token', tokens.refresh_token)
  }

  async function refreshTokens(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) return false

    try {
      const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
      })

      if (!res.ok) return false
      const tokens = await res.json()

      localStorage.setItem('access_token', tokens.access_token)
      if (tokens.id_token) localStorage.setItem('id_token', tokens.id_token)
      return true
    } catch {
      return false
    }
  }

  function getToken(): string | null {
    return localStorage.getItem('access_token')
  }

  function isLoggedIn(): boolean {
    return !!getToken()
  }

  function isTokenExpiringSoon(bufferSeconds = 300): boolean {
    const token = getToken()
    if (!token) return true
    try {
      const part = token.split('.')[1]
      if (!part) return true
      const payload = JSON.parse(atob(part))
      return payload.exp * 1000 - Date.now() < bufferSeconds * 1000
    } catch {
      return true
    }
  }

  return { login, logout, handleCallback, refreshTokens, getToken, isLoggedIn, isTokenExpiringSoon }
}
