import { app } from 'electron';
import { SupabaseClientManager } from '../supabase-client';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum messages a regular user can send per UTC day. */
export const DAILY_MESSAGE_LIMIT = 50;

/** Roles that are exempt from rate limiting (unlimited usage). */
const EXEMPT_ROLES: ReadonlySet<string> = new Set(['dev', 'admin']);

/**
 * Returns true when the app is running in development mode (not packaged).
 * In dev mode, rate limiting is completely bypassed for all users.
 */
function isDevEnvironment(): boolean {
    // app.isPackaged is false when running via `electron .` / `npm run dev`
    // and true when the app is built into a distributable (.exe, .dmg, etc.)
    return !app.isPackaged;
}

/** How long (ms) a cached rate-limit result stays valid before re-querying. */
const CACHE_TTL_MS = 60_000; // 60 seconds

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
    /** Whether the user is allowed to send a message right now. */
    allowed: boolean;
    /** Messages remaining today (Infinity for exempt roles). */
    remaining: number;
    /** The daily limit applied to this user (Infinity for exempt roles). */
    limit: number;
    /** The user's role from profiles. */
    role: string;
}

interface CacheEntry {
    result: RateLimitResult;
    /** Epoch-ms when this entry was written. */
    cachedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rate Limit Service
 *
 * Enforces a daily message cap for regular users.
 * Dev / admin roles bypass the limit entirely.
 *
 * Uses an in-memory cache (per userId) so we don't hit Supabase on every
 * single message — the cache is short-lived (CACHE_TTL_MS) and is
 * force-invalidated after a message is sent so the count stays accurate.
 */
export class RateLimitService {
    private client = SupabaseClientManager.getClient();

    /** userId → cached check result */
    private cache = new Map<string, CacheEntry>();

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Check whether `userId` is allowed to send another message today.
     *
     * @param userId  The authenticated user's UUID.
     * @param force   Skip the cache and always hit the DB.
     */
    async checkRateLimit(userId: string, force = false): Promise<RateLimitResult> {
        // 0. Dev environment — skip rate limiting entirely
        if (isDevEnvironment()) {
            return { allowed: true, remaining: Infinity, limit: Infinity, role: 'dev' };
        }

        // 1. Try cache first (unless forced)
        if (!force) {
            const cached = this.cache.get(userId);
            if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
                return cached.result;
            }
        }

        // 2. Fetch role from profiles
        const role = await this.getUserRole(userId);

        if (EXEMPT_ROLES.has(role)) {
            const result: RateLimitResult = {
                allowed: true,
                remaining: Infinity,
                limit: Infinity,
                role,
            };
            this.cache.set(userId, { result, cachedAt: Date.now() });
            return result;
        }

        // 3. Count today's user-role messages
        const todayCount = await this.getTodayMessageCount(userId);

        const remaining = Math.max(0, DAILY_MESSAGE_LIMIT - todayCount);
        const result: RateLimitResult = {
            allowed: todayCount < DAILY_MESSAGE_LIMIT,
            remaining,
            limit: DAILY_MESSAGE_LIMIT,
            role,
        };

        this.cache.set(userId, { result, cachedAt: Date.now() });
        return result;
    }

    /**
     * Call after a message is successfully sent to keep the cache accurate
     * without waiting for the TTL to expire.
     */
    invalidateCache(userId: string): void {
        this.cache.delete(userId);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Fetch the role column from the profiles table.
     * Falls back to 'user' if the profile doesn't exist or the column is missing.
     */
    private async getUserRole(userId: string): Promise<string> {
        try {
            const { data, error } = await this.client
                .from('profiles')
                .select('role')
                .eq('id', userId)
                .single();

            if (error || !data) {
                console.warn('[RateLimitService] Could not fetch role, defaulting to "user":', error?.message);
                return 'user';
            }

            return (data as any).role ?? 'user';
        } catch (err) {
            console.warn('[RateLimitService] Unexpected error fetching role:', err);
            return 'user';
        }
    }

    /**
     * Count user-role messages created today (UTC) for the given user.
     *
     * Uses the `messages` table which already tracks every message with
     * user_id, role, and created_at.
     */
    private async getTodayMessageCount(userId: string): Promise<number> {
        try {
            // Start of today in UTC
            const now = new Date();
            const todayStart = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
            )).toISOString();

            const { count, error } = await this.client
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('role', 'user')
                .gte('created_at', todayStart);

            if (error) {
                console.error('[RateLimitService] Error counting messages:', error);
                // Fail-open: allow the message if we can't count
                return 0;
            }

            return count ?? 0;
        } catch (err) {
            console.error('[RateLimitService] Unexpected error counting messages:', err);
            // Fail-open
            return 0;
        }
    }
}
