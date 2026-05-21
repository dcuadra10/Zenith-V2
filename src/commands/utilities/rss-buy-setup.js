const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rss-buy-setup')
        .setDescription('Set up the RSS Buying panel in the current channel (Admins only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const db = await getDb();
        const config = await db.get(`SELECT rssEnabled FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        if (!config || !config.rssEnabled) {
            return interaction.reply({ content: '❌ The RSS Buying module is currently disabled. Please enable it in the dashboard first.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🌾 Alliance Resource Purchase')
            .setDescription('Welcome to the **Official Resource Purchase Market**!\n\nBuy resources (Food, Wood, Stone, Gold) securely from our verified RSS Sellers.\n\nClick the button below to select a seller, submit your desired amounts, and open a private trade ticket.')
            .setColor('#10b981');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rss_buy_start')
                .setLabel('Buy RSS')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ RSS Buying panel created successfully!', ephemeral: true });
    },
};
