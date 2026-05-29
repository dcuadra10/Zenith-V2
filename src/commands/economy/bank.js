const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { removeBalance, addBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Manage your bank account')
        .addSubcommand(sub =>
            sub.setName('deposit')
                .setDescription('Deposit coins from your wallet into the bank')
                .addStringOption(opt => opt.setName('amount').setDescription('Amount to deposit (number or "all")').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('withdraw')
                .setDescription('Withdraw coins from the bank into your wallet')
                .addStringOption(opt => opt.setName('amount').setDescription('Amount to withdraw (number or "all")').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('upgrade')
                .setDescription('Upgrade your bank capacity'))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all available banks in the city'))
        .addSubcommand(sub =>
            sub.setName('switch')
                .setDescription('Switch to a different bank')
                .addStringOption(opt => opt.setName('bank').setDescription('ID or Name of the bank').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('found')
                .setDescription('Found your own private bank (Costs 500,000 coins)')
                .addStringOption(opt => opt.setName('name').setDescription('Name of your new bank').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('manage')
                .setDescription('Manage your private bank and buy upgrades')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const db = await getDb();
        const user = await db.get(`SELECT balance, bank, bankCapacity, bankId, level FROM users WHERE userId = ?`, [interaction.user.id]);
        
        if (!user) return await interaction.editReply({ content: '❌ Profile not found!' });

        if (sub === 'deposit') {
            const amountStr = interaction.options.getString('amount');
            let amount = amountStr.toLowerCase() === 'all' ? user.balance : parseInt(amountStr);

            if (isNaN(amount) || amount <= 0) return await interaction.editReply({ content: '❌ Invalid amount!' });
            if (amount > user.balance) return await interaction.editReply({ content: '❌ You don\'t have that much in your wallet!' });

            const remainingCapacity = user.bankCapacity - user.bank;
            if (amount > remainingCapacity) {
                amount = remainingCapacity;
                if (amount <= 0) return await interaction.editReply({ content: '❌ Your bank is already FULL! Upgrade it to store more.' });
            }

            const targetBank = await db.get(`SELECT ownerId, fee FROM economy_banks WHERE id = ?`, [user.bankId]);
            let feeAmount = 0;
            if (targetBank && targetBank.ownerId && targetBank.ownerId !== interaction.user.id) {
                feeAmount = Math.floor(amount * (targetBank.fee || 0.01));
            }

            const netAmount = amount - feeAmount;
            await db.run(`UPDATE users SET balance = balance - ?, bank = bank + ? WHERE userId = ?`, [amount, netAmount, interaction.user.id]);
            
            if (feeAmount > 0 && targetBank.ownerId) {
                await db.run(`UPDATE users SET balance = balance + ? WHERE userId = ?`, [feeAmount, targetBank.ownerId]);
            }

            const embed = new EmbedBuilder()
                .setTitle('🏦 Deposit Successful')
                .setDescription(`You deposited **${netAmount}** coins into your bank.`)
                .addFields(
                    { name: 'Wallet', value: `${user.balance - amount} 🪙`, inline: true },
                    { name: 'Bank', value: `${user.bank + netAmount}/${user.bankCapacity} 🪙`, inline: true }
                )
                .setColor('#10b981');

            if (feeAmount > 0) {
                embed.setFooter({ text: `A transaction fee of ${feeAmount} was paid to the bank owner.` });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'withdraw') {
            const amountStr = interaction.options.getString('amount');
            let amount = amountStr.toLowerCase() === 'all' ? user.bank : parseInt(amountStr);

            if (isNaN(amount) || amount <= 0) return await interaction.editReply({ content: '❌ Invalid amount!' });
            if (amount > user.bank) return await interaction.editReply({ content: '❌ You don\'t have that much in your bank!' });

            await db.run(`UPDATE users SET balance = balance + ?, bank = bank - ? WHERE userId = ?`, [amount, amount, interaction.user.id]);
            
            const embed = new EmbedBuilder()
                .setTitle('🏦 Withdrawal Successful')
                .setDescription(`You withdrew **${amount}** coins from your bank.`)
                .addFields(
                    { name: 'Wallet', value: `${user.balance + amount} 🪙`, inline: true },
                    { name: 'Bank', value: `${user.bank - amount}/${user.bankCapacity} 🪙`, inline: true }
                )
                .setColor('#f59e0b');

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'upgrade') {
            const tiers = [
                { cap: 10000, cost: 2500 },
                { cap: 25000, cost: 7500 },
                { cap: 75000, cost: 20000 },
                { cap: 150000, cost: 50000 },
                { cap: 500000, cost: 150000 },
                { cap: 1000000, cost: 300000 }
            ];

            const nextTier = tiers.find(t => t.cap > user.bankCapacity);
            if (!nextTier) return await interaction.editReply({ content: '❌ You have already reached the maximum bank capacity!' });

            const embed = new EmbedBuilder()
                .setTitle('🏦 Bank Upgrade')
                .setDescription(`Would you like to upgrade your bank capacity to **${nextTier.cap}** coins?\n\n**Cost:** ${nextTier.cost} 🪙\n**Current Capacity:** ${user.bankCapacity} 🪙`)
                .setColor('#6366f1');

            const removed = await removeBalance(interaction.user.id, nextTier.cost);
            if (!removed) return await interaction.editReply({ content: `❌ You need **${nextTier.cost}** coins in your wallet to upgrade!` });

            await db.run(`UPDATE users SET bankCapacity = ? WHERE userId = ?`, [nextTier.cap, interaction.user.id]);
            
            embed.setDescription(`✅ **Upgrade Complete!** Your new bank capacity is **${nextTier.cap}** coins.`)
                 .setColor('#10b981');

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'list') {
            const banks = await db.all(`SELECT * FROM economy_banks`);
            const embed = new EmbedBuilder()
                .setTitle('🏙️ Zenith City Banking Directory')
                .setDescription('Choose where to keep your coins safe. High security banks are harder to rob!')
                .setColor('#6366f1');

            for (const b of banks) {
                const securityStars = '⭐'.repeat(Math.ceil(b.security * 5));
                const ownerText = b.ownerId ? `👑 Owner: <@${b.ownerId}>` : '🏢 Public Institution';
                embed.addFields({
                    name: `${b.name} ${user.bankId === b.id ? '✅' : ''}`,
                    value: `🆔 ID: \`${b.id}\`\n🛡️ Security: ${securityStars}\n🛡️ Insurance: ${b.insurance * 100}%\n📜 Req: Level ${b.requirement}\n${ownerText}`,
                    inline: true
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'switch') {
            const targetId = interaction.options.getString('bank');
            if (user.bankId === targetId) return await interaction.editReply({ content: '❌ You are already using this bank!' });

            const targetBank = await db.get(`SELECT * FROM economy_banks WHERE id = ?`, [targetId]);
            if (!targetBank) return await interaction.editReply({ content: '❌ Bank not found!' });

            if (user.level < targetBank.requirement) {
                return await interaction.editReply({ content: `❌ You need to be **Level ${targetBank.requirement}** to use this bank!` });
            }

            await db.run(`UPDATE users SET bankId = ? WHERE userId = ?`, [targetId, interaction.user.id]);
            
            return await interaction.editReply({ 
                content: `✅ **Account Transferred!** Your funds have been moved to **${targetBank.name}**.` 
            });
        }

        if (sub === 'found') {
            const name = interaction.options.getString('name');
            const cost = 500000;

            if (user.balance < cost) {
                return await interaction.editReply({ content: `❌ You need **${cost}** coins in your wallet to found a bank!` });
            }

            await removeBalance(interaction.user.id, cost);
            const bankId = Math.random().toString(36).substring(2, 7).toUpperCase();

            await db.run(
                `INSERT INTO economy_banks (id, name, security, requirement, insurance, reserve, ownerId, fee) 
                 VALUES (?, ?, 0.2, 0, 0.1, 50000, ?, 0.01)`,
                [bankId, name, interaction.user.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('🏦 New Bank Founded')
                .setDescription(`Congratulations <@${interaction.user.id}>! You have established the **${name}** private bank.\n\n**Bank ID:** \`${bankId}\`\n**Cost:** ${cost} 🪙\n\nCitizens can now switch to your bank using \`/bank switch bank:${bankId}\`. You will collect a **1% fee** on every deposit!`)
                .setColor('#10b981')
                .setThumbnail(interaction.user.displayAvatarURL());

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'manage') {
            const ownedBank = await db.get(`SELECT * FROM economy_banks WHERE ownerId = ?`, [interaction.user.id]);
            if (!ownedBank) return await interaction.editReply({ content: '❌ You do not own any private bank!' });

            const currentUpgrades = JSON.parse(ownedBank.upgrades || '[]');
            
            const upgradeList = [
                { id: 'vaults', name: '🛡️ Reinforced Vaults', cost: 50000, effect: 'Security +0.1', desc: 'Adds physical layers of protection.' },
                { id: 'encryption', name: '🔐 Advanced Encryption', cost: 100000, effect: 'Security +0.15', desc: 'Protects against digital heists.' },
                { id: 'insurance', name: '📜 Gold Insurance', cost: 150000, effect: 'Insurance +0.2', desc: 'Reduces user loss during heists.' },
                { id: 'reserve', name: '🏦 Reserve Expansion', cost: 200000, effect: 'Reserve +100k', desc: 'Increases the bank\'s base funds.' }
            ];

            const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
            
            const select = new StringSelectMenuBuilder()
                .setCustomId(`bank_upgrade_${ownedBank.id}`)
                .setPlaceholder('Select an upgrade to purchase...')
                .addOptions(upgradeList.map(u => ({
                    label: u.name,
                    description: `${u.cost} 🪙 - ${u.effect}`,
                    value: u.id,
                    emoji: u.id === 'vaults' ? '🛡️' : (u.id === 'encryption' ? '🔐' : '💰')
                })));

            const row = new ActionRowBuilder().addComponents(select);

            const embed = new EmbedBuilder()
                .setTitle(`🏦 Management: ${ownedBank.name}`)
                .setDescription(`Manage your institution and invest in its growth.\n\n**Current Stats:**\n🛡️ Security: ${'⭐'.repeat(Math.ceil(ownedBank.security * 5))}\n📜 Insurance: ${ownedBank.insurance * 100}%\n💰 Reserve: ${ownedBank.reserve} 🪙\n📈 Fee: ${ownedBank.fee * 100}%`)
                .addFields({ name: 'Active Upgrades', value: currentUpgrades.length > 0 ? currentUpgrades.map(u => `✅ ${u}`).join('\n') : 'None' })
                .setColor('#6366f1')
                .setFooter({ text: 'Select an upgrade from the menu below to buy it.' });

            return await interaction.editReply({ embeds: [embed], components: [row] });
        }
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const db = await getDb();
        const banks = await db.all(`SELECT id, name FROM economy_banks WHERE name LIKE ? LIMIT 25`, [`%${focusedValue}%`]);

        await interaction.respond(
            banks.map(b => ({ name: b.name, value: b.id }))
        );
    }
};
