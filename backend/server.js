import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// =========================
// APP SETUP
// =========================

export const app = express()
app.use(cors({ origin: ['https://schedulemarketplace.com', 'http://localhost:5173'] }))
app.use(express.json())

// =========================
// AUTH
// =========================

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'access',
  clientId: process.env.COGNITO_CLIENT_ID,
})

const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = await verifier.verify(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// =========================
// AWS CLIENTS
// =========================

const REGION = process.env.AWS_REGION || 'us-east-2'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({
  region: REGION,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})
const lambda = new LambdaClient({ region: REGION })

// Table names come from env vars so they work across environments
const TABLES = {
  teams:       process.env.TEAMS_TABLE       || 'ncaa_teams',
  schedules:   process.env.SCHEDULES_TABLE   || 'ncaa_schedules',
  marketplace: process.env.MARKETPLACE_TABLE || 'ncaa_marketplace',
  importJobs:  process.env.IMPORT_JOBS_TABLE || 'ncaa_import_jobs',
}

const IMPORT_BUCKET = process.env.S3_IMPORT_BUCKET

// =========================
// HELPERS
// =========================

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function getItem(table, key) {
  const result = await dynamo.send(new GetCommand({ TableName: table, Key: key }))
  return result.Item
}

async function putItem(table, item) {
  await dynamo.send(new PutCommand({ TableName: table, Item: item }))
}

async function scanTable(table, filters = {}) {
  const expressions = []
  const names = {}
  const values = {}

  for (const [k, v] of Object.entries(filters)) {
    names[`#${k}`] = k
    values[`:${k}`] = v
    expressions.push(`#${k} = :${k}`)
  }

  const params = { TableName: table }
  if (expressions.length) {
    params.FilterExpression = expressions.join(' AND ')
    params.ExpressionAttributeNames = names
    params.ExpressionAttributeValues = values
  }

  const result = await dynamo.send(new ScanCommand(params))
  return result.Items || []
}

// =========================
// SOS CALCULATION
// =========================

const LOCATION_WEIGHTS = { away: 1.4, neutral: 1.0, home: 0.6 }

const QUADRANT_THRESHOLDS = {
  away:    { q1: 30,  q2: 75,  q3: 135 },
  neutral: { q1: 50,  q2: 100, q3: 200 },
  home:    { q1: 75,  q2: 135, q3: 240 },
}

function calculateSos(games) {
  const valid = games.filter(g => g.opponentNetRanking != null && g.status !== 'cancelled')
  if (!valid.length) return null
  let wSum = 0, wTotal = 0
  for (const g of valid) {
    const w = LOCATION_WEIGHTS[g.location] ?? 1.0
    wSum += g.opponentNetRanking * w
    wTotal += w
  }
  return Math.round((wSum / wTotal) * 10) / 10
}

function getQuadrant(net, location) {
  const t = QUADRANT_THRESHOLDS[location] ?? QUADRANT_THRESHOLDS.neutral
  if (net <= t.q1) return 1
  if (net <= t.q2) return 2
  if (net <= t.q3) return 3
  return 4
}

function buildQuadrantBreakdown(games) {
  const b = { q1Wins: 0, q1Losses: 0, q2Wins: 0, q2Losses: 0, q3Wins: 0, q3Losses: 0, q4Wins: 0, q4Losses: 0 }
  for (const g of games) {
    if (g.status !== 'completed' || !g.opponentNetRanking || !g.result) continue
    const q = getQuadrant(g.opponentNetRanking, g.location)
    b[`q${q}${g.result === 'W' ? 'Wins' : 'Losses'}`]++
  }
  return b
}

function recomputeScheduleStats(schedule) {
  schedule.strengthOfSchedule = calculateSos(schedule.games)
  schedule.sosQuadrantBreakdown = buildQuadrantBreakdown(schedule.games)
  return schedule
}

// =========================
// HEALTH
// =========================

app.get('/health', (req, res) => res.json({ status: 'ok' }))

// =========================
// TEAMS
// =========================

app.get('/teams', async (req, res) => {
  try {
    const { conference } = req.query
    const items = await scanTable(TABLES.teams, conference ? { conference } : {})
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch teams' })
  }
})

app.get('/teams/:id', async (req, res) => {
  try {
    const team = await getItem(TABLES.teams, { id: req.params.id })
    if (!team) return res.status(404).json({ error: 'Team not found' })
    res.json(team)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch team' })
  }
})

app.post('/teams', requireAuth, async (req, res) => {
  try {
    const team = { id: generateId(), ...req.body, updatedAt: Date.now() }
    await putItem(TABLES.teams, team)
    res.json({ status: 'ok', team })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create team' })
  }
})

// =========================
// SCHEDULES
// =========================

app.get('/schedules', requireAuth, async (req, res) => {
  try {
    const { teamId, season } = req.query
    let items = await scanTable(TABLES.schedules, { owner_id: req.user.sub })
    if (teamId) items = items.filter(s => s.teamId === teamId)
    if (season) items = items.filter(s => s.season === season)
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

app.get('/schedules/:id', requireAuth, async (req, res) => {
  try {
    const schedule = await getItem(TABLES.schedules, { id: req.params.id })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })
    res.json(schedule)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch schedule' })
  }
})

app.post('/schedules', requireAuth, async (req, res) => {
  try {
    const schedule = {
      id: generateId(),
      ...req.body,
      games: req.body.games || [],
      openDates: req.body.openDates || [],
      owner_id: req.user.sub,
      updatedAt: Date.now(),
    }
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule)
    res.json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create schedule' })
  }
})

app.patch('/schedules/:id', requireAuth, async (req, res) => {
  try {
    const schedule = await getItem(TABLES.schedules, { id: req.params.id })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })
    Object.assign(schedule, req.body, { updatedAt: Date.now() })
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule)
    res.json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update schedule' })
  }
})

// =========================
// GAMES (nested under schedule)
// =========================

app.post('/schedules/:scheduleId/games', requireAuth, async (req, res) => {
  try {
    const schedule = await getItem(TABLES.schedules, { id: req.params.scheduleId })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })

    const game = { id: generateId(), ...req.body }
    schedule.games = schedule.games || []
    schedule.games.push(game)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule)
    res.json({ status: 'ok', game })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add game' })
  }
})

app.patch('/schedules/:scheduleId/games/:gameId', requireAuth, async (req, res) => {
  try {
    const schedule = await getItem(TABLES.schedules, { id: req.params.scheduleId })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })

    const game = schedule.games?.find(g => g.id === req.params.gameId)
    if (!game) return res.status(404).json({ error: 'Game not found' })
    Object.assign(game, req.body)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule)
    res.json({ status: 'ok', game })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update game' })
  }
})

app.delete('/schedules/:scheduleId/games/:gameId', requireAuth, async (req, res) => {
  try {
    const schedule = await getItem(TABLES.schedules, { id: req.params.scheduleId })
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' })
    if (schedule.owner_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })

    schedule.games = (schedule.games || []).filter(g => g.id !== req.params.gameId)
    recomputeScheduleStats(schedule)
    schedule.updatedAt = Date.now()
    await putItem(TABLES.schedules, schedule)
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete game' })
  }
})

// =========================
// MARKETPLACE
// =========================

app.get('/marketplace', async (req, res) => {
  try {
    const { status, type, conference } = req.query
    const filters = {}
    if (status) filters.status = status
    if (type) filters.type = type
    if (conference) filters.conference = conference
    const items = await scanTable(TABLES.marketplace, filters)
    res.json(items)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch listings' })
  }
})

app.post('/marketplace', requireAuth, async (req, res) => {
  try {
    const listing = {
      id: generateId(),
      ...req.body,
      matchedListingId: null,
      ownerId: req.user.sub,
      createdAt: Date.now(),
    }
    await putItem(TABLES.marketplace, listing)
    res.json({ status: 'ok', listing })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create listing' })
  }
})

app.patch('/marketplace/:id', requireAuth, async (req, res) => {
  try {
    const listing = await getItem(TABLES.marketplace, { id: req.params.id })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.ownerId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })
    Object.assign(listing, req.body)
    await putItem(TABLES.marketplace, listing)
    res.json({ status: 'ok', listing })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to update listing' })
  }
})

app.delete('/marketplace/:id', requireAuth, async (req, res) => {
  try {
    const listing = await getItem(TABLES.marketplace, { id: req.params.id })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.ownerId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })
    await dynamo.send(new DeleteCommand({ TableName: TABLES.marketplace, Key: { id: req.params.id } }))
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete listing' })
  }
})

app.post('/marketplace/:id/match', requireAuth, async (req, res) => {
  try {
    const { matchedListingId } = req.body
    const listing = await getItem(TABLES.marketplace, { id: req.params.id })
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    listing.status = 'matched'
    listing.matchedListingId = matchedListingId
    await putItem(TABLES.marketplace, listing)
    if (matchedListingId && matchedListingId !== req.params.id) {
      const other = await getItem(TABLES.marketplace, { id: matchedListingId })
      if (other) {
        other.status = 'matched'
        other.matchedListingId = req.params.id
        await putItem(TABLES.marketplace, other)
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

app.get('/import/upload-url', requireAuth, async (req, res) => {
  try {
    const { filename, contentType } = req.query
    if (!filename) return res.status(400).json({ error: 'filename required' })

    const key = `imports/${req.user.sub}/${Date.now()}-${filename}`
    const command = new PutObjectCommand({
      Bucket: IMPORT_BUCKET,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    })
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })
    const fileUrl = `https://${IMPORT_BUCKET}.s3.${REGION}.amazonaws.com/${key}`
    res.json({ uploadUrl, fileUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to generate upload URL' })
  }
})

app.post('/import', requireAuth, async (req, res) => {
  try {
    const job = {
      id: generateId(),
      ...req.body,
      status: 'pending',
      parsedGames: [],
      errors: [],
      ownerId: req.user.sub,
      createdAt: Date.now(),
    }
    await putItem(TABLES.importJobs, job)

    // Invoke the import processor Lambda asynchronously (fire-and-forget).
    // Falls back to inline processing when running locally (no Lambda configured).
    const processorFn = process.env.IMPORT_PROCESSOR_FUNCTION_NAME
    if (processorFn) {
      await lambda.send(new InvokeCommand({
        FunctionName: processorFn,
        InvocationType: 'Event',   // async — Lambda returns 202 immediately
        Payload: JSON.stringify(job),
      }))
    } else {
      // Local dev: process inline (dynamic import avoids bundling into Lambda)
      const { processImportJob } = await import('./importProcessor.js')
      processImportJob(job).catch(console.error)
    }

    res.json({ status: 'ok', job })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create import job' })
  }
})

app.get('/import/:id', requireAuth, async (req, res) => {
  try {
    const job = await getItem(TABLES.importJobs, { id: req.params.id })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.ownerId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })
    res.json(job)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch job' })
  }
})

app.post('/import/:id/confirm', requireAuth, async (req, res) => {
  try {
    const job = await getItem(TABLES.importJobs, { id: req.params.id })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.ownerId !== req.user.sub) return res.status(403).json({ error: 'Forbidden' })

    const { games } = req.body
    if (!job.teamId) return res.status(400).json({ error: 'No team associated with import' })

    const existing = await scanTable(TABLES.schedules, {
      teamId: job.teamId,
      owner_id: req.user.sub,
    })

    const season = `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`
    const schedule = existing[0] ?? {
      id: generateId(),
      teamId: job.teamId,
      teamName: '',
      season,
      games: [],
      openDates: [],
      owner_id: req.user.sub,
    }

    schedule.games = [...(schedule.games || []), ...games.map(g => ({ id: generateId(), ...g }))]
    schedule.updatedAt = Date.now()
    recomputeScheduleStats(schedule)
    await putItem(TABLES.schedules, schedule)

    job.status = 'completed'
    await putItem(TABLES.importJobs, job)

    res.json({ status: 'ok', schedule })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to confirm import' })
  }
})

// =========================
// ADMIN
// =========================

app.get('/admin/scraper/status', requireAuth, async (req, res) => {
  res.json({ lastRun: process.env.SCRAPER_LAST_RUN || null, status: 'idle' })
})

app.post('/admin/sync', requireAuth, async (req, res) => {
  res.json({ status: 'ok', message: 'Sync queued' })
})
