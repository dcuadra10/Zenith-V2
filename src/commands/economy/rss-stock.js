const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

function parseRssAmount(val) {
    if (val === null || val === undefined) return null;
    let clean = val.toString().trim().toLowerCase();
    if (!clean) return null;

    // Remove any commas or spaces: "50,000,000" -> "50000000", "50 M" -> "50m"
    clean = clean.replace(/,/g, '').replace(/\s+/g, '');

    // Map written variations of million/billion/thousand (both Spanish and English)
    clean = clean.replace(/million(s)?|millon(es)?/, 'm');
    clean = clean.replace(/billion(s)?|billon(es)?/, 'b');
    clean = clean.replace(/thousand(s)?|mil/, 'k');

    const match = clean.match(/^([\d.]+)([mkb]?)$/);
    if (!match) return null;
    const num = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
        case 'k': return Math.floor(num * 1_000);
        case 'm': return Math.floor(num * 1_000_000);
        case 'b': return Math.floor(num * 1_000_000_000);
        default: return Math.floor(num);
    }
}

function formatRssAmount(num) {
    if (num === null || num === undefined) return '0';
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2).replace(/\.00$/, '') + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(2).replace(/\.00$/, '') + 'k';
    }
    return num.toLocaleString();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rss-stock')
        .setDescription('View or update RSS stock (Sellers and Admins only)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Whether to add, set, or remove stock levels')
                .setRequired(false)
                .addChoices(
                    { name: '➕ Add to Stock', value: 'add' },
                    { name: '⚙️ Set Stock', value: 'set' },
                    { name: '➖ Remove from Stock', value: 'remove' }
                ))
        .addStringOption(option =>
            option.setName('food')
                .setDescription('Amount of Food (e.g. 50M, 100k, 50000000)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('wood')
                .setDescription('Amount of Wood (e.g. 50M, 100k)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('stone')
                .setDescription('Amount of Stone (e.g. 50M, 100k)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('gold')
                .setDescription('Amount of Gold (e.g. 10M, 50k)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('payments')
                .setDescription('Accepted payments (comma-separated, e.g. paypal,zelle,crypto)')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('seller')
                .setDescription('The seller whose stock you want to view (Admins only)')
                .setRequired(false)),

    async execute(interaction) {
        const member = interaction.member;
        if (!member) {
            return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
        }
        
        const db = await getDb();
        const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        const roleNameOrId = config?.rssSellerRole || 'RSS Seller';

        const isSeller = member.roles.cache.has(roleNameOrId) || member.roles.cache.some(role => role.name.toLowerCase() === roleNameOrId.toLowerCase());
        const isAdmin = member.permissions.has('Administrator');
        
        if (!isSeller && !isAdmin) {
            return interaction.reply({ 
                content: `❌ You must have the **${roleNameOrId}** role or Administrator permissions to use this command.`, 
                ephemeral: true 
            });
        }

        const targetUser = interaction.options.getUser('seller');

        // Case 1: Viewing another seller's stock (Admins only)
        if (targetUser) {
            if (!isAdmin) {
                return interaction.reply({ content: '❌ Only administrators can view other sellers\' stocks.', ephemeral: true });
            }
            
            // Check if target has seller role
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const targetHasRole = targetMember && (targetMember.roles.cache.has(roleNameOrId) || targetMember.roles.cache.some(role => role.name.toLowerCase() === roleNameOrId.toLowerCase()));
            if (!targetHasRole) {
                return interaction.reply({ content: `❌ <@${targetUser.id}> does not have the **${roleNameOrId}** role.`, ephemeral: true });
            }

            const stock = await db.get(`SELECT food, wood, stone, gold, paymentMethods FROM rss_seller_stocks WHERE sellerId = ? AND guildId = ?`, [targetUser.id, interaction.guild.id]) || { food: 0, wood: 0, stone: 0, gold: 0, paymentMethods: '' };
            
            const paymentLabels = {
                paypal: '💳 PayPal', cashapp: '💵 Cash App', venmo: '📱 Venmo', zelle: '🏦 Zelle',
                revolut: '🪙 Revolut', crypto: '₿ Crypto', bank: '🏛️ Bank Transfer', applepay: '🍎 Apple Pay / Google Pay'
            };
            const pMethods = (stock.paymentMethods || '').split(',').filter(Boolean);
            const pLabels = pMethods.length > 0 ? pMethods.map(p => paymentLabels[p] || p.toUpperCase()).join(', ') : 'None specified';

            const embed = new EmbedBuilder()
                .setTitle(`🌾 RSS Stock Inventory: ${targetUser.username}`)
                .setDescription(`Individual stock level for seller <@${targetUser.id}>.`)
                .addFields(
                    { name: '🌾 Food', value: `**${formatRssAmount(stock.food)}**`, inline: true },
                    { name: '🪵 Wood', value: `**${formatRssAmount(stock.wood)}**`, inline: true },
                    { name: '🪨 Stone', value: `**${formatRssAmount(stock.stone)}**`, inline: true },
                    { name: '🪙 Gold', value: `**${formatRssAmount(stock.gold)}**`, inline: true },
                    { name: '💳 Accepted Payment Methods', value: pLabels, inline: false }
                )
                .setColor('#4f46e5')
                .setThumbnail(targetUser.displayAvatarURL())
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Case 2: General View for Admin (shows all sellers)
        if (isAdmin && !interaction.options.getString('action') && !interaction.options.getString('payments') && !interaction.options.getString('food') && !interaction.options.getString('wood') && !interaction.options.getString('stone') && !interaction.options.getString('gold')) {
            let sellers = [];
            try {
                const role = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                if (role) {
                    await interaction.guild.members.fetch();
                    sellers = Array.from(role.members.keys());
                } else {
                    await interaction.guild.members.fetch();
                    sellers = Array.from(interaction.guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase())).keys());
                }
            } catch (err) {
                console.error('[View Stock Cmd] Error fetching members:', err);
            }

            if (sellers.length === 0) {
                return interaction.reply({ content: '❌ No verified RSS Sellers found in this server.', ephemeral: true });
            }

            const placeholders = sellers.map(() => '?').join(',');
            const rows = await db.all(`SELECT sellerId, food, wood, stone, gold FROM rss_seller_stocks WHERE guildId = ? AND sellerId IN (${placeholders})`, [interaction.guild.id, ...sellers]);

            const embed = new EmbedBuilder()
                .setTitle('📊 RSS Seller Inventory (Admins Only)')
                .setDescription('Here are the individual stock levels for all verified RSS Sellers:')
                .setColor('#4f46e5')
                .setTimestamp();

            sellers.forEach(sId => {
                const sRow = rows.find(r => r.sellerId === sId) || { food: 0, wood: 0, stone: 0, gold: 0 };
                embed.addFields({
                    name: `👤 Seller: ${interaction.guild.members.cache.get(sId)?.displayName || sId}`,
                    value: `🌾 Food: **${formatRssAmount(sRow.food)}** | 🪵 Wood: **${formatRssAmount(sRow.wood)}**\n🪨 Stone: **${formatRssAmount(sRow.stone)}** | 🪙 Gold: **${formatRssAmount(sRow.gold)}**`,
                    inline: false
                });
            });

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Case 3: Regular seller stock update/view
        if (!isSeller) {
            return interaction.reply({ content: `❌ You must have the **${roleNameOrId}** role to update or view your stock.`, ephemeral: true });
        }

        const sellerId = interaction.user.id;

        // Fetch current stock
        let stock = await db.get(`SELECT food, wood, stone, gold, paymentMethods FROM rss_seller_stocks WHERE sellerId = ? AND guildId = ?`, [sellerId, interaction.guild.id]);
        if (!stock) {
            await db.run(`INSERT INTO rss_seller_stocks (sellerId, guildId, food, wood, stone, gold, paymentMethods) VALUES (?, ?, 0, 0, 0, 0, ?)`, [sellerId, interaction.guild.id, 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay']);
            stock = { food: 0, wood: 0, stone: 0, gold: 0, paymentMethods: 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay' };
        }

        const action = interaction.options.getString('action');
        const rawFood = interaction.options.getString('food');
        const rawWood = interaction.options.getString('wood');
        const rawStone = interaction.options.getString('stone');
        const rawGold = interaction.options.getString('gold');
        const rawPayments = interaction.options.getString('payments');

        // Handle payment method update
        if (rawPayments !== null) {
            const validMethods = ['paypal', 'cashapp', 'venmo', 'zelle', 'revolut', 'crypto', 'bank', 'applepay'];
            const inputs = rawPayments.toLowerCase().split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
            const normalized = inputs.filter(p => validMethods.includes(p));
            
            if (normalized.length === 0) {
                return interaction.reply({
                    content: '❌ Invalid payment methods! Supported methods: `paypal`, `cashapp`, `venmo`, `zelle`, `revolut`, `crypto`, `bank`, `applepay`.',
                    ephemeral: true
                });
            }
            const joinedPayments = normalized.join(',');
            await db.run(`UPDATE rss_seller_stocks SET paymentMethods = ? WHERE sellerId = ? AND guildId = ?`, [joinedPayments, sellerId, interaction.guild.id]);
            stock.paymentMethods = joinedPayments;
        }

        // Check if any stock update was requested
        if (action && (rawFood !== null || rawWood !== null || rawStone !== null || rawGold !== null)) {
            const foodVal = parseRssAmount(rawFood);
            const woodVal = parseRssAmount(rawWood);
            const stoneVal = parseRssAmount(rawStone);
            const goldVal = parseRssAmount(rawGold);

            if (
                (rawFood !== null && foodVal === null) ||
                (rawWood !== null && woodVal === null) ||
                (rawStone !== null && stoneVal === null) ||
                (rawGold !== null && goldVal === null)
            ) {
                return interaction.reply({
                    content: '❌ Invalid number format! Please use numbers (e.g. `50000000`) or standard multipliers (e.g. `50M`, `100k`).',
                    ephemeral: true
                });
            }

            let newFood = stock.food;
            let newWood = stock.wood;
            let newStone = stock.stone;
            let newGold = stock.gold;

            if (action === 'add') {
                if (foodVal !== null) newFood += foodVal;
                if (woodVal !== null) newWood += woodVal;
                if (stoneVal !== null) newStone += stoneVal;
                if (goldVal !== null) newGold += goldVal;
            } else if (action === 'set') {
                if (foodVal !== null) newFood = foodVal;
                if (woodVal !== null) newWood = woodVal;
                if (stoneVal !== null) newStone = stoneVal;
                if (goldVal !== null) newGold = goldVal;
            } else if (action === 'remove') {
                if (foodVal !== null) newFood = Math.max(0, newFood - foodVal);
                if (woodVal !== null) newWood = Math.max(0, newWood - woodVal);
                if (stoneVal !== null) newStone = Math.max(0, newStone - stoneVal);
                if (goldVal !== null) newGold = Math.max(0, newGold - goldVal);
            }

            // Save back to DB
            await db.run(
                `UPDATE rss_seller_stocks SET food = ?, wood = ?, stone = ?, gold = ?, updatedAt = CURRENT_TIMESTAMP WHERE sellerId = ? AND guildId = ?`,
                [newFood, newWood, newStone, newGold, sellerId, interaction.guild.id]
            );

            // Update current memory reference for output
            stock.food = newFood;
            stock.wood = newWood;
            stock.stone = newStone;
            stock.gold = newGold;
        } else if (!action && (rawFood !== null || rawWood !== null || rawStone !== null || rawGold !== null)) {
            return interaction.reply({
                content: '❌ You must select an **Action** (➕ Add to Stock or ⚙️ Set Stock) when providing stock values.',
                ephemeral: true
            });
        }

        const paymentLabels = {
            paypal: '💳 PayPal',
            cashapp: '💵 Cash App',
            venmo: '📱 Venmo',
            zelle: '🏦 Zelle',
            revolut: '🪙 Revolut',
            crypto: '₿ Crypto',
            bank: '🏛️ Bank Transfer',
            applepay: '🍎 Apple Pay / Google Pay'
        };
        const pMethods = (stock.paymentMethods || 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay').split(',');
        const pLabels = pMethods.map(p => paymentLabels[p] || p.toUpperCase()).join(', ');

        const embed = new EmbedBuilder()
            .setTitle(`🌾 RSS Stock Inventory: ${interaction.user.username}`)
            .setDescription('Your current resource levels available for buying transactions.')
            .addFields(
                { name: '🌾 Food', value: `**${formatRssAmount(stock.food)}**`, inline: true },
                { name: '🪵 Wood', value: `**${formatRssAmount(stock.wood)}**`, inline: true },
                { name: '🪨 Stone', value: `**${formatRssAmount(stock.stone)}**`, inline: true },
                { name: '🪙 Gold', value: `**${formatRssAmount(stock.gold)}**`, inline: true },
                { name: '💳 Accepted Payment Methods', value: pLabels, inline: false }
            )
            .setColor('#10b981')
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    parseRssAmount,
    formatRssAmount
};
