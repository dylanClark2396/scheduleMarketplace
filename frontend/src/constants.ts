export const CURRENT_SEASON = '2025-26'

export const SEASONS = ['2024-25', '2025-26', '2026-27']

/**
 * Returns the valid date range for a basketball season string (e.g. "2025-26").
 * Min: October 1 of the first year (preseason leeway)
 * Max: April 30 of the second year (tournament leeway)
 */
export function getSeasonDateRange(season: string): { minDate: Date; maxDate: Date } {
  const startYear = parseInt(season.split('-')[0] ?? '2025', 10)
  return {
    minDate: new Date(startYear, 9, 1),      // Oct 1
    maxDate: new Date(startYear + 1, 3, 30), // Apr 30
  }
}

export const D1_CONFERENCES = [
  'ACC',
  'American Athletic',
  'Atlantic Sun',
  'Atlantic 10',
  'Big 12',
  'Big East',
  'Big South',
  'Big Ten',
  'Big West',
  'CAA',
  'Conference USA',
  'Horizon League',
  'Ivy League',
  'MAAC',
  'MAC',
  'MEAC',
  'Missouri Valley',
  'Mountain West',
  'NEC',
  'Ohio Valley',
  'Pac-12',
  'Patriot League',
  'SEC',
  'Southern',
  'Southland',
  'SWAC',
  'Summit League',
  'Sun Belt',
  'WAC',
  'WCC',
  'Independent',
]

export const LOCATION_LABELS: Record<string, string> = {
  home: 'Home',
  away: 'Away',
  neutral: 'Neutral',
  any: 'Any',
}

export const LOCATION_WEIGHTS: Record<string, number> = {
  away: 1.4,
  neutral: 1.0,
  home: 0.6,
}

// NET quadrant thresholds by location
export const QUADRANT_THRESHOLDS = {
  away:    { q1: 30, q2: 75, q3: 135 },
  neutral: { q1: 50, q2: 100, q3: 200 },
  home:    { q1: 75, q2: 135, q3: 240 },
}

export const QUADRANT_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#ef4444',
}

export const QUADRANT_LABELS: Record<number, string> = {
  1: 'Q1',
  2: 'Q2',
  3: 'Q3',
  4: 'Q4',
}
