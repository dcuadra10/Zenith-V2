const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { removeBalance, addBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rob')
        .setDescription('Attempt to rob another citizen (GTA Style)')
        .addUserOption(opt => opt.setName('target').setDescription('The user you want to rob').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();
        const target = interaction.options.getUser('target');
        const db = await getDb();

        if (target.id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot rob yourself!' });
        if (target.bot) return interaction.editReply({ content: '❌ You cannot rob bots!' });

        const user = await db.get(`SELECT mafiaId FROM users WHERE userId = ?`, [interaction.user.id]);
        const targetData = await db.get(`SELECT balance FROM users WHERE userId = ?`, [target.id]);
        
        if (!targetData || targetData.balance < 100) return await interaction.editReply({ content: '❌ Target too poor to rob!' });

        // Mafia logic integration
        const mafia = user?.mafiaId ? await db.get(`SELECT upgrades, taxRate FROM economy_mafias WHERE id = ?`, [user.mafiaId]) : null;
        const upgrades = mafia ? JSON.parse(mafia.upgrades || '[]') : [];

        let successChance = user?.mafiaId ? 0.45 : 0.35; // Mafias are more skilled
        if (upgrades.includes('silencers')) successChance += 0.15;
        if (upgrades.includes('scanner')) successChance += 0.05;

        // Fail Logic (Jail)
        if (Math.random() > successChance) {
            const jailTime = 30; // 30 minutes
            const jailUntil = new Date(Date.now() + jailTime * 60000).toISOString();
            await db.run(`UPDATE users SET jailUntil = ? WHERE userId = ?`, [jailUntil, interaction.user.id]);
            
            const embed = new EmbedBuilder()
                .setTitle('👮 ARRESTED!')
                .setDescription(`You were caught attempting to rob <@${target.id}>!\n\n**Sentence:** ${jailTime} minutes in jail.\n**Fine:** 200 Zenith Coins.`)
                .setColor('#ef4444');
            
            await removeBalance(interaction.user.id, 200);
            return await interaction.editReply({ embeds: [embed] });
        }

        // Success Logic
        const amount = Math.floor(targetData.balance * (0.1 + Math.random() * 0.15)); // 10-25%
        await removeBalance(target.id, amount);

        if (user?.mafiaId) {
            const tax = mafia.taxRate || 0.05;
            const vaultShare = Math.floor(amount * tax);
            const memberShare = amount - vaultShare;
            
            await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [vaultShare, user.mafiaId]);
            await db.run(`UPDATE mafia_members SET dirtyMoney = dirtyMoney + ? WHERE userId = ? AND mafiaId = ?`, [memberShare, interaction.user.id, user.mafiaId]);
            
            const embed = new EmbedBuilder()
                .setTitle('🎭 ROBBERY SUCCESS')
                .setDescription(`You successfully robbed <@${target.id}>!`)
                .addFields(
                    { name: '<:zenith_coin:1510656265830011031> Total Loot', value: `${amount} 🪙`, inline: true },
                    { name: '<:zenith_bank:1510681878032552166> Mafia Tax', value: `${vaultShare} 🪙 sent to vault`, inline: true },
                    { name: '<:zenith_user:1510658870790590646> Your Cut', value: `${memberShare} (Dirty Money)`, inline: true }
                )
                .setColor('#10b981')
                .setFooter({ text: '💡 You earned Dirty Money! Use "/mafia clean" to launder it into clean coins.' });
                
            return await interaction.editReply({ embeds: [embed] });
        } else {
            await addBalance(interaction.user.id, amount, interaction.guild.id);
            
            const embed = new EmbedBuilder()
                .setTitle('🧤 LONE WOLF ROBBERY')
                .setDescription(`You successfully robbed <@${target.id}> and got away with **${amount}** Zenith Coins!`)
                .setColor('#10b981');
                
            return await interaction.editReply({ embeds: [embed] });
        }
    }
};
