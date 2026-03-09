export type GameLocation = 'home' | 'away' | 'neutral'
export type GameResult = 'W' | 'L' | null
export type GameStatus = 'scheduled' | 'completed' | 'cancelled'

export interface Game {
  id: string
  date: string
  opponentId: string
  opponentName: string
  opponentNetRanking: number | null
  location: GameLocation
  isConference: boolean
  status: GameStatus
  result: GameResult
  homeScore: number | null
  awayScore: number | null
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
  owner_id: string
  updatedAt: number
}

export interface Team {
  id: string
  name: string
  conference: string
  netRanking: number | null
  updatedAt: number
}

export type ListingType = 'request' | 'offer'
export type ListingStatus = 'open' | 'matched' | 'closed'

export interface MarketplaceListing {
  id: string
  type: ListingType
  status: ListingStatus
  teamId: string
  teamName: string
  conference: string
  season: string
  desiredDate: string
  location: GameLocation
  netRankingMin: number | null
  netRankingMax: number | null
  notes: string
  ownerId: string
  matchedListingId: string | null
  createdAt: number
}

export type ImportSource = 'photo' | 'pdf' | 'csv' | 'manual'
export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ImportJob {
  id: string
  source: ImportSource
  status: ImportStatus
  fileUrl: string | null
  teamId: string | null
  parsedGames: Omit<Game, 'id'>[]
  errors: string[]
  ownerId: string
  createdAt: number
}

// Minimal shape of the verified Cognito token we use from req.user
export interface AuthUser {
  sub: string
  username?: string
  [key: string]: unknown
}
