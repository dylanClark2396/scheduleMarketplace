# Architecture

Basketball Scheduling Marketplace — a web platform where D1 programs can manage
their schedules, analyze strength of schedule (SOS), and trade open game slots with
other programs through a marketplace.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository Structure](#repository-structure)
3. [Frontend](#frontend)
4. [Backend API](#backend-api)
5. [Data Scraper](#data-scraper)
6. [Data Models](#data-models)
7. [SOS & NET Calculation](#sos--net-calculation)
8. [Schedule Import Pipeline](#schedule-import-pipeline)
9. [Infrastructure & Deployment](#infrastructure--deployment)
10. [Authentication Flow](#authentication-flow)
11. [Request Lifecycle](#request-lifecycle)

---

## System Overview

```
                           ┌─────────────────────────────┐
                           │        User (browser)        │
                           └──────────────┬──────────────┘
                                          │ HTTPS
                           ┌──────────────▼──────────────┐
                           │   CloudFront CDN             │
                           │   (edge cache, HTTPS)        │
                           └──────────────┬──────────────┘
                                          │
               ┌──────────────────────────┼──────────────────────────┐
               │                          │                           │
  ┌────────────▼───────────┐  ┌──────────▼──────────┐   ┌──────────▼──────────┐
  │   S3 (frontend/)       │  │  API Gateway HTTP API│   │   Cognito           │
  │   Vue 3 SPA (static)   │  │  (single $default    │   │   (auth / tokens)   │
  └────────────────────────┘  │   route → Lambda)    │   └─────────────────────┘
                               └──────────┬──────────┘
                                          │
                          ┌───────────────┼──────────────────┐
                          │               │                  │
             ┌────────────▼──────┐  ┌─────▼──────┐  ┌───────▼───────────────┐
             │  API Lambda        │  │  DynamoDB  │  │  Import Processor      │
             │  (Express via      │──│  4 tables  │  │  Lambda (async)        │
             │  serverless-       │  └─────┬──────┘  │  Textract / CSV parse  │
             │  express)          │        │          └───────┬───────────────┘
             └────────────────────┘  ┌─────▼──────┐          │
                                     │  S3         │  ┌───────▼──────┐
                                     │  imports/   │  │  AWS Textract│
                                     └─────────────┘  └──────────────┘

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │   Python Scraper (scheduled via GitHub Actions — runs weekly)                │
  │   Stats site → teams.json / rankings.json → S3 scraper bucket               │
  │   Backend /admin/sync reads from S3 and upserts into DynamoDB                │
  └──────────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
scheduleMarketplace/
├── frontend/                  Vue 3 + TypeScript SPA
│   └── src/
│       ├── models.ts          All TypeScript interfaces
│       ├── apiRoutes.ts       API URL constants (reads VITE_API_BASE)
│       ├── constants.ts       Conferences, seasons, NET thresholds
│       ├── utils/
│       │   └── sosCalculator.ts   Pure SOS/NET math (no API calls)
│       ├── composables/
│       │   ├── useApi.ts      Typed fetch wrapper for all API calls
│       │   └── useAuth.ts     Cognito PKCE auth flow
│       ├── router/index.ts    Routes + auth guard
│       ├── components/        Reusable UI components
│       └── views/             One file per page/route
│
├── backend/
│   └── server.js              Express API (single file, all routes)
│
├── scraper/
│   └── scraper.py             D1 stats + NET rankings scraper
│
├── infra/
│   ├── cfn/                   CloudFormation templates (01–05)
│   └── scripts/
│       └── deploy-all.sh      One-shot bootstrap script
│
└── .github/workflows/         GitHub Actions CI/CD
    ├── deploy-infrastructure.yml
    ├── deploy-backend.yml
    ├── deploy-frontend.yml
    └── run-scraper.yml
```

---

## Frontend

**Stack:** Vue 3 · TypeScript · PrimeVue 4 · Vue Router · Vite · pnpm

The frontend is a single-page application. All PrimeVue components are
auto-imported at build time via `unplugin-vue-components` — no manual import
statements are needed in `.vue` files.

### Pages (routes)

| Route | View | Purpose |
|---|---|---|
| `/` | `DashboardView` | Overview: game count, open dates, SOS, recent marketplace activity |
| `/estimator` | `ScheduleEstimatorView` | Load a schedule, view SOS + quadrant breakdown, set a target SOS and get opponent suggestions |
| `/marketplace` | `MarketplaceView` | Browse and post requests/offers for open schedule dates |
| `/schedules` | `MasterScheduleView` | Read-only browser for all teams' schedules |
| `/import` | `ImportView` | Upload files or enter games manually; review parsed results before saving |
| `/login` | `LoginView` | Redirects to Cognito Hosted UI |
| `/callback` | `CallbackView` | Exchanges the auth code for tokens, stores in localStorage |

### Auth guard

`router/index.ts` checks for `access_token` in `localStorage` before every
navigation. Any unauthenticated request to a non-public route is redirected
to `/login`.

### API layer

All HTTP calls go through `useApi()` (`composables/useApi.ts`). It:
- Reads the base URL from `VITE_API_BASE` (set at build time)
- Attaches `Authorization: Bearer <token>` from localStorage
- Throws a typed error on non-2xx responses via `safeJson<T>()`

### SOS calculator

`utils/sosCalculator.ts` contains **pure functions** with no API dependencies.
The SOS math runs entirely in the browser so the Estimator view can update
instantly as games are added or removed without a round-trip to the server.
The backend runs the same logic server-side to persist computed values.

---

## Backend API

**Stack:** Node.js · Express 5 · AWS SDK v3 · serverless-express · pnpm

The backend has three entry points, all bundled by esbuild:

| File | Purpose | Bundled to |
|---|---|---|
| `lambda.js` | Wraps Express with `@vendia/serverless-express`, exports `handler` | `dist/lambda.js` |
| `importProcessor.js` | Self-contained async import Lambda | `dist/importProcessor.js` |
| `index.js` | `app.listen()` for local dev only — not bundled for Lambda | — |

Both Lambda bundles are zipped together into `backend.zip` and uploaded to S3.
Each Lambda function points to a different `Handler:` in the same zip.

### Route groups

```
GET    /health                          Liveness probe

GET    /teams                           List all D1 teams (public)
GET    /teams/:id

GET    /schedules/public                List reference schedules (auth, scheduleType=reference)
GET    /schedules/public/:id            Fetch one reference schedule (auth)
GET    /schedules                       List my user schedules (auth, scoped to owner_id)
POST   /schedules                       Create user schedule; looks up team to populate teamName/conference
GET    /schedules/:id                   Fetch one user schedule (auth, owner only)
PATCH  /schedules/:id                   Update user schedule (auth, owner only; 403 if reference)
DELETE /schedules/:id                   Delete user schedule (auth, owner only; 403 if reference)
POST   /schedules/:id/games             Add a game (auth, owner only; 403 if reference)
PATCH  /schedules/:id/games/:gameId     Update a game (auth, owner only; 403 if reference)
DELETE /schedules/:id/games/:gameId     Delete a game (auth, owner only; 403 if reference)

GET    /marketplace                     List open listings (public, filterable)
POST   /marketplace                     Create a listing (auth)
PATCH  /marketplace/:id
DELETE /marketplace/:id
POST   /marketplace/:id/match           Mark two listings as matched (auth)

GET    /import/upload-url               S3 presigned PUT URL (auth)
POST   /import                          Create + kick off async import job (auth)
GET    /import/:id                      Poll job status (auth)
POST   /import/:id/confirm              Save parsed games into schedule (auth); looks up team for teamName/conference

GET    /admin/scraper/status
POST   /admin/sync                      Load scraper JSON from S3 → DynamoDB (auth)
```

### Schedule mutation guards

Every write route (`PATCH`/`DELETE` schedule, `POST`/`PATCH`/`DELETE` game) checks in order:

1. `scheduleType === 'reference'` or `owner_id === 'system'` → `403 Reference schedules are read-only`
2. `owner_id !== req.user.sub` → `403 Forbidden`

Reference schedules are populated by the scraper and are always read-only. They are served via `GET /schedules/public`.

### SOS recomputation

Every time a game is added, updated, or deleted, the server calls
`recomputeScheduleStats(schedule)` before saving. This recalculates:
- `strengthOfSchedule` — weighted average opponent NET rank
- `sosQuadrantBreakdown` — Q1–Q4 win/loss counts

This means stored schedule documents always have up-to-date SOS values for
display in the Master Schedule view without requiring the browser to run math.

### Async import processing

When a `POST /import` request arrives:
1. A job record is created in DynamoDB with `status: pending`
2. The response is returned immediately with the job ID
3. `processImportJob(job)` runs asynchronously:
   - **Photo / PDF** → sends the S3 object to AWS Textract, parses the returned
     `LINE` blocks with a regex to extract dates, opponent names, and locations
   - **CSV** → downloads from S3, parses rows against expected column headers
4. The job record is updated to `completed` (with `parsedGames[]`) or `failed`
5. The frontend polls `GET /import/:id` every 2 seconds until the status changes

---

## Data Scraper

**Stack:** Python 3.12 · requests · BeautifulSoup · boto3

`scraper/scraper.py` scrapes public D1 stats pages to populate the
teams database. It runs on a schedule (via GitHub Actions) and is the source
of truth for NET rankings and team stats.

### Pipeline

```
Stats site (ncaa.com/stats/basketball-men)
        │
        ▼
scrape_teams()     → base team list (id, name, conference, division)
        +
scrape_stats()     → ppg, oppPpg, wins, losses, conference records
        +
scrape_net_rankings() → netRanking (1–363)
        │
        ▼
merge into teams_by_id dict
        │
        ▼
output/teams.json + output/rankings.json
        │
        ▼  (--upload-s3 flag)
S3 scraper bucket  →  backend /admin/sync  →  DynamoDB teams
```

### Rate limiting

The scraper sleeps 1.5 seconds between requests and sends a descriptive
`User-Agent` header. It retries up to 3 times with exponential backoff on
transient failures.

---

## Data Models

Defined in `frontend/src/models.ts` and mirrored structurally in `backend/server.js`.

### Team

```typescript
Team {
  id: string                  // school slug (e.g. "duke-blue-devils")
  name: string                // "Duke Blue Devils"
  shortName: string           // "Duke"
  conference: string          // "ACC"
  division: "D1"
  netRanking: number | null   // 1–363, null if unranked/preseason
  wins / losses: number
  homeWins / homeLosses: number
  awayWins / awayLosses: number
  neutralWins / neutralLosses: number
  confWins / confLosses: number
  ppg / oppPpg: number | null
  netEfficiency: number | null
  updatedAt: number           // Unix ms
}
```

### TeamSchedule

The `schedules` table holds two fundamentally different kinds of rows, distinguished by `scheduleType`:

| `scheduleType` | `owner_id` | `isPublic` | Source | Mutable? |
|---|---|---|---|---|
| `"reference"` | `"system"` | `true` | Python scraper (ESPN) | No — `403` on any mutation |
| `"user"` | Cognito `sub` | `false` | User via Import / Estimator | Yes — owner only |

```typescript
TeamSchedule {
  id: string
  teamId: string
  teamName: string            // populated at creation time from teams table
  conference: string          // populated at creation time from teams table
  season: string              // "2025-26"
  games: Game[]
  openDates: string[]         // "YYYY-MM-DD" dates with no game
  strengthOfSchedule: number | null   // server-computed
  sosQuadrantBreakdown: SosQuadrantBreakdown | null
  isPublic: boolean
  scheduleType: "reference" | "user"
  owner_id: string            // "system" for reference schedules; Cognito sub for user schedules
  updatedAt: number
}
```

### Game (nested inside TeamSchedule)

```typescript
Game {
  id: string
  date: string                // "2025-11-15"
  opponentId: string
  opponentName: string
  opponentNetRanking: number | null
  location: "home" | "away" | "neutral"
  isConference: boolean
  status: "scheduled" | "completed" | "cancelled"
  homeScore / awayScore: number | null
  result: "W" | "L" | null
}
```

### MarketplaceListing

```typescript
MarketplaceListing {
  id: string
  type: "request" | "offer"
  // request = "I need an opponent on this date"
  // offer   = "We are available to play on this date"
  teamId / teamName / conference: string
  currentNetRanking: number | null
  date: string
  dateFlexibilityDays: number   // willing to shift ± N days
  preferredLocation: "home" | "away" | "neutral" | "any"
  targetNetMin / targetNetMax: number | null
  targetConferences: string[]   // empty = any
  compensationNotes: string     // game guarantee info
  notes: string
  status: "open" | "matched" | "closed"
  matchedListingId: string | null
  ownerId: string
  createdAt / expiresAt: number
}
```

### ImportJob

```typescript
ImportJob {
  id: string
  teamId: string | null
  source: "pdf" | "csv" | "excel" | "photo" | "manual"
  status: "pending" | "processing" | "completed" | "failed"
  fileUrl: string | null      // S3 URL of uploaded file
  parsedGames: Partial<Game>[]
  errors: string[]
  ownerId: string
  createdAt: number
}
```

---

## SOS & NET Calculation

The NET (Nitty Gritty Efficiency Tool) ranking drives all SOS logic.
NET ranks all 363 D1 teams 1–363 where **1 is the best team**.

### Strength of Schedule formula

```
SOS = Σ(opponentNetRank × locationWeight) / Σ(locationWeights)

Location weights:
  Away    → 1.4   (road games are harder — winning matters more)
  Neutral → 1.0
  Home    → 0.6   (home games are easier — winning matters less)

Lower SOS = harder schedule (playing better-ranked opponents)
Higher SOS = easier schedule (playing worse-ranked opponents)
```

**Example:** Playing #10 on the road contributes 10 × 1.4 = 14.
Playing #200 at home contributes 200 × 0.6 = 120.
A team with only road wins against top-10 teams would have SOS ≈ 14 — very hard.

### Display score (0–100)

Because lower = harder can be counterintuitive in a UI, SOS is also converted
to a 0–100 "Schedule Strength Score" for the gauge component:

```
displayScore = ((363 - SOS) / 363) × 100
```

100 = maximum difficulty (all opponents ranked #1), 0 = minimum.

### Quadrant system

Each completed game is classified Q1–Q4 based on opponent NET rank and game
location. The thresholds are:

| Location | Q1     | Q2      | Q3       | Q4    |
|----------|--------|---------|----------|-------|
| Away     | 1–30   | 31–75   | 76–135   | 136+  |
| Neutral  | 1–50   | 51–100  | 101–200  | 201+  |
| Home     | 1–75   | 76–135  | 136–240  | 241+  |

Q1 wins are the most valuable. Q4 losses are the most damaging.
The selection committee uses the Q1–Q4 breakdown extensively when
evaluating tournament bids.

### SOS target suggestion algorithm

Implemented in `frontend/src/utils/sosCalculator.ts`:

```
Input:
  currentGames[]    — team's existing schedule
  openDates[]       — dates with no game
  allTeams[]        — full D1 team list with NET rankings
  targetSos         — user's desired SOS value

For each unscheduled team:
  For each open date:
    For each location (home, away, neutral):
      projectedSos = calculateSos([...currentGames, mockGame])
      delta = |projectedSos - targetSos|
      Track best (date, location) pair for this team

Sort by delta ascending, return top 10 suggestions
```

Each suggestion shows: team name, NET rank, suggested date, location, projected
SOS if added, and the quadrant that game would count as.

---

## Schedule Import Pipeline

Users can import schedules from four sources. All paths converge on a
`parsedGames[]` review screen before anything is saved.

```
User uploads file
       │
       ▼
GET /import/upload-url  →  S3 presigned PUT URL
       │
       ▼
Browser PUTs file directly to S3 (bypasses API, no size limit)
       │
       ▼
POST /import  →  creates ImportJob{status:pending}, returns job ID
       │          kicks off processImportJob() asynchronously
       │
       ├── source: photo/pdf  →  AWS Textract AnalyzeDocument
       │                          parses LINE blocks with regex
       │                          extracts date, opponent, location
       │
       └── source: csv        →  downloads from S3, parses rows
                                  validates location values
                                  collects row-level errors
       │
       ▼
ImportJob updated: status:completed, parsedGames:[], errors:[]
       │
       ▼
Frontend polls GET /import/:id every 2s until completed/failed
       │
       ▼
User reviews parsed games in editable DataTable (can fix dates, opponents, etc.)
       │
       ▼
POST /import/:id/confirm  →  games appended to TeamSchedule
                              SOS recomputed and stored
```

---

## Infrastructure & Deployment

### AWS resources

| Service | Purpose |
|---|---|
| **Lambda** (2 functions, nodejs20.x) | API handler + async import processor; scales to zero |
| **API Gateway HTTP API** | Single `$default` route proxies all requests to API Lambda; built-in CORS |
| **DynamoDB** (PAY_PER_REQUEST) | All application data (4 tables) |
| **S3** (4 buckets) | Frontend static files, import uploads, scraper output, deploy artifacts |
| **CloudFront** | CDN for frontend; OAC keeps S3 bucket private; SPA 404→index.html |
| **Cognito** | User authentication; Hosted UI + PKCE flow; no client secret |
| **Textract** | OCR for PDF/photo schedule imports; called by import processor Lambda |
| **SSM Parameter Store** | Cross-stack config; Lambda env vars set from SSM at CFN deploy time |
| **IAM OIDC** | GitHub Actions authenticates via OIDC — zero long-lived access keys |

### CloudFormation stack order

```
01-github-oidc   (bootstrap manually once — creates the role all workflows use)
       ↓
02-storage       (DynamoDB tables + S3 buckets + SSM params)
       ↓
03-cognito       (User Pool + App Client + Hosted UI domain + SSM params)
       ↓
04-lambda        (2 Lambda functions + API Gateway HTTP API + IAM role + SSM params)
       ↓
05-cdn           (CloudFront OAC distribution + S3 bucket policy + SSM params)
```

### Deployment flows

**Backend deploy** (triggered on push to `main` touching `backend/**`):
```
pnpm build  →  esbuild bundles:
                 lambda.js          → dist/lambda.js
                 importProcessor.js → dist/importProcessor.js
zip dist/lambda.js dist/importProcessor.js → backend.zip → S3 deploy bucket
aws lambda update-function-code (API Lambda)    ─┐ parallel
aws lambda update-function-code (Import Lambda) ─┘
aws lambda wait function-updated (both)
curl API Gateway URL/health → 200 OK
```

**Frontend deploy** (triggered on push to `main` touching `frontend/**`):
```
pnpm build  →  Vite builds dist/ (env vars baked in from GitHub secrets)
aws s3 sync dist/ → S3 frontend bucket
  assets/  → Cache-Control: max-age=31536000,immutable  (hashed filenames)
  *.html   → Cache-Control: no-cache                    (always fresh)
CloudFront CreateInvalidation /* → wait for completion
```

**Scraper** (runs every Monday 06:00 UTC or manual dispatch):
```
python scraper.py --target all --upload-s3
  → scrapes stats site (1.5s/request, 3 retries)
  → writes output/teams.json + output/rankings.json
  → uploads to S3 scraper bucket
SSM RunCommand → POST /admin/sync on EC2
  → reads teams.json from S3 → upserts into teams DynamoDB table
```

### IAM boundaries

- **GitHub Actions role** — OIDC only (no keys), constrained to deploy operations
- **Lambda execution role** — scoped to project DynamoDB tables and specific S3 bucket ARNs; Textract and `lambda:InvokeFunction` on the import processor only; no wildcard resource access on sensitive services
- **No servers to manage** — no EC2, no security groups, no OS patches, no SSH

### Required GitHub Secrets

| Secret | Set to |
|---|---|
| `AWS_DEPLOY_ROLE` | ARN output from `01-github-oidc` stack |
| `AWS_REGION` | e.g. `us-east-2` |
| `VITE_API_BASE` | `http://<elastic-ip>:3000` |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI domain URL |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID |
| `VITE_REDIRECT_URI` | Frontend callback URL |

`DEPLOY_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID` are read from SSM at runtime —
they do not need to be secrets.

---

## Authentication Flow

```
User clicks "Sign In"
       │
       ▼
useAuth.login()  →  redirect to Cognito Hosted UI
                    (authorization_code + PKCE flow)
       │
       ▼ (user authenticates on Cognito's domain)
Cognito redirects to /callback?code=...
       │
       ▼
CallbackView  →  useAuth.handleCallback(code)
  POST to Cognito /oauth2/token  →  { access_token, id_token, refresh_token }
  localStorage.setItem('access_token', ...)
       │
       ▼
router.replace('/')  →  Dashboard
       │
All subsequent API calls attach:
  Authorization: Bearer <access_token>
       │
       ▼
Backend requireAuth middleware:
  CognitoJwtVerifier.verify(token)  →  sets req.user = { sub, email, ... }
  Ownership checks use req.user.sub to scope DynamoDB reads/writes
```

Tokens are stored in `localStorage`. The router guard re-checks on every
navigation. No refresh-token rotation is implemented yet — users re-authenticate
when the 1-hour access token expires.

---

## Request Lifecycle

A complete example: **user adds a game to their schedule from the SOS Estimator**.

```
1. User picks team, loads schedule  →  GET /schedules?teamId=X&season=2025-26
   └─ DynamoDB Scan(schedules, filter: teamId + owner_id)

2. User clicks "Get Suggestions"
   └─ suggestTeamsForTarget() runs entirely in the browser
      Iterates: unscheduled teams × open dates × locations
      Computes projected SOS for each combination
      Returns top 10 sorted by |projected - target|
      No API call made

3. User clicks "Add" on a suggestion
   └─ POST /schedules/:id/games  { opponentId, date, location, ... }
      Backend:
        a. Fetch schedule from DynamoDB
        b. Verify owner_id === req.user.sub
        c. Push new game into schedule.games[]
        d. recomputeScheduleStats():
             calculateSos(games)        → strengthOfSchedule
             buildQuadrantBreakdown()   → q1Wins, q1Losses, ...
        e. PutItem back to DynamoDB
        f. Return { game }

4. Frontend receives new game  →  loadSchedule() re-fetches full schedule
   └─ SOS gauge and quadrant grid update with new values
   └─ Suggestion list is cleared (user can re-run with updated schedule)
```
