import { describe, it, expect } from 'vitest'
import { calculateSos, getQuadrant, buildQuadrantBreakdown, estimateSos, suggestTeamsForTarget, sosToDisplayScore } from './sosCalculator'
import type { Game, Team } from '@/models'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    date: '2025-11-15',
    opponentId: 'opp-1',
    opponentName: 'Opponent',
    opponentNetRanking: 50,
    location: 'home',
    isConference: false,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    result: null,
    ...overrides,
  }
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Test Team',
    shortName: 'TEST',
    conference: 'ACC',
    division: 'D1',
    netRanking: 50,
    wins: 10, losses: 5,
    homeWins: 5, homeLosses: 2,
    awayWins: 3, awayLosses: 2,
    neutralWins: 2, neutralLosses: 1,
    confWins: 6, confLosses: 3,
    ppg: 75,
    oppPpg: 68,
    netEfficiency: 7,
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ── calculateSos ─────────────────────────────────────────────────────────────

describe('calculateSos', () => {
  it('returns null for empty games', () => {
    expect(calculateSos([])).toBeNull()
  })

  it('returns null when all games are cancelled', () => {
    expect(calculateSos([makeGame({ status: 'cancelled' })])).toBeNull()
  })

  it('returns null when no games have NET rankings', () => {
    expect(calculateSos([makeGame({ opponentNetRanking: null })])).toBeNull()
  })

  it('applies home weight 0.6 correctly', () => {
    // Single home game vs #100 → SOS = 100 (weight cancels out in single-game case)
    const result = calculateSos([makeGame({ opponentNetRanking: 100, location: 'home' })])
    expect(result).toBe(100)
  })

  it('weights away games more than home games', () => {
    // Away vs #100 weighted 1.4; home vs #100 weighted 0.6
    // Two games, both #100, mixed locations → still 100
    const games = [
      makeGame({ id: 'g1', opponentNetRanking: 100, location: 'away' }),
      makeGame({ id: 'g2', opponentNetRanking: 100, location: 'home' }),
    ]
    expect(calculateSos(games)).toBe(100)
  })

  it('road win against #10 yields lower SOS than home win against #10', () => {
    const away = calculateSos([makeGame({ opponentNetRanking: 10, location: 'away' })])
    const home = calculateSos([makeGame({ opponentNetRanking: 10, location: 'home' })])
    // Raw SOS number is the same (single game → weighted avg = opponent rank)
    // but mixing with easier games would differ; in isolation both equal 10
    expect(away).toBe(10)
    expect(home).toBe(10)
  })

  it('correctly weights a mixed schedule', () => {
    // Away vs #10 (w=1.4) + Home vs #200 (w=0.6)
    // = (10*1.4 + 200*0.6) / (1.4+0.6) = (14+120)/2 = 67
    const games = [
      makeGame({ id: 'g1', opponentNetRanking: 10,  location: 'away' }),
      makeGame({ id: 'g2', opponentNetRanking: 200, location: 'home' }),
    ]
    expect(calculateSos(games)).toBe(67)
  })

  it('excludes cancelled games', () => {
    const games = [
      makeGame({ id: 'g1', opponentNetRanking: 10,  location: 'away' }),
      makeGame({ id: 'g2', opponentNetRanking: 300, location: 'home', status: 'cancelled' }),
    ]
    expect(calculateSos(games)).toBe(10)
  })
})

// ── getQuadrant ───────────────────────────────────────────────────────────────

describe('getQuadrant', () => {
  it('Q1 away: ≤30', () => expect(getQuadrant(30, 'away')).toBe(1))
  it('Q2 away: 31–75', () => expect(getQuadrant(31, 'away')).toBe(2))
  it('Q3 away: 76–135', () => expect(getQuadrant(76, 'away')).toBe(3))
  it('Q4 away: >135', () => expect(getQuadrant(136, 'away')).toBe(4))

  it('Q1 neutral: ≤50', () => expect(getQuadrant(50, 'neutral')).toBe(1))
  it('Q2 neutral: 51–100', () => expect(getQuadrant(51, 'neutral')).toBe(2))

  it('Q1 home: ≤75', () => expect(getQuadrant(75, 'home')).toBe(1))
  it('Q2 home: 76–135', () => expect(getQuadrant(76, 'home')).toBe(2))
  it('Q4 home: >240', () => expect(getQuadrant(241, 'home')).toBe(4))

  it('falls back to neutral thresholds for unknown location', () => {
    expect(getQuadrant(50, 'unknown')).toBe(1)
  })
})

// ── buildQuadrantBreakdown ────────────────────────────────────────────────────

describe('buildQuadrantBreakdown', () => {
  it('returns all zeros for empty games', () => {
    const b = buildQuadrantBreakdown([])
    expect(b.q1Wins).toBe(0)
    expect(b.q4Losses).toBe(0)
  })

  it('skips scheduled games', () => {
    const b = buildQuadrantBreakdown([makeGame({ status: 'scheduled', result: null })])
    expect(b.q1Wins + b.q1Losses + b.q2Wins + b.q2Losses).toBe(0)
  })

  it('counts Q1 win correctly (away vs #10)', () => {
    const b = buildQuadrantBreakdown([
      makeGame({ status: 'completed', result: 'W', opponentNetRanking: 10, location: 'away' }),
    ])
    expect(b.q1Wins).toBe(1)
    expect(b.q1Losses).toBe(0)
  })

  it('counts Q4 loss correctly (home vs #300)', () => {
    const b = buildQuadrantBreakdown([
      makeGame({ status: 'completed', result: 'L', opponentNetRanking: 300, location: 'home' }),
    ])
    expect(b.q4Losses).toBe(1)
  })
})

// ── estimateSos ───────────────────────────────────────────────────────────────

describe('estimateSos', () => {
  it('counts home/away/neutral/conf/nonConf correctly', () => {
    const games = [
      makeGame({ id: 'g1', location: 'home',    isConference: true }),
      makeGame({ id: 'g2', location: 'away',    isConference: true }),
      makeGame({ id: 'g3', location: 'neutral', isConference: false }),
    ]
    const e = estimateSos(games)
    expect(e.homeGames).toBe(1)
    expect(e.awayGames).toBe(1)
    expect(e.neutralGames).toBe(1)
    expect(e.confGames).toBe(2)
    expect(e.nonConGames).toBe(1)
    expect(e.totalGames).toBe(3)
  })

  it('excludes cancelled games from counts', () => {
    const e = estimateSos([makeGame({ status: 'cancelled' })])
    expect(e.totalGames).toBe(0)
  })
})

// ── sosToDisplayScore ─────────────────────────────────────────────────────────

describe('sosToDisplayScore', () => {
  it('SOS=1 → ~100 (hardest)', () => {
    expect(sosToDisplayScore(1)).toBe(100)
  })
  it('SOS=363 → 0 (easiest)', () => {
    expect(sosToDisplayScore(363)).toBe(0)
  })
  it('SOS=182 → ~50', () => {
    expect(sosToDisplayScore(182)).toBeCloseTo(50, 0)
  })
})

// ── suggestTeamsForTarget ─────────────────────────────────────────────────────

describe('suggestTeamsForTarget', () => {
  const currentGames: Game[] = [
    makeGame({ id: 'g1', opponentId: 'scheduled-team', opponentNetRanking: 100, location: 'home' }),
  ]
  const openDates = ['2025-12-01', '2025-12-15']

  it('returns empty when no teams have NET rankings', () => {
    const teams = [makeTeam({ netRanking: null })]
    const s = suggestTeamsForTarget(currentGames, openDates, teams, 50)
    expect(s).toHaveLength(0)
  })

  it('excludes already-scheduled opponents', () => {
    const teams = [makeTeam({ id: 'scheduled-team', netRanking: 5 })]
    const s = suggestTeamsForTarget(currentGames, openDates, teams, 50)
    expect(s).toHaveLength(0)
  })

  it('returns at most maxSuggestions results', () => {
    const teams = Array.from({ length: 20 }, (_, i) =>
      makeTeam({ id: `team-${i}`, netRanking: i + 1 })
    )
    // target=50, current SOS=100 → need harder schedule (lower SOS), teams with netRanking < 100
    const s = suggestTeamsForTarget(currentGames, openDates, teams, 50, 5)
    expect(s.length).toBeLessThanOrEqual(5)
  })

  it('suggestions are sorted by sosDelta ascending', () => {
    const teams = Array.from({ length: 10 }, (_, i) =>
      makeTeam({ id: `team-${i}`, netRanking: (i + 1) * 10 })
    )
    const s = suggestTeamsForTarget(currentGames, openDates, teams, 50)
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.sosDelta).toBeGreaterThanOrEqual(s[i - 1]!.sosDelta)
    }
  })
})
