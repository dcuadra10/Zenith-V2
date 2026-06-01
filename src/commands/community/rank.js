const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const canvacord = require('canvacord');
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

    const requiredXP = 5 * (userProfile.level ** 2) + 50 * userProfile.level + 100;

    const rankRow = await db.get(
        `SELECT COUNT(*) AS higherRank FROM users WHERE (level > ?) OR (level = ? AND xp > ?)`,
        [userProfile.level, userProfile.level, userProfile.xp]
    );
    const rankPosition = (rankRow?.higherRank || 0) + 1;

    const path = require('path');
    const imagePath = path.join(__dirname, '../../zenith_bg - Copy.png');

    canvacord.Font.loadDefault();
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const status = member?.presence?.status || 'offline';

    const rank = new canvacord.RankCardBuilder()
        .setBackground(imagePath)
        .setAvatar(target.displayAvatarURL({ forceStatic: true, extension: 'png' }))
        .setCurrentXP(userProfile.xp)
        .setRequiredXP(requiredXP)
        .setStatus(status)
        .setUsername(target.username)
        .setDisplayName(target.globalName || target.username)
        .setLevel(userProfile.level)
        .setRank(rankPosition);

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
