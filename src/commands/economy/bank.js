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
        const user = await db.get(`SELECT balance, bank, bankCapacity, bankId, level FROM users WHERE userId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
        if (!user) return await interaction.editReply({ content: '❌ Profile not found!' });

        // Normalize BigInt/INTEGER values from DB to standard JS Numbers to prevent NaN math and string concat issues in PostgreSQL
        user.balance = parseInt(user.balance) || 0;
        user.bank = parseInt(user.bank) || 0;
        user.bankCapacity = parseInt(user.bankCapacity) || 5000;
        user.level = parseInt(user.level) || 1;

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

            const targetBank = await db.get(`SELECT ownerId, fee FROM economy_banks WHERE id = ? AND (guildId = ? OR guildId IS NULL OR guildId = 'global')`, [user.bankId, interaction.guild.id]);
            let feeAmount = 0;
            if (targetBank && targetBank.ownerId && targetBank.ownerId !== interaction.user.id) {
                feeAmount = Math.floor(amount * (targetBank.fee || 0.01));
            }

            const netAmount = amount - feeAmount;
            const removed = await removeBalance(interaction.user.id, amount, interaction.guild.id, 'Bank Deposit');
            if (!removed) return await interaction.editReply({ content: '❌ Deposit transaction failed.' });
            await db.run(`UPDATE users SET bank = bank + ? WHERE userId = ? AND guildId = ?`, [netAmount, interaction.user.id, interaction.guild.id]);
            
            if (feeAmount > 0 && targetBank.ownerId) {
                await addBalance(targetBank.ownerId, feeAmount, interaction.guild.id, false, `Deposit fee from ${interaction.user.tag}`, true);
            }

            const embed = new EmbedBuilder()
                .setTitle('<:zenith_bank:1510681878032552166> Deposit Successful')
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

            await db.run(`UPDATE users SET bank = bank - ? WHERE userId = ? AND guildId = ?`, [amount, interaction.user.id, interaction.guild.id]);
            await addBalance(interaction.user.id, amount, interaction.guild.id, true, 'Bank Withdrawal', true);
            
            const embed = new EmbedBuilder()
                .setTitle('<:zenith_bank:1510681878032552166> Withdrawal Successful')
                .setDescription(`You withdrew **${amount}** coins from your bank.`)
                .addFields(
                    { name: 'Wallet', value: `${user.balance + amount} 🪙`, inline: true },
                    { name: 'Bank', value: `${user.bank - amount}/${user.bankCapacity} 🪙`, inline: true }
                )
                .setColor('#f59e0b');

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'upgrade') {
            const maxCapacity = 10000000;
            if (user.bankCapacity >= maxCapacity) return await interaction.editReply({ content: '❌ You have already reached the maximum bank capacity!' });

            const cost = Math.max(2500, Math.floor(user.bankCapacity * 0.10));

            const removed = await removeBalance(interaction.user.id, cost, interaction.guild.id, 'Bank Capacity Upgrade');
            if (!removed) return await interaction.editReply({ content: `❌ You need **${cost.toLocaleString('en-US')}** coins in your wallet to upgrade!` });

            // Random capacity gain between 2,500 and 7,500 + 5% of current capacity
            const capacityGain = Math.floor(2500 + Math.random() * 5000 + (user.bankCapacity * 0.05));
            const newCapacity = Math.min(maxCapacity, user.bankCapacity + capacityGain);
            const actualGain = newCapacity - user.bankCapacity;

            await db.run(`UPDATE users SET bankCapacity = ? WHERE userId = ? AND guildId = ?`, [newCapacity, interaction.user.id, interaction.guild.id]);
            
            const embed = new EmbedBuilder()
                .setTitle('<:zenith_bank:1510681878032552166> Bank Capacity Upgrade')
                .setDescription(`✅ **Upgrade Complete!**\n\n**Cost:** ${cost.toLocaleString('en-US')} 🪙\n**Capacity Gained:** +${actualGain.toLocaleString('en-US')} 🪙\n**New Bank Capacity:** **${newCapacity.toLocaleString('en-US')}** / ${maxCapacity.toLocaleString('en-US')} 🪙`)
                .setColor('#10b981');

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'list') {
            const banks = await db.all(`SELECT * FROM economy_banks WHERE guildId = ? OR guildId IS NULL OR guildId = 'global'`, [interaction.guild.id]);
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

            const targetBank = await db.get(`SELECT * FROM economy_banks WHERE id = ? AND (guildId = ? OR guildId IS NULL OR guildId = 'global')`, [targetId, interaction.guild.id]);
            if (!targetBank) return await interaction.editReply({ content: '❌ Bank not found!' });

            if (user.level < targetBank.requirement) {
                return await interaction.editReply({ content: `❌ You need to be **Level ${targetBank.requirement}** to use this bank!` });
            }

            await db.run(`UPDATE users SET bankId = ? WHERE userId = ? AND guildId = ?`, [targetId, interaction.user.id, interaction.guild.id]);
            
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

            await removeBalance(interaction.user.id, cost, interaction.guild.id, `Founded Private Bank: ${name}`);
            const bankId = Math.random().toString(36).substring(2, 7).toUpperCase();

            await db.run(
                `INSERT INTO economy_banks (id, guildId, name, security, requirement, insurance, reserve, ownerId, fee) 
                 VALUES (?, ?, ?, 0.2, 0, 0.1, 50000, ?, 0.01)`,
                [bankId, interaction.guild.id, name, interaction.user.id]
            );

            const embed = new EmbedBuilder()
                .setTitle('<:zenith_bank:1510681878032552166> New Bank Founded')
                .setDescription(`Congratulations <@${interaction.user.id}>! You have established the **${name}** private bank.\n\n**Bank ID:** \`${bankId}\`\n**Cost:** ${cost} 🪙\n\nCitizens can now switch to your bank using \`/bank switch bank:${bankId}\`. You will collect a **1% fee** on every deposit!`)
                .setColor('#10b981')
                .setThumbnail(interaction.user.displayAvatarURL());

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'manage') {
            const ownedBank = await db.get(`SELECT * FROM economy_banks WHERE ownerId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
            if (!ownedBank) return await interaction.editReply({ content: '❌ You do not own any private bank!' });

            const UPGRADES_CFG = {
                vaults: { name: 'Reinforced Vaults', emoji: '🛡️', baseCost: 50000, costMultiplier: 1.5, maxLevel: 5, desc: 'Security +5% per lvl.' },
                encryption: { name: 'Advanced Encryption', emoji: '🔐', baseCost: 100000, costMultiplier: 1.6, maxLevel: 5, desc: 'Security +8% per lvl.' },
                insurance: { name: 'Gold Insurance', emoji: '📜', baseCost: 150000, costMultiplier: 1.5, maxLevel: 5, desc: 'Insurance +15% per lvl.' },
                reserve: { name: 'Reserve Expansion', emoji: '🏦', baseCost: 200000, costMultiplier: 1.7, maxLevel: 5, desc: 'Reserve +100k per lvl.' },
                guards: { name: 'Armed Guards', emoji: '💂', baseCost: 75000, costMultiplier: 1.4, maxLevel: 5, desc: 'Security +4% per lvl.' },
                auditing: { name: 'Automated Auditing', emoji: '📈', baseCost: 120000, costMultiplier: 1.5, maxLevel: 5, desc: 'Deposit Fee +0.5% per lvl.' }
            };

            const getUpgradeLevels = (upgradesJson) => {
                let levels = { vaults: 0, encryption: 0, insurance: 0, reserve: 0, guards: 0, auditing: 0 };
                if (!upgradesJson) return levels;
                try {
                    const parsed = JSON.parse(upgradesJson);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(name => {
                            if (name.includes('Vaults')) levels.vaults = 1;
                            if (name.includes('Encryption')) levels.encryption = 1;
                            if (name.includes('Insurance')) levels.insurance = 1;
                            if (name.includes('Reserve')) levels.reserve = 1;
                        });
                    } else if (typeof parsed === 'object') {
                        levels = { ...levels, ...parsed };
                    }
                } catch (e) {}
                return levels;
            };

            const levels = getUpgradeLevels(ownedBank.upgrades);
            const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
            
            const selectOptions = [];
            const activeUpgradesList = [];

            Object.entries(UPGRADES_CFG).forEach(([id, up]) => {
                const lvl = levels[id] || 0;
                const cost = Math.floor(up.baseCost * Math.pow(up.costMultiplier, lvl));

                if (lvl > 0) {
                    activeUpgradesList.push(`${up.emoji} **${up.name}**: Level ${lvl} / ${up.maxLevel}`);
                } else {
                    activeUpgradesList.push(`${up.emoji} **${up.name}**: *Not Purchased*`);
                }

                if (lvl < up.maxLevel) {
                    selectOptions.push({
                        label: `${up.emoji} ${up.name} (Lvl ${lvl + 1})`,
                        description: `💰 ${cost.toLocaleString()} coins — ${up.desc}`,
                        value: id
                    });
                }
            });

            const select = new StringSelectMenuBuilder()
                .setCustomId(`bank_upgrade_${ownedBank.id}`)
                .setPlaceholder(selectOptions.length > 0 ? 'Select an upgrade to purchase...' : 'All upgrades fully completed!')
                .addOptions(selectOptions.length > 0 ? selectOptions : [{ label: 'Completed', value: 'max' }]);

            if (selectOptions.length === 0) {
                select.setDisabled(true);
            }

            const row = new ActionRowBuilder().addComponents(select);

            // Cap security stars visual display
            const securityStars = '⭐'.repeat(Math.min(5, Math.ceil(ownedBank.security * 5)));

            const embed = new EmbedBuilder()
                .setTitle(`<:zenith_bank:1510681878032552166> Management: ${ownedBank.name}`)
                .setDescription(`Manage your institution and invest in its growth.\n\n**Current Stats:**\n🛡️ Security: ${securityStars} (Rate: ${(ownedBank.security * 100).toFixed(0)}%)\n📜 Insurance: ${(ownedBank.insurance * 100).toFixed(0)}%\n💰 Reserve: ${ownedBank.reserve.toLocaleString()} coins\n📈 Fee: ${(ownedBank.fee * 100).toFixed(1)}%`)
                .addFields({ name: 'Active Upgrades', value: activeUpgradesList.join('\n') })
                .setColor('#ffd700') // Gold color
                .setFooter({ text: 'Select an upgrade from the menu below to buy it.' });

            return await interaction.editReply({ embeds: [embed], components: [row] });
        }
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const db = await getDb();
        const banks = await db.all(`SELECT id, name FROM economy_banks WHERE name LIKE ? AND (guildId = ? OR guildId IS NULL OR guildId = 'global') LIMIT 25`, [`%${focusedValue}%`, interaction.guildId]);

        await interaction.respond(
            banks.map(b => ({ name: b.name, value: b.id }))
        );
    }
};
