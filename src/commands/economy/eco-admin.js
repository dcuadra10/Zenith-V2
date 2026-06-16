const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addBalance, removeBalance, logEconomyEvent } = require('../../utils/economyHandler');
const { getDb } = require('../../config/database');

// The ONLY user who can use eco-admin commands
const ECONOMY_ADMIN_ID = '1211770249200795734';

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
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('⚠️ RESET all economy data for this server (IRREVERSIBLE)')),
    
    async execute(interaction) {
        // ===== HARD LOCK: Only the designated admin can use ANY eco-admin command =====
        if (interaction.user.id !== ECONOMY_ADMIN_ID) {
            return await interaction.reply({ 
                content: '🚫 **Access Denied.** You are not authorized to use economy admin commands.', 
                ephemeral: true 
            });
        }

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
            const mafia = await db.get(`SELECT name FROM economy_mafias WHERE id = ? AND guildId = ?`, [id, interaction.guild.id]);
            if (!mafia) return await interaction.reply({ content: '❌ Mafia not found.', ephemeral: true });

            await db.run(`UPDATE economy_mafias SET balance = balance + ? WHERE id = ? AND guildId = ?`, [amount, id, interaction.guild.id]);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, amount, 'mafia_treasury_deposit', {
                mafiaId: id,
                mafiaName: mafia.name,
                reason: `Admin Addition by ${interaction.user.tag}`
            });
            return await interaction.reply({ content: `✅ Added **${amount}** coins to the **${mafia.name}** treasury.` });
        }

        if (sub === 'reset') {
            // Confirmation step — require button click to proceed
            const confirmEmbed = new EmbedBuilder()
                .setTitle('⚠️ ECONOMY RESET — CONFIRMATION REQUIRED')
                .setDescription(
                    `**This will permanently delete ALL economy data for this server.**\n\n` +
                    `The following data will be **wiped**:\n` +
                    `• 💰 All user balances, bank savings, and bank capacity\n` +
                    `• 🏢 All businesses (legal operations)\n` +
                    `• 🏦 All private banks (player-founded)\n` +
                    `• 🎭 All mafias, mafia members, and mafia businesses\n` +
                    `• 📊 All stocks and influence investments\n` +
                    `• 🛒 All shop items and inventory\n` +
                    `• 👔 All job assignments and work experience\n` +
                    `• ⛓️ All jail sentences\n\n` +
                    `**This action is IRREVERSIBLE.** Are you absolutely sure?`
                )
                .setColor('#ef4444')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('eco_reset_confirm')
                    .setLabel('🔴 CONFIRM RESET')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('eco_reset_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

            const msg = await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true, fetchReply: true });

            const filter = i => i.user.id === ECONOMY_ADMIN_ID && (i.customId === 'eco_reset_confirm' || i.customId === 'eco_reset_cancel');

            try {
                const confirmation = await msg.awaitMessageComponent({ filter, time: 30000 });

                if (confirmation.customId === 'eco_reset_cancel') {
                    return await confirmation.update({ content: '❎ Economy reset **cancelled**.', embeds: [], components: [] });
                }

                // === PERFORM THE RESET ===
                await confirmation.update({ content: '⏳ **Resetting economy data...** Please wait.', embeds: [], components: [] });

                const guildId = interaction.guild.id;

                // Reset economy columns on users table (keep xp, level, invites, partnerId intact)
                await db.run(
                    `UPDATE users SET balance = 0, bank = 0, bankCapacity = 5000, bankId = 'standard', jobId = NULL, lastWork = NULL, mafiaId = NULL, dirtyMoney = 0, jailUntil = NULL, reputation = 0, workplaceId = NULL, workExperience = 0 WHERE guildId = ?`,
                    [guildId]
                );

                // Delete all economy-specific tables for this guild
                await db.run(`DELETE FROM economy_shop WHERE guildId = ?`, [guildId]);
                await db.run(`DELETE FROM economy_inventory WHERE guildId = ?`, [guildId]);
                await db.run(`DELETE FROM economy_operations WHERE guildId = ?`, [guildId]);

                // Delete mafias and related data
                const mafias = await db.all(`SELECT id FROM economy_mafias WHERE guildId = ?`, [guildId]);
                for (const mafia of mafias) {
                    await db.run(`DELETE FROM mafia_members WHERE mafiaId = ?`, [mafia.id]);
                    await db.run(`DELETE FROM mafia_businesses WHERE mafiaId = ?`, [mafia.id]);
                    await db.run(`DELETE FROM mafia_stocks WHERE mafiaId = ?`, [mafia.id]);
                }
                await db.run(`DELETE FROM economy_mafias WHERE guildId = ?`, [guildId]);

                // Delete turfs
                await db.run(`DELETE FROM economy_turfs WHERE guildId = ?`, [guildId]);

                // Delete influence data
                await db.run(`DELETE FROM economy_influence WHERE guildId = ?`, [guildId]);
                await db.run(`DELETE FROM economy_entity_influence WHERE guildId = ?`, [guildId]);

                // Delete private banks (keep seed banks: standard, zenith, royal)
                await db.run(`DELETE FROM economy_banks WHERE guildId = ? AND id NOT IN ('standard', 'zenith', 'royal')`, [guildId]);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Economy Reset Complete')
                    .setDescription(
                        `All economy data for **${interaction.guild.name}** has been permanently wiped.\n\n` +
                        `• User balances → **0**\n` +
                        `• Banks → **Standard (default)**\n` +
                        `• Businesses → **Deleted**\n` +
                        `• Mafias → **Dissolved**\n` +
                        `• Shop → **Empty**\n` +
                        `• Influence → **Reset**\n` +
                        `• Stocks → **Cleared**\n\n` +
                        `The economy starts fresh now.`
                    )
                    .setColor('#10b981')
                    .setFooter({ text: `Reset performed by ${interaction.user.tag}` })
                    .setTimestamp();

                return await interaction.editReply({ content: null, embeds: [successEmbed], components: [] });
            } catch (err) {
                // Timeout — no button clicked within 30s
                return await interaction.editReply({ content: '⏰ **Reset timed out.** No action taken.', embeds: [], components: [] });
            }
        }
    },
};
