const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { addBalance, removeBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('businesses')
        .setDescription('Manage your legal city businesses')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View available business types'))
        .addSubcommand(sub =>
            sub.setName('open')
                .setDescription('Establish a new legal business')
                .addStringOption(opt => opt.setName('type').setDescription('Business type').setRequired(true).addChoices(
                    { name: '🧼 Car Wash (💰 2000)', value: 'car_wash' },
                    { name: '⚡ Gas Station (💰 5000)', value: 'gas_station' },
                    { name: '🌃 Nightclub (💰 8000)', value: 'nightclub' },
                    { name: '🍕 Restaurant (💰 12000)', value: 'restaurant' },
                    { name: '⚖️ Law Firm (💰 20000)', value: 'law_firm' },
                    { name: '🧪 Tech Lab (💰 50000)', value: 'tech_lab' },
                    { name: '🎰 Private Casino (💰 100000)', value: 'casino' },
                    { name: '🏦 Private Bank (💰 250000)', value: 'bank_private' }
                )))
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View your current businesses'))
        .addSubcommand(sub =>
            sub.setName('collect')
                .setDescription('Collect profits from all businesses'))
        .addSubcommand(sub =>
            sub.setName('upgrade')
                .setDescription('Upgrade a business to increase its level and profit')
                .addStringOption(opt => opt.setName('id').setDescription('ID of the business to upgrade').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('hire')
                .setDescription('Toggle recruitment status for your business')
                .addStringOption(opt => opt.setName('id').setDescription('Business ID').setRequired(true).setAutocomplete(true))
                .addBooleanOption(opt => opt.setName('status').setDescription('Set to True to open vacancies').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('salary')
                .setDescription('Set the salary for your employees')
                .addStringOption(opt => opt.setName('id').setDescription('Business ID').setRequired(true).setAutocomplete(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Coins per work cycle').setRequired(true).setMinValue(50).setMaxValue(1000)))
        .addSubcommand(sub =>
            sub.setName('cooldown')
                .setDescription('Set the work cooldown for your employees (Minimum 4 hours)')
                .addStringOption(opt => opt.setName('id').setDescription('Business ID').setRequired(true).setAutocomplete(true))
                .addIntegerOption(opt => opt.setName('hours').setDescription('Cooldown in hours (Minimum 4)').setRequired(true).setMinValue(4)))
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Set a custom name for your business')
                .addStringOption(opt => opt.setName('id').setDescription('Business ID').setRequired(true).setAutocomplete(true))
                .addStringOption(opt => opt.setName('name').setDescription('New custom business name').setRequired(true))),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const db = await getDb();
        const sub = interaction.options.getSubcommand();

        if (sub === 'upgrade' || sub === 'hire' || sub === 'salary' || sub === 'cooldown' || sub === 'rename') {
            const ops = await db.all(`SELECT id, type, level FROM economy_operations WHERE userId = ?`, [interaction.user.id]);
            const bizNames = {
                car_wash: 'Car Wash',
                gas_station: 'Gas Station',
                nightclub: 'Nightclub',
                restaurant: 'Restaurant',
                law_firm: 'Law Firm',
                tech_lab: 'Tech Lab',
                casino: 'Private Casino',
                bank_private: 'Private Bank'
            };
            const choices = ops.map(op => {
                const name = `${bizNames[op.type] || op.type.toUpperCase()} (Lvl ${op.level} - ID: ${op.id})`;
                return { name, value: op.id };
            });
            
            const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);
            await interaction.respond(filtered);
        }
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        const bizData = {
            car_wash: { name: 'Car Wash', cost: 2000, income: 200 },
            gas_station: { name: 'Gas Station', cost: 5000, income: 500 },
            nightclub: { name: 'Nightclub', cost: 8000, income: 1000 },
            restaurant: { name: 'Restaurant', cost: 12000, income: 1500 },
            law_firm: { name: 'Law Firm', cost: 20000, income: 3000 },
            tech_lab: { name: 'Tech Lab', cost: 50000, income: 8000 },
            casino: { name: 'Private Casino', cost: 100000, income: 15000 },
            bank_private: { name: 'Private Bank', cost: 250000, income: 40000 }
        };

        if (sub === 'list') {
            const ops = await db.all(`SELECT * FROM economy_operations WHERE guildId = ? ORDER BY level DESC`, [interaction.guild.id]);
            
            const embed = new EmbedBuilder()
                .setTitle('🏢 Established City Businesses')
                .setDescription('Directory of all active, player-owned legal businesses in the city. You can apply to work at hiring businesses using `/jobs apply <ID>`.')
                .setColor('#10b981')
                .setTimestamp();

            const bizNames = {
                car_wash: 'Car Wash',
                gas_station: 'Gas Station',
                nightclub: 'Nightclub',
                restaurant: 'Restaurant',
                law_firm: 'Law Firm',
                tech_lab: 'Tech Lab',
                casino: 'Private Casino',
                bank_private: 'Private Bank'
            };

            if (ops.length === 0) {
                embed.setDescription('🏙️ **Zenith City has no private businesses yet!**\nUse `/businesses open` to establish the very first enterprise in the city and hire other citizens.');
            } else {
                for (const op of ops) {
                    const baseName = bizNames[op.type] || op.type.toUpperCase();
                    const displayName = op.customName ? `"${op.customName}" (${baseName})` : baseName;
                    
                    embed.addFields({
                        name: `💼 ${displayName} (ID: \`${op.id}\`)`,
                        value: `👑 **Owner:** <@${op.userId}>\n⭐ **Level:** ${op.level}\n👥 **Employees:** ${op.employeeCount}\n💰 **Salary:** ${op.salary.toLocaleString()} 🪙\n📢 **Status:** ${op.hiringEnabled ? '🟢 **Hiring**' : '🔴 **Closed**'}`,
                        inline: true
                    });
                }
            }
            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'open') {
            const type = interaction.options.getString('type');
            if (type === 'municipal') {
                return await interaction.editReply({ content: `❌ **Municipal Cleaner** is a public, city-owned job. You do not need to buy it! Anyone can join it immediately using \`/jobs apply MUNICIPAL\`.` });
            }
            const data = bizData[type];

            const success = await removeBalance(interaction.user.id, data.cost);
            if (!success) return await interaction.editReply({ content: `❌ You need **${data.cost}** coins to open this business!` });

            const opId = Math.random().toString(36).substring(2, 8).toUpperCase();
            await db.run(`INSERT INTO economy_operations (id, userId, guildId, type) VALUES (?, ?, ?, ?)`,
                [opId, interaction.user.id, interaction.guildId, type]);

            return await interaction.editReply({ content: `✅ **Congratulations!** You have opened a **${data.name}** (ID: \`${opId}\`). Start collecting profits soon!` });
        }

        if (sub === 'view') {
            const ops = await db.all(`SELECT * FROM economy_operations WHERE userId = ?`, [interaction.user.id]);
            if (ops.length === 0) return await interaction.editReply({ content: '❌ You don\'t own any businesses yet. Use `/businesses open` to begin!' });

            const embed = new EmbedBuilder()
                .setTitle('🏢 Your City Businesses')
                .setColor('#3b82f6')
                .setTimestamp();

            for (const op of ops) {
                const data = bizData[op.type];
                const hoursPassed = Math.floor((new Date() - new Date(op.lastCollect + ' UTC')) / 3600000);
                const pending = hoursPassed * data.income * op.level;
                const displayName = op.customName ? `${op.customName} (${data.name})` : data.name;
                const salary = op.salary || 0;
                const expenses = (op.employeeCount || 0) * salary;

                embed.addFields({ 
                    name: `${displayName} (Lvl ${op.level})`, 
                    value: `🆔 \`${op.id}\`\n👥 Employees: ${op.employeeCount || 0}\n💸 Salary: ${salary.toLocaleString('en-US')} 🪙 / cycle\n📉 Expenses: **${expenses.toLocaleString('en-US')}** 🪙 / cycle\n📊 Market Share: **${(op.marketShare * 100).toFixed(1)}%**\n💰 Pending: ${pending.toLocaleString('en-US')} 🪙`, 
                    inline: true 
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'collect') {
            const ops = await db.all(`SELECT * FROM economy_operations WHERE userId = ?`, [interaction.user.id]);
            if (ops.length === 0) return await interaction.editReply({ content: '❌ No businesses to collect from!' });

            let total = 0;
            for (const op of ops) {
                const data = bizData[op.type];
                const hoursPassed = Math.floor((new Date() - new Date(op.lastCollect + ' UTC')) / 3600000);
                const pending = hoursPassed * data.income * op.level;
                if (pending > 0) {
                    total += pending;
                    await db.run(`UPDATE economy_operations SET lastCollect = CURRENT_TIMESTAMP WHERE id = ?`, [op.id]);
                }
            }

            if (total === 0) return await interaction.editReply({ content: '⏳ No profits available yet. Wait at least one hour!' });

            await addBalance(interaction.user.id, total, interaction.guildId);
            return await interaction.editReply({ content: `💰 **Profits Collected!** You earned **${total}** coins from your legal businesses.` });
        }

        if (sub === 'upgrade') {
            const opId = interaction.options.getString('id').toUpperCase();
            const op = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND userId = ?`, [opId, interaction.user.id]);
            
            if (!op) return await interaction.editReply({ content: '❌ Business not found or you don\'t own it!' });
            
            const data = bizData[op.type];
            const upgradeCost = Math.floor(data.cost * (op.level + 1) * 0.8);

            const success = await removeBalance(interaction.user.id, upgradeCost);
            if (!success) return await interaction.editReply({ content: `❌ You need **${upgradeCost}** coins to upgrade this business to Level ${op.level + 1}!` });

            await db.run(`UPDATE economy_operations SET level = level + 1 WHERE id = ?`, [opId]);

            const embed = new EmbedBuilder()
                .setTitle('🏗️ Business Upgraded!')
                .setDescription(`Your **${data.name}** has reached **Level ${op.level + 1}**!`)
                .addFields(
                    { name: 'New Level', value: `📈 Lvl ${op.level + 1}`, inline: true },
                    { name: 'Income Boost', value: `💰 ${data.income * (op.level + 1)}/hr`, inline: true }
                )
                .setColor('#10b981');

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'hire') {
            const opId = interaction.options.getString('id').toUpperCase();
            const status = interaction.options.getBoolean('status');
            const op = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND userId = ?`, [opId, interaction.user.id]);
            
            if (!op) return await interaction.editReply({ content: '❌ Business not found!' });
            
            await db.run(`UPDATE economy_operations SET hiringEnabled = ? WHERE id = ?`, [status ? 1 : 0, opId]);
            return await interaction.editReply({ content: `📢 Recruitment for **${opId}** is now **${status ? 'OPEN' : 'CLOSED'}**.` });
        }

        if (sub === 'salary') {
            const opId = interaction.options.getString('id').toUpperCase();
            const amount = interaction.options.getInteger('amount');
            const op = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND userId = ?`, [opId, interaction.user.id]);
            
            if (!op) return await interaction.editReply({ content: '❌ Business not found!' });
            
            await db.run(`UPDATE economy_operations SET salary = ? WHERE id = ?`, [amount, opId]);
            return await interaction.editReply({ content: `💰 Employee salary for **${opId}** set to **${amount}** coins per work cycle.` });
        }

        if (sub === 'cooldown') {
            const opId = interaction.options.getString('id').toUpperCase();
            const hours = interaction.options.getInteger('hours');
            const op = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND userId = ?`, [opId, interaction.user.id]);
            
            if (!op) return await interaction.editReply({ content: '❌ Business not found!' });
            
            const cooldownSeconds = hours * 3600;
            await db.run(`UPDATE economy_operations SET cooldown = ? WHERE id = ?`, [cooldownSeconds, opId]);
            return await interaction.editReply({ content: `⏱️ Cooldown for **${opId}** set to **${hours}** hours (${cooldownSeconds} seconds).` });
        }

        if (sub === 'rename') {
            const opId = interaction.options.getString('id').toUpperCase();
            const newName = interaction.options.getString('name');
            const op = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND userId = ?`, [opId, interaction.user.id]);
            
            if (!op) return await interaction.editReply({ content: '❌ Business not found or you don\'t own it!' });
            
            if (newName.length < 3 || newName.length > 50) {
                return await interaction.editReply({ content: '❌ Custom name must be between 3 and 50 characters long.' });
            }
            
            await db.run(`UPDATE economy_operations SET customName = ? WHERE id = ?`, [newName, opId]);
            return await interaction.editReply({ content: `✅ Custom name for business **${opId}** set to **${newName}**.` });
        }
    }
};
