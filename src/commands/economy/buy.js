const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { removeBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Purchase an item from the shop')
        .addStringOption(option => 
            option.setName('item_id')
                .setDescription('The ID of the item to buy')
                .setRequired(true)),
    async execute(interaction) {
        const itemId = interaction.options.getString('item_id');
        const db = await getDb();
        const item = await db.get(`SELECT * FROM economy_shop WHERE id = ? AND guildId = ?`, [itemId, interaction.guild.id]);

        if (!item) {
            return await interaction.reply({ content: '❌ Item not found. Check the ID using `/shop`.', ephemeral: true });
        }

        const success = await removeBalance(interaction.user.id, item.price, interaction.guild.id, `Purchased shop item: ${item.name}`);
        if (!success) {
            return await interaction.reply({ content: `❌ You don't have enough coins! You need **${item.price}** coins.`, ephemeral: true });
        }

        // Logic based on item type
        let extraInfo = '';
        if (item.type === 'role') {
            const role = interaction.guild.roles.cache.get(item.roleId);
            if (role) {
                await interaction.member.roles.add(role).catch(err => {
                    console.error('Error adding role:', err);
                    extraInfo = '\n⚠️ *Failed to add role. Please contact an admin.*';
                });
                extraInfo = extraInfo || `\n✅ You have been granted the **${role.name}** role!`;
            } else {
                extraInfo = '\n❌ *Role not found. Please contact an admin.*';
            }
        }

        // Record purchase in inventory
        await db.run(
            `INSERT INTO economy_inventory (userId, guildId, itemId) VALUES (?, ?, ?)`,
            [interaction.user.id, interaction.guild.id, item.id]
        );

        const embed = new EmbedBuilder()
            .setTitle('🛒 Purchase Successful!')
            .setDescription(`You bought **${item.name}** for **${item.price}** coins.${extraInfo}`)
            .setColor('#10b981')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
