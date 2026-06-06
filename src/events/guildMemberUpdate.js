const { addBalance } = require('../utils/economyHandler');
const { getDb } = require('../config/database');

module.exports = {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember, client) {
        // Boost detection: premiumSince is the date they started boosting
        if (!oldMember.premiumSince && newMember.premiumSince) {
            try {
                const db = await getDb();
                const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [newMember.guild.id]);
                if (conf && (conf.ecoEnabled || conf.ecoenabled)) {
                    const amount = (conf.ecoCoinsPerBoost || conf.ecocoinsperboost) || 100;
                    await addBalance(newMember.id, amount, newMember.guild.id, false, 'Reward for Server Boosting');
                    
                    console.log(`[Economy] User ${newMember.user.tag} rewarded ${amount} coins for boosting ${newMember.guild.name}`);
                }
            } catch (e) {
                console.error('Boost Economy reward error:', e.message);
            }
        }
    }
};
