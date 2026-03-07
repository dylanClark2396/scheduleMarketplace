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
  }

  function getToken(): string | null {
    return localStorage.getItem('access_token')
  }

  function isLoggedIn(): boolean {
    return !!getToken()
  }

  return { login, logout, handleCallback, getToken, isLoggedIn }
}
