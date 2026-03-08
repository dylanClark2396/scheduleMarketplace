// Async import processor — runs as a separate Lambda function.
// Invoked asynchronously by the API Lambda after POST /import.
// Also used directly in local dev (dynamic import from server.ts).

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { TextractClient, AnalyzeDocumentCommand, Block } from '@aws-sdk/client-textract'
import type { ImportJob, Game, GameLocation, ImportStatus } from './types.js'

const REGION = process.env.AWS_REGION ?? 'us-east-2'
const IMPORT_BUCKET = process.env.S3_IMPORT_BUCKET ?? ''
const IMPORT_JOBS_TABLE = process.env.IMPORT_JOBS_TABLE ?? 'ncaa_import_jobs'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({ region: REGION })
const textract = new TextractClient({ region: REGION })

// =========================
// Lambda handler
// =========================

export const handler = async (event: ImportJob): Promise<void> => {
  await processImportJob(event)
}

// =========================
// Processor
// =========================

export async function processImportJob(job: ImportJob): Promise<void> {
  try {
    await updateJobStatus(job.id, 'processing')

    if ((job.source === 'photo' || job.source === 'pdf') && job.fileUrl) {
      await processWithTextract(job)
    } else if (job.source === 'csv' && job.fileUrl) {
      await processCsvImport(job)
    } else {
      await updateJobStatus(job.id, 'failed', [], ['Unsupported source type for auto-processing.'])
    }
  } catch (err) {
    console.error('Import processing error:', err)
    await updateJobStatus(job.id, 'failed', [], [(err as Error).message])
  }
}

// =========================
// Textract (photo / PDF)
// =========================

async function processWithTextract(job: ImportJob): Promise<void> {
  const url = new URL(job.fileUrl!)
  const key = url.pathname.slice(1)

  const result = await textract.send(new AnalyzeDocumentCommand({
    Document: { S3Object: { Bucket: IMPORT_BUCKET, Name: key } },
    FeatureTypes: ['TABLES', 'FORMS'],
  }))

  const games = parseTextractOutput(result.Blocks ?? [])
  await updateJobStatus(job.id, 'completed', games, [])
}

function parseTextractOutput(blocks: Block[]): Omit<Game, 'id'>[] {
  const lines = blocks
    .filter(b => b.BlockType === 'LINE')
    .map(b => b.Text ?? '')

  const games: Omit<Game, 'id'>[] = []
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4}|\w+ \d{1,2})/i
  const locationPattern = /\b(vs\.?|at|@|vs\s|home|away|neutral)\b/i

  for (const line of lines) {
    if (!datePattern.test(line)) continue
    const dateMatch = line.match(datePattern)
    const isAway = /\bat\b|@/.test(line)
    const isNeutral = /neutral|n\b/i.test(line)
    const location: GameLocation = isAway ? 'away' : isNeutral ? 'neutral' : 'home'
    const opponentName = line.replace(datePattern, '').replace(locationPattern, '').trim()

    if (opponentName.length > 2) {
      games.push({
        date: dateMatch?.[0] ?? '',
        opponentName,
        location,
        isConference: false,
        status: 'scheduled',
        result: null,
        homeScore: null,
        awayScore: null,
        opponentId: '',
        opponentNetRanking: null,
      })
    }
  }

  return games
}

// =========================
// CSV
// =========================

async function processCsvImport(job: ImportJob): Promise<void> {
  const url = new URL(job.fileUrl!)
  const key = url.pathname.slice(1)

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: IMPORT_BUCKET, Key: key }))
  if (!Body) throw new Error('Empty S3 response body')

  const csv = await (Body as { transformToString(): Promise<string> }).transformToString()
  const lines = csv.split('\n').filter(Boolean)
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim())

  const dateIdx = headers.indexOf('date')
  const oppIdx  = headers.findIndex(h => h.includes('opponent'))
  const locIdx  = headers.indexOf('location')
  const confIdx = headers.findIndex(h => h.includes('conf'))

  const games: Omit<Game, 'id'>[] = []
  const errors: string[] = []
  const validLocs: GameLocation[] = ['home', 'away', 'neutral']

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    if (!cols[dateIdx] && !cols[oppIdx]) continue

    const rawLoc = (cols[locIdx] ?? 'home').toLowerCase()
    if (!validLocs.includes(rawLoc as GameLocation)) {
      errors.push(`Row ${i + 1}: invalid location "${cols[locIdx]}"`)
    }

    games.push({
      date: cols[dateIdx] ?? '',
      opponentName: cols[oppIdx] ?? '',
      location: (validLocs.includes(rawLoc as GameLocation) ? rawLoc : 'home') as GameLocation,
      isConference: /yes|true|1/i.test(cols[confIdx] ?? ''),
      status: 'scheduled',
      result: null,
      homeScore: null,
      awayScore: null,
      opponentId: '',
      opponentNetRanking: null,
    })
  }

  await updateJobStatus(job.id, 'completed', games, errors)
}

// =========================
// Helpers
// =========================

async function updateJobStatus(
  jobId: string,
  status: ImportStatus,
  parsedGames: Omit<Game, 'id'>[] = [],
  errors: string[] = [],
): Promise<void> {
  const result = await dynamo.send(new GetCommand({
    TableName: IMPORT_JOBS_TABLE,
    Key: { id: jobId },
  }))
  if (!result.Item) return
  await dynamo.send(new PutCommand({
    TableName: IMPORT_JOBS_TABLE,
    Item: { ...result.Item, status, parsedGames, errors },
  }))
}
