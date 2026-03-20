import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as crypto from "crypto";

// this is the cached token - GitHub App tokens are valid for 1 hour
// so we just re-use it until it's about to expire
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

function generateJWT(): string {
    const appId = process.env.GITHUB_APP_ID!;
    const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH || "./private-key.pem";

    let privateKey: string;
    try {
        privateKey = fs.readFileSync(keyPath, "utf8");
    } catch {
        throw new Error(`Could not read private key from ${keyPath}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iat: now - 60,
        exp: now + 600,
        iss: appId,
    };

    // simple base64url encoding for JWT header + payload
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const data = `${header}.${body}`;

    const signature = crypto.createSign("RSA-SHA256").update(data).sign(privateKey, "base64url");
    return `${data}.${signature}`;
}

export async function getInstallationToken(): Promise<string> {
    const now = Date.now();

    // reuse the cached token if we still have 5+ minutes left on it
    if (cachedToken && tokenExpiresAt - now > 5 * 60 * 1000) {
        return cachedToken;
    }

    const jwt = generateJWT();
    const installationId = process.env.GITHUB_INSTALLATION_ID!;

    const tempOctokit = new Octokit({ auth: jwt });
    const { data } = await tempOctokit.rest.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
    });

    cachedToken = data.token;
    tokenExpiresAt = new Date(data.expires_at).getTime();

    return cachedToken;
}

export async function getOctokit(): Promise<Octokit> {
    const token = await getInstallationToken();
    return new Octokit({ auth: token });
}
