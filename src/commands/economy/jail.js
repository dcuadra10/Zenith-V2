const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { removeBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Manage your jail status and trials')
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('View your current sentence'))
        .addSubcommand(sub =>
            sub.setName('trial')
                .setDescription('Request a trial to reduce your sentence (Once per arrest)'))
        .addSubcommand(sub =>
            sub.setName('bribe')
                .setDescription('Pay a corrupt guard to let you out')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to bribe (min 1000)').setRequired(true).setMinValue(1000))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const db = await getDb();
        const guildId = interaction.guild.id;
        const userData = await db.get(`SELECT jailUntil FROM users WHERE userId = ? AND guildId = ?`, [interaction.user.id, guildId]);

        if (sub === 'info') {
            if (!userData || !userData.jailUntil || new Date(userData.jailUntil) <= new Date()) {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '✅ You are a free citizen! No active sentence.' });
                } else {
                    return await interaction.reply({ content: '✅ You are a free citizen! No active sentence.' });
                }
            }

            const diffMs = new Date(userData.jailUntil) - new Date();
            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.ceil((diffMs % 3600000) / 60000);
            const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

            const embed = new EmbedBuilder()
                .setTitle('⛓️ Jail Record')
                .setDescription(`You are currently serving a sentence in the Zenith Correctional Facility.`)
                .addFields({ name: 'Time Remaining', value: `⏳ ${timeStr}` })
                .setColor('#b91c1c')
                .setTimestamp();

            if (interaction.replied || interaction.deferred) {
                return await interaction.editReply({ embeds: [embed] });
            } else {
                return await interaction.reply({ embeds: [embed] });
            }
        }

        if (sub === 'trial') {
            if (!userData || !userData.jailUntil || new Date(userData.jailUntil) <= new Date()) {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '❌ You are not in jail.' });
                } else {
                    return await interaction.reply({ content: '❌ You are not in jail.' });
                }
            }

            // Simple trial mechanic: 30% chance to be released, 70% chance nothing happens
            const success = Math.random() > 0.7;
            if (success) {
                await db.run(`UPDATE users SET jailUntil = NULL WHERE userId = ? AND guildId = ?`, [interaction.user.id, guildId]);
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '⚖️ **The Judge has ruled in your favor!** You have been released from jail early.' });
                } else {
                    return await interaction.reply({ content: '⚖️ **The Judge has ruled in your favor!** You have been released from jail early.' });
                }
            } else {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '⚖️ **Verdict:** The evidence against you is too strong. The sentence remains unchanged.' });
                } else {
                    return await interaction.reply({ content: '⚖️ **Verdict:** The evidence against you is too strong. The sentence remains unchanged.' });
                }
            }
        }

        if (sub === 'bribe') {
            if (!userData || !userData.jailUntil || new Date(userData.jailUntil) <= new Date()) {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '❌ You are not in jail.' });
                } else {
                    return await interaction.reply({ content: '❌ You are not in jail.' });
                }
            }

            const amount = interaction.options.getInteger('amount');
            const success = await removeBalance(interaction.user.id, amount, guildId, 'Jail bribe');
            if (!success) {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '❌ You don\'t have enough money for this bribe!' });
                } else {
                    return await interaction.reply({ content: '❌ You don\'t have enough money for this bribe!' });
                }
            }

            // Bribe chance: scale with amount. 1000 = 10%, 5000 = 50%, 10000 = 100%
            const chance = Math.min(amount / 10000, 1);
            if (Math.random() < chance) {
                await db.run(`UPDATE users SET jailUntil = NULL WHERE userId = ? AND guildId = ?`, [interaction.user.id, guildId]);
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: `💰 **The guard took the cash.** You slip out of the back door. You are free!` });
                } else {
                    return await interaction.reply({ content: `💰 **The guard took the cash.** You slip out of the back door. You are free!` });
                }
            } else {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.editReply({ content: '👮 **The guard rejected the bribe!** "You trying to corrupt me, boy?" He keeps the cash anyway as a "fine".' });
                } else {
                    return await interaction.reply({ content: '👮 **The guard rejected the bribe!** "You trying to corrupt me, boy?" He keeps the cash anyway as a "fine".' });
                }
            }
        }
    }
};
