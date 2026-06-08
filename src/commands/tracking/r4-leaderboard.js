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
        const rawConf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);

        if (!rawConf) {
            return interaction.editReply('❌ The R4 Tracking module is currently disabled for this server.');
        }

        const conf = Object.keys(rawConf).reduce((acc, key) => {
            acc[key.toLowerCase()] = rawConf[key];
            return acc;
        }, {});

        if (!conf.r4trackingenabled) {
            return interaction.editReply('❌ The R4 Tracking module is currently disabled for this server.');
        }

        const roleId = conf.r4trackingrole ? conf.r4trackingrole.replace(/[^0-9]/g, '') : null;
        if (roleId && !interaction.member.roles.cache.has(roleId)) {
            return interaction.editReply('❌ You do not have the required officer role to view the R4 Tracking Leaderboard.');
        }

        const weekId = getISOWeekString();
        const records = await db.all(`SELECT userId, ads, messages, excused FROM r4_tracking WHERE guildId = ? AND weekId = ?`, [interaction.guild.id, weekId]);
        const excuses = await db.all(`SELECT userId, startWeekId, durationWeeks FROM r4_excuses WHERE guildId = ?`, [interaction.guild.id]);
        const excusesMap = new Map();
        excuses.forEach(e => excusesMap.set(e.userId, e));

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

        const adQuota = conf.r4trackingadquota || 40;
        const msgQuota = conf.r4trackingmsgquota || 245;

        // Calculate progress percentage and sort
        const { isWeekWithinExcuse } = require('../../utils/dateHelpers');
        const leaderboard = finalRecords.map(r => {
            const adPct = (r.ads / adQuota) * 100;
            const msgPct = (r.messages / msgQuota) * 100;
            const totalPct = Math.min(Math.round(adPct + msgPct), 200);

            const excuse = excusesMap.get(r.userId);
            let isExcused = r.excused === 1;
            if (excuse) {
                const excuseCheck = isWeekWithinExcuse(excuse.startWeekId, excuse.durationWeeks, weekId);
                if (excuseCheck.excused) {
                    isExcused = true;
                }
            }

            return { ...r, totalPct, isExcused };
        }).sort((a, b) => b.totalPct - a.totalPct).slice(0, 15);

        const entries = [];
        for (let i = 0; i < leaderboard.length; i++) {
            const r = leaderboard[i];
            let name = `User ${r.userId.slice(-4)}`;
            try {
                const member = await interaction.guild.members.fetch(r.userId).catch(() => null);
                if (member) name = member.displayName || member.user.username;
            } catch (e) {}

            const icon = r.isExcused ? '🛡️' : (r.totalPct >= 100 ? '✅' : (r.totalPct >= 75 ? '⚠️' : '❌'));
            entries.push({
                name: `${name} ${icon}`,
                value: `${r.totalPct}% (Ads: ${r.ads}/${adQuota} | Msgs: ${r.messages}/${msgQuota})`
            });
        }

        const { generateLeaderboardImage } = require('../../utils/imageGenerator');
        const imagePath = path.join(__dirname, '..', '..', '..', 'zenith_bg - Copy.png');
        const buffer = await generateLeaderboardImage(`🏆  R4 Activity Leaderboard (${weekId})`, entries, imagePath);
        const attachment = new AttachmentBuilder(buffer, { name: 'r4_leaderboard.png' });

        await interaction.editReply({ files: [attachment] });
    }
};
