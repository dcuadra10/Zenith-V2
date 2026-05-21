const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rss-stock-setup')
        .setDescription('Set up the RSS Stock Management panel in the current channel (Admins only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const db = await getDb();
        const config = await db.get(`SELECT rssEnabled, rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        if (!config || !config.rssEnabled) {
            return interaction.reply({ content: '❌ The RSS Buying module is currently disabled. Please enable it in the dashboard first.', ephemeral: true });
        }

        const roleNameOrId = config.rssSellerRole || 'RSS Seller';
        const guild = interaction.guild;
        
        let sellers = [];
        let sellerListStr = 'No verified RSS Sellers found.';
        
        try {
            const role = guild.roles.cache.get(roleNameOrId) || guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
            if (role) {
                await guild.members.fetch();
                const membersWithRole = role.members;
                sellers = membersWithRole.map(m => m.id);
                if (membersWithRole.size > 0) {
                    sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                }
            } else {
                await guild.members.fetch();
                const membersWithRole = guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase()));
                sellers = membersWithRole.map(m => m.id);
                if (membersWithRole.size > 0) {
                    sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                }
            }
        } catch (err) {
            console.error('[Stock Setup] Error fetching members/roles:', err);
        }

        let totalFood = 0, totalWood = 0, totalStone = 0, totalGold = 0;
        if (sellers.length > 0) {
            const placeholders = sellers.map(() => '?').join(',');
            const row = await db.get(`SELECT SUM(food) as f, SUM(wood) as w, SUM(stone) as s, SUM(gold) as g FROM rss_seller_stocks WHERE sellerId IN (${placeholders})`, sellers);
            if (row) {
                totalFood = row.f || 0;
                totalWood = row.w || 0;
                totalStone = row.s || 0;
                totalGold = row.g || 0;
            }
        }

        const formatNumber = (num) => {
            if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(1) + 'k';
            return num.toString();
        };

        const embed = new EmbedBuilder()
            .setTitle('📦 Collective RSS Stock Management')
            .setDescription(`Welcome to the **RSS Stock Management Portal**.\n\nSellers can add to their private stock directly from this panel using the button below. Individual stocks remain private, only the aggregate collective total is visible.`)
            .addFields(
                { name: '👥 Verified Sellers', value: sellerListStr },
                { name: '🌾 Collective Stocks', value: `**Food:** ${formatNumber(totalFood)}\n**Wood:** ${formatNumber(totalWood)}\n**Stone:** ${formatNumber(totalStone)}\n**Gold:** ${formatNumber(totalGold)}` }
            )
            .setColor('#4f46e5')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rss_stock_add_click')
                .setLabel('Add Stock')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ RSS Stock Management panel created successfully!', ephemeral: true });
    },
};
