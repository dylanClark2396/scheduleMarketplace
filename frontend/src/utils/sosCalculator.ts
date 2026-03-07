import type { Game, SosEstimate, SosQuadrantBreakdown, SosTargetSuggestion, Team } from '@/models'
import { LOCATION_WEIGHTS, QUADRANT_THRESHOLDS } from '@/constants'

export function getQuadrant(opponentNet: number, location: string): 1 | 2 | 3 | 4 {
  const thresholds = QUADRANT_THRESHOLDS[location as keyof typeof QUADRANT_THRESHOLDS]
    ?? QUADRANT_THRESHOLDS.neutral
  if (opponentNet <= thresholds.q1) return 1
  if (opponentNet <= thresholds.q2) return 2
  if (opponentNet <= thresholds.q3) return 3
  return 4
}

export function calculateSos(games: Game[]): number | null {
  const gamesWithNet = games.filter(
    g => g.opponentNetRanking !== null && g.status !== 'cancelled'
  )
  if (gamesWithNet.length === 0) return null

  let weightedSum = 0
  let totalWeight = 0

  for (const game of gamesWithNet) {
    const weight = LOCATION_WEIGHTS[game.location] ?? 1.0
    weightedSum += (game.opponentNetRanking as number) * weight
    totalWeight += weight
  }

  return Math.round((weightedSum / totalWeight) * 10) / 10
}

export function buildQuadrantBreakdown(games: Game[]): SosQuadrantBreakdown {
  const breakdown: SosQuadrantBreakdown = {
    q1Wins: 0, q1Losses: 0,
    q2Wins: 0, q2Losses: 0,
    q3Wins: 0, q3Losses: 0,
    q4Wins: 0, q4Losses: 0,
  }

  for (const game of games) {
    if (game.status !== 'completed' || !game.opponentNetRanking || !game.result) continue
    const q = getQuadrant(game.opponentNetRanking, game.location)
    const key = `q${q}${game.result === 'W' ? 'Wins' : 'Losses'}` as keyof SosQuadrantBreakdown
    breakdown[key]++
  }

  return breakdown
}

export function estimateSos(games: Game[]): SosEstimate {
  const validGames = games.filter(g => g.status !== 'cancelled')

  return {
    currentSos: calculateSos(validGames),
    quadrantBreakdown: buildQuadrantBreakdown(validGames),
    nonConGames: validGames.filter(g => !g.isConference).length,
    confGames: validGames.filter(g => g.isConference).length,
    homeGames: validGames.filter(g => g.location === 'home').length,
    awayGames: validGames.filter(g => g.location === 'away').length,
    neutralGames: validGames.filter(g => g.location === 'neutral').length,
    totalGames: validGames.length,
  }
}

export function suggestTeamsForTarget(
  currentGames: Game[],
  openDates: string[],
  allTeams: Team[],
  targetSos: number,
  maxSuggestions = 10,
): SosTargetSuggestion[] {
  const currentSos = calculateSos(currentGames) ?? 200
  const scheduledTeamIds = new Set(currentGames.map(g => g.opponentId))

  const suggestions: SosTargetSuggestion[] = []
  const needHarder = targetSos < currentSos

  const locations: Array<Game['location']> = ['home', 'away', 'neutral']

  for (const team of allTeams) {
    if (scheduledTeamIds.has(team.id) || !team.netRanking) continue

    let best: SosTargetSuggestion | null = null

    for (const date of openDates) {
      for (const location of locations) {
        const mockGame: Game = {
          id: '__mock__',
          date,
          opponentId: team.id,
          opponentName: team.name,
          opponentNetRanking: team.netRanking,
          location,
          isConference: false,
          status: 'scheduled',
          homeScore: null,
          awayScore: null,
          result: null,
        }

        const projected = calculateSos([...currentGames, mockGame])
        if (projected === null) continue

        const delta = Math.abs(projected - targetSos)

        if (!best || delta < best.sosDelta) {
          best = {
            team,
            suggestedDate: date,
            suggestedLocation: location,
            projectedSosIfAdded: projected,
            sosDelta: delta,
            quadrantIfAdded: getQuadrant(team.netRanking, location),
          }
        }
      }
    }

    if (best) suggestions.push(best)
  }

  // If we need a harder schedule, prefer teams with better NET rank (lower number)
  // Sort by closeness to target first, then by whether they move in the right direction
  return suggestions
    .filter(s => needHarder ? s.team.netRanking! < currentSos : s.team.netRanking! > currentSos)
    .sort((a, b) => a.sosDelta - b.sosDelta)
    .slice(0, maxSuggestions)
}

// Convert raw SOS number to a 0-100 display score (100 = hardest)
export function sosToDisplayScore(sos: number, totalTeams = 363): number {
  return Math.round(((totalTeams - sos) / totalTeams) * 100)
}
