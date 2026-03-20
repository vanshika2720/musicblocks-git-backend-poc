# musicblocks-git-backend-poc

Proof of concept for **GSoC 2026 – Git Backend for Music Blocks Part 2**.

This is a standalone mini-demo that proves the feasibility of the three hardest technical problems in the proposal: scaling via caching, idempotent Planet migration, and the contextual Git education module.

It is intentionally small. All the logic lives in four files under `src/` and there is a browser dashboard in `public/index.html` to interact with each piece.

---

## What's inside

| File | What it proves |
|---|---|
| `src/cache.ts` | Redis + LRU fallback caching. Server stays responsive even without Redis. |
| `src/octokit.ts` | GitHub App token cached for 55 min — fixes the "2 API calls per request" problem from Part 1. |
| `src/migrate.ts` | SHA256 content hashing to detect and skip duplicate Planet migrations. |
| `src/education.ts` | Tutorial state machine — each moment fires only once per student. |
| `src/server.ts` | Express 5 server wiring all three demos to HTTP routes. |
| `public/index.html` | Browser dashboard to trigger and watch each demo. |

---

## Setup

```bash
cp .env.example .env
# Fill in GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_PRIVATE_KEY_PATH
# Redis is optional - the server falls back to in-memory LRU automatically

npm install
npm run dev
```

Then open `http://localhost:3001` in your browser.

---

## Demo 1 — Scaling: Cache Benchmark

Hit **Fetch All Repos** twice.

- First call: simulates a live GitHub API round-trip → ~320ms, `source: "github-api"`
- Second call: served from Redis or LRU cache → ~5ms, `source: "redis"` or `"lru-memory"`

Hit **Clear Cache** to reset and repeat the benchmark.

This maps directly to the proposal's claim of an 89% reduction in GitHub API overhead at classroom scale.

---

## Demo 2 — Migration: SHA256 Deduplication

Hit **Run Migration Batch**.

The backend calls `migrateBatch(["planet-proj-001", "planet-proj-002"], ownerKey)`.

Each project goes through:
1. Planet API fetch
2. SHA256 hash of the returned JSON
3. GitHub code search for the hash in `metaData.json`
4. Skip if found, create repo if not

Run it a second time and both projects come back as `"skipped"` — the deduplication is working.

---

## Demo 3 — Education: Tutorial Triggers

Hit **Student Clicks Save**.

- First click returns `{ streak: 1, tutorialMoment: "first_save" }` — the tutorial fires
- Every click after that returns `{ streak: N, tutorialMoment: null }` — already seen

Hit **Reset Student** to clear the state and trigger the tutorial again.

**Check Progress** shows exactly which moments have been seen and which remain.

---

## Routes

```
GET  /api/status                          health check
GET  /api/demo/allRepos                   cache benchmark
DEL  /api/demo/allRepos/cache             clear benchmark cache
POST /api/migrate/planet                  batch migration endpoint
POST /api/demo/save                       simulate a save/commit
GET  /api/demo/tutorials/:studentId       get tutorial progress
POST /api/demo/tutorials/:studentId/seen  mark a moment as seen
DEL  /api/demo/tutorials/:studentId       reset student state
```

---

## Notes

- The GitHub App credentials in `.env` are only needed for Demo 2 (migration). Demos 1 and 3 work without them.
- Redis is optional for all three demos. If `REDIS_URL` is unreachable the server logs `"cache backend: lru (redis not available)"` and continues with the in-memory fallback.
- The 320ms delay in Demo 1 is intentional — it simulates the real observed latency from GitHub's API. The actual Part 1 codebase shows similar numbers in production.
