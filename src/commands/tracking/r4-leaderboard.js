const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getDb } = require('../../config/database');
const { getISOWeekString } = require('../../utils/dateHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('r4-leaderboard')
        .setDescription('Shows the R4 Activity Tracking Leaderboard for the current week.'),
    async execute(interaction) {
        await interaction.deferReply();

        const db = await getDb();
        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);

        if (!conf || !conf.r4TrackingEnabled) {
            return interaction.editReply('❌ The R4 Tracking module is currently disabled for this server.');
        }

        const roleId = conf.r4TrackingRole ? conf.r4TrackingRole.replace(/[^0-9]/g, '') : null;
        if (roleId && !interaction.member.roles.cache.has(roleId)) {
            return interaction.editReply('❌ You do not have the required officer role to view the R4 Tracking Leaderboard.');
        }

        const weekId = getISOWeekString();
        const records = await db.all(`SELECT userId, ads, messages, excused FROM r4_tracking WHERE guildId = ? AND weekId = ?`, [interaction.guild.id, weekId]);

        // Fetch all current guild members to ensure hot cache and identify officers
        const officerIds = new Set();
        if (roleId) {
            try {
                await interaction.guild.members.fetch();
                interaction.guild.members.cache.forEach(m => {
                    if (m.roles.cache.has(roleId)) {
                        officerIds.add(m.id);
                    }
                });
            } catch (err) {
                console.error('[Command] Error fetching guild members:', err);
            }
        }

        const recordsMap = new Map();
        records.forEach(r => recordsMap.set(r.userId, r));

        const finalRecords = [];
        
        // Ensure every active officer has a baseline record for this week
        officerIds.forEach(officerId => {
            if (recordsMap.has(officerId)) {
                finalRecords.push(recordsMap.get(officerId));
            } else {
                finalRecords.push({
                    userId: officerId,
                    ads: 0,
                    messages: 0,
                    excused: 0
                });
            }
        });

        // Add any non-officer who has historical data for this week
        records.forEach(r => {
            if (!officerIds.has(r.userId)) {
                finalRecords.push(r);
            }
        });

        if (finalRecords.length === 0) {
            return interaction.editReply(`No R4 activity recorded yet for the current week (${weekId}).`);
        }

        const adQuota = conf.r4TrackingAdQuota || 40;
        const msgQuota = conf.r4TrackingMsgQuota || 245;

        // Calculate progress percentage and sort
        const leaderboard = finalRecords.map(r => {
            const adPct = (r.ads / adQuota) * 100;
            const msgPct = (r.messages / msgQuota) * 100;
            const totalPct = Math.min(Math.round(adPct + msgPct), 200);
            return { ...r, totalPct };
        }).sort((a, b) => b.totalPct - a.totalPct).slice(0, 15);

        const embed = new EmbedBuilder()
            .setTitle(`🏆 R4 Activity Leaderboard (${weekId})`)
            .setColor('#FFD700')
            .setDescription(`Here are the top performing R4s for the current week based on their overall quota completion.`)
            .setThumbnail(interaction.guild.iconURL());

        let rankText = '';
        for (let i = 0; i < leaderboard.length; i++) {
            const r = leaderboard[i];
            const icon = r.excused ? '🛡️' : (r.totalPct >= 100 ? '✅' : (r.totalPct >= 75 ? '⚠️' : '❌'));
            const rankEmoji = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `**${i + 1}.**`));
            rankText += `${rankEmoji} <@${r.userId}> — **${r.totalPct}%** ${icon}\n└ Ads: ${r.ads} | Msgs: ${r.messages}\n\n`;
        }

        embed.addFields({ name: 'Leaderboard', value: rankText || 'No data.', inline: false });
        embed.setFooter({ text: `Quotas: ${adQuota} Ads, ${msgQuota} Msgs` });

        const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');
        const attachment = new AttachmentBuilder(imagePath, { name: 'zenith_bg.png' });
        embed.setImage('attachment://zenith_bg.png');

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    }
};
