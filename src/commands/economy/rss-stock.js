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
        .setDescription('View or update your RSS stock (RSS Sellers only)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Whether to add to or set your stock levels')
                .setRequired(false)
                .addChoices(
                    { name: '➕ Add to Stock', value: 'add' },
                    { name: '⚙️ Set Stock', value: 'set' }
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
                .setRequired(false)),

    async execute(interaction) {
        const member = interaction.member;
        if (!member) {
            return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
        }
        
        const db = await getDb();
        const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        const roleNameOrId = config?.rssSellerRole || 'RSS Seller';

        const hasRole = member.roles.cache.has(roleNameOrId) || member.roles.cache.some(role => role.name.toLowerCase() === roleNameOrId.toLowerCase());
        
        if (!hasRole) {
            return interaction.reply({ 
                content: `❌ You must have the **${roleNameOrId}** role to manage RSS stock.`, 
                ephemeral: true 
            });
        }

        const sellerId = interaction.user.id;

        // Fetch current stock
        let stock = await db.get(`SELECT food, wood, stone, gold FROM rss_seller_stocks WHERE sellerId = ?`, [sellerId]);
        if (!stock) {
            await db.run(`INSERT INTO rss_seller_stocks (sellerId, food, wood, stone, gold) VALUES (?, 0, 0, 0, 0)`, [sellerId]);
            stock = { food: 0, wood: 0, stone: 0, gold: 0 };
        }

        const action = interaction.options.getString('action');
        const rawFood = interaction.options.getString('food');
        const rawWood = interaction.options.getString('wood');
        const rawStone = interaction.options.getString('stone');
        const rawGold = interaction.options.getString('gold');

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
            }

            // Save back to DB
            await db.run(
                `UPDATE rss_seller_stocks SET food = ?, wood = ?, stone = ?, gold = ?, updatedAt = CURRENT_TIMESTAMP WHERE sellerId = ?`,
                [newFood, newWood, newStone, newGold, sellerId]
            );

            // Update current memory reference for output
            stock = { food: newFood, wood: newWood, stone: newStone, gold: newGold };
        } else if (!action && (rawFood !== null || rawWood !== null || rawStone !== null || rawGold !== null)) {
            return interaction.reply({
                content: '❌ You must select an **Action** (➕ Add to Stock or ⚙️ Set Stock) when providing stock values.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🌾 RSS Stock Inventory: ${interaction.user.username}`)
            .setDescription('Your current resource levels available for buying transactions.')
            .addFields(
                { name: '🌾 Food', value: `**${formatRssAmount(stock.food)}**`, inline: true },
                { name: '🪵 Wood', value: `**${formatRssAmount(stock.wood)}**`, inline: true },
                { name: '🪨 Stone', value: `**${formatRssAmount(stock.stone)}**`, inline: true },
                { name: '🪙 Gold', value: `**${formatRssAmount(stock.gold)}**`, inline: true }
            )
            .setColor('#10b981')
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    parseRssAmount,
    formatRssAmount
};
