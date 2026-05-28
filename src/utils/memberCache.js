const { GuildMemberManager } = require('discord.js');

const originalFetch = GuildMemberManager.prototype.fetch;

// In-memory caches
// guildId -> { timestamp: number, members: Collection }
const memberCache = new Map();
// guildId -> Promise<Collection> (for request coalescing)
const activeFetches = new Map();

// 5 minutes Time-To-Live
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Patched GuildMemberManager.prototype.fetch
 * 
 * Safely fetches all guild members with in-memory caching and request coalescing.
 * This prevents GatewayRateLimitError (opcode 8 rate limit) when multiple calls
 * query guild members concurrently.
 * 
 * To bypass the cache, pass { force: true } in the options argument.
 */
GuildMemberManager.prototype.fetch = function (options) {
    // Check if this is a request to fetch all/default members.
    // guild.members.fetch() with no options, or empty object option.
    const isFetchAll = !options || (typeof options === 'object' && Object.keys(options).filter(k => k !== 'force').length === 0);
    const force = options && options.force;

    if (isFetchAll && !force) {
        const guildId = this.guild.id;
        const now = Date.now();

        // 1. Check if we have a valid unexpired cache in memory
        if (memberCache.has(guildId)) {
            const cached = memberCache.get(guildId);
            if (now - cached.timestamp < CACHE_TTL) {
                return Promise.resolve(cached.members);
            }
        }

        // 2. Check if a fetch is already in progress for this guild
        if (activeFetches.has(guildId)) {
            return activeFetches.get(guildId);
        }

        // 3. Perform the actual gateway/API fetch
        console.log(`[MemberCache] Fetching all guild members for ${this.guild.name} (${guildId}) via Gateway...`);
        const fetchPromise = originalFetch.call(this, options)
            .then(members => {
                // Update cache
                memberCache.set(guildId, {
                    timestamp: Date.now(),
                    members: members
                });
                activeFetches.delete(guildId);
                return members;
            })
            .catch(err => {
                activeFetches.delete(guildId);
                // Fallback to expired cache if available to prevent gateway downtime crashes
                if (memberCache.has(guildId)) {
                    console.warn(`[MemberCache] Gateway fetch failed for guild ${guildId}, falling back to expired cache:`, err.message || err);
                    return memberCache.get(guildId).members;
                }
                throw err;
            });

        activeFetches.set(guildId, fetchPromise);
        return fetchPromise;
    }

    // For specific user fetches, array queries, role queries, search, or forced bypass, use standard fetch
    return originalFetch.call(this, options);
};

console.log('[MemberCache] GuildMemberManager prototype successfully patched for Gateway rate-limit protection.');
