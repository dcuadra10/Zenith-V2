const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const jobs = require('../../config/jobs');
const { getDb } = require('../../config/database');
const { addBalance, removeBalance, logEconomyEvent } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work your shift to earn coins'),
    async execute(interaction) {
        await interaction.deferReply();
        const db = await getDb();
        const user = await db.get(`SELECT jobId, workplaceId, lastWork FROM users WHERE userId = ?`, [interaction.user.id]);

        if (!user || !user.workplaceId) {
            return await interaction.editReply({ content: '❌ You don\'t have a job! Join a private business using `/jobs vacancies` and apply using `/jobs apply <id>`.', ephemeral: true });
        }

        let salary = 0;
        let jobName = '';
        let cooldown = 14400; // 4 hours default
        let workplace = null;

        let isUnderworld = false;
        let mafiaData = null;

        if (user.workplaceId) {
            if (user.workplaceId === 'MUNICIPAL') {
                salary = 60;
                cooldown = 14400; // 4 hours
                jobName = 'Municipal Cleaner';
            } else if (user.workplaceId.includes('_')) {
                // Underworld Work
                isUnderworld = true;
                const [mafiaId, type] = user.workplaceId.split('_');
                mafiaData = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [mafiaId, type.toLowerCase()]);
                if (!mafiaData) {
                    await db.run(`UPDATE users SET workplaceId = NULL WHERE userId = ?`, [interaction.user.id]);
                    return await interaction.editReply({ content: '❌ Your underworld venture has been busted. Find a new job!', ephemeral: true });
                }
                salary = mafiaData.salary;
                cooldown = mafiaData.cooldown !== undefined ? mafiaData.cooldown : 14400; // default 4 hours
                jobName = mafiaData.customName ? `${mafiaData.customName} Associate` : `Underworld ${mafiaData.type.toUpperCase()} Associate`;
            } else {
                // Legal Work
                workplace = await db.get(`SELECT * FROM economy_operations WHERE id = ?`, [user.workplaceId]);
                if (!workplace) {
                    await db.run(`UPDATE users SET workplaceId = NULL WHERE userId = ?`, [interaction.user.id]);
                    return await interaction.editReply({ content: '❌ Your workplace has gone out of business. Please find a new job!', ephemeral: true });
                }
                salary = workplace.salary;
                cooldown = workplace.cooldown !== undefined ? workplace.cooldown : 14400; // default 4 hours
                jobName = workplace.customName ? `${workplace.customName} Employee` : `${workplace.type.replace('_', ' ').toUpperCase()} Employee`;
            }
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

        // Fluctuate salary by +/- 5% (GTA / Mafia style realism)
        const fluctuationPercent = 0.95 + (Math.random() * 0.10);
        const finalSalary = Math.floor(salary * fluctuationPercent);

        // --- PAYROLL CHECKS & DEDUCTIONS ---
        if (isUnderworld) {
            const [mafiaId] = user.workplaceId.split('_');
            const mafia = await db.get(`SELECT leaderId FROM economy_mafias WHERE id = ?`, [mafiaId]);
            if (!mafia) {
                return await interaction.editReply({ content: `❌ Syndicate data not found!`, ephemeral: true });
            }
            const don = await db.get(`SELECT balance, bank FROM users WHERE userId = ?`, [mafia.leaderId]);
            if (!don || (don.balance + don.bank) < finalSalary) {
                return await interaction.editReply({ content: `❌ The Don (<@${mafia.leaderId}>) is short on funds and cannot pay your salary!`, ephemeral: true });
            }
            // Deduct from Don's wallet/bank
            if (don.balance >= finalSalary) {
                await removeBalance(mafia.leaderId, finalSalary, interaction.guild.id, `Syndicate Payroll to ${interaction.user.tag}`);
            } else {
                const remaining = finalSalary - don.balance;
                if (don.balance > 0) {
                    await removeBalance(mafia.leaderId, don.balance, interaction.guild.id, `Syndicate Payroll (partial) to ${interaction.user.tag}`);
                }
                await db.run(`UPDATE users SET balance = 0, bank = bank - ? WHERE userId = ?`, [remaining, mafia.leaderId]);
            }
        } else if (workplace) {
            const owner = await db.get(`SELECT balance, bank FROM users WHERE userId = ?`, [workplace.userId]);
            if (!owner || (owner.balance + owner.bank) < finalSalary) {
                return await interaction.editReply({ content: `❌ The business is short on funds and cannot pay your salary! Contact the owner (<@${workplace.userId}>) to deposit coins.`, ephemeral: true });
            }
            // Deduct from owner
            if (owner.balance >= finalSalary) {
                await removeBalance(workplace.userId, finalSalary, interaction.guild.id, `Business Payroll to ${interaction.user.tag}`);
            } else {
                const remaining = finalSalary - owner.balance;
                if (owner.balance > 0) {
                    await removeBalance(workplace.userId, owner.balance, interaction.guild.id, `Business Payroll (partial) to ${interaction.user.tag}`);
                }
                await db.run(`UPDATE users SET balance = 0, bank = bank - ? WHERE userId = ?`, [remaining, workplace.userId]);
            }
        }

        // Add balance or dirty money
        let balanceMsg = '';
        if (isUnderworld) {
            const [mafiaId] = user.workplaceId.split('_');
            await db.run(`UPDATE mafia_members SET dirtyMoney = dirtyMoney + ? WHERE userId = ? AND mafiaId = ?`, [finalSalary, interaction.user.id, mafiaId]);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, finalSalary, 'dirty_money_gain', {
                reason: `Salary for Underworld Work (${jobName})`
            });
            balanceMsg = `💰 **${finalSalary}** dirty bills added to your stash.`;
            
            // Bonus to mafia business: Boost production (stock)
            await db.run(`UPDATE mafia_businesses SET stock = stock + 10 WHERE mafiaId = ? AND type = ?`, [mafiaId, mafiaData.type]);
        } else if (user.workplaceId === 'MUNICIPAL') {
            const newBal = await addBalance(interaction.user.id, finalSalary, interaction.guild.id, false, `Salary for working as Municipal Cleaner`);
            balanceMsg = `💰 New Balance: **${newBal}** coins`;
        } else {
            const newBal = await addBalance(interaction.user.id, finalSalary, interaction.guild.id, false, `Salary for working as ${jobName}`);
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

        await db.run(`UPDATE users SET lastWork = ?, workExperience = COALESCE(workExperience, 0) + 1 WHERE userId = ?`, [now, interaction.user.id]);
        const updatedUser = await db.get(`SELECT workExperience FROM users WHERE userId = ?`, [interaction.user.id]);
        const newExp = updatedUser ? updatedUser.workExperience : 0;

        const embed = new EmbedBuilder()
            .setTitle('🏢 Shift Completed!')
            .setDescription(`You worked hard as a **${jobName}**!`)
            .addFields(
                { name: 'Earnings', value: balanceMsg, inline: true },
                { name: '⭐ Job Experience', value: `\`${newExp} XP\` (+1)`, inline: true }
            )
            .setColor(isUnderworld ? '#ef4444' : (user.workplaceId === 'MUNICIPAL' ? '#6b7280' : '#10b981'))
            .setFooter({ text: 'Thank you for contributing to the city economy.' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
