// Async import processor — runs as a separate Lambda function.
// Invoked asynchronously by the API Lambda after POST /import.
// Also used directly in local dev (dynamic import from server.js).
//
// esbuild bundles this as dist/importProcessor.js.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract'

const REGION = process.env.AWS_REGION || 'us-east-2'
const IMPORT_BUCKET = process.env.S3_IMPORT_BUCKET

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({ region: REGION })
const textract = new TextractClient({ region: REGION })

const IMPORT_JOBS_TABLE = process.env.IMPORT_JOBS_TABLE || 'ncaa_import_jobs'

// =========================
// Lambda handler
// =========================

// When invoked from Lambda, `event` is the ImportJob object.
export const handler = async (event) => {
  await processImportJob(event)
}

// =========================
// Processor
// =========================

export async function processImportJob(job) {
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
    await updateJobStatus(job.id, 'failed', [], [err.message])
  }
}

// =========================
// Textract (photo / PDF)
// =========================

async function processWithTextract(job) {
  const url = new URL(job.fileUrl)
  const key = url.pathname.slice(1)

  const result = await textract.send(new AnalyzeDocumentCommand({
    Document: { S3Object: { Bucket: IMPORT_BUCKET, Name: key } },
    FeatureTypes: ['TABLES', 'FORMS'],
  }))

  const games = parseTextractOutput(result.Blocks || [])
  await updateJobStatus(job.id, 'completed', games, [])
}

function parseTextractOutput(blocks) {
  const lines = blocks
    .filter(b => b.BlockType === 'LINE')
    .map(b => b.Text || '')

  const games = []
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]?\d{0,4}|\w+ \d{1,2})/i
  const locationPattern = /\b(vs\.?|at|@|vs\s|home|away|neutral)\b/i

  for (const line of lines) {
    if (!datePattern.test(line)) continue
    const dateMatch = line.match(datePattern)
    const isAway = /\bat\b|@/.test(line)
    const isNeutral = /neutral|n\b/i.test(line)
    const location = isAway ? 'away' : isNeutral ? 'neutral' : 'home'
    const opponentName = line.replace(datePattern, '').replace(locationPattern, '').trim()

    if (opponentName.length > 2) {
      games.push({
        date: dateMatch?.[0] || '',
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

async function processCsvImport(job) {
  const url = new URL(job.fileUrl)
  const key = url.pathname.slice(1)

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: IMPORT_BUCKET, Key: key }))
  const csv = await Body.transformToString()
  const lines = csv.split('\n').filter(Boolean)
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim())

  const dateIdx    = headers.indexOf('date')
  const oppIdx     = headers.findIndex(h => h.includes('opponent'))
  const locIdx     = headers.indexOf('location')
  const confIdx    = headers.findIndex(h => h.includes('conf'))

  const games = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    if (!cols[dateIdx] && !cols[oppIdx]) continue

    const rawLoc = (cols[locIdx] || 'home').toLowerCase()
    const validLocs = ['home', 'away', 'neutral']
    if (!validLocs.includes(rawLoc)) {
      errors.push(`Row ${i + 1}: invalid location "${cols[locIdx]}"`)
    }

    games.push({
      date: cols[dateIdx] || '',
      opponentName: cols[oppIdx] || '',
      location: validLocs.includes(rawLoc) ? rawLoc : 'home',
      isConference: /yes|true|1/i.test(cols[confIdx] || ''),
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

async function updateJobStatus(jobId, status, parsedGames = [], errors = []) {
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
