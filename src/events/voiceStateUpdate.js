const { addBalance } = require('../utils/economyHandler');
const { getDb } = require('../config/database');

// In-memory tracker for VC join times
const vcJoins = new Map();

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        const userId = newState.id;
        const guildId = newState.guild.id;
        const key = `${guildId}_${userId}`;

        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
            if (!newState.member.user.bot) {
                vcJoins.set(key, Date.now());
            }
        }

        // User left a voice channel
        if (oldState.channelId && !newState.channelId) {
            const joinTime = vcJoins.get(key);
            if (joinTime) {
                vcJoins.delete(key);
                
                // Don't reward if they are muted/deafened? 
                // Let's keep it simple for now: reward for any time in VC.
                
                const durationMs = Date.now() - joinTime;
                const durationMinutes = Math.floor(durationMs / (1000 * 60));

                if (durationMinutes > 0) {
                    try {
                        const db = await getDb();
                        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [guildId]);
                        if (conf && (conf.ecoEnabled || conf.ecoenabled)) {
                            const coinsPerMinute = (conf.ecoCoinsPerVCMinute || conf.ecocoinspervcminute) || 1;
                            await addBalance(userId, durationMinutes * coinsPerMinute, guildId, false, `Reward for spending ${durationMinutes} minutes in VC`);
                        }
                    } catch (e) {
                        console.error('VC Economy reward error:', e.message);
                    }
                }
            }
        }
        
        // Handle switching channels: keep the original join time
    }
};
