const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { removeBalance, addBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stocks')
        .setDescription('Trade shares of city enterprises')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all businesses available for public investment'))
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Buy shares of a city enterprise')
                .addStringOption(opt => opt.setName('mafia').setDescription('Name or ID of the organization').setRequired(true))
                .addStringOption(opt => opt.setName('type').setDescription('Enterprise type').setRequired(true).addChoices(
                    { name: 'Nightclub', value: 'nightclub' },
                    { name: 'Underground Lab', value: 'lab' },
                    { name: 'Money Printing', value: 'cash' }
                ))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Number of shares to buy').setRequired(true).setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('portfolio')
                .setDescription('View your current enterprise investments')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        if (sub === 'list') {
            const publicBusinesses = await db.all(`
                SELECT b.*, m.name as mafiaName 
                FROM mafia_businesses b 
                JOIN economy_mafias m ON b.mafiaId = m.id 
                WHERE b.publicShares > 0
            `);

            if (publicBusinesses.length === 0) {
                return await interaction.editReply({ content: '🏙️ No enterprises are currently listed on the official stock market.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('📈 Zenith Stock Exchange: Enterprise Index')
                .setDescription('Invest in the growth of our city\'s premier enterprises. Shareholders receive quarterly dividends based on operational success.')
                .setColor('#f59e0b');

            for (const b of publicBusinesses) {
                embed.addFields({
                    name: `${b.mafiaName} — ${b.type.toUpperCase()}`,
                    value: `💰 Share Price: ${b.sharePrice} 🪙\n📊 Avail. Shares: ${b.publicShares}\n🆔 Enterprise ID: \`${b.mafiaId}\``,
                    inline: true
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'buy') {
            const mafiaInput = interaction.options.getString('mafia');
            const type = interaction.options.getString('type');
            const amount = interaction.options.getInteger('amount');

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ? OR name = ?`, [mafiaInput, mafiaInput]);
            if (!mafia) return await interaction.editReply({ content: '❌ Enterprise not found!' });

            const b = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [mafia.id, type]);
            if (!b || b.publicShares < amount) {
                return await interaction.editReply({ content: '❌ This enterprise does not have enough shares available for purchase!' });
            }

            const totalCost = b.sharePrice * amount;
            const success = await removeBalance(interaction.user.id, totalCost, interaction.guild.id, `Purchased ${amount} shares of ${mafia.name} (${type})`);
            if (!success) return await interaction.editReply({ content: `❌ You need **${totalCost}** coins to buy ${amount} shares!` });

            // Move funds to Mafia Vault (Capital Injection)
            await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [totalCost, mafia.id]);

            // Update shares
            await db.run(`UPDATE mafia_businesses SET publicShares = publicShares - ? WHERE mafiaId = ? AND type = ?`, [amount, mafia.id, type]);
            
            // Register holder
            const existing = await db.get(`SELECT * FROM mafia_stocks WHERE userId = ? AND mafiaId = ? AND businessType = ?`, [interaction.user.id, mafia.id, type]);
            if (existing) {
                await db.run(`UPDATE mafia_stocks SET shares = shares + ? WHERE userId = ? AND mafiaId = ? AND businessType = ?`, [amount, interaction.user.id, mafia.id, type]);
            } else {
                await db.run(`INSERT INTO mafia_stocks (mafiaId, businessType, userId, shares) VALUES (?, ?, ?, ?)`, [mafia.id, type, interaction.user.id, amount]);
            }

            return await interaction.editReply({ 
                content: `✅ **Investment Successful!** You now own **${amount}** shares of ${mafia.name}'s ${type}. You will receive dividends automatically!` 
            });
        }

        if (sub === 'portfolio') {
            const stocks = await db.all(`
                SELECT s.*, m.name as mafiaName, b.sharePrice
                FROM mafia_stocks s
                JOIN economy_mafias m ON s.mafiaId = m.id
                JOIN mafia_businesses b ON s.mafiaId = b.mafiaId AND s.businessType = b.type
                WHERE s.userId = ?
            `, [interaction.user.id]);

            if (stocks.length === 0) return await interaction.editReply({ content: '❌ You don\'t own any enterprise shares yet!' });

            const embed = new EmbedBuilder()
                .setTitle(`📊 Official Portfolio: ${interaction.user.username}`)
                .setColor('#6366f1');

            for (const s of stocks) {
                embed.addFields({
                    name: `${s.mafiaName} — ${s.businessType.toUpperCase()}`,
                    value: `📈 Shares: ${s.shares}\n💰 Current Value: ${s.shares * s.sharePrice} 🪙`,
                    inline: true
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }
    }
};
