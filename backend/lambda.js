// Lambda entry point — wraps the Express app with serverless-express.
// esbuild bundles this as dist/lambda.js for the API Lambda function.
import serverlessExpress from '@vendia/serverless-express'
import { app } from './server.js'

export const handler = serverlessExpress({ app })
