const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');
const { parseRssAmount, formatRssAmount } = require('./rss-stock');

function hasOutstandingTaxes(sales) {
    return (sales.pendingTaxFood || 0) > 0 || 
           (sales.pendingTaxWood || 0) > 0 || 
           (sales.pendingTaxStone || 0) > 0 || 
           (sales.pendingTaxGold || 0) > 0;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rss-tax')
        .setDescription('Manage pending resource taxes owed by RSS Sellers (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View outstanding taxes for a targeted seller or a ledger of all sellers')
                .addUserOption(opt => opt.setName('seller').setDescription('Target RSS Seller (Optional)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('pay')
                .setDescription('Record resource tax payment for a seller (supports suffixes: 50M, 100k, all)')
                .addUserOption(opt => opt.setName('seller').setDescription('Target RSS Seller').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('resource')
                        .setDescription('The resource being paid')
                        .setRequired(true)
                        .addChoices(
                            { name: '🌾 Food', value: 'food' },
                            { name: '🪵 Wood', value: 'wood' },
                            { name: '🪨 Stone', value: 'stone' },
                            { name: '🪙 Gold', value: 'gold' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('amount')
                        .setDescription('Quantity to pay (e.g. 5M, 100k, or "all" / "todo")')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Wipe all outstanding tax debts for an RSS Seller to 0')
                .addUserOption(opt => opt.setName('seller').setDescription('Target RSS Seller').setRequired(true))
        ),

    async execute(interaction) {
        // Double-check permissions just in case
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({
                content: '❌ Only guild Administrators are authorized to run this command.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        if (sub === 'view') {
            const sellerUser = interaction.options.getUser('seller');

            if (sellerUser) {
                // View taxes for a single specific seller
                const sellerId = sellerUser.id;
                let sales = await db.get(
                    `SELECT pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold, totalTransactions 
                     FROM rss_seller_sales WHERE sellerId = ? AND guildId = ?`, 
                    [sellerId, interaction.guild.id]
                );

                if (!sales) {
                    sales = { pendingTaxFood: 0, pendingTaxWood: 0, pendingTaxStone: 0, pendingTaxGold: 0, totalTransactions: 0 };
                }

                const outstanding = hasOutstandingTaxes(sales);
                const embed = new EmbedBuilder()
                    .setTitle(`🧾 Outstanding Taxes: ${sellerUser.username}`)
                    .setDescription(`Pending taxes accumulated from completed trade tickets for <@${sellerId}>.`)
                    .addFields(
                        { name: '🌾 Food Tax', value: `**${formatRssAmount(sales.pendingTaxFood)}**`, inline: true },
                        { name: '🪵 Wood Tax', value: `**${formatRssAmount(sales.pendingTaxWood)}**`, inline: true },
                        { name: '🪨 Stone Tax', value: `**${formatRssAmount(sales.pendingTaxStone)}**`, inline: true },
                        { name: '🪙 Gold Tax', value: `**${formatRssAmount(sales.pendingTaxGold)}**`, inline: true },
                        { name: '📊 Total Completed Trades', value: `\`${sales.totalTransactions}\``, inline: true }
                    )
                    .setColor(outstanding ? '#eab308' : '#10b981')
                    .setThumbnail(sellerUser.displayAvatarURL())
                    .setTimestamp();

                return await interaction.reply({ embeds: [embed] });
            } else {
                // View guild-wide tax ledger of all sellers who owe any tax
                const allSales = await db.all(`
                    SELECT sellerId, pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold 
                    FROM rss_seller_sales 
                    WHERE (pendingTaxFood > 0 OR pendingTaxWood > 0 OR pendingTaxStone > 0 OR pendingTaxGold > 0) AND guildId = ?
                `, [interaction.guild.id]);

                if (allSales.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('🧾 Server Tax Ledger')
                        .setDescription('✨ No outstanding taxes due from any RSS Seller! All accounts are perfectly clear.')
                        .setColor('#10b981')
                        .setTimestamp();
                    return await interaction.reply({ embeds: [embed] });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🧾 Server Tax Ledger')
                    .setDescription('Below is a summary of verified RSS Sellers with outstanding tax balances.')
                    .setColor('#ef4444')
                    .setTimestamp();

                // Format list beautifully
                for (const row of allSales) {
                    let sellerName = `<@${row.sellerId}>`;
                    try {
                        const member = interaction.guild.members.cache.get(row.sellerId) || await interaction.guild.members.fetch(row.sellerId);
                        if (member) {
                            sellerName = `**${member.displayName}** (<@${row.sellerId}>)`;
                        }
                    } catch (e) {
                        // Keep mention if member fetch fails or isn't cached
                    }

                    const taxStr = `🌾 \`${formatRssAmount(row.pendingTaxFood)}\` | 🪵 \`${formatRssAmount(row.pendingTaxWood)}\` | 🪨 \`${formatRssAmount(row.pendingTaxStone)}\` | 🪙 \`${formatRssAmount(row.pendingTaxGold)}\``;
                    embed.addFields({ name: sellerName, value: taxStr, inline: false });
                }

                return await interaction.reply({ embeds: [embed] });
            }
        }

        if (sub === 'pay') {
            const sellerUser = interaction.options.getUser('seller');
            const resource = interaction.options.getString('resource'); // food, wood, stone, gold
            const amountInput = interaction.options.getString('amount').trim().toLowerCase();

            let sales = await db.get(
                `SELECT pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold FROM rss_seller_sales WHERE sellerId = ? AND guildId = ?`, 
                [sellerUser.id, interaction.guild.id]
            );

            if (!sales) {
                sales = { pendingTaxFood: 0, pendingTaxWood: 0, pendingTaxStone: 0, pendingTaxGold: 0 };
            }

            const colName = `pendingTax${resource.charAt(0).toUpperCase() + resource.slice(1)}`;
            const currentTax = sales[colName] || 0;

            let deductAmount = 0;
            if (amountInput === 'all' || amountInput === 'todo') {
                deductAmount = currentTax;
            } else {
                deductAmount = parseRssAmount(amountInput);
                if (deductAmount === null || isNaN(deductAmount) || deductAmount < 0) {
                    return await interaction.reply({
                        content: `❌ Invalid quantity! Use formats like \`50M\`, \`100k\`, \`50000000\`, or keywords like \`all\`/\`todo\`.`,
                        ephemeral: true
                    });
                }
            }

            if (deductAmount === 0) {
                return await interaction.reply({
                    content: `❌ <@${sellerUser.id}> already has **0** outstanding tax for **${resource.toUpperCase()}**.`,
                    ephemeral: true
                });
            }

            const newTax = Math.max(0, currentTax - deductAmount);
            const actualPaid = currentTax - newTax;

            // Ensure sales record row exists before updating
            await db.run(`
                INSERT INTO rss_seller_sales (
                    sellerId, guildId, 
                    totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, 
                    totalTransactions,
                    pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                )
                VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                ON CONFLICT(sellerId, guildId) DO NOTHING
            `, [sellerUser.id, interaction.guild.id]);

            // Save the updated tax amount
            await db.run(
                `UPDATE rss_seller_sales SET ${colName} = ? WHERE sellerId = ? AND guildId = ?`,
                [newTax, sellerUser.id, interaction.guild.id]
            );

            const resourceEmoji = {
                food: '🌾',
                wood: '🪵',
                stone: '🪨',
                gold: '🪙'
            }[resource];

            const embed = new EmbedBuilder()
                .setTitle('🧾 Tax Payment Recorded')
                .setDescription(`Successfully recorded a tax payment for <@${sellerUser.id}>.`)
                .addFields(
                    { name: '👤 Seller', value: `<@${sellerUser.id}>`, inline: true },
                    { name: '📦 Resource', value: `${resourceEmoji} **${resource.toUpperCase()}**`, inline: true },
                    { name: '💰 Paid Amount', value: `**${formatRssAmount(actualPaid)}**`, inline: true },
                    { name: '⏳ Remaining Tax Balance', value: `**${formatRssAmount(newTax)}**`, inline: false }
                )
                .setColor('#10b981')
                .setThumbnail(sellerUser.displayAvatarURL())
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }

        if (sub === 'clear') {
            const sellerUser = interaction.options.getUser('seller');

            // Insert placeholder if not exists to support the update
            await db.run(`
                INSERT INTO rss_seller_sales (
                    sellerId, guildId, 
                    totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, 
                    totalTransactions,
                    pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                )
                VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                ON CONFLICT(sellerId, guildId) DO NOTHING
            `, [sellerUser.id, interaction.guild.id]);

            await db.run(`
                UPDATE rss_seller_sales SET 
                    pendingTaxFood = 0,
                    pendingTaxWood = 0,
                    pendingTaxStone = 0,
                    pendingTaxGold = 0
                WHERE sellerId = ? AND guildId = ?
            `, [sellerUser.id, interaction.guild.id]);

            const embed = new EmbedBuilder()
                .setTitle('🧾 All Taxes Cleared')
                .setDescription(`Wiped all outstanding resource tax debts for <@${sellerUser.id}> to **0**.`)
                .addFields(
                    { name: '👤 Seller', value: `<@${sellerUser.id}>`, inline: true },
                    { name: '🌾 Food Tax', value: '`0`', inline: true },
                    { name: '🪵 Wood Tax', value: '`0`', inline: true },
                    { name: '🪨 Stone Tax', value: '`0`', inline: true },
                    { name: '🪙 Gold Tax', value: '`0`', inline: true }
                )
                .setColor('#10b981')
                .setThumbnail(sellerUser.displayAvatarURL())
                .setTimestamp();

            return await interaction.reply({ embeds: [embed] });
        }
    }
};
