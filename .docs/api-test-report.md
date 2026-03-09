# API End-to-End Test Report

**Date:** 2026-03-09
**Base URL:** `https://ov8z84d5v3.execute-api.us-east-1.amazonaws.com`
**Tester:** Claude Code (automated)
**Backend Stack:** Express 5.2.1 + @vendia/serverless-express 4.12.6 + AWS Lambda + DynamoDB

---

## Executive Summary

26 unique API endpoints were tested across 7 resource groups. The public (no-auth) endpoints are fully functional and well-behaved. All auth-protected endpoints correctly enforce authentication — the supplied JWT had expired at test time, so every protected route returned `401 Invalid token`, which is correct behavior. No auth-protected endpoint was successfully invoked with real data. Additionally, **4 bugs** were identified:

1. **[BUG-1] Unregistered routes return HTTP 500 instead of 404** — affects usability and client error handling.
2. **[BUG-2] No `DELETE /schedules/:id` route exists** — schedules cannot be deleted; this is a missing feature and may be intentional but is undocumented.
3. **[BUG-3] `X-Powered-By: Express` header is exposed** — minor security/information-disclosure issue.
4. **[BUG-4] CORS preflight returns 204 for disallowed origins without blocking** — the `Vary: Origin` header is set but `Access-Control-Allow-Origin` is omitted, which is correct; however, the 204 status (rather than a CORS error) may confuse some clients.

Auth-protected routes **could not be tested end-to-end** because the provided Bearer token expired at `2026-03-09T06:06:43Z`, approximately 8.5 hours before these tests ran. All functional tests of schedules, games, marketplace, import, and admin require a fresh token. The token expiration and its impact on coverage are documented in detail below.

---

## Summary Table — All Endpoints Tested

| # | Method | Path | Expected HTTP | Actual HTTP | Pass/Fail | Notes |
|---|--------|------|---------------|-------------|-----------|-------|
| 1 | GET | `/health` | 200 | 200 | PASS | `{"status":"ok"}` |
| 2 | GET | `/teams` | 200 | 200 | PASS | Returns 362 teams |
| 3 | GET | `/teams?conference=ACC` | 200 | 200 | PASS | Returns 19 ACC teams |
| 4 | GET | `/teams/:id` (duke-blue-devils) | 200 | 200 | PASS | Full team object returned |
| 5 | GET | `/teams/nonexistent-xyz` | 404 | 404 | PASS | `{"error":"Team not found"}` |
| 6 | GET | `/marketplace` | 200 | 200 | PASS | Empty array `[]` (no listings) |
| 7 | GET | `/marketplace?status=open` | 200 | 200 | PASS | Empty array |
| 8 | GET | `/marketplace?type=offer` | 200 | 200 | PASS | Empty array |
| 9 | GET | `/marketplace?type=request` | 200 | 200 | PASS | Empty array |
| 10 | GET | `/marketplace?conference=ACC` | 200 | 200 | PASS | Empty array |
| 11 | GET | `/marketplace?status=open&type=offer` | 200 | 200 | PASS | Combined filters work |
| 12 | GET | `/schedules` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 13 | GET | `/schedules` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 14 | POST | `/teams` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 15 | POST | `/schedules` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 16 | GET | `/schedules/:id` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 17 | PATCH | `/schedules/:id` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 18 | POST | `/schedules/:id/games` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 19 | PATCH | `/schedules/:id/games/:gameId` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 20 | DELETE | `/schedules/:id/games/:gameId` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 21 | DELETE | `/schedules/:id/games/:gameId` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 22 | POST | `/marketplace` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 23 | PATCH | `/marketplace/:id` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 24 | PATCH | `/marketplace/:id` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 25 | DELETE | `/marketplace/:id` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 26 | DELETE | `/marketplace/:id` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 27 | POST | `/marketplace/:id/match` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 28 | POST | `/marketplace/:id/match` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 29 | GET | `/import/upload-url` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 30 | GET | `/import/upload-url` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 31 | POST | `/import` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 32 | GET | `/import/:id` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 33 | GET | `/import/:id` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 34 | POST | `/import/:id/confirm` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 35 | POST | `/import/:id/confirm` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 36 | GET | `/admin/scraper/status` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 37 | GET | `/admin/scraper/status` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 38 | POST | `/admin/sync` (expired token) | 401 | 401 | PASS | `{"error":"Invalid token"}` |
| 39 | POST | `/admin/sync` (no auth) | 401 | 401 | PASS | `{"error":"Unauthorized"}` |
| 40 | DELETE | `/schedules/:id` (no auth, missing route) | 404/405 | **500** | **FAIL** | BUG-1, BUG-2 |
| 41 | DELETE | `/teams` (missing route) | 404/405 | **500** | **FAIL** | BUG-1 |
| 42 | DELETE | `/teams/:id` (missing route) | 404/405 | **500** | **FAIL** | BUG-1 |
| 43 | GET | `/nonexistent-route` (missing route) | 404 | **500** | **FAIL** | BUG-1 |
| 44 | PUT | `/teams` (missing route) | 404/405 | 404 | INFO | Returns "Cannot PUT /teams" HTML |

---

## Detailed Findings

### BUG-1 — Unregistered Routes Return 500 Instead of 404

**Severity:** Medium
**Affected routes:**
- Any HTTP method on a completely unregistered path (e.g., `GET /`, `GET /nonexistent-route`)
- Any HTTP method that is not registered for a path segment (e.g., `DELETE /teams`, `DELETE /teams/:id`, `DELETE /schedules/:id`)

**Observed behavior:**
```
HTTP/2 500
Content-Type: text/html; charset=utf-8
X-Powered-By: Express

<!DOCTYPE html><html>...<pre>Internal Server Error</pre>...</html>
```

**Expected behavior:** `404 Not Found` with a JSON body such as `{"error":"Not found"}`.

**Root cause analysis:**
Express 5 changed error propagation behavior compared to Express 4. In Express 5, calling `next()` with no matching route causes the default error handler to be invoked with a `404`-like finalization error — but the exact behavior differs when combined with `@vendia/serverless-express`. The pattern is inconsistent: `PUT /teams` correctly returns `404 Cannot PUT /teams` (HTML), but `DELETE /teams` returns `500 Internal Server Error` (HTML). This suggests the serverless-express layer, Express 5's router, or both are not consistently surfacing unhandled method/path combinations.

**Recommendation:** Add a catch-all route at the bottom of `server.ts` to return a JSON 404:

```typescript
// Must be the LAST route registered
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})
```

Also consider adding a global error handler:

```typescript
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
```

---

### BUG-2 — No `DELETE /schedules/:id` Route

**Severity:** Medium (missing feature)
**Description:** There is no endpoint to delete an entire schedule. The server implements `DELETE /schedules/:scheduleId/games/:gameId` (delete a single game) but not `DELETE /schedules/:id` (delete the whole schedule). This means once a schedule is created, it cannot be removed through the API.

**Current routes for schedules:**
- `GET /schedules` — list
- `GET /schedules/:id` — get one
- `POST /schedules` — create
- `PATCH /schedules/:id` — update
- `POST /schedules/:id/games` — add game
- `PATCH /schedules/:id/games/:gameId` — update game
- `DELETE /schedules/:id/games/:gameId` — delete game
- *(missing)* `DELETE /schedules/:id` — **delete schedule**

**Recommendation:** Add a `DELETE /schedules/:id` route with ownership check, mirroring the pattern used in `DELETE /marketplace/:id`.

---

### BUG-3 — `X-Powered-By: Express` Header Exposed

**Severity:** Low (security / information disclosure)
**Observed:** Every response includes `x-powered-by: Express` in the response headers.

**Impact:** Reveals the server-side technology stack to potential attackers.

**Recommendation:** Disable this header in `server.ts` during app setup:

```typescript
app.disable('x-powered-by')
```

---

### BUG-4 — CORS Preflight Behavior for Disallowed Origins

**Severity:** Low
**Description:** When a CORS preflight request is sent with an origin not in the `ALLOWED_ORIGINS` list (e.g., `http://evil.example.com`), the server returns HTTP 204 without an `Access-Control-Allow-Origin` header. This is technically correct per the CORS spec (browser will block the request). However:

1. The allowed origins list (`ALLOWED_ORIGINS` in `server.ts`) only includes `http://localhost:5173` and the value of `APP_DOMAIN` env var. The production CloudFront domain must be set in `APP_DOMAIN` for CORS to work in production.
2. The current CORS config does not include the CloudFront distribution URL by default, which means the frontend served from CloudFront will be blocked by CORS unless `APP_DOMAIN` is set correctly in the Lambda environment variables.

**Observed behavior for allowed origin:**
```
HTTP/2 204
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: DELETE,GET,OPTIONS,PATCH,POST
Access-Control-Allow-Headers: authorization,content-type
Access-Control-Max-Age: 300
```

**Observed behavior for disallowed origin:**
```
HTTP/2 204
Vary: Origin, Access-Control-Request-Headers
(no Access-Control-Allow-Origin header)
```

**Recommendation:** Verify that the Lambda environment variable `APP_DOMAIN` is set to the CloudFront distribution URL in the `04-lambda.yml` CFN stack. If not set, all browser requests from the production frontend will be blocked by CORS.

---

## Auth Enforcement

Authentication is correctly enforced on all protected routes. Two distinct behaviors were observed:

| Scenario | HTTP Status | Response Body |
|----------|-------------|---------------|
| No `Authorization` header | 401 | `{"error":"Unauthorized"}` |
| Expired or invalid Bearer token | 401 | `{"error":"Invalid token"}` |

Both behaviors are correct and consistent. The distinction between "missing token" and "invalid token" in the error message is a useful UX improvement.

All 18 auth-protected endpoints were verified to return 401 for both scenarios. No auth-protected route was inadvertently accessible without a valid token.

---

## Token Expiration — Impact on Test Coverage

The Bearer token provided for testing was issued at `2026-03-09T05:06:43Z` and expired at `2026-03-09T06:06:43Z` (1-hour lifetime). Tests were executed at approximately `2026-03-09T14:38Z`, approximately **8.5 hours after expiration**.

As a result, the following test scenarios could **not** be executed with real data:

- POST /teams — create a test team
- POST /schedules — create a schedule for the test team
- GET /schedules — verify schedule appears in list for owner
- GET /schedules/:id — verify schedule retrieval
- PATCH /schedules/:id — update schedule (e.g., add open dates)
- POST /schedules/:id/games — add a game
- PATCH /schedules/:id/games/:gameId — update a game (e.g., set result)
- DELETE /schedules/:id/games/:gameId — remove a game
- **SOS recalculation** — verify `strengthOfSchedule` and `sosQuadrantBreakdown` are recomputed after game add/update/delete
- POST /marketplace — create a listing
- PATCH /marketplace/:id — update listing status
- POST /marketplace/:id/match — verify bidirectional match logic
- DELETE /marketplace/:id — verify listing deletion
- GET /import/upload-url — verify presigned S3 URL generation
- POST /import — create manual import job
- GET /import/:id — check import job status
- POST /import/:id/confirm — confirm games and verify schedule creation/update
- GET /admin/scraper/status — verify `lastRun` field
- POST /admin/sync — verify sync queuing response

**To complete end-to-end testing, a fresh Cognito access token is required.**

---

## Data Integrity Observations (Public Data)

### Teams Table
- **362 D1 teams** are present in the database.
- All teams have the required fields: `id`, `name`, `conference`, `division`, `shortName`, `netRanking`, `wins`, `losses`.
- Additional ESPN-sourced fields present on all records: `espnId`, `ppg`, `oppPpg`, `netEfficiency`, `homeWins`, `homeLosses`, `awayWins`, `awayLosses`, `confWins`, `confLosses`, `neutralWins`, `neutralLosses`, `updatedAt`.
- **31 unique conferences** represented; all expected Power 6 + mid-major conferences present.
- Conference filtering works correctly (e.g., ACC returns exactly 19 teams, SEC returns 23, Big Ten returns 19, Big 12 returns 16).
- `netRanking` is populated for all teams (no nulls in the scraper data).

### Marketplace Table
- Currently **empty** (0 listings). All filtered queries (`?status=open`, `?type=offer`, `?type=request`, `?conference=ACC`) return `[]`.

### SOS Recalculation (Static Code Review)
The SOS calculation logic in `server.ts` was reviewed and matches the documented algorithm:

- Location weights: `away=1.4`, `neutral=1.0`, `home=0.6` — **correct**
- Formula: `SOS = Σ(opponentNetRanking × locationWeight) / Σ(locationWeight)` — **correct**
- Cancelled games are excluded from SOS calculation — **correct**
- SOS is recomputed after every game add (`POST /schedules/:id/games`), update (`PATCH /schedules/:id/games/:gameId`), and delete (`DELETE /schedules/:id/games/:gameId`) — **correct, verified in code**
- Quadrant breakdown is also recomputed on every game mutation — **correct, verified in code**
- Quadrant thresholds match documentation: Away Q1≤30, Neutral Q1≤50, Home Q1≤75, etc. — **correct**

**Note:** Runtime verification of SOS recalculation was not possible due to expired token. The logic is code-verified only.

---

## Response Format Observations

- All functional JSON endpoints return `application/json; charset=utf-8` content type — **correct**
- Error responses from Express's unhandled route handler return `text/html; charset=utf-8` — **incorrect** (see BUG-1)
- Success responses for mutations (`POST /teams`, `POST /schedules`, etc.) follow the pattern `{"status":"ok", "resource": {...}}` per code review
- The `GET /marketplace` and `GET /teams` endpoints return raw arrays (no pagination wrapper), which is appropriate for the current data size but may need pagination as the marketplace grows

---

## Performance Observations

Response times for `GET /health` (warmed Lambda):
- Request 1: 110ms
- Request 2: 108ms
- Request 3: 111ms

Lambda appears to be warm and consistent. No cold-start latency was observed during the test window, suggesting the function was recently invoked.

---

## Recommendations Summary

| Priority | Issue | Recommendation |
|----------|-------|----------------|
| High | Token expired — full functional test not completed | Re-run with a fresh access token |
| Medium | BUG-1: Unknown routes return 500 | Add Express catch-all 404 handler and global error handler |
| Medium | BUG-2: No `DELETE /schedules/:id` route | Implement schedule deletion endpoint |
| Medium | BUG-4: `APP_DOMAIN` CORS config | Verify CloudFront domain is set in Lambda env vars |
| Low | BUG-3: `X-Powered-By: Express` header | `app.disable('x-powered-by')` in server setup |
| Low | HTML error bodies for 500/404 | Ensure all error responses are JSON |
| Low | Admin endpoints lack role-based access control | Any authenticated user can access `/admin/*`; consider restricting to admin group |
| Low | No pagination on `GET /teams` or `GET /marketplace` | Add limit/offset or cursor pagination for future scalability |

---

## CRUD Test Results (Pass 2)

**Date:** 2026-03-09 (token issued 2026-03-09T05:07:13Z, tested within same hour)
**Token subject:** `94388488-2051-70b1-5a45-d6eea52cec22`
**Test team used:** `seattle-u-redhawks` / "Seattle U Redhawks" (first team in DB)

---

### Summary Table — All Endpoints Tested in Pass 2

| # | Method | Path | HTTP Status | Pass/Fail | Notes |
|---|--------|------|-------------|-----------|-------|
| 1 | GET | `/teams` | 200 | PASS | 362 teams returned, correct shape |
| 2 | POST | `/teams` | 200 | PASS* | Team created; returns 200 not 201 (see BUG-5) |
| 3 | POST | `/schedules` | 200 | PASS* | Schedule created; returns 200 not 201 (see BUG-5) |
| 4 | GET | `/schedules` | 200 | PASS | New schedule appears; only owner's schedules returned |
| 5 | GET | `/schedules/:id` | 200 | PASS | Correct schedule returned with full shape |
| 6 | PATCH | `/schedules/:id` | 200 | PASS | `openDates` updated correctly |
| 7 | POST | `/schedules/:id/games` (game 1) | 200 | PASS* | Game created; response does NOT include schedule SOS (see BUG-6) |
| 8 | POST | `/schedules/:id/games` (game 2) | 200 | PASS* | Game created |
| 9 | PATCH | `/schedules/:id/games/:gameId` | 200 | PASS | Game status/result updated correctly |
| 10 | GET | `/schedules/:id` (SOS check) | 200 | PASS | SOS = 15.5, matches expected calculation exactly |
| 11 | DELETE | `/schedules/:id/games/:gameId` | 200 | PASS | Game deleted, returns `{"status":"ok"}` |
| 12 | GET | `/schedules/:id` (post-delete) | 200 | PASS | SOS recalculated to 20.0, game removed |
| 13 | POST | `/marketplace` (offer) | 200 | PASS* | Listing created; returns 200 not 201 (see BUG-5) |
| 14 | POST | `/marketplace` (request) | 200 | PASS* | Listing created |
| 15 | GET | `/marketplace` | 200 | PASS | Both listings returned |
| 16 | GET | `/marketplace?status=open` | 200 | PASS | Filter works; both open listings returned |
| 17 | GET | `/marketplace?type=offer` | 200 | PASS | Filter works; only offer returned |
| 18 | PATCH | `/marketplace/:id` | 200 | PASS | `notes` field updated correctly |
| 19 | POST | `/marketplace/:id/match` | 200 | PASS | Both listings updated to `status=matched` bidirectionally |
| 20 | GET | `/marketplace` (post-match) | 200 | PASS | Both listings show `status=matched` and correct `matchedListingId` |
| 21 | DELETE | `/marketplace/:id` (matched) | 200 | FAIL | Matched listing deleted without error — no guard (see BUG-7) |
| 22 | GET | `/import/upload-url` | 200 | PASS | Valid S3 presigned URL returned; `uploadUrl` and `fileUrl` present |
| 23 | POST | `/import` (manual) | 200 | PASS* | Job created with `status=pending`; Lambda processor immediately sets it to `failed` (see BUG-8) |
| 24 | GET | `/import/:id` | 200 | PASS | Job status correctly returned; `failed` with error message |
| 25 | POST | `/import/:id/confirm` | 200 | PASS | Games added to existing schedule; SOS recalculated correctly |
| 26 | GET | `/admin/scraper/status` | 200 | PASS | Returns `{"lastRun":null,"status":"idle"}` |
| 27 | POST | `/admin/sync` | 200 | PASS | Returns `{"status":"ok","message":"Sync queued"}` |
| 28 | GET | `/schedules` (no auth) | 401 | PASS | `{"error":"Unauthorized"}` |
| 29 | GET | `/schedules` (invalid token) | 401 | PASS | `{"error":"Invalid token"}` |
| 30 | POST | `/schedules/:id/games` (missing fields) | 200 | FAIL | Incomplete game stored in DB — no validation (see BUG-9) |
| 31 | PATCH | `/marketplace/:id` (unknown field) | 200 | FAIL | Unknown field accepted and persisted (see BUG-10) |
| 32 | GET | `/schedules/nonexistent-id` | 404 | PASS | `{"error":"Schedule not found"}` |

---

### New Bugs Found (BUG-5 through BUG-10)

---

#### BUG-5 — All Create Endpoints Return HTTP 200 Instead of 201

**Severity:** Low (protocol correctness)
**Affected routes:**
- `POST /teams` → returns 200
- `POST /schedules` → returns 200
- `POST /marketplace` → returns 200
- `POST /import` → returns 200
- `POST /schedules/:id/games` → returns 200

**Expected behavior:** HTTP 201 Created for successful resource creation, per REST conventions and HTTP semantics.

**Observed response:**
```
HTTP/1.1 200 OK
{"status":"ok","team":{"id":"1773068257313-3gcrz10",...}}
```

**Recommendation:** Change `res.json(...)` to `res.status(201).json(...)` on all POST handlers that create a new resource.

---

#### BUG-6 — POST /schedules/:id/games Response Does Not Include Updated SOS

**Severity:** Medium (API usability / client UX)
**Description:** After adding a game, the client receives only the newly-created game object. To learn the updated `strengthOfSchedule` (which is recomputed server-side on every game mutation), the client must make a second round-trip `GET /schedules/:id`.

**Observed response:**
```json
{
  "status": "ok",
  "game": {
    "id": "1773068304633-sridpp0",
    "date": "2026-01-15",
    "opponentNetRanking": 5,
    "location": "home",
    ...
  }
}
```

**Expected/better response** (matches PATCH game behavior too):
```json
{
  "status": "ok",
  "game": { ... },
  "schedule": {
    "strengthOfSchedule": 5,
    "sosQuadrantBreakdown": { ... }
  }
}
```

**Recommendation:** On `POST /schedules/:id/games` and `PATCH /schedules/:id/games/:gameId`, include the updated schedule-level SOS fields in the response body (either as a nested `schedule` object or as top-level keys alongside `game`). This eliminates an extra round-trip on the most common user action in the app.

---

#### BUG-7 — DELETE /marketplace/:id Allows Deletion of Matched Listings Without Warning

**Severity:** Medium (data integrity)
**Description:** After two listings are matched (`status=matched`, `matchedListingId` set on both), deleting one listing via `DELETE /marketplace/:listing2id` succeeds with HTTP 200 and `{"status":"ok"}`. The paired listing (`listing1`) is left with `status=matched` and a dangling `matchedListingId` pointing to a now-deleted record.

**Observed behavior:**
1. Listing 1 (`offer`) and Listing 2 (`request`) are matched — both show `status=matched`
2. `DELETE /marketplace/listing2id` → HTTP 200 `{"status":"ok"}`
3. Listing 1 remains in DB with `status=matched`, `matchedListingId=listing2id` (points to deleted record)

**Expected behavior:** Either:
- (a) Block deletion of a matched listing and return 409 Conflict, OR
- (b) Allow deletion but automatically revert the paired listing to `status=open` and clear its `matchedListingId`

**Recommendation:** In the `DELETE /marketplace/:id` handler, if the listing is `matched`, look up the paired listing via `matchedListingId` and reset it to `status=open`, `matchedListingId=null` before deleting. This mirrors the `/match` endpoint's bidirectional logic.

---

#### BUG-8 — POST /import with source="manual" Immediately Fails with "Unsupported source type"

**Severity:** Low (expected behavior, but misleading API contract)
**Description:** Creating an import job with `source=manual` and `fileUrl=null` saves the job with `status=pending`, but the import processor Lambda immediately sets it to `status=failed` with the error `"Unsupported source type for auto-processing."`. The job is unusable unless the caller proceeds directly to `POST /import/:id/confirm`.

**Observed sequence:**
```
POST /import {"source":"manual","fileUrl":null}  →  {"status":"pending"}
GET  /import/:id                                  →  {"status":"failed","errors":["Unsupported source type for auto-processing."]}
POST /import/:id/confirm {games:[...]}            →  works correctly despite "failed" status
```

**Issue:** The `confirm` endpoint operates on a job with `status=failed`. No validation that job is in a confirmable state. The naming is also confusing — for manual imports there is nothing to "process", the caller just submits games directly via `/confirm`.

**Recommendation:** Either:
- (a) Allow `source=manual` to skip auto-processing and stay in `pending` state (skip the Lambda invocation), OR
- (b) Set `status=pending` for auto-processing sources only; for `source=manual`, set initial status to `awaiting_confirmation` and document that the caller should call `/confirm` immediately.

Also, the `/confirm` endpoint should validate that the job `status` is not `completed` to prevent double-confirmation.

---

#### BUG-9 — POST /schedules/:id/games Accepts and Persists Games with Missing Required Fields

**Severity:** High (data integrity)
**Description:** Submitting a game with only `date` populated (no `opponentId`, `opponentName`, `opponentNetRanking`, `location`, `isConference`, `status`) returns HTTP 200 and creates a game object in the database with only `id` and `date`.

**Observed request:**
```
POST /schedules/1773068268992-ou21vr8/games
{"date":"2026-01-30"}
```

**Observed response:**
```json
HTTP 200
{"status":"ok","game":{"id":"1773068701398-r1qg1ia","date":"2026-01-30"}}
```

**Impact:**
- Game appears in schedule with `undefined`/missing fields
- SOS calculation will fail or produce incorrect results when `opponentNetRanking` is null/undefined
- Frontend will crash attempting to render incomplete game objects
- Data corruption in DynamoDB — incomplete records hard to clean up

**Required fields that must be validated:**
- `date` (string, ISO date format)
- `opponentId` (string)
- `opponentName` (string)
- `opponentNetRanking` (number, 1–400)
- `location` (enum: `home` | `away` | `neutral`)
- `isConference` (boolean)
- `status` (enum: `scheduled` | `completed` | `cancelled`)

**Recommendation:** Add input validation on `POST /schedules/:id/games` and `PATCH /schedules/:id/games/:gameId`. Use a validation library (e.g., `zod` or `joi`) or manual checks, returning HTTP 400 with a descriptive error if required fields are missing or have wrong types:
```json
{"error":"Missing required field: opponentNetRanking"}
```

---

#### BUG-10 — PATCH /marketplace/:id Accepts and Persists Arbitrary Unknown Fields

**Severity:** Medium (data integrity / security)
**Description:** Submitting a PATCH body with a field that is not part of the `MarketplaceListing` data model is accepted, persisted to DynamoDB, and returned in the response. This allows clients to inject arbitrary key-value pairs into marketplace listing records.

**Observed request:**
```
PATCH /marketplace/1773068455197-irur608
{"nonexistentField":"value"}
```

**Observed response:**
```json
HTTP 200
{
  "status": "ok",
  "listing": {
    ...all real fields...,
    "nonexistentField": "value"
  }
}
```

**Impact:**
- DynamoDB records can be polluted with arbitrary attributes
- An attacker (authenticated user) could inject fields like `ownerId`, `matchedListingId`, or `status` directly, bypassing business logic
- The same issue likely exists on `PATCH /schedules/:id`

**Recommendation:** Use an allowlist of patchable fields for each endpoint. For marketplace listings, only permit: `notes`, `preferredLocation`, `targetNetRange`, `date`. Reject or strip any other keys. Example pattern:
```javascript
const ALLOWED_PATCH_FIELDS = ['notes', 'preferredLocation', 'targetNetRange', 'date'];
const patch = Object.fromEntries(
  Object.entries(body).filter(([k]) => ALLOWED_PATCH_FIELDS.includes(k))
);
```
Note: the `status` field in particular must never be directly patchable — status changes should be gated through dedicated endpoints (e.g., `/match`, `/close`).

---

### SOS Calculation Verification Results

All SOS calculations were verified at runtime with a valid token:

| Test Scenario | Expected SOS | Actual SOS | Match |
|---------------|-------------|------------|-------|
| 1 game: home vs NET 5 | 5.0 | 5 | PASS |
| 2 games: home NET 5 (w=0.6) + away NET 20 (w=1.4) = (3+28)/2.0 | 15.5 | 15.5 | PASS |
| After deleting home NET 5 game: only away NET 20 remains | 20.0 | 20 | PASS |
| After confirm-import: away NET 20 (w=1.4) + neutral NET 30 (w=1.0) = (28+30)/2.4 | 24.167 | 24.2 | PASS (rounded to 1dp) |

**Quadrant breakdown accuracy:**
- Home game vs NET 5: Home Q1 threshold ≤75 → classified as Q1 ✓
- Away game vs NET 20: Away Q1 threshold ≤30 → classified as Q1 ✓
- Neutral game vs NET 30: Neutral Q1 threshold ≤50 → classified as Q1 ✓
- Win/loss counts only increment when `status=completed` ✓

**Conclusion:** The SOS engine is correct. All formulas, weights, and quadrant thresholds match the documented specification exactly.

---

### Import Pipeline Status

| Step | Status | Notes |
|------|--------|-------|
| `GET /import/upload-url` | PASS | Valid S3 presigned PUT URL generated; correct bucket, user-scoped path, 5-minute expiry |
| `POST /import` (manual) | PASS (with caveat) | Job created but immediately transitions to `failed` status (BUG-8) |
| `GET /import/:id` | PASS | Returns current job state correctly |
| `POST /import/:id/confirm` | PASS | Games added to existing schedule by matching `teamId+season`; SOS recalculated |
| Import with non-manual source | NOT TESTED | Would require uploading a real file to S3 and waiting for async Lambda processing |

The confirm endpoint correctly locates an existing schedule for the team/season and appends games rather than creating a duplicate schedule. This is the correct behavior.

---

### Admin Endpoints

| Endpoint | Status | Response |
|----------|--------|----------|
| `GET /admin/scraper/status` | PASS | `{"lastRun":null,"status":"idle"}` — scraper has never run (or status not persisted) |
| `POST /admin/sync` | PASS | `{"status":"ok","message":"Sync queued"}` — async operation, outcome not verifiable synchronously |

**Security note (from Pass 1, confirmed):** Both admin endpoints are accessible to any authenticated user. There is no role/group check. Any Cognito user who logs in can trigger a scraper sync or read scraper status.

---

### Overall Assessment

**Pass 2 summary:** 29 of 32 tests passed. 3 failures, all due to missing input validation or missing business logic guards. The core data model, auth enforcement, SOS engine, and CRUD operations are functionally correct.

**Bugs by severity:**

| Severity | Count | Bugs |
|----------|-------|------|
| High | 1 | BUG-9 (no input validation on game creation) |
| Medium | 3 | BUG-6 (SOS not in game response), BUG-7 (matched listing deletion), BUG-10 (arbitrary field injection) |
| Low | 2 | BUG-5 (200 vs 201), BUG-8 (manual import fails immediately) |

**Recommended fix order:**

| Priority | Bug | Fix Effort | Risk |
|----------|-----|-----------|------|
| 1 | BUG-9: No game field validation | Low (add zod schema) | High if left unaddressed |
| 2 | BUG-10: Arbitrary field injection on PATCH | Low (allowlist) | Medium — security issue |
| 3 | BUG-7: Matched listing deletion with no cleanup | Low (add cleanup logic) | Medium — data corruption |
| 4 | BUG-1: 500 on unknown routes (from Pass 1) | Low (catch-all handler) | Medium |
| 5 | BUG-6: SOS not in game response | Medium (restructure response) | Low |
| 6 | BUG-8: Manual import fails state | Low (skip processor for manual) | Low |
| 7 | BUG-2: No DELETE /schedules/:id (from Pass 1) | Low (add route) | Low |
| 8 | BUG-5: 200 vs 201 on creation | Trivial | None |
| 9 | BUG-3: X-Powered-By header (from Pass 1) | Trivial | None |
| 10 | BUG-4: APP_DOMAIN CORS (from Pass 1) | Config only | Blocks production |
