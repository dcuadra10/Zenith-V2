const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { addBalance, removeBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Transfer coins to another user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to pay')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('The amount of coins to send')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (target.id === interaction.user.id) {
            return await interaction.reply({ content: '❌ You cannot pay yourself!', ephemeral: true });
        }
        if (target.bot) {
            return await interaction.reply({ content: '❌ You cannot pay bots!', ephemeral: true });
        }

        const success = await removeBalance(interaction.user.id, amount, interaction.guild.id, `Transfer to ${target.tag}`);
        if (!success) {
            return await interaction.reply({ content: '❌ You don\'t have enough coins!', ephemeral: true });
        }

        await addBalance(target.id, amount, interaction.guild.id, false, `Transfer from ${interaction.user.tag}`, true);

        const embed = new EmbedBuilder()
            .setTitle('💸 Transfer Successful')
            .setDescription(`You sent **${amount}** coins to <@${target.id}>.`)
            .setColor('#3b82f6')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
