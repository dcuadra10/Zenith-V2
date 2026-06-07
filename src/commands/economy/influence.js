const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { addBalance, removeBalance } = require('../../utils/economyHandler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('influence')
        .setDescription('Trade influence in city sectors')
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View current influence market prices'))
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Invest in a city sector')
                .addStringOption(opt => opt.setName('sector').setDescription('Sector to invest in').setRequired(true).addChoices(
                    { name: '🏛️ Political (Reduces Fines)', value: 'political' },
                    { name: '🏭 Industrial (Boosts Salaries)', value: 'industrial' },
                    { name: '🌑 Underworld (Boosts Heists)', value: 'underworld' },
                    { name: '📺 Media (Reduces Cooldowns)', value: 'media' },
                    { name: '🚚 Transport (Boosts Missions)', value: 'transport' }
                ))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of influence points to buy').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('type').setDescription('Invest as?').setRequired(true).addChoices(
                    { name: 'Personal (Your Balance)', value: 'user' },
                    { name: 'Mafia (Mafia Treasury)', value: 'mafia' }
                )))
        .addSubcommand(sub =>
            sub.setName('sell')
                .setDescription('Liquidate your influence points')
                .addStringOption(opt => opt.setName('sector').setDescription('Sector to sell').setRequired(true).addChoices(
                    { name: 'Political', value: 'political' },
                    { name: 'Industrial', value: 'industrial' },
                    { name: 'Underworld', value: 'underworld' },
                    { name: 'Media', value: 'media' },
                    { name: 'Transport', value: 'transport' }
                ))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to sell').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('type').setDescription('Sell from?').setRequired(true).addChoices(
                    { name: 'Personal', value: 'user' },
                    { name: 'Mafia', value: 'mafia' }
                ))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const db = await getDb();

        // Initial prices if empty
        const sectors = ['political', 'industrial', 'underworld', 'media', 'transport'];
        for (const s of sectors) {
            await db.run(`INSERT INTO economy_influence (sectorId, guildId, name, price) VALUES (?, ?, ?, ?) ON CONFLICT(sectorId, guildId) DO NOTHING`,
                [s, interaction.guild.id, s.charAt(0).toUpperCase() + s.slice(1), 100]);
        }

        if (sub === 'view') {
            const data = await db.all(`SELECT * FROM economy_influence WHERE guildId = ?`, [interaction.guild.id]);
            const embed = new EmbedBuilder()
                .setTitle('📊 City Influence Market & Control')
                .setDescription('Invest to control city sectors and gain passive benefits!')
                .setColor('#6366f1')
                .setTimestamp();

            for (const s of data) {
                let controlText = 'None';
                if (s.controllingEntityId) {
                    if (s.controllingEntityType === 'mafia') {
                        const m = await db.get(`SELECT name FROM economy_mafias WHERE id = ? AND guildId = ?`, [s.controllingEntityId, interaction.guild.id]);
                        controlText = m ? `🛡️ ${m.name}` : 'Unknown Mafia';
                    } else {
                        controlText = `👤 <@${s.controllingEntityId}>`;
                    }
                    
                    const controlPercent = Math.round((s.totalInvested > 0 ? (await db.get(`SELECT points FROM economy_entity_influence WHERE entityId = ? AND sectorId = ? AND guildId = ?`, [s.controllingEntityId, s.sectorId, interaction.guild.id])).points / s.totalInvested : 0) * 100);
                    controlText += ` (${controlPercent}%)`;
                    if (controlPercent >= 100) controlText = `👑 **TOTAL CONTROL: ${controlText}**`;
                }

                embed.addFields({ 
                    name: s.name, 
                    value: `💰 **Price:** ${s.price.toFixed(2)} coins\n📈 **Points:** ${s.totalInvested}\n🕹️ **Controller:** ${controlText}`, 
                    inline: true 
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'buy') {
            const sectorId = interaction.options.getString('sector');
            const amount = interaction.options.getInteger('amount');
            const type = interaction.options.getString('type');
            
            const sector = await db.get(`SELECT * FROM economy_influence WHERE guildId = ? WHERE sectorId = ?`, [sectorId]);
            const cost = Math.floor(sector.price * amount);

            let entityId = interaction.user.id;
            if (type === 'mafia') {
                const user = await db.get(`SELECT mafiaId FROM users WHERE userId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
                if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });
                
                const mafia = await db.get(`SELECT balance FROM economy_mafias WHERE id = ? AND guildId = ?`, [user.mafiaId, interaction.guild.id]);
                if (mafia.balance < cost) return await interaction.editReply({ content: `❌ Mafia treasury needs **${cost}** coins!` });
                
                await db.run(`UPDATE economy_mafias SET balance = balance - ? WHERE id = ? AND guildId = ?`, [cost, user.mafiaId, interaction.guild.id]);
                entityId = user.mafiaId;
            } else {
                const success = await removeBalance(interaction.user.id, cost);
                if (!success) return await interaction.editReply({ content: `❌ You need **${cost}** coins!` });
            }

            await db.run(`INSERT INTO economy_entity_influence (entityId, entityType, sectorId, guildId, points) VALUES (?, ?, ?, ?, ?) 
                ON CONFLICT(entityId, entityType, sectorId, guildId) DO UPDATE SET points = economy_entity_influence.points + ?`,
                [entityId, type, sectorId, interaction.guild.id, amount, amount]);

            // Price increases
            const newPrice = sector.price + (amount * 0.05);
            const newTotal = sector.totalInvested + amount;
            await db.run(`UPDATE economy_influence SET price = ?, totalInvested = ? WHERE sectorId = ? AND guildId = ?`, [newPrice, newTotal, sectorId, interaction.guild.id]);

            // Recalculate Control
            const topEntity = await db.get(`SELECT entityId, entityType, points FROM economy_entity_influence WHERE sectorId = ? AND guildId = ? ORDER BY points DESC LIMIT 1`, [sectorId, interaction.guild.id]);
            if (topEntity && topEntity.points > (newTotal / 2)) {
                await db.run(`UPDATE economy_influence SET controllingEntityId = ?, controllingEntityType = ? WHERE sectorId = ? AND guildId = ?`, 
                    [topEntity.entityId, topEntity.entityType, sectorId]);
            } else {
                await db.run(`UPDATE economy_influence SET controllingEntityId = NULL, controllingEntityType = NULL WHERE sectorId = ? AND guildId = ?`, [sectorId, interaction.guild.id]);
            }

            return await interaction.editReply({ content: `✅ **Investment Success!** You bought **${amount}** points in **${sector.name}** for **${cost}** coins.` });
        }

        if (sub === 'sell') {
            const sectorId = interaction.options.getString('sector');
            const amount = interaction.options.getInteger('amount');
            const type = interaction.options.getString('type');

            let entityId = interaction.user.id;
            if (type === 'mafia') {
                const user = await db.get(`SELECT mafiaId FROM users WHERE userId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
                if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });
                entityId = user.mafiaId;
            }

            const entityInf = await db.get(`SELECT points FROM economy_entity_influence WHERE entityId = ? AND entityType = ? AND sectorId = ? AND guildId = ?`, [entityId, type, sectorId, interaction.guild.id]);
            if (!entityInf || entityInf.points < amount) return await interaction.editReply({ content: '❌ Not enough influence points to sell!' });

            const sector = await db.get(`SELECT * FROM economy_influence WHERE guildId = ? WHERE sectorId = ?`, [sectorId]);
            const revenue = Math.floor(sector.price * amount * 0.95);

            await db.run(`UPDATE economy_entity_influence SET points = points - ? WHERE entityId = ? AND entityType = ? AND sectorId = ? AND guildId = ?`, [amount, entityId, type, sectorId, interaction.guild.id]);
            
            if (type === 'mafia') {
                await db.run(`UPDATE economy_mafias SET balance = balance + ? WHERE id = ? AND guildId = ?`, [revenue, entityId, interaction.guild.id]);
            } else {
                await addBalance(interaction.user.id, revenue, interaction.guild.id);
            }

            // Price decreases
            const newPrice = Math.max(50, sector.price - (amount * 0.05));
            const newTotal = sector.totalInvested - amount;
            await db.run(`UPDATE economy_influence SET price = ?, totalInvested = ? WHERE sectorId = ? AND guildId = ?`, [newPrice, newTotal, sectorId, interaction.guild.id]);

            // Recalculate Control
            const topEntity = await db.get(`SELECT entityId, entityType, points FROM economy_entity_influence WHERE sectorId = ? AND guildId = ? ORDER BY points DESC LIMIT 1`, [sectorId, interaction.guild.id]);
            if (topEntity && topEntity.points > (newTotal / 2)) {
                await db.run(`UPDATE economy_influence SET controllingEntityId = ?, controllingEntityType = ? WHERE sectorId = ? AND guildId = ?`, 
                    [topEntity.entityId, topEntity.entityType, sectorId]);
            } else {
                await db.run(`UPDATE economy_influence SET controllingEntityId = NULL, controllingEntityType = NULL WHERE sectorId = ? AND guildId = ?`, [sectorId, interaction.guild.id]);
            }

            return await interaction.editReply({ content: `✅ **Liquidated!** Sold **${amount}** points for **${revenue}** coins.` });
        }
    }
};
