// ========================
// Teams & Rankings
// ========================

export interface Team {
  id: string
  name: string
  shortName: string
  conference: string
  division: 'D1' | 'D2' | 'D3'
  netRanking: number | null
  wins: number
  losses: number
  homeWins: number
  homeLosses: number
  awayWins: number
  awayLosses: number
  neutralWins: number
  neutralLosses: number
  confWins: number
  confLosses: number
  ppg: number | null
  oppPpg: number | null
  netEfficiency: number | null
  updatedAt: number
}

// ========================
// Schedule & Games
// ========================

export type GameLocation = 'home' | 'away' | 'neutral'
export type GameStatus = 'scheduled' | 'completed' | 'cancelled'
export type GameResult = 'W' | 'L' | null

export interface Game {
  id: string
  date: string
  opponentId: string
  opponentName: string
  opponentNetRanking: number | null
  location: GameLocation
  isConference: boolean
  status: GameStatus
  homeScore: number | null
  awayScore: number | null
  result: GameResult
}

export type ScheduleType = 'reference' | 'user'

export interface TeamSchedule {
  id: string
  teamId: string
  teamName: string
  conference: string
  season: string
  games: Game[]
  openDates: string[]
  strengthOfSchedule: number | null
  sosQuadrantBreakdown: SosQuadrantBreakdown | null
  isPublic: boolean
  scheduleType: ScheduleType
  ownerId: string
  updatedAt: number
  // Pre-computed summary fields (list endpoint only, not present after row expand)
  wins?: number
  losses?: number
  gameCount?: number
}

export interface SosQuadrantBreakdown {
  q1Wins: number
  q1Losses: number
  q2Wins: number
  q2Losses: number
  q3Wins: number
  q3Losses: number
  q4Wins: number
  q4Losses: number
}

// ========================
// Schedule Estimator
// ========================

export interface SosEstimate {
  currentSos: number | null
  quadrantBreakdown: SosQuadrantBreakdown
  nonConGames: number
  confGames: number
  homeGames: number
  awayGames: number
  neutralGames: number
  totalGames: number
}

export interface SosTargetSuggestion {
  team: Team
  suggestedDate: string | null
  suggestedLocation: GameLocation
  projectedSosIfAdded: number
  sosDelta: number
  quadrantIfAdded: 1 | 2 | 3 | 4
}

// ========================
// Marketplace
// ========================

export type DealType = 'buy-game' | 'home-and-home' | 'neutral-site'
export type BuyGameRole = 'host' | 'visitor'
export type HomeAndHomeHostYear = 'year1' | 'year2' | 'either'
export type ListingStatus = 'open' | 'matched' | 'closed'

interface ListingBase {
  id: string
  dealType: DealType
  status: ListingStatus
  teamId: string
  teamName: string
  conference: string
  currentNetRanking: number | null
  targetNetMin: number | null
  targetNetMax: number | null
  targetConferences: string[]
  notes: string
  ownerId: string
  matchedListingId: string | null
  createdAt: number
  expiresAt: number
}

export interface BuyGameListing extends ListingBase {
  dealType: 'buy-game'
  role: BuyGameRole
  date: string
  dateFlexibilityDays: number
  season: string
  guaranteeAmount: number | null
}

export interface HomeAndHomeListing extends ListingBase {
  dealType: 'home-and-home'
  hostYear: HomeAndHomeHostYear
  year1Season: string
  year2Season: string
  year1Date: string | null
  year2Date: string | null
  dateFlexibilityDays: number
}

export interface NeutralSiteListing extends ListingBase {
  dealType: 'neutral-site'
  date: string
  dateFlexibilityDays: number
  season: string
  venueName: string | null
  venueCity: string | null
}

export type MarketplaceListing = BuyGameListing | HomeAndHomeListing | NeutralSiteListing

// ========================
// Import
// ========================

export type ImportSource = 'pdf' | 'csv' | 'excel' | 'photo' | 'manual'
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ImportJob {
  id: string
  teamId: string | null
  source: ImportSource
  status: ImportStatus
  fileUrl: string | null
  parsedGames: Partial<Game>[]
  errors: string[]
  ownerId: string
  createdAt: number
}
