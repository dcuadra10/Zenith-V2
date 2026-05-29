const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const jobs = require('../../config/jobs');
const { getDb } = require('../../config/database');
const { addBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work your shift to earn coins'),
    async execute(interaction) {
        await interaction.deferReply();
        const db = await getDb();
        const user = await db.get(`SELECT jobId, workplaceId, lastWork FROM users WHERE userId = ?`, [interaction.user.id]);

        if (!user || (!user.jobId && !user.workplaceId)) {
            return await interaction.editReply({ content: '❌ You don\'t have a job! Join a city career using `/jobs list` or a private business using `/jobs vacancies`.', ephemeral: true });
        }

        let salary = 0;
        let jobName = '';
        let cooldown = 3600; // 1 hour default
        let workplace = null;

        let isUnderworld = false;
        let mafiaData = null;

        if (user.workplaceId) {
            if (user.workplaceId.includes('_')) {
                // Underworld Work
                isUnderworld = true;
                const [mafiaId, type] = user.workplaceId.split('_');
                mafiaData = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);
                if (!mafiaData) {
                    await db.run(`UPDATE users SET workplaceId = NULL WHERE userId = ?`, [interaction.user.id]);
                    return await interaction.editReply({ content: '❌ Your underworld venture has been busted. Find a new job!', ephemeral: true });
                }
                salary = mafiaData.salary;
                jobName = `Underworld ${mafiaData.type.toUpperCase()} Associate`;
            } else {
                // Legal Work
                workplace = await db.get(`SELECT * FROM economy_operations WHERE id = ?`, [user.workplaceId]);
                if (!workplace) {
                    await db.run(`UPDATE users SET workplaceId = NULL WHERE userId = ?`, [interaction.user.id]);
                    return await interaction.editReply({ content: '❌ Your workplace has gone out of business. Please find a new job!', ephemeral: true });
                }
                salary = workplace.salary;
                jobName = `${workplace.type.replace('_', ' ').toUpperCase()} Employee`;
            }
        } else {
            const job = jobs[user.jobId];
            if (!job) return await interaction.editReply({ content: '❌ Job not found!', ephemeral: true });
            salary = job.salary;
            jobName = job.name;
            cooldown = job.cooldown;
        }

        const now = Math.floor(Date.now() / 1000);
        const lastWork = user.lastWork || 0;

        if (now - lastWork < cooldown) {
            const remaining = cooldown - (now - lastWork);
            const hours = Math.floor(remaining / 3600);
            const minutes = Math.floor((remaining % 3600) / 60);
            return await interaction.editReply({ 
                content: `⏳ You are tired! You can work again in **${hours}h ${minutes}m**.`, 
                ephemeral: true 
            });
        }

        // --- PAYROLL CHECKS & DEDUCTIONS ---
        if (isUnderworld) {
            const [mafiaId] = user.workplaceId.split('_');
            const mafia = await db.get(`SELECT vault FROM economy_mafias WHERE id = ?`, [mafiaId]);
            if (!mafia || mafia.vault < salary) {
                return await interaction.editReply({ content: `❌ The syndicate's vault is short on funds and cannot pay your salary! Contact the Don to fund the vault.`, ephemeral: true });
            }
            // Deduct from mafia vault
            await db.run(`UPDATE economy_mafias SET vault = vault - ? WHERE id = ?`, [salary, mafiaId]);
        } else if (workplace) {
            const owner = await db.get(`SELECT balance, bank FROM users WHERE userId = ?`, [workplace.userId]);
            if (!owner || (owner.balance + owner.bank) < salary) {
                return await interaction.editReply({ content: `❌ The business is short on funds and cannot pay your salary! Contact the owner (<@${workplace.userId}>) to deposit coins.`, ephemeral: true });
            }
            // Deduct from owner
            if (owner.balance >= salary) {
                await db.run(`UPDATE users SET balance = balance - ? WHERE userId = ?`, [salary, workplace.userId]);
            } else {
                const remaining = salary - owner.balance;
                await db.run(`UPDATE users SET balance = 0, bank = bank - ? WHERE userId = ?`, [remaining, workplace.userId]);
            }
        }

        // Add balance or dirty money
        let balanceMsg = '';
        if (isUnderworld) {
            const [mafiaId] = user.workplaceId.split('_');
            await db.run(`UPDATE mafia_members SET dirtyMoney = dirtyMoney + ? WHERE userId = ? AND mafiaId = ?`, [salary, interaction.user.id, mafiaId]);
            balanceMsg = `💰 **${salary}** dirty bills added to your stash.`;
            
            // Bonus to mafia business: Boost production (stock)
            await db.run(`UPDATE mafia_businesses SET stock = stock + 10 WHERE mafiaId = ? AND type = ?`, [mafiaId, mafiaData.type]);
        } else {
            const newBal = await addBalance(interaction.user.id, salary, interaction.guild.id);
            balanceMsg = `💰 New Balance: **${newBal}** coins`;
            
            // Bonus to owner if private
            if (workplace) {
                const dbType = process.env.DB_TYPE || 'sqlite';
                if (dbType === 'sqlite') {
                    await db.run(`UPDATE economy_operations SET lastCollect = datetime(lastCollect, '-30 minutes') WHERE id = ?`, [workplace.id]);
                } else {
                    await db.run(`UPDATE economy_operations SET lastCollect = lastCollect - interval '30 minutes' WHERE id = ?`, [workplace.id]);
                }
            }
        }

        await db.run(`UPDATE users SET lastWork = ? WHERE userId = ?`, [now, interaction.user.id]);

        const embed = new EmbedBuilder()
            .setTitle('🏢 Shift Completed!')
            .setDescription(`You worked hard as a **${jobName}**!`)
            .addFields({ name: 'Earnings', value: balanceMsg })
            .setColor(isUnderworld ? '#ef4444' : '#10b981')
            .setFooter({ text: 'Thank you for contributing to the city economy.' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
