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

export function isBuyGame(l: MarketplaceListing): l is BuyGameListing {
  return l.dealType === 'buy-game'
}

export function isHomeAndHome(l: MarketplaceListing): l is HomeAndHomeListing {
  return l.dealType === 'home-and-home'
}

export function isNeutralSite(l: MarketplaceListing): l is NeutralSiteListing {
  return l.dealType === 'neutral-site'
}

/** Normalize a raw DynamoDB item that might predate the dealType field */
export function normalizeListing(raw: Record<string, unknown>): MarketplaceListing {
  if (raw['dealType']) return raw as unknown as MarketplaceListing
  // Legacy row: map old fields to BuyGameListing
  return {
    id: raw['id'] as string,
    dealType: 'buy-game',
    status: (raw['status'] as ListingStatus) ?? 'open',
    teamId: (raw['teamId'] as string) ?? '',
    teamName: (raw['teamName'] as string) ?? '',
    conference: (raw['conference'] as string) ?? '',
    currentNetRanking: (raw['currentNetRanking'] as number | null) ?? null,
    targetNetMin: (raw['netRankingMin'] as number | null) ?? null,
    targetNetMax: (raw['netRankingMax'] as number | null) ?? null,
    targetConferences: (raw['targetConferences'] as string[]) ?? [],
    notes: (raw['notes'] as string) ?? '',
    ownerId: (raw['ownerId'] as string) ?? '',
    matchedListingId: (raw['matchedListingId'] as string | null) ?? null,
    createdAt: (raw['createdAt'] as number) ?? 0,
    expiresAt: (raw['expiresAt'] as number) ?? 0,
    role: 'host',
    date: (raw['desiredDate'] as string) ?? (raw['date'] as string) ?? '',
    dateFlexibilityDays: (raw['dateFlexibilityDays'] as number) ?? 0,
    season: (raw['season'] as string) ?? '',
    guaranteeAmount: null,
  }
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
