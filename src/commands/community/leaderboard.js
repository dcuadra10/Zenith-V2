const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Displays the top 10 users by XP.'),
            
  async execute(interaction) {
    await interaction.deferReply();
    const db = await getDb();
    
    const topUsers = await db.all(`SELECT userId, xp, level FROM users ORDER BY level DESC, xp DESC LIMIT 10`);
    const conf = await db.get(`SELECT levelingBackground, leaderboardImageEnabled FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
    
    const defaultBgPath = path.join(process.cwd(), 'zenith_bg - Copy.png');
    const background = conf?.levelingBackground || null;
    const useImage = conf?.leaderboardImageEnabled ? true : false;

    // --- IMAGE MODE: Leaderboard baked into a canvas image ---
    if (useImage) {
        const { generateLeaderboardImage } = require('../../utils/imageGenerator');

        // Resolve usernames for display
        const entries = [];
        for (const u of topUsers) {
            let name = `User ${u.userId.slice(-4)}`;
            try {
                const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                if (member) name = member.displayName || member.user.username;
            } catch (e) {}
            entries.push({ name, value: `Lv.${u.level}  •  ${u.xp} XP` });
        }

        const bgPath = background || defaultBgPath;
        const buffer = await generateLeaderboardImage('🏆  Zenith Leaderboard', entries, bgPath);
        const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
        return interaction.editReply({ files: [attachment] });
    }

    // --- CLASSIC MODE: Text embed with background image below ---
    const files = [];
    let imageUrl = background;

    if (!background) {
        const attachment = new AttachmentBuilder(defaultBgPath, { name: 'leaderboard_bg.png' });
        files.push(attachment);
        imageUrl = 'attachment://leaderboard_bg.png';
    }

    const embed = new EmbedBuilder()
        .setTitle('🏆 Zenith Leaderboard')
        .setColor('#FFD700')
        .setThumbnail(interaction.guild.iconURL())
        .setImage(imageUrl)
        .setDescription(topUsers.length > 0 
            ? topUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> - Level **${u.level}** (${u.xp} XP)`).join('\n')
            : 'No users found in the leaderboard.');

    interaction.editReply({ embeds: [embed], files });
  }
};
