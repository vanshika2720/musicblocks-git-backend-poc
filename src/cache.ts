import Redis from "ioredis";
import { LRUCache } from "lru-cache";

let redisClient: Redis | null = null;

// kicks off the Redis connection attempt — called once at server startup
// if Redis isn't running we just stay on the LRU fallback, no crash
export async function initCache(): Promise<void> {
    try {
        const client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
            lazyConnect: true,
            connectTimeout: 2000,
            maxRetriesPerRequest: 1,
        });

        client.on("error", () => {
            redisClient = null;
        });

        await client.connect();
        redisClient = client;
    } catch {
        redisClient = null;
    }
}

// in-memory fallback - keeps the last 200 entries
const lru = new LRUCache<string, string>({
    max: 200,
    ttl: 1000 * 60, // 1 minute default
});

export async function cacheGet(key: string): Promise<string | null> {
    if (redisClient) {
        return await redisClient.get(key);
    }
    return lru.get(key) ?? null;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (redisClient) {
        await redisClient.set(key, value, "EX", ttlSeconds);
    } else {
        lru.set(key, value, { ttl: ttlSeconds * 1000 });
    }
}

export async function cacheDel(key: string): Promise<void> {
    if (redisClient) {
        await redisClient.del(key);
    } else {
        lru.delete(key);
    }
}

export function usingRedis(): boolean {
    return redisClient !== null;
}
