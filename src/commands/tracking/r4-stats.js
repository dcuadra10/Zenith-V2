const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getDb } = require('../../config/database');
const { getISOWeekString } = require('../../utils/dateHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('r4-stats')
        .setDescription('Check your current weekly progress for R4 quotas (Ads and Messages).'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

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
            return interaction.editReply('❌ You do not have the required officer role to participate in R4 Tracking.');
        }

        const weekId = getISOWeekString();
        const record = await db.get(`SELECT * FROM r4_tracking WHERE guildId = ? AND userId = ? AND weekId = ?`, [interaction.guild.id, interaction.user.id, weekId]);
        const excuse = await db.get(`SELECT startWeekId, durationWeeks, excuseReason FROM r4_excuses WHERE userId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
        const { isWeekWithinExcuse } = require('../../utils/dateHelpers');

        const ads = record ? record.ads : 0;
        const msgs = record ? record.messages : 0;
        let excused = record ? record.excused === 1 : false;

        if (excuse) {
            const excuseCheck = isWeekWithinExcuse(excuse.startWeekId, excuse.durationWeeks, weekId);
            if (excuseCheck.excused) {
                excused = true;
            }
        }

        const adQuota = conf.r4trackingadquota || 40;
        const msgQuota = conf.r4trackingmsgquota || 245;

        const adPct = (ads / adQuota) * 100;
        const msgPct = (msgs / msgQuota) * 100;
        const totalPct = Math.min(Math.round(adPct + msgPct), 200);

        let statusText = '⚠️ **Failing**';
        let color = 'Red';
        if (excused) {
            statusText = '🛡️ **Excused**';
            color = 'Blue';
        } else if (totalPct >= 100) {
            statusText = '✅ **Passed**';
            color = 'Green';
        } else if (totalPct >= 75) {
            statusText = '⚠️ **Warning (Near Passing)**';
            color = 'Orange';
        }

        const embed = new EmbedBuilder()
             .setTitle(`🎯 R4 Weekly Progress: ${weekId}`)
             .setColor(color)
             .setDescription(`Here is your current progress towards the weekly activity quotas.\n\n**Status:** ${statusText}\n**Total Completion:** \`${totalPct}%\` / 100%`)
             .addFields(
                 { name: '📊 Ads Logged', value: `${ads} / ${adQuota} \`(${Math.round(adPct)}%)\``, inline: true },
                 { name: '💬 Messages Sent', value: `${msgs} / ${msgQuota} \`(${Math.round(msgPct)}%)\``, inline: true }
             );

        // Fetch History
        const history = await db.all(`SELECT weekId, ads, messages, excused FROM r4_tracking WHERE guildId = ? AND userId = ? AND weekId != ? ORDER BY weekId DESC LIMIT 4`, [interaction.guild.id, interaction.user.id, weekId]);
        
        if (history.length > 0) {
            let historyText = history.map(h => {
                const hAdPct = (h.ads / adQuota) * 100;
                const hMsgPct = (h.messages / msgQuota) * 100;
                const hTotal = Math.min(Math.round(hAdPct + hMsgPct), 200);
                
                let hExcused = h.excused === 1;
                if (excuse) {
                    const excuseCheck = isWeekWithinExcuse(excuse.startWeekId, excuse.durationWeeks, h.weekId);
                    if (excuseCheck.excused) {
                        hExcused = true;
                    }
                }
                
                const hIcon = hExcused ? '🛡️' : (hTotal >= 100 ? '✅' : (hTotal >= 75 ? '⚠️' : '❌'));
                return `**${h.weekId}**: ${hIcon} Ads: ${h.ads} | Msgs: ${h.messages} (${hTotal}%)`;
            }).join('\n');
            embed.addFields({ name: '📜 Past Performance History', value: historyText, inline: false });
        } else {
            embed.addFields({ name: '📜 Past Performance History', value: '*No previous week data found.*', inline: false });
        }

        embed.setFooter({ text: 'Quotas are combined. You can compensate one with the other.' });

        const imagePath = path.join(__dirname, '..', '..', '..', 'zenith_bg - Copy.png');
        const attachment = new AttachmentBuilder(imagePath, { name: 'zenith_bg.png' });
        embed.setImage('attachment://zenith_bg.png');

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    }
};
