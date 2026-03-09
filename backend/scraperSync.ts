// scraperSync Lambda — triggered by S3 when scraper uploads files.
// Handles teams.json → teams table, schedules-*.json → schedules table.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { S3Event } from 'aws-lambda'

const REGION = process.env.AWS_REGION ?? 'us-east-2'
const TEAMS_TABLE = process.env.TEAMS_TABLE ?? 'teams'
const SCHEDULES_TABLE = process.env.SCHEDULES_TABLE ?? 'schedules'

const s3 = new S3Client({ region: REGION })
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

async function readS3Json(bucket: string, key: string): Promise<unknown[]> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = await res.Body!.transformToString()
  const parsed = JSON.parse(body)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function batchWrite(table: string, items: Record<string, unknown>[]): Promise<void> {
  // DynamoDB BatchWrite accepts max 25 items per call
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25).map(item => ({ PutRequest: { Item: item } }))
    await dynamo.send(new BatchWriteCommand({ RequestItems: { [table]: chunk } }))
  }
}

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

    console.log(`Processing s3://${bucket}/${key}`)

    if (key === 'scraper/teams.json') {
      const teams = await readS3Json(bucket, key) as Record<string, unknown>[]
      await batchWrite(TEAMS_TABLE, teams)
      console.log(`Synced ${teams.length} teams to DynamoDB`)

    } else if (key.startsWith('scraper/schedules-') && key.endsWith('.json')) {
      const schedules = await readS3Json(bucket, key) as Record<string, unknown>[]
      await batchWrite(SCHEDULES_TABLE, schedules)
      console.log(`Synced ${schedules.length} schedules from ${key} to DynamoDB`)

    } else {
      console.log(`Skipping unrecognized key: ${key}`)
    }
  }
}
