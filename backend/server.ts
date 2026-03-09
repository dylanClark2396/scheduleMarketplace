import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
  ScanCommandInput,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import type {
  Game,
  TeamSchedule,
  MarketplaceListing,
  ImportJob,
  AuthUser,
  SosQuadrantBreakdown,
  GameLocation,
} from './types.js'

// =========================
// APP SETUP
// =========================

export const app = express()
app.disable('x-powered-by')
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  ...(process.env.APP_DOMAIN ? [process.env.APP_DOMAIN] : []),
]
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json())

// Extend Express Request to carry the verified Cognito token
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}

// =========================
// AUTH
// =========================

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID ?? '',
})

const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    req.user = await verifier.verify(token) as AuthUser
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// =========================
// AWS CLIENTS
// =========================

const REGION = process.env.AWS_REGION ?? 'us-east-2'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({
  region: REGION,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const lambda = new LambdaClient({ region: REGION })

const TABLES = {
  teams:       process.env.TEAMS_TABLE       ?? 'teams',
  schedules:   process.env.SCHEDULES_TABLE   ?? 'schedules',
  marketplace: process.env.MARKETPLACE_TABLE ?? 'marketplace',
  importJobs:  process.env.IMPORT_JOBS_TABLE ?? 'import_jobs',
} as const

const IMPORT_BUCKET = process.env.S3_IMPORT_BUCKET ?? ''

// =========================
// HELPERS
// =========================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function getItem<T>(table: string, key: Record<string, string>): Promise<T | undefined> {
  const result = await dynamo.send(new GetCommand({ TableName: table, Key: key }))
  return result.Item as T | undefined
}

async function putItem(table: string, item: Record<string, unknown>): Promise<void> {
  await dynamo.send(new PutCommand({ TableName: table, Item: item }))
}

async function scanTable<T>(table: string, filters: Record<string, string> = {}): Promise<T[]> {
  const expressions: string[] = []
  const names: Record<string, string> = {}
  const values: Record<string, string> = {}

  for (const [k, v] of Object.entries(filters)) {
    names[`#${k}`] = k
    values[`:${k}`] = v
    expressions.push(`#${k} = :${k}`)
  }

  const params: ScanCommandInput = { TableName: table }
  if (expressions.length) {
    params.FilterExpression = expressions.join(' AND ')
    params.ExpressionAttributeNames = names
    params.ExpressionAttributeValues = values
  }

  const result = await dynamo.send(new ScanCommand(params))
  return (result.Items ?? []) as T[]
}

// =========================
// SOS CALCULATION
// =========================

const LOCATION_WEIGHTS: Record<GameLocation, number> = { away: 1.4, neutral: 1.0, home: 0.6 }

const QUADRANT_THRESHOLDS: Record<GameLocation, { q1: number; q2: number; q3: number }> = {
  away:    { q1: 30,  q2: 75,  q3: 135 },
  neutral: { q1: 50,  q2: 100, q3: 200 },
  home:    { q1: 75,  q2: 135, q3: 240 },
}

function calculateSos(games: Game[]): number | null {
  const valid = games.filter(g => g.opponentNetRanking != null && g.status !== 'cancelled')
  if (!valid.length) return null
  let wSum = 0, wTotal = 0
  for (const g of valid) {
    const w = LOCATION_WEIGHTS[g.location] ?? 1.0
    wSum += (g.opponentNetRanking as number) * w
    wTotal += w
  }
  return Math.round((wSum / wTotal) * 10) / 10
}

function getQuadrant(net: number, location: GameLocation): 1 | 2 | 3 | 4 {
  const t = QUADRANT_THRESHOLDS[location] ?? QUADRANT_THRESHOLDS.neutral
  if (net <= t.q1) return 1
  if (net <= t.q2) return 2
  if (net <= t.q3) return 3
  return 4
}

function buildQuadrantBreakdown(games: Game[]): SosQuadrantBreakdown {
  const b: SosQuadrantBreakdown = {
    q1Wins: 0, q1Losses: 0,
    q2Wins: 0, q2Losses: 0,
    q3Wins: 0, q3Losses: 0,
    q4Wins: 0, q4Losses: 0,
  }
  for (const g of games) {
    if (g.status !== 'completed' || !g.opponentNetRanking || !g.result) continue
    const q = getQuadrant(g.opponentNetRanking, g.location)
    const key = `q${q}${g.result === 'W' ? 'Wins' : 'Losses'}` as keyof SosQuadrantBreakdown
    b[key]++
  }
  return b
}

function recomputeScheduleStats(schedule: TeamSchedule): TeamSchedule {
  schedule.strengthOfSchedule = calculateSos(schedule.games)
  schedule.sosQuadrantBreakdown = buildQuadrantBreakdown(schedule.games)
  return schedule
}

// =========================
// HEALTH
// =========================

app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }))

// =========================
// TEAMS
// =========================

app.get('/teams', async (req: Request, res: Response) => {
  try {
    const { conference } = req.query as Record<string, string>
    const items = await scanTable(TABLES.teams, conference ? { conference } : {})
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch teams' })
  }
})

app.get('/teams/:id', async (req: Request, res: Response) => {
  try {
    const team = await getItem(TABLES.teams, { id: req.params['id'] as string })
    if (!team) return res.status(404).json({ error: 'Team not found' })
    res.json(team)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch team' })
  }
})

app.post('/teams', requireAuth, async (req: Request, res: Response) => {
  try {
    const team = { id: generateId(), ...req.body as object, updatedAt: Date.now() }
    await putItem(TABLES.teams, team)
    res.status(201).json({ status: 'ok', team })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create team' })
  }
})

// =========================
// SCHEDULES
// =========================

app.get('/schedules', requireAuth, async (req: Request, res: Response) => {
  try {
    const { teamId, season } = req.query as Record<string, string>
    let items = await scanTable<TeamSchedule>(TABLES.schedules, { owner_id: req.user!.sub })
    if (teamId) items = items.filter(s => s.teamId === teamId)
    if (season) items = items.filter(s => s.season === season)
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

app.get('/schedules/public', async (req: Request, res: Response) => {
  try {
    const { season, conference } = req.query as Record<string, string>
    let items = await scanTable<TeamSchedule & { conference?: string }>(TABLES.schedules)
    items = items.filter(s => s.isPublic === true)
    if (season) items = items.filter(s => s.season === season)
    if (conference) items = items.filter(s => s.conference === conference)
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch public schedules' })
  }
})

app.get('/schedules/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['id'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    res.json(schedule)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch schedule' })
  }
})

app.post('/schedules', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TeamSchedule>
    const schedule: TeamSchedule = {
      id: generateId(),
      ...body,
      games: body.games ?? [],
      openDates: body.openDates ?? [],
      owner_id: req.user!.sub,
      updatedAt: Date.now(),
    } as TeamSchedule
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)
    res.status(201).json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create schedule' })
  }
})

app.patch('/schedules/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['id'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    Object.assign(schedule, req.body, { updatedAt: Date.now() })
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)
    res.json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update schedule' })
  }
})

app.delete('/schedules/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['id'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    await dynamo.send(new DeleteCommand({ TableName: TABLES.schedules, Key: { id: req.params['id'] as string } }))
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete schedule' })
  }
})

// =========================
// GAMES (nested under schedule)
// =========================

app.post('/schedules/:scheduleId/games', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['scheduleId'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })

    const body = req.body as Partial<Game>
    if (!body.date || !body.opponentId || !body.location || !body.status) {
      return res.status(400).json({ error: 'date, opponentId, location, and status are required' })
    }

    const game: Game = { id: generateId(), ...body as Omit<Game, 'id'> }
    schedule.games = schedule.games ?? []
    schedule.games.push(game)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)
    res.status(201).json({ status: 'ok', game, strengthOfSchedule: schedule.strengthOfSchedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add game' })
  }
})

app.patch('/schedules/:scheduleId/games/:gameId', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['scheduleId'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })

    const game = schedule.games?.find(g => g.id === req.params['gameId'] as string)
    if (!game) return res.status(404).json({ error: 'Game not found' })
    Object.assign(game, req.body)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)
    res.json({ status: 'ok', game, strengthOfSchedule: schedule.strengthOfSchedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update game' })
  }
})

app.delete('/schedules/:scheduleId/games/:gameId', requireAuth, async (req: Request, res: Response) => {
  try {
    const schedule = await getItem<TeamSchedule>(TABLES.schedules, { id: req.params['scheduleId'] as string })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })

    schedule.games = (schedule.games ?? []).filter(g => g.id !== req.params['gameId'] as string)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete game' })
  }
})

// =========================
// MARKETPLACE
// =========================

app.get('/marketplace', async (req: Request, res: Response) => {
  try {
    const { status, type, conference } = req.query as Record<string, string>
    const filters: Record<string, string> = {}
    if (status) filters.status = status
    if (type) filters.type = type
    if (conference) filters.conference = conference
    const items = await scanTable<MarketplaceListing>(TABLES.marketplace, filters)
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch listings' })
  }
})

app.post('/marketplace', requireAuth, async (req: Request, res: Response) => {
  try {
    const listing: MarketplaceListing = {
      id: generateId(),
      ...req.body as Omit<MarketplaceListing, 'id' | 'matchedListingId' | 'ownerId' | 'createdAt'>,
      matchedListingId: null,
      ownerId: req.user!.sub,
      createdAt: Date.now(),
    }
    await putItem(TABLES.marketplace, listing as unknown as Record<string, unknown>)
    res.status(201).json({ status: 'ok', listing })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create listing' })
  }
})

app.patch('/marketplace/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const listing = await getItem<MarketplaceListing>(TABLES.marketplace, { id: req.params['id'] as string })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.ownerId !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    const { date, preferredLocation, targetNetRange, status, notes } = req.body as Partial<MarketplaceListing>
    if (date !== undefined) listing.date = date
    if (preferredLocation !== undefined) listing.preferredLocation = preferredLocation
    if (targetNetRange !== undefined) listing.targetNetRange = targetNetRange
    if (status !== undefined) listing.status = status
    if (notes !== undefined) listing.notes = notes
    await putItem(TABLES.marketplace, listing as unknown as Record<string, unknown>)
    res.json({ status: 'ok', listing })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update listing' })
  }
})

app.delete('/marketplace/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const listing = await getItem<MarketplaceListing>(TABLES.marketplace, { id: req.params['id'] as string })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.ownerId !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    // Clean up paired listing's matchedListingId if this was matched
    if (listing.matchedListingId) {
      const paired = await getItem<MarketplaceListing>(TABLES.marketplace, { id: listing.matchedListingId })
      if (paired) {
        paired.status = 'open'
        paired.matchedListingId = null
        await putItem(TABLES.marketplace, paired as unknown as Record<string, unknown>)
      }
    }
    await dynamo.send(new DeleteCommand({ TableName: TABLES.marketplace, Key: { id: req.params['id'] as string } }))
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete listing' })
  }
})

app.post('/marketplace/:id/match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matchedListingId } = req.body as { matchedListingId: string }
    const listing = await getItem<MarketplaceListing>(TABLES.marketplace, { id: req.params['id'] as string })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    listing.status = 'matched'
    listing.matchedListingId = matchedListingId
    await putItem(TABLES.marketplace, listing as unknown as Record<string, unknown>)
    if (matchedListingId && matchedListingId !== req.params['id'] as string) {
      const other = await getItem<MarketplaceListing>(TABLES.marketplace, { id: matchedListingId })
      if (other) {
        other.status = 'matched'
        other.matchedListingId = req.params['id'] as string
        await putItem(TABLES.marketplace, other as unknown as Record<string, unknown>)
      }
    }
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to match listings' })
  }
})

// =========================
// IMPORT
// =========================

app.get('/import/upload-url', requireAuth, async (req: Request, res: Response) => {
  try {
    const { filename, contentType } = req.query as Record<string, string>
    if (!filename) return res.status(400).json({ error: 'filename required' })

    const key = `imports/${req.user!.sub}/${Date.now()}-${filename}`
    const command = new PutObjectCommand({
      Bucket: IMPORT_BUCKET,
      Key: key,
      ContentType: contentType ?? 'application/octet-stream',
    })
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })
    const fileUrl = `https://${IMPORT_BUCKET}.s3.${REGION}.amazonaws.com/${key}`
    res.json({ uploadUrl, fileUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to generate upload URL' })
  }
})

app.post('/import', requireAuth, async (req: Request, res: Response) => {
  try {
    const job: ImportJob = {
      id: generateId(),
      ...req.body as Omit<ImportJob, 'id' | 'status' | 'parsedGames' | 'errors' | 'ownerId' | 'createdAt'>,
      status: 'pending',
      parsedGames: [],
      errors: [],
      ownerId: req.user!.sub,
      createdAt: Date.now(),
    }
    await putItem(TABLES.importJobs, job as unknown as Record<string, unknown>)

    const processorFn = process.env.IMPORT_PROCESSOR_FUNCTION_NAME
    if (processorFn) {
      await lambda.send(new InvokeCommand({
        FunctionName: processorFn,
        InvocationType: 'Event',
        Payload: JSON.stringify(job),
      }))
    } else {
      const { processImportJob } = await import('./importProcessor.js')
      processImportJob(job).catch(console.error)
    }

    res.json({ status: 'ok', job })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create import job' })
  }
})

app.get('/import/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await getItem<ImportJob>(TABLES.importJobs, { id: req.params['id'] as string })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.ownerId !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })
    res.json(job)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch job' })
  }
})

app.post('/import/:id/confirm', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await getItem<ImportJob>(TABLES.importJobs, { id: req.params['id'] as string })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.ownerId !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' })

    const { games } = req.body as { games: Omit<Game, 'id'>[] }
    if (!job.teamId) return res.status(400).json({ error: 'No team associated with import' })

    const existing = await scanTable<TeamSchedule>(TABLES.schedules, {
      teamId: job.teamId,
      owner_id: req.user!.sub,
    })

    const year = new Date().getFullYear()
    const season = `${year}-${String(year + 1).slice(2)}`
    const schedule: TeamSchedule = existing[0] ?? {
      id: generateId(),
      teamId: job.teamId,
      teamName: '',
      season,
      games: [],
      openDates: [],
      strengthOfSchedule: null,
      sosQuadrantBreakdown: null,
      owner_id: req.user!.sub,
      updatedAt: Date.now(),
    }

    schedule.games = [...(schedule.games ?? []), ...games.map(g => ({ id: generateId(), ...g }))]
    schedule.updatedAt = Date.now()
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule as unknown as Record<string, unknown>)

    job.status = 'completed'
    await putItem(TABLES.importJobs, job as unknown as Record<string, unknown>)

    res.json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to confirm import' })
  }
})

// =========================
// ADMIN
// =========================

app.get('/admin/scraper/status', requireAuth, (_req: Request, res: Response) => {
  res.json({ lastRun: process.env.SCRAPER_LAST_RUN ?? null, status: 'idle' })
})

app.post('/admin/sync', requireAuth, (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Sync queued' })
})

// =========================
// CATCH-ALL / ERROR HANDLERS
// =========================

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
