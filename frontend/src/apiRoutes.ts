const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

export const API_ROUTES = {
  // Teams
  teams: `${BASE}/teams`,
  team: (id: string) => `${BASE}/teams/${id}`,

  // Schedules
  schedules: `${BASE}/schedules`,
  schedule: (id: string) => `${BASE}/schedules/${id}`,
  teamSchedule: (teamId: string, season: string) =>
    `${BASE}/schedules?teamId=${encodeURIComponent(teamId)}&season=${encodeURIComponent(season)}`,
  scheduleGames: (scheduleId: string) => `${BASE}/schedules/${scheduleId}/games`,
  scheduleGame: (scheduleId: string, gameId: string) =>
    `${BASE}/schedules/${scheduleId}/games/${gameId}`,

  // Marketplace
  marketplace: `${BASE}/marketplace`,
  marketplaceListing: (id: string) => `${BASE}/marketplace/${id}`,
  marketplaceMatch: (id: string) => `${BASE}/marketplace/${id}/match`,

  // Import
  importUploadUrl: `${BASE}/import/upload-url`,
  importJobs: `${BASE}/import`,
  importJob: (id: string) => `${BASE}/import/${id}`,
  importConfirm: (id: string) => `${BASE}/import/${id}/confirm`,

  // Admin / Scraper
  adminSync: `${BASE}/admin/sync`,
  scraperStatus: `${BASE}/admin/scraper/status`,
}
