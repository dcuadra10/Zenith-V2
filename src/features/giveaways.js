const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');

async function checkGiveaways(client) {
    try {
        const db = await getDb();
        const now = Date.now();
        // Fetch expired giveaways that are still marked as active
        const expired = await db.all(`SELECT * FROM giveaways WHERE status = 'active' AND endTime <= ?`, [now]);

        for (const ga of expired) {
            const guild = client.guilds.cache.get(ga.guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(ga.channelId);
            if (!channel) continue;

            try {
                const message = await channel.messages.fetch(ga.id);
                if (!message) continue;

                // Mark ended in db
                await db.run(`UPDATE giveaways SET status = 'ended' WHERE id = ?`, [ga.id]);

                const reaction = message.reactions.cache.find(r => r.emoji.name === '🎉');
                let winners = [];

                if (reaction) {
                    const users = new Map();
                    let lastId = null;
                    while (true) {
                        const options = { limit: 100 };
                        if (lastId) options.after = lastId;
                        const fetchedUsers = await reaction.users.fetch(options);
                        if (fetchedUsers.size === 0) break;
                        for (const [userId, user] of fetchedUsers) {
                            users.set(userId, user);
                        }
                        if (fetchedUsers.size < 100) break;
                        lastId = fetchedUsers.lastKey();
                    }

                    const validUsers = [];
                    for (const [userId, user] of users) {
                        if (user.bot) continue;
                        
                        if (ga.requiredRole) {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (!member || !member.roles.cache.has(ga.requiredRole)) continue;
                        }
                        
                        validUsers.push(user);
                    }
                    
                    // Shuffle and select N
                    const shuffled = validUsers.sort(() => 0.5 - Math.random());
                    winners = shuffled.slice(0, ga.winnersCount);
                }

                // Edit original embed
                const oldEmbed = message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed)
                    .setTitle(`[ENDED] ${ga.prize}`)
                    .setDescription(`**Winners:** ${winners.length > 0 ? winners.map(w => `<@${w.id}>`).join(', ') : 'No valid entries.'}\n**Hosted By:** <@${ga.hostedBy}>`)
                    .setColor('#2b2d31');
                
                await message.edit({ embeds: [newEmbed], components: [] });

                const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [ga.guildId]);

                // Announce winners
                if (winners.length > 0) {
                    await channel.send(`🎉 Congratulations ${winners.map(w => `<@${w.id}>`).join(', ')}! You won the **${ga.prize}**!`);
                    
                    // Enviar DM a cada uno de los ganadores iniciales
                    for (const winner of winners) {
                        try {
                            const winEmbed = new EmbedBuilder()
                                .setTitle('🎉 You won a giveaway!')
                                .setDescription(`Congratulations! You won **${ga.prize}** in **${guild.name}**!\n\n**Click here to view the giveaway**`)
                                .setColor('#a855f7')
                                .setTimestamp();
                            await winner.send({ embeds: [winEmbed] });
                        } catch (err) {
                            console.log(`[Giveaways] Could not DM winner ${winner.tag} (DMs might be closed).`);
                        }
                    }
                    
                    // Economy reward for winners
                    if (conf && conf.giveawaysEcoReward) {
                        const { addBalance } = require('../utils/economyHandler');
                        const amount = conf.giveawaysEcoCoins || 200;
                        for (const winner of winners) {
                            await addBalance(winner.id, amount, ga.guildId);
                        }
                    }
                } else {
                    await channel.send(`🛑 No valid participants entered the **${ga.prize}** giveaway.`);
                }

                // Log the end
                if (conf && conf.giveawaysLogChannel) {
                    const logChan = guild.channels.cache.get(conf.giveawaysLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🏁 Giveaway Ended')
                            .setColor('#e74c3c')
                            .addFields(
                                { name: 'Prize', value: ga.prize, inline: true },
                                { name: 'Winners', value: winners.length > 0 ? winners.map(w => `<@${w.id}>`).join(', ') : 'None', inline: true },
                                { name: 'Channel', value: `<#${ga.channelId}>`, inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }
            } catch (e) {
                console.error(`Error ending giveaway ${ga.id}`, e);
            }
        }
    } catch (e) {
        console.error('Giveaway checker error', e);
    }
}

module.exports = function setupGiveaways(client) {
    // Check every 30 seconds
    setInterval(() => checkGiveaways(client), 30000);
};
