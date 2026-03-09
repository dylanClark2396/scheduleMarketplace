import type {
  Team, TeamSchedule, Game,
  MarketplaceListing, ImportJob,
} from '@/models'
import { API_ROUTES } from '@/apiRoutes'
import { useAuth } from '@/composables/useAuth'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API Error ${res.status}: ${text}`)
  }
  return res.json()
}

// Fetch wrapper that silently refreshes the token on 401 and retries once.
// Also proactively refreshes if the token expires within 5 minutes.
async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const { refreshTokens, isTokenExpiringSoon } = useAuth()

  if (isTokenExpiringSoon()) {
    await refreshTokens()
  }

  const withAuth = (i?: RequestInit) => ({
    ...i,
    headers: { ...authHeaders(), ...(i?.headers as Record<string, string>) },
  })

  const res = await fetch(input, withAuth(init))

  if (res.status === 401) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      return fetch(input, withAuth(init))
    }
    // Refresh failed — boot to login
    localStorage.removeItem('access_token')
    localStorage.removeItem('id_token')
    localStorage.removeItem('refresh_token')
    window.location.href = '/login'
  }

  return res
}

export function useApi() {

  // ========================
  // Teams
  // ========================

  const getTeams = async (conference?: string): Promise<Team[]> => {
    const url = conference
      ? `${API_ROUTES.teams}?conference=${encodeURIComponent(conference)}`
      : API_ROUTES.teams
    const res = await apiFetch(url)
    return safeJson<Team[]>(res)
  }

  const getTeam = async (id: string): Promise<Team> => {
    const res = await apiFetch(API_ROUTES.team(id))
    return safeJson<Team>(res)
  }

  // ========================
  // Schedules
  // ========================

  const getSchedules = async (): Promise<TeamSchedule[]> => {
    const res = await apiFetch(API_ROUTES.schedules)
    return safeJson<TeamSchedule[]>(res)
  }

  const getPublicSchedules = async (params?: { season?: string; conference?: string }): Promise<TeamSchedule[]> => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    const res = await apiFetch(`${API_ROUTES.publicSchedules}${qs}`)
    return safeJson<TeamSchedule[]>(res)
  }

  const getPublicSchedule = async (id: string): Promise<TeamSchedule> => {
    const res = await apiFetch(API_ROUTES.publicSchedule(id))
    return safeJson<TeamSchedule>(res)
  }

  const getTeamSchedule = async (teamId: string, season: string): Promise<TeamSchedule | null> => {
    const res = await apiFetch(API_ROUTES.teamSchedule(teamId, season))
    if (res.status === 404) return null
    const items = await safeJson<TeamSchedule[]>(res)
    return items[0] ?? null
  }

  const getSchedule = async (id: string): Promise<TeamSchedule> => {
    const res = await apiFetch(API_ROUTES.schedule(id))
    return safeJson<TeamSchedule>(res)
  }

  const createSchedule = async (data: Partial<TeamSchedule>): Promise<TeamSchedule> => {
    const res = await apiFetch(API_ROUTES.schedules, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await safeJson<{ schedule: TeamSchedule }>(res)
    return result.schedule
  }

  const updateSchedule = async (id: string, updates: Partial<TeamSchedule>): Promise<TeamSchedule> => {
    const res = await apiFetch(API_ROUTES.schedule(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const result = await safeJson<{ schedule: TeamSchedule }>(res)
    return result.schedule
  }

  const addGame = async (scheduleId: string, game: Partial<Game>): Promise<Game> => {
    const res = await apiFetch(API_ROUTES.scheduleGames(scheduleId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(game),
    })
    const result = await safeJson<{ game: Game }>(res)
    return result.game
  }

  const updateGame = async (scheduleId: string, gameId: string, updates: Partial<Game>): Promise<Game> => {
    const res = await apiFetch(API_ROUTES.scheduleGame(scheduleId, gameId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const result = await safeJson<{ game: Game }>(res)
    return result.game
  }

  const deleteGame = async (scheduleId: string, gameId: string): Promise<void> => {
    const res = await apiFetch(API_ROUTES.scheduleGame(scheduleId, gameId), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete game')
  }

  // ========================
  // Marketplace
  // ========================

  const getListings = async (params?: {
    status?: string
    type?: string
    conference?: string
  }): Promise<MarketplaceListing[]> => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    const res = await apiFetch(`${API_ROUTES.marketplace}${qs}`)
    return safeJson<MarketplaceListing[]>(res)
  }

  const createListing = async (data: Partial<MarketplaceListing>): Promise<MarketplaceListing> => {
    const res = await apiFetch(API_ROUTES.marketplace, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await safeJson<{ listing: MarketplaceListing }>(res)
    return result.listing
  }

  const updateListing = async (id: string, updates: Partial<MarketplaceListing>): Promise<MarketplaceListing> => {
    const res = await apiFetch(API_ROUTES.marketplaceListing(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const result = await safeJson<{ listing: MarketplaceListing }>(res)
    return result.listing
  }

  const deleteListing = async (id: string): Promise<void> => {
    const res = await apiFetch(API_ROUTES.marketplaceListing(id), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete listing')
  }

  const matchListings = async (id: string, matchId: string): Promise<void> => {
    const res = await apiFetch(API_ROUTES.marketplaceMatch(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchedListingId: matchId }),
    })
    if (!res.ok) throw new Error('Failed to match listings')
  }

  // ========================
  // Import
  // ========================

  const getImportUploadUrl = async (filename: string, contentType: string): Promise<{ uploadUrl: string; fileUrl: string }> => {
    const res = await apiFetch(
      `${API_ROUTES.importUploadUrl}?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`
    )
    return safeJson(res)
  }

  const createImportJob = async (data: Partial<ImportJob>): Promise<ImportJob> => {
    const res = await apiFetch(API_ROUTES.importJobs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await safeJson<{ job: ImportJob }>(res)
    return result.job
  }

  const getImportJob = async (id: string): Promise<ImportJob> => {
    const res = await apiFetch(API_ROUTES.importJob(id))
    return safeJson<ImportJob>(res)
  }

  const confirmImport = async (id: string, games: Partial<Game>[]): Promise<void> => {
    const res = await apiFetch(API_ROUTES.importConfirm(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games }),
    })
    if (!res.ok) throw new Error('Failed to confirm import')
  }

  return {
    getTeams,
    getTeam,
    getSchedules,
    getPublicSchedules,
    getPublicSchedule,
    getTeamSchedule,
    getSchedule,
    createSchedule,
    updateSchedule,
    addGame,
    updateGame,
    deleteGame,
    getListings,
    createListing,
    updateListing,
    deleteListing,
    matchListings,
    getImportUploadUrl,
    createImportJob,
    getImportJob,
    confirmImport,
  }
}
