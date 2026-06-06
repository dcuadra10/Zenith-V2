const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addBalance, removeBalance, logEconomyEvent } = require('../../utils/economyHandler');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('eco-admin')
        .setDescription('Economy administrative commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => 
            sub.setName('give')
                .setDescription('Give coins to a user')
                .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of coins').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => 
            sub.setName('take')
                .setDescription('Take coins from a user')
                .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of coins').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => 
            sub.setName('shop-add')
                .setDescription('Add an item to the shop')
                .addStringOption(opt => opt.setName('name').setDescription('Item name').setRequired(true))
                .addIntegerOption(opt => opt.setName('price').setDescription('Price').setRequired(true).setMinValue(0))
                .addStringOption(opt => opt.setName('description').setDescription('Item description').setRequired(true))
                .addStringOption(opt => opt.setName('type')
                    .setDescription('Item type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Role', value: 'role' },
                        { name: 'Item', value: 'item' }
                    ))
                .addRoleOption(opt => opt.setName('role').setDescription('Role to grant (required if type is Role)')))
        .addSubcommand(sub => 
            sub.setName('shop-remove')
                .setDescription('Remove an item from the shop')
                .addStringOption(opt => opt.setName('item_id').setDescription('ID of the item to remove').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('mafia-add')
                .setDescription('Add coins to a mafia treasury')
                .addStringOption(opt => opt.setName('id').setDescription('Mafia ID').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1))),
    
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        if (sub === 'give') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const newBal = await addBalance(user.id, amount, interaction.guild.id, true, `Admin Give by ${interaction.user.tag}`, true);
            return await interaction.reply({ content: `✅ Gave **${amount}** coins to <@${user.id}>. New balance: **${newBal}**.` });
        }

        if (sub === 'take') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const success = await removeBalance(user.id, amount, interaction.guild.id, `Admin Take by ${interaction.user.tag}`);
            if (!success) return await interaction.reply({ content: `❌ User does not have enough coins to take **${amount}**.`, ephemeral: true });
            return await interaction.reply({ content: `✅ Took **${amount}** coins from <@${user.id}>.` });
        }

        if (sub === 'shop-add') {
            const name = interaction.options.getString('name');
            const price = interaction.options.getInteger('price');
            const desc = interaction.options.getString('description');
            const type = interaction.options.getString('type');
            const role = interaction.options.getRole('role');

            if (type === 'role' && !role) {
                return await interaction.reply({ content: '❌ You must specify a role when the type is "Role".', ephemeral: true });
            }

            const id = Math.random().toString(36).substring(2, 8).toUpperCase();
            await db.run(
                `INSERT INTO economy_shop (id, guildId, name, description, price, type, roleId) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, interaction.guild.id, name, desc, price, type, role ? role.id : null]
            );

            return await interaction.reply({ content: `✅ Added **${name}** to the shop with ID: \`${id}\`.` });
        }

        if (sub === 'shop-remove') {
            const itemId = interaction.options.getString('item_id');
            const res = await db.run(`DELETE FROM economy_shop WHERE id = ? AND guildId = ?`, [itemId, interaction.guild.id]);
            if (res.changes === 0) return await interaction.reply({ content: '❌ Item not found.', ephemeral: true });
            return await interaction.reply({ content: `✅ Removed item \`${itemId}\` from the shop.` });
        }

        if (sub === 'mafia-add') {
            const id = interaction.options.getString('id');
            const amount = interaction.options.getInteger('amount');
            const mafia = await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [id]);
            if (!mafia) return await interaction.reply({ content: '❌ Mafia not found.', ephemeral: true });

            await db.run(`UPDATE economy_mafias SET balance = balance + ? WHERE id = ?`, [amount, id]);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, amount, 'mafia_treasury_deposit', {
                mafiaId: id,
                mafiaName: mafia.name,
                reason: `Admin Addition by ${interaction.user.tag}`
            });
            return await interaction.reply({ content: `✅ Added **${amount}** coins to the **${mafia.name}** treasury.` });
        }
    },
};
