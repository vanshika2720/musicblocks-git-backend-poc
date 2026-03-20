import * as crypto from "crypto";
import axios from "axios";
import { getOctokit } from "./octokit";

const SUGAR_LABS_ORG = "sugarlabs";
const PLANET_API = "https://planet.sugarlabs.org";

type MigrationResult = {
    status: "migrated" | "skipped" | "failed";
    planetId: string;
    repoName?: string;
    reason?: string;
};

// fetches a single project from the Planet server
async function fetchPlanetProject(planetId: string) {
    const url = `${PLANET_API}/api/v1/share/${planetId}`;
    const res = await axios.get(url, { timeout: 8000 });
    return res.data;
}

// checks if a repo with this content hash already exists under sugarlabs
// this is the SHA256 deduplication - avoids creating duplicate repos if a 
// student migrates twice or two students had identical projects on Planet
async function findExistingByHash(contentHash: string): Promise<string | null> {
    const octokit = await getOctokit();
    try {
        const results = await octokit.rest.search.code({
            q: `${contentHash} org:${SUGAR_LABS_ORG} filename:metaData.json`,
        });
        if (results.data.total_count > 0) {
            return results.data.items[0].repository.full_name;
        }
    } catch {
        // search API rate limits hit, just proceed with migration
    }
    return null;
}

async function createMigratedRepo(
    projectData: object,
    title: string,
    planetId: string,
    ownerKey: string,
    contentHash: string
) {
    const octokit = await getOctokit();

    // sanitize the title for use as a repo name
    const safeName = title
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80) + "-planet";

    const projectJson = JSON.stringify(projectData, null, 2);
    const metaData = {
        ownerKey,
        planetId,
        contentHash,
        migratedAt: new Date().toISOString(),
    };
    const metaJson = JSON.stringify(metaData, null, 2);

    const { data: repo } = await octokit.rest.repos.createInOrg({
        org: SUGAR_LABS_ORG,
        name: safeName,
        description: `Migrated from Planet: ${title}`,
        private: false,
        auto_init: true,
    });

    const encode = (s: string) => Buffer.from(s).toString("base64");

    // write the three core files
    for (const [path, content] of [
        ["projectData.json", encode(projectJson)],
        ["metaData.json", encode(metaJson)],
        ["README.md", encode(`# ${title}\n\nMigrated from Sugar Labs Planet.\n`)],
    ] as [string, string][]) {
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: SUGAR_LABS_ORG,
            repo: safeName,
            path,
            message: `chore: migrate from Planet (id: ${planetId})`,
            content,
        });
    }

    return repo.html_url;
}

export async function migratePlanetProject(
    planetId: string,
    ownerKey: string
): Promise<MigrationResult> {
    let projectData: any;
    try {
        projectData = await fetchPlanetProject(planetId);
    } catch (err: any) {
        return { status: "failed", planetId, reason: `Planet fetch failed: ${err.message}` };
    }

    const projectJson = JSON.stringify(projectData);
    const contentHash = crypto.createHash("sha256").update(projectJson).digest("hex");

    // level 2 deduplication check
    const existing = await findExistingByHash(contentHash);
    if (existing) {
        return {
            status: "skipped",
            planetId,
            repoName: existing,
            reason: "content hash already exists",
        };
    }

    const title = projectData.title || `project-${planetId}`;

    try {
        const repoUrl = await createMigratedRepo(
            projectData,
            title,
            planetId,
            ownerKey,
            contentHash
        );
        return { status: "migrated", planetId, repoName: repoUrl };
    } catch (err: any) {
        return { status: "failed", planetId, reason: err.message };
    }
}

// handles a batch of projects from the migration wizard
// enforces 500ms delay between requests to stay within rate limits
export async function migrateBatch(
    planetIds: string[],
    ownerKey: string
): Promise<{ migrated: MigrationResult[]; skipped: MigrationResult[]; failed: MigrationResult[] }> {
    const results: MigrationResult[] = [];

    for (const id of planetIds) {
        const r = await migratePlanetProject(id, ownerKey);
        results.push(r);
        // rate limit safety - 500ms between calls
        await new Promise((res) => setTimeout(res, 500));
    }

    return {
        migrated: results.filter((r) => r.status === "migrated"),
        skipped: results.filter((r) => r.status === "skipped"),
        failed: results.filter((r) => r.status === "failed"),
    };
}
