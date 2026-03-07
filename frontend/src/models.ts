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

export interface TeamSchedule {
  id: string
  teamId: string
  teamName: string
  season: string
  games: Game[]
  openDates: string[]
  strengthOfSchedule: number | null
  sosQuadrantBreakdown: SosQuadrantBreakdown | null
  ownerId: string
  updatedAt: number
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

export type ListingType = 'request' | 'offer'
export type ListingStatus = 'open' | 'matched' | 'closed'

export interface MarketplaceListing {
  id: string
  type: ListingType
  teamId: string
  teamName: string
  conference: string
  currentNetRanking: number | null
  date: string
  dateFlexibilityDays: number
  preferredLocation: GameLocation | 'any'
  targetNetMin: number | null
  targetNetMax: number | null
  targetConferences: string[]
  compensationNotes: string
  notes: string
  status: ListingStatus
  matchedListingId: string | null
  ownerId: string
  createdAt: number
  expiresAt: number
}

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
