# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

NCAA Basketball Scheduling Marketplace — a platform for D1 programs to manage schedules, estimate strength of schedule (SOS), and trade open schedule slots.

Sub-projects:
- `frontend/` — Vue 3 + TypeScript SPA (PrimeVue 4, Vite, pnpm)
- `backend/` — Node.js Express REST API (AWS DynamoDB, S3, Cognito)
- `scraper/` — Python data pipeline for NCAA D1 stats and NET rankings

Package manager is **pnpm** for both frontend and backend.

## Commands

### Frontend (`frontend/`)
```bash
pnpm dev          # dev server (Vite, port 5173)
pnpm build        # type-check + build to dist/
pnpm type-check   # vue-tsc only
```

### Backend (`backend/`)
```bash
pnpm dev    # nodemon server.js (auto-reload)
pnpm start  # node server.js
pnpm build  # esbuild bundle → dist/server.js
```

### Scraper (`scraper/`)
```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python ncaa_scraper.py --target teams       # scrape D1 team list
python ncaa_scraper.py --target rankings    # scrape NET rankings
python ncaa_scraper.py --target stats       # scrape team stats
python ncaa_scraper.py --target all         # run full pipeline
```

## Architecture

### Data model
```
Team { id, name, shortName, conference, division, netRanking, wins, losses, ... }

TeamSchedule { id, teamId, season, games[], openDates[], strengthOfSchedule }
  └── Game { id, date, opponentId, opponentNetRanking, location, isConference, status, result }

MarketplaceListing { id, type(request|offer), teamId, date, preferredLocation,
                     targetNetRange, status(open|matched|closed), ... }

ImportJob { id, teamId, source(pdf|csv|excel|photo|manual), status, parsedGames[] }
```

### SOS Calculation (NET-based)
- Weighted average of opponent NET rankings by game location
- Location weights: Away = 1.4, Neutral = 1.0, Home = 0.6
- **Lower SOS number = stronger schedule** (playing better-ranked/lower-number teams)
- Quadrant system:
  - Q1: Away vs 1-30, Neutral vs 1-50, Home vs 1-75
  - Q2: Away vs 31-75, Neutral vs 51-100, Home vs 76-135
  - Q3: Away vs 76-135, Neutral vs 101-200, Home vs 136-240
  - Q4: Away vs 136+, Neutral vs 201+, Home vs 241+

### SOS Target Suggestion Algorithm
1. User sets a target SOS number
2. For each unscheduled D1 team × each open date × each location:
   - Compute projected SOS if that game were added
3. Sort by `|projected_sos - target_sos|` ascending
4. Return top suggestions

### Backend — DynamoDB tables
- `ncaa_teams` — partition key: `id`
- `ncaa_schedules` — partition key: `id`, GSI: `teamId-season-index`
- `ncaa_marketplace` — partition key: `id`, GSI: `status-createdAt-index`
- `ncaa_import_jobs` — partition key: `id`

### Frontend key files
- `src/apiRoutes.ts` — all API endpoint URLs (reads `VITE_API_BASE` env var)
- `src/composables/useApi.ts` — typed composable wrapping all fetch calls
- `src/models.ts` — TypeScript interfaces for the full data hierarchy
- `src/utils/sosCalculator.ts` — pure SOS/NET calculation logic
- `src/router/index.ts` — route definitions with auth guard
- `src/constants.ts` — conferences, seasons, NET thresholds

PrimeVue components are **auto-imported** via `unplugin-vue-components` + `PrimeVueResolver`. Always prefer PrimeVue over plain HTML (Button, InputText, Dialog, DataTable, Select, Slider, Tag, Card, etc.).

### Scraper strategy
- Primary source: `https://www.ncaa.com/stats/basketball-men` for D1 stats
- NET rankings: scraped from NCAA or ESPN — stored in `scraper/output/`
- Scraper outputs JSON files that are loaded into DynamoDB by the backend on startup or via `/admin/sync` endpoint
- Rate limiting: 1 request/second, respectful of robots.txt
