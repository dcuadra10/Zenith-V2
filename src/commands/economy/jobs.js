const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const jobs = require('../../config/jobs');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jobs')
        .setDescription('View and apply to available private business jobs')
        .addSubcommand(sub =>
            sub.setName('vacancies')
                .setDescription('View open positions in private businesses'))
        .addSubcommand(sub =>
            sub.setName('apply')
                .setDescription('Apply to a private business position')
                .addStringOption(opt => opt.setName('id').setDescription('Business ID').setRequired(true).setAutocomplete(true))),
    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const db = await getDb();
        const sub = interaction.options.getSubcommand();

        if (sub === 'apply') {
            const guildId = interaction.guild.id;
            const legalVacancies = await db.all(`SELECT id, type, salary, customName FROM economy_operations WHERE hiringEnabled = 1 AND guildId = ?`, [guildId]);
            const mafiaVacancies = await db.all(`SELECT mafiaId, type, salary, customName FROM mafia_businesses WHERE hiringEnabled = 1 AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [guildId]);

            const bizNames = {
                car_wash: 'Car Wash',
                gas_station: 'Gas Station',
                nightclub: 'Nightclub',
                restaurant: 'Restaurant',
                law_firm: 'Law Firm',
                tech_lab: 'Tech Lab',
                casino: 'Private Casino',
                bank_private: 'Private Bank',
                lab: 'Underworld Lab',
                cash: 'Money Printing'
            };

            const expRequirements = {
                car_wash: 5,
                gas_station: 10,
                nightclub: 15,
                restaurant: 20,
                law_firm: 30,
                tech_lab: 50,
                casino: 75,
                bank_private: 100,
                lab: 30,
                cash: 50
            };

            const choices = [];
            // Default Public Municipal Job
            choices.push({
                name: `🧹 Municipal Cleaner (Salary: 60 🪙 - Req. Exp: 0 - ID: MUNICIPAL)`,
                value: 'MUNICIPAL'
            });

            for (const v of legalVacancies) {
                const displayName = v.customName || bizNames[v.type] || v.type.toUpperCase();
                const req = expRequirements[v.type] || 0;
                choices.push({
                    name: `🏙️ ${displayName} (Req. Exp: ${req} - ID: ${v.id})`,
                    value: v.id
                });
            }
            for (const v of mafiaVacancies) {
                const displayName = v.customName || v.type.toUpperCase();
                const req = expRequirements[v.type] || 0;
                choices.push({
                    name: `🔞 UNDERWORLD: ${displayName} (Req. Exp: ${req} - ID: ${v.mafiaId}_${v.type})`,
                    value: `${v.mafiaId}_${v.type}`.toUpperCase()
                });
            }

            const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);
            await interaction.respond(filtered);
        }
    },
    async execute(interaction) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        if (sub === 'vacancies') {
            const guildId = interaction.guild.id;
            const legalVacancies = await db.all(`SELECT * FROM economy_operations WHERE hiringEnabled = 1 AND guildId = ? LIMIT 5`, [guildId]);
            const mafiaVacancies = await db.all(`SELECT * FROM mafia_businesses WHERE hiringEnabled = 1 AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?) LIMIT 5`, [guildId]);
            
            const embed = new EmbedBuilder()
                .setTitle('🏢 Zenith Job Market')
                .setDescription('Work for other citizens or the city to gain experience and earn competitive salaries!')
                .setColor('#f59e0b')
                .setTimestamp();

            // Default entry-level public municipal job always available
            embed.addFields({
                name: `🧹 Municipal Cleaner (ID: \`MUNICIPAL\`)`,
                value: `💰 **Salary:** 60 🪙\n👥 **Staff:** Everyone welcome\n📍 **Owner:** The City\n⭐ **Req. Exp:** 0 (Perfect for beginners)`
            });

            const expRequirements = {
                car_wash: 5,
                gas_station: 10,
                nightclub: 15,
                restaurant: 20,
                law_firm: 30,
                tech_lab: 50,
                casino: 75,
                bank_private: 100,
                lab: 30,
                cash: 50
            };

            for (const v of legalVacancies) {
                const displayName = v.customName || v.type.replace('_', ' ').toUpperCase();
                const req = expRequirements[v.type] || 0;
                embed.addFields({
                    name: `🏙️ ${displayName} (ID: ${v.id})`,
                    value: `💰 **Salary:** ${v.salary} 🪙\n👥 **Staff:** ${v.employeeCount}\n📍 **Owner:** <@${v.userId}>\n⭐ **Req. Exp:** ${req} XP`
                });
            }

            for (const v of mafiaVacancies) {
                const displayName = v.customName || v.type.toUpperCase();
                const req = expRequirements[v.type] || 0;
                embed.addFields({
                    name: `🔞 UNDERWORLD: ${displayName} (ID: ${v.mafiaId}_${v.type})`,
                    value: `💰 **Salary:** ${v.salary} 💸 (Dirty Money)\n👥 **Staff:** ${v.employeeCount}\n💀 **Mafia:** ${v.mafiaId}\n⭐ **Req. Exp:** ${req} XP`
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'apply') {
            const appId = interaction.options.getString('id').toUpperCase();
            const guildId = interaction.guild.id;
            const user = await db.get(`SELECT workplaceId, workExperience FROM users WHERE userId = ? AND guildId = ?`, [interaction.user.id, guildId]);
            const currentExp = (user && user.workExperience) || 0;

            if (user && user.workplaceId === appId) {
                return await interaction.editReply({ content: '❌ You are already employed at this business!' });
            }

            const expRequirements = {
                car_wash: 5,
                gas_station: 10,
                nightclub: 15,
                restaurant: 20,
                law_firm: 30,
                tech_lab: 50,
                casino: 75,
                bank_private: 100,
                lab: 30,
                cash: 50
            };

            // Decrement previous workplace employee count if switching
            if (user && user.workplaceId) {
                const oldWorkplaceId = user.workplaceId;
                if (oldWorkplaceId.includes('_')) {
                    const [oldMafiaId, oldType] = oldWorkplaceId.split('_');
                    await db.run(`UPDATE mafia_businesses SET employeeCount = MAX(0, employeeCount - 1) WHERE mafiaId = ? AND type = ?`, [oldMafiaId, oldType.toLowerCase()]);
                } else if (oldWorkplaceId !== 'MUNICIPAL') {
                    await db.run(`UPDATE economy_operations SET employeeCount = MAX(0, employeeCount - 1) WHERE id = ? AND guildId = ?`, [oldWorkplaceId, guildId]);
                }
            }
            
            if (appId === 'MUNICIPAL') {
                await db.run(
                    `INSERT INTO users (userId, guildId, workplaceId, jobId) VALUES (?, ?, ?, NULL)
                     ON CONFLICT(userId, guildId) DO UPDATE SET workplaceId = excluded.workplaceId, jobId = NULL`,
                    [interaction.user.id, guildId, 'MUNICIPAL']
                );
                const embed = new EmbedBuilder()
                    .setTitle('🧹 Hired as Municipal Cleaner!')
                    .setDescription(`You have joined the **Municipal Cleaning Crew**. Work using \`/work\` to gain experience and qualify for better paying private jobs!`)
                    .addFields({ name: 'Salary', value: `💰 60 coins per cycle`, inline: true })
                    .setColor('#6b7280');

                return await interaction.editReply({ embeds: [embed] });
            }

            if (appId.includes('_')) {
                // Underworld Application
                const [mafiaId, type] = appId.split('_');
                const business = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);

                if (!business) return await interaction.editReply({ content: '❌ Underworld venture not found!' });
                if (!business.hiringEnabled) return await interaction.editReply({ content: '❌ This venture is not currently hiring outsiders!' });

                const reqExp = expRequirements[type.toLowerCase()] || 0;
                if (currentExp < reqExp) {
                    return await interaction.editReply({ content: `❌ You do not have enough experience to join this underworld venture! Required: **${reqExp} XP**, Your Experience: **${currentExp} XP**.` });
                }

                await db.run(
                    `INSERT INTO users (userId, guildId, workplaceId, jobId) VALUES (?, ?, ?, NULL)
                     ON CONFLICT(userId, guildId) DO UPDATE SET workplaceId = excluded.workplaceId, jobId = NULL`,
                    [interaction.user.id, guildId, appId]
                );
                await db.run(`UPDATE mafia_businesses SET employeeCount = employeeCount + 1 WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);

                const displayName = business.customName || type.toUpperCase();
                const embed = new EmbedBuilder()
                    .setTitle('🎭 Recruited!')
                    .setDescription(`You are now an associate for the **${displayName}** venture.`)
                    .addFields({ name: 'Salary', value: `💰 ${business.salary} dirty bills per cycle`, inline: true })
                    .setColor('#ef4444');

                return await interaction.editReply({ embeds: [embed] });
            } else {
                // Legal Application
                const business = await db.get(`SELECT * FROM economy_operations WHERE id = ? AND guildId = ?`, [appId, guildId]);

                if (!business) return await interaction.editReply({ content: '❌ Business not found!' });
                if (!business.hiringEnabled) return await interaction.editReply({ content: '❌ This business is not currently hiring!' });

                const reqExp = expRequirements[business.type] || 0;
                if (currentExp < reqExp) {
                    return await interaction.editReply({ content: `❌ You do not have enough experience to apply here! Required: **${reqExp} XP**, Your Experience: **${currentExp} XP**.\nWork at the **Municipal Cleaner** (ID: \`MUNICIPAL\`) to gain experience!` });
                }

                await db.run(
                    `INSERT INTO users (userId, guildId, workplaceId, jobId) VALUES (?, ?, ?, NULL)
                     ON CONFLICT(userId, guildId) DO UPDATE SET workplaceId = excluded.workplaceId, jobId = NULL`,
                    [interaction.user.id, guildId, appId]
                );
                await db.run(`UPDATE economy_operations SET employeeCount = employeeCount + 1 WHERE id = ? AND guildId = ?`, [appId, guildId]);

                const displayName = business.customName || appId;
                const embed = new EmbedBuilder()
                    .setTitle('🤝 Hired!')
                    .setDescription(`You have joined **${displayName}** as an employee.`)
                    .addFields({ name: 'Salary', value: `💰 ${business.salary} coins per cycle`, inline: true })
                    .setColor('#10b981');

                return await interaction.editReply({ embeds: [embed] });
            }
        }
    },
};
