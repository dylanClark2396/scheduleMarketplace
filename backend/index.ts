// Local development entry point — starts the Express server directly.
// Not used in Lambda; esbuild does not bundle this file.
import { app } from './server.js'

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log(`NCAA Marketplace API running on http://localhost:${PORT}`)
})
