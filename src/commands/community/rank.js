const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const canvacord = require('canvacord');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../../config/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Displays the rank card for you or another user.')
    .addUserOption(option => 
        option.setName('user')
            .setDescription('User to view their rank.')),
            
  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') || interaction.user;
    
    if (target.bot) return interaction.editReply('Bots do not have a rank.');

    const db = await getDb();
    const userProfile = await db.get(`SELECT * FROM users WHERE userId = ?`, [target.id]);
    if (!userProfile) return interaction.editReply(`${target.username} currently has no XP.`);

    const levelValue = Number(userProfile.level) || 0;
    const xpValue = Number(userProfile.xp) || 0;
    const requiredXP = 5 * (levelValue ** 2) + 50 * levelValue + 100;

    const rankRow = await db.get(
        `SELECT COUNT(*) AS higherrank FROM users WHERE (level > ?) OR (level = ? AND xp > ?)`,
        [levelValue, levelValue, xpValue]
    );
    const higherRankCount = Number(rankRow?.higherrank || 0);
    const rankPosition = higherRankCount + 1;

    const imagePath = path.resolve(__dirname, '../../zenith_bg - Copy.png');
    const hasBackground = fs.existsSync(imagePath);

    canvacord.Font.loadDefault();
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const status = member?.presence?.status || 'offline';

    const rank = new canvacord.RankCardBuilder()
        .setAvatar(target.displayAvatarURL({ forceStatic: true, extension: 'png' }))
        .setCurrentXP(xpValue)
        .setRequiredXP(requiredXP)
        .setStatus(status)
        .setUsername(target.username)
        .setDisplayName(target.globalName || target.username)
        .setLevel(levelValue)
        .setRank(rankPosition);

    if (hasBackground) {
        rank.setBackground(imagePath);
    } else {
        rank.setBackground('#23272A');
    }

    rank.build()
        .then(async data => {
            const attachment = new AttachmentBuilder(data, { name: 'rank.png' });
            const payload = { files: [attachment] };
            interaction.editReply(payload);
        })
        .catch(err => {
            console.error(err);
            interaction.editReply('There was an error building your rank card.');
        });
  }
};
