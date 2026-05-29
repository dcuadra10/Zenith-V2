const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getDb } = require('../../config/database');
const { getISOWeekString } = require('../../utils/dateHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-ads-panel')
    .setDescription('Spawns the interactive Ads Tracking panel and Leaderboard.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const db = await getDb();
    const conf = await db.get(`SELECT leaderboardImageEnabled FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
    const useImage = conf?.leaderboardImageEnabled ? true : false;

    const topUsers = await db.all(`SELECT userId, SUM(ads) as totalAds FROM r4_tracking WHERE guildId = ? GROUP BY userId ORDER BY totalAds DESC LIMIT 10`, [interaction.guild.id]);
    
    const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');
    const files = [];
    let leaderboardEmbed = null;

    if (useImage) {
        // --- IMAGE MODE: Leaderboard baked into canvas ---
        const { generateLeaderboardImage } = require('../../utils/imageGenerator');

        const entries = [];
        for (const u of topUsers) {
            let name = `User ${u.userId.slice(-4)}`;
            try {
                const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                if (member) name = member.displayName || member.user.username;
            } catch (e) {}
            entries.push({ name, value: `${u.totalAds} ads` });
        }

        const buffer = await generateLeaderboardImage('🏆  Leaderboard of the Week', entries, imagePath);
        const imgAttachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
        files.push(imgAttachment);

        leaderboardEmbed = new EmbedBuilder()
            .setTitle('🏆 Top Ad Publishers')
            .setColor('#FFD700')
            .setImage('attachment://leaderboard.png');
    } else {
        // --- CLASSIC MODE: Text embed ---
        leaderboardEmbed = new EmbedBuilder()
            .setTitle('🏆 Top Ad Publishers')
            .setColor('#FFD700');

        if (!topUsers || topUsers.length === 0) {
            leaderboardEmbed.setDescription('🏆 **Leaderboard of the Week**\n\n*The board is currently vacant. Be the first to register an ad and secure the top spot!*');
        } else {
            let desc = '🏆 **Leaderboard of the Week**\n\n';
            topUsers.forEach((u, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅';
                desc += `${medal} <@${u.userId}> ── **${u.totalAds}** ads\n`;
            });
            leaderboardEmbed.setDescription(desc);
        }

        const attachment = new AttachmentBuilder(imagePath, { name: 'zenith_bg.png' });
        files.push(attachment);
        leaderboardEmbed.setThumbnail('attachment://zenith_bg.png');
    }

    const currentWeekId = getISOWeekString();

    const embed = new EmbedBuilder()
      .setTitle('📊 Ad Tracking Center')
      .setDescription(
        'Welcome to the **Zenith Tracking Center**.\n\n' +
        'Click the **Register Ads** button below to log your completed ads. Submissions are processed, archived in our **Google Sheets**, and queued for leadership evaluation.\n\n' +
        '**Guidelines:**\n' +
        '• Submissions must be genuine.\n' +
        '• Progress is dynamically counted towards your weekly R4 quota.'
      )
      .addFields(
        { name: '⚡ Status', value: '🟢 Active & Syncing', inline: true },
        { name: '📅 Current Week', value: `\`${currentWeekId}\``, inline: true },
        { name: '🎯 Weekly Target', value: '`40 Ads / Officer`', inline: true }
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Zenith Global Tracking Systems' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('btn_register_ads')
          .setLabel('Register Ads')
          .setEmoji('➕')
          .setStyle(ButtonStyle.Primary),
      );

    const payload = { embeds: [leaderboardEmbed, embed], components: [row], files };
    await interaction.channel.send(payload);
    await interaction.reply({ content: 'Panel deployed successfully.', ephemeral: true });
  }
};
