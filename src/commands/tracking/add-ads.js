const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { addAdTrackingRecord } = require('../../utils/googleSheetsConnector');
const { getDb } = require('../../config/database');
const { getISOWeekString } = require('../../utils/dateHelpers');

async function processAdsSubmission(interaction, amount) {
    try {
        const db = await getDb();
        const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guild.id]);
        if (config && config.spreadsheetId) {
            try {
                await addAdTrackingRecord(
                    config.spreadsheetId,
                    interaction.user.id, 
                    interaction.user.username, 
                    amount, 
                    new Date().toISOString()
                );
            } catch (err) {
                console.warn('Google Sheets config is not connected or failed:', err.message);
            }
        }

        await db.run(
            `INSERT INTO global_stats (statName, value) VALUES ('total_ads_globales', ?) 
             ON CONFLICT(statName) DO UPDATE SET value = global_stats.value + ?`,
             [amount, amount]
        );

        // --- R4 TRACKING (ADS) ---
        const rawModConf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        if (rawModConf) {
            const modConf = Object.keys(rawModConf).reduce((acc, key) => {
                acc[key.toLowerCase()] = rawModConf[key];
                return acc;
            }, {});
            const isEnabled = !!modConf.r4trackingenabled;
            const roleId = modConf.r4trackingrole ? modConf.r4trackingrole.replace(/[^0-9]/g, '') : null;
            const hasRole = !roleId || (interaction.member && interaction.member.roles && interaction.member.roles.cache.has(roleId));

            if (isEnabled && hasRole) {
                const weekId = getISOWeekString();
                await db.run(
                    `INSERT INTO r4_tracking (userId, guildId, weekId, messages, ads, excused) 
                     VALUES (?, ?, ?, 0, ?, 0)
                     ON CONFLICT(userId, guildId, weekId) DO UPDATE SET ads = r4_tracking.ads + ?`,
                    [interaction.user.id, interaction.guild.id, weekId, amount, amount]
                );

                // Economy reward for ads
                if (modConf.ecoenabled) {
                    const { addBalance } = require('../../utils/economyHandler');
                    const coinsPerAd = modConf.ecocoinsperad || 10;
                    await addBalance(interaction.user.id, coinsPerAd * amount, interaction.guild.id);
                }
            }
        }

        const updatedStat = await db.get(`SELECT value FROM global_stats WHERE statName = 'total_ads_globales'`);

        const oldTotal = updatedStat.value - amount;
        const newTotal = updatedStat.value;
        const threshold = 1000;
        const crossedThreshold = Math.floor(oldTotal / threshold) < Math.floor(newTotal / threshold);

        if (crossedThreshold) {
            await interaction.editReply({ content: `✅ Successfully registered ${amount} ads!\n\n🎉 **YOU JUST CROSSED THE GLOBAL MILESTONE OF ${Math.floor(newTotal/threshold)*1000} ADS!** 🎉\nWe require evidence. Please check your Direct Messages.` });
            
            try {
                const dmChannel = await interaction.user.createDM();
                await dmChannel.send("Congratulations on crossing the 1000 global ads milestone! 🚀\nPlease **attach or forward a photo/screenshot** of the ad you uploaded here as evidence.");
                
                const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
                const collector = dmChannel.createMessageCollector({ filter, max: 1, time: 300000 });
                
                collector.on('collect', async m => {
                    const evidenceUrl = m.attachments.first().url;
                    await dmChannel.send("✅ Evidence received and sent to Leadership! Thank you.");
                    
                    const targetChannelId = config.leadershipChannelId || config.logChannelId;
                    let channel = null;
                    if (targetChannelId) {
                        channel = interaction.guild.channels.cache.get(targetChannelId) || 
                                  await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
                    }
                    
                    // Fallback: search for channels by common administrative names
                    if (!channel) {
                        channel = interaction.guild.channels.cache.find(c => 
                            c.name.toLowerCase() === 'admin' || 
                            c.name.toLowerCase() === 'logs' || 
                            c.name.toLowerCase() === 'audits' || 
                            c.name.toLowerCase() === 'leadership' || 
                            c.name.toLowerCase() === 'transcripts'
                        );
                    }
                    
                    if (channel) {
                        await channel.send({
                            content: `📢 **Global 1000-Ads Milestone Audit**\nUser: <@${interaction.user.id}>\nAd Evidence:`,
                            files: [evidenceUrl]
                        });
                    } else {
                        console.error('Evidence received but no leadership/admin/logs channel could be resolved in the guild.');
                    }
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time') {
                        dmChannel.send("⚠️ Wait time for evidence has expired.");
                    }
                });

            } catch (dmError) {
               console.error('Could not send DM:', dmError);
            }

        } else {
            await interaction.editReply({ content: `✅ Successfully registered ${amount} ads! Global estimated total: ${newTotal}.` });
        }

        // --- UPDATE LEADERBOARD IF TRIGGERED FROM PANEL ---
        try {
            // Find the panel message in the channel (look for our bot's message with the leaderboard + panel embeds)
            const recentMessages = await interaction.channel.messages.fetch({ limit: 30 });
            const panelMsg = recentMessages.find(m => 
                m.author.id === interaction.client.user.id && 
                m.components.length > 0 &&
                m.components[0].components.some(c => c.customId === 'btn_register_ads')
            );
            
            if (panelMsg) {
                const topUsers = await db.all(`SELECT userId, SUM(ads) as totalAds FROM r4_tracking WHERE guildId = ? GROUP BY userId ORDER BY totalAds DESC LIMIT 10`, [interaction.guild.id]);
                const useImage = true;
                
                let leaderboardEmbed = null;
                const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');
                const files = [];

                if (useImage) {
                    const { generateLeaderboardImage } = require('../../utils/imageGenerator');
                    const entries = [];
                    for (const u of topUsers) {
                        const uid = u.userId || u.userid;
                        if (!uid) continue;
                        let name = `User ${uid.slice(-4)}`;
                        try {
                            const member = await interaction.guild.members.fetch(uid).catch(() => null);
                            if (member) name = member.displayName || member.user.username;
                        } catch (e) {}
                        entries.push({ name, value: `${u.totalAds ?? u.totalads ?? 0} ads` });
                    }
                    const buffer = await generateLeaderboardImage('🏆  Leaderboard of the Week', entries, imagePath);
                    const imgAttachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
                    files.push(imgAttachment);
                } else {
                    leaderboardEmbed = new EmbedBuilder()
                      .setTitle('🏆 Top Ad Publishers')
                      .setColor('#FFD700');

                    if (!topUsers || topUsers.length === 0) {
                        leaderboardEmbed.setDescription('🏆 **Leaderboard of the Week**\n\n*The board is currently vacant. Be the first to register an ad and secure the top spot!*');
                    } else {
                        let desc = '🏆 **Leaderboard of the Week**\n\n';
                        topUsers.forEach((u, i) => {
                            const uid = u.userId || u.userid;
                            const totalAds = u.totalAds ?? u.totalads ?? 0;
                            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅';
                            desc += `${medal} <@${uid}> ── **${totalAds}** ads\n`;
                        });
                        leaderboardEmbed.setDescription(desc);
                    }
                    const attachment = new AttachmentBuilder(imagePath, { name: 'zenith_bg.png' });
                    files.push(attachment);
                    leaderboardEmbed.setThumbnail('attachment://zenith_bg.png');
                }

                await panelMsg.edit({ 
                    embeds: leaderboardEmbed ? [leaderboardEmbed] : [], 
                    files 
                });
            }
        } catch (err) {
            console.error('Failed to update leaderboard panel:', err);
        }

    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: '❌ An error occurred processing your entry.' });
    }
}

module.exports = {
  processAdsSubmission,
  data: new SlashCommandBuilder()
    .setName('add-ads')
    .setDescription('Logs a number of ads you have generated and sends them to Google Sheets.')
    .addIntegerOption(option => 
      option.setName('amount')
        .setDescription('The amount of ads to log.')
        .setRequired(true)
        .setMinValue(1)
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    await interaction.deferReply({ ephemeral: true });
    await processAdsSubmission(interaction, amount);
  }
};
