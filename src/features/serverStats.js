const { ChannelType } = require('discord.js');
const { getDb } = require('../config/database');

module.exports = function setupServerStats(client) {
    // Update every 10 minutes (Discord limits channel rename rate limits to 2 per 10min)
    setInterval(async () => {
        try {
            const db = await getDb();
            const configs = await db.all(`SELECT * FROM module_configs WHERE serverStatsEnabled = 1 AND statsCategoryId IS NOT NULL`);
            
            for (const conf of configs) {
                const guild = client.guilds.cache.get(conf.guildId);
                if (!guild) continue;

                const category = guild.channels.cache.get(conf.statsCategoryId);
                if (!category || category.type !== ChannelType.GuildCategory) continue;

                const channels = category.children.cache;

                const totalMembers = guild.memberCount;
                // Fetch members to correctly calculate bots and online
                const members = await guild.members.fetch().catch(()=>null);
                if (!members) continue;

                const botCount = members.filter(m => m.user.bot).size;
                const onlineCount = members.filter(m => m.presence && m.presence.status !== 'offline').size;
                const validTypes = [
                    ChannelType.GuildText,
                    ChannelType.GuildVoice,
                    ChannelType.GuildAnnouncement,
                    ChannelType.GuildStageVoice,
                    ChannelType.GuildForum
                ];
                const totalChannels = guild.channels.cache.filter(c => validTypes.includes(c.type)).size;

                // Function to create or update stat vc
                const updateStatChannel = async (label, value, isEnabled) => {
                    if (!isEnabled) return;
                    const name = `${label}: ${value}`;
                    const existing = channels.find(c => c.name.startsWith(label));
                    if (existing) {
                        if (existing.name !== name) await existing.setName(name).catch(()=>{});
                    } else {
                        await guild.channels.create({
                            name,
                            type: ChannelType.GuildVoice,
                            parent: category.id,
                            permissionOverwrites: [
                                { 
                                    id: guild.roles.everyone.id, 
                                    deny: ['Connect'] 
                                }
                            ]
                        }).catch(()=>{});
                    }
                };

                await updateStatChannel('Members', totalMembers, conf.statsTotalMembers);
                await updateStatChannel('Online', onlineCount, conf.statsOnline);
                await updateStatChannel('Bots', botCount, conf.statsBots);
                await updateStatChannel('Channels', totalChannels, conf.statsChannels);
            }
        } catch (e) {
            console.error('Error updating server stats', e);
        }
    }, 600000); // 10 minutes
};
