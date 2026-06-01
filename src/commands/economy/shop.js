const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View items available for purchase'),
    async execute(interaction) {
        const db = await getDb();
        const items = await db.all(`SELECT * FROM economy_shop WHERE guildId = ?`, [interaction.guild.id]);

        const embed = new EmbedBuilder()
            .setTitle('<:zenith_shop:1510658653567324344> Server Shop')
            .setDescription(items.length > 0 ? 'Use `/buy <item_id>` to purchase an item.' : 'The shop is currently empty.')
            .setColor('#10b981')
            .setTimestamp();

        if (items.length > 0) {
            items.forEach(item => {
                embed.addFields({ 
                    name: `${item.name} (ID: ${item.id})`, 
                    value: `💰 **Price:** ${item.price} coins\n📝 ${item.description || 'No description provided.'}`
                });
            });
        }

        await interaction.reply({ embeds: [embed] });
    },
};
