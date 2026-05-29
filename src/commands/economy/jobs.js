const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const jobs = require('../../config/jobs');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jobs')
        .setDescription('View and join available jobs')
        .addSubcommand(sub => sub.setName('list').setDescription('List all available jobs'))
        .addSubcommand(sub => 
            sub.setName('join')
                .setDescription('Join a new career path')
                .addStringOption(opt => 
                    opt.setName('job')
                        .setDescription('The job you want to join')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Baker 🥖 (Salary: 50)', value: 'baker' },
                            { name: 'Engineer 🛠️ (Salary: 150)', value: 'engineer' },
                            { name: 'Pilot ✈️ (Salary: 500)', value: 'pilot' },
                            { name: 'Ethical Hacker 💻 (Salary: 300)', value: 'hacker' },
                            { name: 'Doctor 🩺 (Salary: 400)', value: 'doctor' }
                        )))
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
            const legalVacancies = await db.all(`SELECT id, type, salary FROM economy_operations WHERE hiringEnabled = 1`);
            const mafiaVacancies = await db.all(`SELECT mafiaId, type, salary, customName FROM mafia_businesses WHERE hiringEnabled = 1`);

            const bizNames = {
                car_wash: 'Car Wash',
                nightclub: 'Nightclub',
                law_firm: 'Law Firm',
                tech_lab: 'Tech Lab',
                lab: 'Underworld Lab',
                cash: 'Money Printing'
            };

            const choices = [];
            for (const v of legalVacancies) {
                choices.push({
                    name: `🏙️ ${bizNames[v.type] || v.type.toUpperCase()} (Salary: ${v.salary} 🪙 - ID: ${v.id})`,
                    value: v.id
                });
            }
            for (const v of mafiaVacancies) {
                const displayName = v.customName || v.type.toUpperCase();
                choices.push({
                    name: `🔞 UNDERWORLD: ${displayName} (${bizNames[v.type] || v.type.toUpperCase()}) (Salary: ${v.salary} 💸 - ID: ${v.mafiaId}_${v.type})`,
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

        if (sub === 'list') {
            const embed = new EmbedBuilder()
                .setTitle('💼 City Careers')
                .setDescription('Choose a job to start earning coins! Use `/jobs join <job_id>` to select one.')
                .setColor('#3b82f6')
                .setTimestamp();

            Object.values(jobs).forEach(job => {
                embed.addFields({
                    name: `${job.name} (ID: ${job.id})`,
                    value: `💰 **Salary:** ${job.salary} coins\n⏱️ **Cooldown:** ${job.cooldown / 3600}h\n📝 ${job.description}`
                });
            });

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'join') {
            const jobId = interaction.options.getString('job');
            const job = jobs[jobId];

            if (!job) {
                return await interaction.editReply({ content: '❌ Job not found. Check the list using `/jobs list`.' });
            }

            await db.run(
                `INSERT INTO users (userId, jobId) VALUES (?, ?)
                 ON CONFLICT(userId) DO UPDATE SET jobId = excluded.jobId`,
                [interaction.user.id, jobId]
            );

            const embed = new EmbedBuilder()
                .setTitle('👔 New Career Started!')
                .setDescription(`Congratulations! You are now a **${job.name}**. Use \`/work\` to start earning.`)
                .setColor('#10b981')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'vacancies') {
            const legalVacancies = await db.all(`SELECT * FROM economy_operations WHERE hiringEnabled = 1 LIMIT 5`);
            const mafiaVacancies = await db.all(`SELECT * FROM mafia_businesses WHERE hiringEnabled = 1 LIMIT 5`);
            
            if (legalVacancies.length === 0 && mafiaVacancies.length === 0) 
                return await interaction.editReply({ content: '😔 No businesses are currently hiring. Check back later!' });

            const embed = new EmbedBuilder()
                .setTitle('🏢 Zenith Job Market')
                .setDescription('Work for other citizens to earn competitive salaries!')
                .setColor('#f59e0b')
                .setTimestamp();

            for (const v of legalVacancies) {
                embed.addFields({
                    name: `🏙️ ${v.type.replace('_', ' ').toUpperCase()} (ID: ${v.id})`,
                    value: `💰 **Salary:** ${v.salary} 🪙\n👥 **Staff:** ${v.employeeCount}\n📍 **Owner:** <@${v.userId}>`
                });
            }

            for (const v of mafiaVacancies) {
                embed.addFields({
                    name: `🔞 UNDERWORLD: ${v.type.toUpperCase()} (ID: ${v.mafiaId}_${v.type})`,
                    value: `💰 **Salary:** ${v.salary} 💸 (Dirty Money)\n👥 **Staff:** ${v.employeeCount}\n💀 **Mafia:** ${v.mafiaId}`
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'apply') {
            const appId = interaction.options.getString('id').toUpperCase();
            
            if (appId.includes('_')) {
                // Underworld Application
                const [mafiaId, type] = appId.split('_');
                const business = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);

                if (!business) return await interaction.editReply({ content: '❌ Underworld venture not found!' });
                if (!business.hiringEnabled) return await interaction.editReply({ content: '❌ This venture is not currently hiring outsiders!' });

                await db.run(`UPDATE users SET workplaceId = ?, jobId = NULL WHERE userId = ?`, [appId, interaction.user.id]);
                await db.run(`UPDATE mafia_businesses SET employeeCount = employeeCount + 1 WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);

                const embed = new EmbedBuilder()
                    .setTitle('🎭 Recruited!')
                    .setDescription(`You are now an associate for the **${type.toUpperCase()}** venture.`)
                    .addFields({ name: 'Salary', value: `💰 ${business.salary} dirty bills per cycle`, inline: true })
                    .setColor('#ef4444');

                return await interaction.editReply({ embeds: [embed] });
            } else {
                // Legal Application
                const business = await db.get(`SELECT * FROM economy_operations WHERE id = ?`, [appId]);

                if (!business) return await interaction.editReply({ content: '❌ Business not found!' });
                if (!business.hiringEnabled) return await interaction.editReply({ content: '❌ This business is not currently hiring!' });

                await db.run(`UPDATE users SET workplaceId = ?, jobId = NULL WHERE userId = ?`, [appId, interaction.user.id]);
                await db.run(`UPDATE economy_operations SET employeeCount = employeeCount + 1 WHERE id = ?`, [appId]);

                const embed = new EmbedBuilder()
                    .setTitle('🤝 Hired!')
                    .setDescription(`You have joined **${appId}** as an employee.`)
                    .addFields({ name: 'Salary', value: `💰 ${business.salary} coins per cycle`, inline: true })
                    .setColor('#10b981');

                return await interaction.editReply({ embeds: [embed] });
            }
        }
    },
};
