import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { cacheGet, cacheSet, cacheDel, usingRedis, initCache } from "./cache";
import { migrateBatch } from "./migrate";
import {
    recordSave,
    shouldShowTutorial,
    markTutorialSeen,
    getTutorialProgress,
    resetStudentState,
} from "./education";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// -----------------------------------------------------------------------
// SCALING DEMO: cache benchmark
// hits /api/demo/allRepos and compares raw vs cached response time
// -----------------------------------------------------------------------

app.get("/api/demo/allRepos", async (req: Request, res: Response) => {
    const cacheKey = "cache:allRepos:demo";
    const start = Date.now();

    const cached = await cacheGet(cacheKey);
    if (cached) {
        const elapsed = Date.now() - start;
        res.json({
            source: usingRedis() ? "redis" : "lru-memory",
            responseTimeMs: elapsed,
            data: JSON.parse(cached),
        });
        return;
    }

    // simulate a live GitHub API call (in real use this hits /orgs/sugarlabs/repos)
    await new Promise((r) => setTimeout(r, 320));
    const fakeRepos = [
        { name: "jazz-loop", description: "A jazz loop by student A", stars: 3 },
        { name: "drum-beat-v2", description: "Drum pattern project", stars: 1 },
        { name: "flute-melody", description: "forked from jazz-loop", stars: 0 },
    ];
    const elapsed = Date.now() - start;

    await cacheSet(cacheKey, JSON.stringify(fakeRepos), 60);

    res.json({
        source: "github-api",
        responseTimeMs: elapsed,
        data: fakeRepos,
    });
});

// clears the demo cache so you can re-run the benchmark
app.delete("/api/demo/allRepos/cache", async (_req: Request, res: Response) => {
    await cacheDel("cache:allRepos:demo");
    res.json({ cleared: true });
});

// -----------------------------------------------------------------------
// MIGRATION DEMO: batch migrate from Planet
// -----------------------------------------------------------------------

app.post("/api/migrate/planet", async (req: Request, res: Response) => {
    const { planetIds, ownerKey } = req.body;

    if (!Array.isArray(planetIds) || planetIds.length === 0) {
        res.status(400).json({ error: "planetIds must be a non-empty array" });
        return;
    }

    if (!ownerKey || typeof ownerKey !== "string") {
        res.status(400).json({ error: "ownerKey is required" });
        return;
    }

    if (planetIds.length > 20) {
        res.status(400).json({ error: "max 20 projects per batch" });
        return;
    }

    try {
        const result = await migrateBatch(planetIds, ownerKey);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// -----------------------------------------------------------------------
// EDUCATION DEMO: tutorial state and commit streak
// -----------------------------------------------------------------------

// simulates a student clicking "Save" for the first time
app.post("/api/demo/save", (req: Request, res: Response) => {
    const studentId = req.body.studentId || "demo-student";
    const result = recordSave(studentId);
    res.json(result);
});

app.get("/api/demo/tutorials/:studentId", (req: Request, res: Response) => {
    const progress = getTutorialProgress(req.params.studentId as string);
    res.json(progress);
});

app.post("/api/demo/tutorials/:studentId/seen", (req: Request, res: Response) => {
    const { moment } = req.body;
    if (!moment) {
        res.status(400).json({ error: "moment is required" });
        return;
    }
    markTutorialSeen(req.params.studentId as string, moment);
    res.json({ ok: true, moment });
});

app.delete("/api/demo/tutorials/:studentId", (req: Request, res: Response) => {
    resetStudentState(req.params.studentId as string);
    res.json({ reset: true });
});

// health / status endpoint
app.get("/api/status", (_req: Request, res: Response) => {
    res.json({
        ok: true,
        cache: usingRedis() ? "redis" : "lru-fallback",
        timestamp: new Date().toISOString(),
    });
});

const PORT = parseInt(process.env.PORT || "3001");

initCache().then(() => {
    app.listen(PORT, () => {
        console.log(`poc server running on http://localhost:${PORT}`);
        console.log(`cache backend: ${usingRedis() ? "redis" : "lru (redis not available)"}`);
    });
});

export default app;
