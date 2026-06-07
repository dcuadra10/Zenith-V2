const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current coin balance')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to check balance for')
                .setRequired(false)),
    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const db = await getDb();
        const user = await db.get(`SELECT balance, bank, bankCapacity FROM users WHERE userId = ? AND guildId = ?`, [target.id, interaction.guild.id]);
        const mafiaMember = await db.get(`SELECT dirtyMoney FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [target.id, interaction.guild.id]);
        
        const wallet = user?.balance ?? 0;
        const bank = user?.bank ?? 0;
        const capacity = user?.bankCapacity ?? 5000;
        const dirty = mafiaMember?.dirtyMoney ?? 0;

        const walletFormatted = Number(wallet).toLocaleString('en-US');
        const bankFormatted = Number(bank).toLocaleString('en-US');
        const capacityFormatted = Number(capacity).toLocaleString('en-US');
        const dirtyFormatted = Number(dirty).toLocaleString('en-US');

        const embed = new EmbedBuilder()
            .setTitle(`💰 Financial Status: ${target.username}`)
            .addFields(
                { name: '<:zenith_coin:1510656265830011031> Wallet (Cash)', value: `**${walletFormatted}** 🪙`, inline: true },
                { name: '<:zenith_bank:1510681878032552166> Bank (Safe)', value: `**${bankFormatted}** / ${capacityFormatted} 🪙`, inline: true },
                { name: '💵 Dirty Money', value: `**${dirtyFormatted}** 💵\n*Use \`/mafia clean\` to launder.*`, inline: true }
            )
            .setColor('#10b981')
            .setThumbnail(target.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Use /bank deposit to save your Zenith Coins!' });

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed] });
        }
    },
};
