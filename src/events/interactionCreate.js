const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { processAdsSubmission } = require('../commands/tracking/add-ads');
const { handleTicketSelection, handleApplicationStartButton, createTicketChannel } = require('../utils/applicationHandler');
const { getDb } = require('../config/database');

const economyCooldowns = new Map();

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (err) {
                console.error('Autocomplete Error:', err);
            }
            return;
        }

        console.log(`[INTERACTION] Type: ${interaction.type}, Name: ${interaction.commandName || interaction.customId}, User: ${interaction.user.tag}`);
        if (interaction.isChatInputCommand()) {
            const commandName = interaction.commandName;
            
            const economyCommands = ['work', 'rob', 'pay', 'jail', 'shop', 'buy', 'bank', 'stocks', 'mafia', 'businesses', 'influence', 'jobs', 'balance', 'eco-admin'];
            if (economyCommands.includes(commandName)) {
                const now = Date.now();
                const userCd = economyCooldowns.get(interaction.user.id);
                if (userCd && now < userCd) {
                    return await interaction.reply({ content: '⏳ Please slow down. (1s cooldown)', ephemeral: true }).catch(() => {});
                }
                economyCooldowns.set(interaction.user.id, now + 1000);
            }

            const publicCommands = ['help', 'jail', 'mafia', 'family'];
            const slowCommands = ['help', 'mafia', 'businesses', 'jail', 'influence', 'family'];
            
            if (slowCommands.includes(commandName)) {
                const shouldBePublic = publicCommands.includes(commandName);
                const isEphemeral = !shouldBePublic;
                console.log(`[DEBUG] Command: ${commandName}, ShouldBePublic: ${shouldBePublic}, Final Ephemeral: ${isEphemeral}`);
                
                if (interaction.isRepliable()) {
                    if (interaction.replied || interaction.deferred) {
                        console.log(`[DEBUG] Interaction ${interaction.id} already acknowledged, skipping defer.`);
                    } else {
                        try {
                            await interaction.deferReply({ ephemeral: isEphemeral });
                        } catch (e) {
                            console.error('[ERROR] DeferReply failed:', e.message);
                            return; 
                        }
                    }
                }
            }
            
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`[WARNING] Command not found: ${interaction.commandName}`);
                return;
            }

            const step1 = Date.now();
            const db = await getDb();
            const dbTime = Date.now() - step1;
            console.log(`[DEBUG] getDb took ${dbTime}ms for ${interaction.commandName}`);

            const step2 = Date.now();
            const userData = await db.get(`SELECT jailUntil FROM users WHERE userId = ?`, [interaction.user.id]);
            console.log(`[DEBUG] userData fetch took ${Date.now() - step2}ms`);
            if (userData && userData.jailUntil && new Date(userData.jailUntil) > new Date()) {
                if (interaction.commandName !== 'jail' && interaction.commandName !== 'help') {
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
                    
                    if (interaction.deferred || interaction.replied) {
                        return await interaction.editReply({ 
                            embeds: [embed]
                        }).catch(() => {});
                    } else {
                        return await interaction.reply({ 
                            embeds: [embed],
                            ephemeral: true
                        }).catch(() => {});
                    }
                }
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`[COMMAND ERROR] ${commandName}:`, error.message || error);
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: '❌ There was an error executing this command.', ephemeral: true }).catch(() => {});
                    } else {
                        await interaction.reply({ content: '❌ There was an error executing this command.', ephemeral: true }).catch(() => {});
                    }
                } catch (e) {
                    console.error('[FATAL] Could not send error message to Discord:', e.message);
                }
            }
        } 
        else if (interaction.isButton()) {
            if (interaction.customId.startsWith('market_')) {
                const { handleMarketInteraction } = require('../features/market');
                await handleMarketInteraction(interaction);
                return;
            } else if (interaction.customId === 'rss_buy_start') {
                const safeReply = async (response) => {
                    if (interaction.replied || interaction.deferred || interaction.acknowledged) {
                        return interaction.followUp(response).catch(() => {});
                    }
                    return interaction.reply(response).catch(() => {});
                };

                const db = await getDb();
                const config = await db.get(`SELECT rssEnabled, rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
                if (!config || !config.rssEnabled) {
                    return safeReply({
                        content: '❌ The RSS Buying module is currently disabled.',
                        ephemeral: true
                    });
                }

                const roleNameOrId = config.rssSellerRole || 'RSS Seller';
                let sellers = [];
                try {
                    const role = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                    if (role) {
                        const fetchedMembers = await interaction.guild.members.fetch();
                        sellers = Array.from(fetchedMembers.filter(m => m.roles.cache.has(role.id)).values());
                    } else {
                        const fetchedMembers = await interaction.guild.members.fetch();
                        sellers = Array.from(fetchedMembers.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase())).values());
                    }
                } catch (e) {
                    console.error('Error fetching members:', e);
                }

                if (sellers.length === 0) {
                    return safeReply({
                        content: '❌ No verified RSS Sellers are currently registered or online. Please try again later.',
                        ephemeral: true
                    });
                }

                const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js');
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('rss_buy_payment_select')
                    .setPlaceholder('Select preferred payment method(s) (choose up to 2)...')
                    .setMinValues(1)
                    .setMaxValues(2)
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('PayPal').setValue('paypal').setEmoji({ name: '💳' }).setDescription('Pay securely via PayPal'),
                        new StringSelectMenuOptionBuilder().setLabel('Cash App').setValue('cashapp').setEmoji({ name: '💵' }).setDescription('Pay via Cash App transfer'),
                        new StringSelectMenuOptionBuilder().setLabel('Venmo').setValue('venmo').setEmoji({ name: '📱' }).setDescription('Pay via Venmo mobile app'),
                        new StringSelectMenuOptionBuilder().setLabel('Zelle').setValue('zelle').setEmoji({ name: '🏦' }).setDescription('Instant bank transfer via Zelle'),
                        new StringSelectMenuOptionBuilder().setLabel('Revolut').setValue('revolut').setEmoji({ name: '🔷' }).setDescription('International transfer via Revolut'),
                        new StringSelectMenuOptionBuilder().setLabel('Crypto (BTC/USDT)').setValue('crypto').setEmoji({ name: '💰' }).setDescription('Pay using Bitcoin or USDT stablecoin'),
                        new StringSelectMenuOptionBuilder().setLabel('Bank Transfer').setValue('bank').setEmoji({ name: '🏛️' }).setDescription('Direct wire or local bank transfer'),
                        new StringSelectMenuOptionBuilder().setLabel('Apple Pay / Google Pay').setValue('applepay').setEmoji({ name: '🍎' }).setDescription('Pay using Apple Pay or Google Pay mobile wallet')
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                return safeReply({
                    content: '✨ **Welcome to RSS Buying!** Please select your preferred payment method(s) from the options below (you can choose multiple):',
                    components: [row],
                    ephemeral: true
                });
            } else if (interaction.customId === 'rss_stock_add_click') {
                const db = await getDb();
                const config = await db.get(`SELECT rssEnabled, rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                if (!config || !config.rssEnabled) {
                    return interaction.reply({ content: '❌ The RSS module is currently disabled.', ephemeral: true });
                }

                const sellersRoleNameOrId = config.rssSellerRole || 'RSS Seller';
                const hasRole = interaction.member.roles.cache.has(sellersRoleNameOrId) || 
                                interaction.member.roles.cache.some(r => r.name.toLowerCase() === sellersRoleNameOrId.toLowerCase());
                if (!hasRole) {
                    return interaction.reply({ content: '❌ Only verified RSS Sellers can add stock.', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId('rss_stock_modal_submit')
                    .setTitle('➕ Add RSS Stock');

                const foodInput = new TextInputBuilder()
                    .setCustomId('food')
                    .setLabel('Food to ADD (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const woodInput = new TextInputBuilder()
                    .setCustomId('wood')
                    .setLabel('Wood to ADD (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const stoneInput = new TextInputBuilder()
                    .setCustomId('stone')
                    .setLabel('Stone to ADD (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const goldInput = new TextInputBuilder()
                    .setCustomId('gold')
                    .setLabel('Gold to ADD (e.g. 10M, 50k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(foodInput),
                    new ActionRowBuilder().addComponents(woodInput),
                    new ActionRowBuilder().addComponents(stoneInput),
                    new ActionRowBuilder().addComponents(goldInput)
                );

                return await interaction.showModal(modal);
            } else if (interaction.customId === 'rss_stock_remove_click') {
                const db = await getDb();
                const config = await db.get(`SELECT rssEnabled, rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                if (!config || !config.rssEnabled) {
                    return interaction.reply({ content: '❌ The RSS module is currently disabled.', ephemeral: true });
                }

                const sellersRoleNameOrId = config.rssSellerRole || 'RSS Seller';
                const hasRole = interaction.member.roles.cache.has(sellersRoleNameOrId) || 
                                interaction.member.roles.cache.some(r => r.name.toLowerCase() === sellersRoleNameOrId.toLowerCase());
                if (!hasRole) {
                    return interaction.reply({ content: '❌ Only verified RSS Sellers can remove stock.', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId('rss_stock_remove_modal_submit')
                    .setTitle('➖ Remove RSS Stock');

                const foodInput = new TextInputBuilder()
                    .setCustomId('food')
                    .setLabel('Food to REMOVE (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const woodInput = new TextInputBuilder()
                    .setCustomId('wood')
                    .setLabel('Wood to REMOVE (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const stoneInput = new TextInputBuilder()
                    .setCustomId('stone')
                    .setLabel('Stone to REMOVE (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const goldInput = new TextInputBuilder()
                    .setCustomId('gold')
                    .setLabel('Gold to REMOVE (e.g. 10M, 50k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(foodInput),
                    new ActionRowBuilder().addComponents(woodInput),
                    new ActionRowBuilder().addComponents(stoneInput),
                    new ActionRowBuilder().addComponents(goldInput)
                );

                return await interaction.showModal(modal);
            } else if (interaction.customId.startsWith('rss_buy_complete_')) {
                const txId = interaction.customId.replace('rss_buy_complete_', '');
                const db = await getDb();
                const tx = await db.get(`SELECT * FROM rss_transactions WHERE id = ?`, [txId]);
                
                if (!tx) {
                    return interaction.reply({ content: '❌ Transaction not found or already completed.', ephemeral: true });
                }

                // Verify permissions
                const isSeller = interaction.user.id === tx.seller1Id || interaction.user.id === tx.seller2Id;
                const isAdmin = interaction.member.permissions.has('Administrator');
                
                if (!isSeller && !isAdmin) {
                    return interaction.reply({ content: '❌ Only the assigned RSS Seller or an Administrator can complete this transaction.', ephemeral: true });
                }

                await interaction.deferReply();

                // Split parsing
                const isSplit = !!tx.seller2Id;
                
                const food1 = isSplit ? Math.floor(tx.food / 2) : tx.food;
                const wood1 = isSplit ? Math.floor(tx.wood / 2) : tx.wood;
                const stone1 = isSplit ? Math.floor(tx.stone / 2) : tx.stone;
                const gold1 = isSplit ? Math.floor(tx.gold / 2) : tx.gold;

                const food2 = isSplit ? (tx.food - food1) : 0;
                const wood2 = isSplit ? (tx.wood - wood1) : 0;
                const stone2 = isSplit ? (tx.stone - stone1) : 0;
                const gold2 = isSplit ? (tx.gold - gold1) : 0;

                // Load tax configuration to calculate deduction including tax
                const config = await db.get(`SELECT rssTaxRate FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                const taxRatePct = config && config.rssTaxRate !== null && config.rssTaxRate !== undefined ? config.rssTaxRate : 10;
                const taxMultiplier = taxRatePct / 100;

                // Seller 1 deduction (sold amount + tax amount)
                const deductFood1 = food1 + Math.floor(food1 * taxMultiplier);
                const deductWood1 = wood1 + Math.floor(wood1 * taxMultiplier);
                const deductStone1 = stone1 + Math.floor(stone1 * taxMultiplier);
                const deductGold1 = gold1 + Math.floor(gold1 * taxMultiplier);

                // Deduct Seller 1 stock (quantity + tax)
                await db.run(
                    `UPDATE rss_seller_stocks SET 
                        food = CASE WHEN food - ? < 0 THEN 0 ELSE food - ? END, 
                        wood = CASE WHEN wood - ? < 0 THEN 0 ELSE wood - ? END, 
                        stone = CASE WHEN stone - ? < 0 THEN 0 ELSE stone - ? END, 
                        gold = CASE WHEN gold - ? < 0 THEN 0 ELSE gold - ? END 
                     WHERE sellerId = ?`,
                    [
                        deductFood1, deductFood1,
                        deductWood1, deductWood1,
                        deductStone1, deductStone1,
                        deductGold1, deductGold1,
                        tx.seller1Id
                    ]
                );

                // Calculate tax to record pending taxes in database
                const taxFood1 = Math.floor(food1 * taxMultiplier);
                const taxWood1 = Math.floor(wood1 * taxMultiplier);
                const taxStone1 = Math.floor(stone1 * taxMultiplier);
                const taxGold1 = Math.floor(gold1 * taxMultiplier);

                // Upsert Seller 1 sales metrics (record only actual sold quantity and add to pending taxes)
                await db.run(`
                    INSERT INTO rss_seller_sales (
                        sellerId, 
                        totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, 
                        totalTransactions,
                        pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                    )
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                    ON CONFLICT(sellerId) DO UPDATE SET
                        totalSoldFood = rss_seller_sales.totalSoldFood + EXCLUDED.totalSoldFood,
                        totalSoldWood = rss_seller_sales.totalSoldWood + EXCLUDED.totalSoldWood,
                        totalSoldStone = rss_seller_sales.totalSoldStone + EXCLUDED.totalSoldStone,
                        totalSoldGold = rss_seller_sales.totalSoldGold + EXCLUDED.totalSoldGold,
                        totalTransactions = rss_seller_sales.totalTransactions + 1,
                        pendingTaxFood = rss_seller_sales.pendingTaxFood + EXCLUDED.pendingTaxFood,
                        pendingTaxWood = rss_seller_sales.pendingTaxWood + EXCLUDED.pendingTaxWood,
                        pendingTaxStone = rss_seller_sales.pendingTaxStone + EXCLUDED.pendingTaxStone,
                        pendingTaxGold = rss_seller_sales.pendingTaxGold + EXCLUDED.pendingTaxGold
                `, [tx.seller1Id, food1, wood1, stone1, gold1, taxFood1, taxWood1, taxStone1, taxGold1]);

                // Send Seller 1 Tax DM
                try {
                    const seller1User = await client.users.fetch(tx.seller1Id);
                    if (seller1User) {
                        const { formatRssAmount } = require('../commands/economy/rss-stock');
                        const taxEmbed = new EmbedBuilder()
                            .setTitle(`🧾 Tax Payment Reminder (${taxRatePct}%)`)
                            .setDescription(`A transaction in which you participated has been completed. In accordance with server regulations, a **${taxRatePct}% tax** is due on all resources sold.`)
                            .addFields(
                                { name: 'Transaction ID', value: `\`${tx.id}\``, inline: false },
                                { name: '🌾 Food Sold', value: `${formatRssAmount(food1)} (Tax: **${formatRssAmount(Math.floor(food1 * taxMultiplier))}**)`, inline: true },
                                { name: '🪵 Wood Sold', value: `${formatRssAmount(wood1)} (Tax: **${formatRssAmount(Math.floor(wood1 * taxMultiplier))}**)`, inline: true },
                                { name: '🪨 Stone Sold', value: `${formatRssAmount(stone1)} (Tax: **${formatRssAmount(Math.floor(stone1 * taxMultiplier))}**)`, inline: true },
                                { name: '🪙 Gold Sold', value: `${formatRssAmount(gold1)} (Tax: **${formatRssAmount(Math.floor(gold1 * taxMultiplier))}**)`, inline: true }
                            )
                            .setColor('#b91c1c')
                            .setTimestamp();
                        await seller1User.send({ embeds: [taxEmbed] });
                    }
                } catch (e) {
                    console.error(`Failed to DM Seller 1 (${tx.seller1Id}):`, e);
                }

                if (isSplit) {
                    // Seller 2 deduction (sold amount + tax amount)
                    const deductFood2 = food2 + Math.floor(food2 * taxMultiplier);
                    const deductWood2 = wood2 + Math.floor(wood2 * taxMultiplier);
                    const deductStone2 = stone2 + Math.floor(stone2 * taxMultiplier);
                    const deductGold2 = gold2 + Math.floor(gold2 * taxMultiplier);

                    // Deduct Seller 2 stock (quantity + tax)
                    await db.run(
                        `UPDATE rss_seller_stocks SET 
                            food = CASE WHEN food - ? < 0 THEN 0 ELSE food - ? END, 
                            wood = CASE WHEN wood - ? < 0 THEN 0 ELSE wood - ? END, 
                            stone = CASE WHEN stone - ? < 0 THEN 0 ELSE stone - ? END, 
                            gold = CASE WHEN gold - ? < 0 THEN 0 ELSE gold - ? END 
                         WHERE sellerId = ?`,
                        [
                            deductFood2, deductFood2,
                            deductWood2, deductWood2,
                            deductStone2, deductStone2,
                            deductGold2, deductGold2,
                            tx.seller2Id
                        ]
                    );

                    // Calculate tax for Seller 2
                    const taxFood2 = Math.floor(food2 * taxMultiplier);
                    const taxWood2 = Math.floor(wood2 * taxMultiplier);
                    const taxStone2 = Math.floor(stone2 * taxMultiplier);
                    const taxGold2 = Math.floor(gold2 * taxMultiplier);

                    // Upsert Seller 2 sales metrics
                    await db.run(`
                        INSERT INTO rss_seller_sales (
                            sellerId, 
                            totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, 
                            totalTransactions,
                            pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                        )
                        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                        ON CONFLICT(sellerId) DO UPDATE SET
                            totalSoldFood = rss_seller_sales.totalSoldFood + EXCLUDED.totalSoldFood,
                            totalSoldWood = rss_seller_sales.totalSoldWood + EXCLUDED.totalSoldWood,
                            totalSoldStone = rss_seller_sales.totalSoldStone + EXCLUDED.totalSoldStone,
                            totalSoldGold = rss_seller_sales.totalSoldGold + EXCLUDED.totalSoldGold,
                            totalTransactions = rss_seller_sales.totalTransactions + 1,
                            pendingTaxFood = rss_seller_sales.pendingTaxFood + EXCLUDED.pendingTaxFood,
                            pendingTaxWood = rss_seller_sales.pendingTaxWood + EXCLUDED.pendingTaxWood,
                            pendingTaxStone = rss_seller_sales.pendingTaxStone + EXCLUDED.pendingTaxStone,
                            pendingTaxGold = rss_seller_sales.pendingTaxGold + EXCLUDED.pendingTaxGold
                    `, [tx.seller2Id, food2, wood2, stone2, gold2, taxFood2, taxWood2, taxStone2, taxGold2]);

                    // Send Seller 2 Tax DM
                    try {
                        const seller2User = await client.users.fetch(tx.seller2Id);
                        if (seller2User) {
                            const { formatRssAmount } = require('../commands/economy/rss-stock');
                            const taxEmbed = new EmbedBuilder()
                                .setTitle(`🧾 Tax Payment Reminder (${taxRatePct}%)`)
                                .setDescription(`A transaction in which you participated has been completed. In accordance with server regulations, a **${taxRatePct}% tax** is due on all resources sold.`)
                                .addFields(
                                    { name: 'Transaction ID', value: `\`${tx.id}\``, inline: false },
                                    { name: '🌾 Food Sold', value: `${formatRssAmount(food2)} (Tax: **${formatRssAmount(Math.floor(food2 * taxMultiplier))}**)`, inline: true },
                                    { name: '🪵 Wood Sold', value: `${formatRssAmount(wood2)} (Tax: **${formatRssAmount(Math.floor(wood2 * taxMultiplier))}**)`, inline: true },
                                    { name: '🪨 Stone Sold', value: `${formatRssAmount(stone2)} (Tax: **${formatRssAmount(Math.floor(stone2 * taxMultiplier))}**)`, inline: true },
                                    { name: '🪙 Gold Sold', value: `${formatRssAmount(gold2)} (Tax: **${formatRssAmount(Math.floor(gold2 * taxMultiplier))}**)`, inline: true }
                                )
                                .setColor('#b91c1c')
                                .setTimestamp();
                            await seller2User.send({ embeds: [taxEmbed] });
                        }
                    } catch (e) {
                        console.error(`Failed to DM Seller 2 (${tx.seller2Id}):`, e);
                    }
                }

                // Update Transaction Status
                await db.run(`UPDATE rss_transactions SET status = 'completed' WHERE id = ?`, [txId]);

                await interaction.editReply('✅ **Transaction complete!** Stock has been deducted, stats logged, and tax reminders sent to sellers. This channel will close in 5 seconds.');
                
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 5000);
            } else if (interaction.customId.startsWith('rss_buy_cancel_')) {
                const txId = interaction.customId.replace('rss_buy_cancel_', '');
                const db = await getDb();
                
                const transaction = await db.get(`SELECT * FROM rss_transactions WHERE id = ?`, [txId]);
                if (!transaction) {
                    return interaction.reply({ content: '❌ Transaction not found.', ephemeral: true });
                }

                // Permissions check
                const isBuyer = interaction.user.id === transaction.buyerId;
                const isSeller = interaction.user.id === transaction.seller1Id || interaction.user.id === transaction.seller2Id;
                const isAdmin = interaction.member.permissions.has('Administrator');

                if (!isBuyer && !isSeller && !isAdmin) {
                    return interaction.reply({ content: '❌ You are not authorized to cancel this order.', ephemeral: true });
                }

                await db.run(`UPDATE rss_transactions SET status = 'cancelled' WHERE id = ?`, [txId]);
                await interaction.reply('❌ **Transaction cancelled.** Closing channel in 5 seconds...');
                
                setTimeout(() => {
                    interaction.channel.delete().catch(() => {});
                }, 5000);
            } else if (interaction.customId === 'btn_register_ads') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_register_ads')
                    .setTitle('Log Sent Ads');

                const amountInput = new TextInputBuilder()
                    .setCustomId('adsAmount')
                    .setLabel("How many ads did you send?")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('e.g. 5');

                const row = new ActionRowBuilder().addComponents(amountInput);
                modal.addComponents(row);

                await interaction.showModal(modal);
            } else if (interaction.customId.startsWith('start_app_')) {
                await handleApplicationStartButton(interaction);

            } else if (interaction.customId.startsWith('ticket_panel_')) {
                const parts = interaction.customId.split('_');
                // ticket_panel_{panelId}_btn_{rIdx}_{oIdx}
                if (parts[3] === 'btn') {
                    const panelId = parts[2];
                    const rIdx = parseInt(parts[4]);
                    const oIdx = parseInt(parts[5]);
                    
                    const db = await getDb();
                    const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                    if (!panelRec) return interaction.reply({ content: 'It looks like your ticket is already being processed. Please check your DMs or your open ticket channel.', ephemeral: true });

                    const data = JSON.parse(panelRec.panelData);
                    const opt = data.buttonRows[rIdx].options[oIdx];
                    const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                    const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                    
                    await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs);
                }

            } else if (interaction.customId.startsWith('start_app_') || 
                       interaction.customId.startsWith('app_choice_') || 
                       interaction.customId === 'app_finalize_submit' || 
                       interaction.customId === 'app_cancel_all') {
                await handleApplicationStartButton(interaction);
            } else if (interaction.customId === 'app_edit_select') {
                await handleApplicationStartButton(interaction);

            } else if (interaction.customId.startsWith('claim_ticket_')) {
                if (!interaction.member.permissions.has('ManageChannels')) {
                    return interaction.reply({ content: '❌ You do not have permission to claim this ticket.', ephemeral: true });
                }
                
                const originalEmbed = interaction.message.embeds[0];
                if (!originalEmbed) return interaction.reply({ content: '❌ Could not find ticket embed.', ephemeral: true });

                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .addFields({ name: 'Assigned Staff', value: `<@${interaction.user.id}>` });

                const parts = interaction.customId.split('_');
                const targetUserId = parts[2];
                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`close_ticket_${targetUserId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
                );

                await interaction.update({ embeds: [newEmbed], components: [newRow] });
                await interaction.followUp({ content: `✅ Ticket claimed by <@${interaction.user.id}>. They will assist you shortly!` });

            } else if (interaction.customId.startsWith('close_ticket_')) {
                if (!interaction.member.permissions.has('ManageChannels')) {
                    return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
                }

                const targetUser = interaction.customId.replace('close_ticket_', '');
                const closeReason = 'No reason provided';
                
                await interaction.deferReply({ ephemeral: true });
                await interaction.editReply({ content: `🔒 Closing ticket — Reason: **${closeReason}**\nGenerating transcript...` });
                
                try {
                    const db = await getDb();
                    
                    // Fetch ALL messages from the channel
                    let allMessages = [];
                    let lastId;
                    while (true) {
                        const options = { limit: 100 };
                        if (lastId) options.before = lastId;
                        const fetched = await interaction.channel.messages.fetch(options);
                        if (fetched.size === 0) break;
                        allMessages.push(...fetched.values());
                        lastId = fetched.last().id;
                        if (fetched.size < 100) break;
                    }
                    allMessages.reverse(); // chronological order
                    
                    // Build Markdown transcript
                    let mdLines = [];
                    mdLines.push(`# Transcript: ${interaction.channel.name}`);
                    mdLines.push(`**Server:** ${interaction.guild.name}`);
                    mdLines.push(`**Closed by:** ${interaction.user.tag}`);
                    mdLines.push(`**Reason:** ${closeReason}`);
                    mdLines.push(`**Date:** ${new Date().toLocaleString()}`);
                    mdLines.push(`**Messages:** ${allMessages.length}`);
                    mdLines.push('');
                    mdLines.push('---');
                    mdLines.push('');
                    
                    for (const msg of allMessages) {
                        const ts = new Date(msg.createdTimestamp).toLocaleString();
                        mdLines.push(`### ${msg.author.tag} — ${ts}`);
                        if (msg.content) {
                            mdLines.push(msg.content);
                        }
                        if (msg.embeds.length > 0) {
                            for (const embed of msg.embeds) {
                                if (embed.title) mdLines.push(`> **${embed.title}**`);
                                if (embed.description) mdLines.push(`> ${embed.description.replace(/\n/g, '\n> ')}`);
                                if (embed.fields?.length > 0) {
                                    for (const f of embed.fields) {
                                        mdLines.push(`> **${f.name}:** ${f.value}`);
                                    }
                                }
                            }
                        }
                        if (msg.attachments.size > 0) {
                            msg.attachments.forEach(att => {
                                mdLines.push(`📎 [${att.name}](${att.url})`);
                            });
                        }
                        mdLines.push('');
                        mdLines.push('---');
                        mdLines.push('');
                    }
                    
                    const markdownString = mdLines.join('\n');
                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(Buffer.from(markdownString, 'utf-8'), { name: `${interaction.channel.name}-transcript.md` });
                    
                    // Save to DB (plain markdown, no encoding)
                    const ticketId = interaction.channel.name + '-' + Date.now().toString().slice(-4);
                    await db.run(
                        `INSERT INTO ticket_transcripts (ticketId, guildId, userId, logContent) VALUES (?, ?, ?, ?)`,
                        [ticketId, interaction.guildId, targetUser || interaction.user.id, markdownString]
                    );

                    const moduleConfigs = await db.get(`SELECT ticketsTranscriptChannel FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                    // DM the user with reason + transcript
                    if (targetUser) {
                        try {
                            const dmMember = await interaction.guild.members.fetch(targetUser).catch(() => null);
                            if (dmMember) {
                                const dmEmbed = new EmbedBuilder()
                                    .setTitle('🔒 Ticket Closed')
                                    .setColor('#ed4245')
                                    .addFields(
                                        { name: 'Ticket', value: `\`${interaction.channel.name}\``, inline: true },
                                        { name: 'Closed By', value: interaction.user.tag, inline: true },
                                        { name: 'Reason', value: closeReason }
                                    )
                                    .setTimestamp();
                                await dmMember.send({ embeds: [dmEmbed], files: [attachment] }).catch(err => {
                                    console.error('Error sending DM to ticket owner:', err.message);
                                });
                            }
                        } catch(err) {
                            console.error('Could not DM user transcript:', err.message);
                        }
                    }
                    // Send to transcript log channel
                    if (moduleConfigs && moduleConfigs.ticketsTranscriptChannel) {
                        const transcriptChannel = interaction.guild.channels.cache.get(moduleConfigs.ticketsTranscriptChannel);
                        if (transcriptChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('📁 Ticket Transcript')
                                .setColor('#5865f2')
                                .addFields(
                                    { name: 'Ticket', value: `\`${interaction.channel.name}\``, inline: true },
                                    { name: 'User', value: `<@${targetUser}>`, inline: true },
                                    { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: 'Reason', value: closeReason }
                                )
                                .setTimestamp();
                            const logAttachment = new AttachmentBuilder(Buffer.from(markdownString, 'utf-8'), { name: `${interaction.channel.name}-transcript.md` });
                            await transcriptChannel.send({ embeds: [logEmbed], files: [logAttachment] });
                        }
                    }
                } catch(e) {
                    console.error('Error generating transcript:', e);
                }
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            } else if (interaction.customId.startsWith('admin_app_approve_')) {
                const uuid = interaction.customId.split('_').pop();
                const db = await getDb();
                const pending = await db.get(`SELECT * FROM pending_tickets WHERE uuid = ?`, [uuid]);
                if (!pending) return interaction.reply({ content: '❌ Application data not found or already processed.', ephemeral: true });

                // Defer and update button immediately to prevent Gateway timeout (Unknown Interaction)
                await interaction.deferUpdate();

                const opt = JSON.parse(pending.optJson);
                const answers = JSON.parse(pending.answersJson);
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                await createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs, pending.userId);
                await db.run(`DELETE FROM pending_tickets WHERE uuid = ?`, [uuid]);
                await interaction.editReply({ content: `✅ Application approved by <@${interaction.user.id}>. Ticket created.`, embeds: interaction.message.embeds, components: [] });

            } else if (interaction.customId.startsWith('admin_app_decline_')) {
                const uuid = interaction.customId.split('_').pop();
                const modal = new ModalBuilder()
                    .setCustomId(`admin_app_decline_modal_${uuid}`)
                    .setTitle('Decline Application');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('declineReason')
                    .setLabel("Reason for rejection (Optional)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Provide feedback to the user...');

                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'rss_buy_payment_select') {
                const paymentMethods = interaction.values;
                const db = await getDb();
                const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                const roleNameOrId = config?.rssSellerRole || 'RSS Seller';

                let sellers = [];
                try {
                    const role = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                    if (role) {
                        const fetchedMembers = await interaction.guild.members.fetch();
                        sellers = Array.from(fetchedMembers.filter(m => m.roles.cache.has(role.id)).values());
                    } else {
                        const fetchedMembers = await interaction.guild.members.fetch();
                        sellers = Array.from(fetchedMembers.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase())).values());
                    }
                } catch (e) {
                    console.error('Error fetching members:', e);
                }

                if (sellers.length === 0) {
                    return interaction.reply({
                        content: '❌ No verified RSS Sellers are currently registered or online. Please try again later.',
                        ephemeral: true
                    });
                }

                const sellerIds = sellers.map(seller => seller.user.id);
                const stockRows = sellerIds.length > 0
                    ? await db.all(`SELECT sellerId, food, wood, stone, gold, paymentMethods FROM rss_seller_stocks WHERE sellerId IN (${sellerIds.map(() => '?').join(',')})`, sellerIds)
                    : [];

                const stockedSellers = sellers.filter(seller => {
                    const stock = stockRows.find(r => r.sellerId === seller.user.id);
                    if (!stock) return false;
                    
                    const stockTotal = (stock.food || 0) + (stock.wood || 0) + (stock.stone || 0) + (stock.gold || 0);
                    if (stockTotal <= 0) return false;

                    const sellerPayments = (stock.paymentMethods || 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay')
                        .toLowerCase()
                        .split(/[,\s]+/)
                        .map(p => p.trim())
                        .filter(Boolean);

                    return paymentMethods.some(pm => sellerPayments.includes(pm));
                });

                if (stockedSellers.length === 0) {
                    return interaction.reply({
                        content: '❌ No RSS Sellers matching your selected payment method(s) currently have stock available. Please try again later or select other payment methods.',
                        ephemeral: true
                    });
                }

                const selectMenu = new (require('discord.js').StringSelectMenuBuilder)()
                    .setCustomId(`rss_buy_seller_select_${paymentMethods.join(',')}`)
                    .setPlaceholder('Select your favorite RSS Seller...');

                stockedSellers.slice(0, 24).forEach(seller => {
                    selectMenu.addOptions({
                        label: seller.user.username,
                        value: seller.user.id,
                        description: `Verified RSS Seller with stock available`
                    });
                });

                selectMenu.addOptions({
                    label: 'Assign Automatically',
                    value: 'auto',
                    description: 'Balances the workload among verified sellers.'
                });

                const row = new (require('discord.js').ActionRowBuilder)().addComponents(selectMenu);

                const paymentLabels = {
                    paypal: '💳 PayPal',
                    cashapp: '💵 Cash App',
                    venmo: '📱 Venmo',
                    zelle: '🏦 Zelle',
                    revolut: '🪙 Revolut',
                    crypto: '₿ Crypto (BTC/USDT)',
                    bank: '🏛️ Bank Transfer',
                    applepay: '🍎 Apple Pay / Google Pay'
                };
                const readablePayments = paymentMethods.map(pm => paymentLabels[pm] || pm.toUpperCase()).join(', ');

                return interaction.update({
                    content: `✨ Excellent! You selected **${readablePayments}** as preferred payment method(s).\n\nNow, select your favorite RSS Seller from the dropdown below to coordinate delivery:`,
                    components: [row]
                });
            } else if (interaction.customId.startsWith('rss_buy_seller_select')) {
                const parts = interaction.customId.split('_');
                const paymentMethod = parts[4] || 'unspecified';
                const sellerId = interaction.values[0];

                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                const modal = new ModalBuilder()
                    .setCustomId(`rss_buy_modal_submit_${sellerId}_${paymentMethod}`)
                    .setTitle('🛒 RSS Buy: Resource Quantities');

                const foodInput = new TextInputBuilder()
                    .setCustomId('food')
                    .setLabel('How much Food? (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const woodInput = new TextInputBuilder()
                    .setCustomId('wood')
                    .setLabel('How much Wood? (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const stoneInput = new TextInputBuilder()
                    .setCustomId('stone')
                    .setLabel('How much Stone? (e.g. 50M, 100k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                const goldInput = new TextInputBuilder()
                    .setCustomId('gold')
                    .setLabel('How much Gold? (e.g. 10M, 50k, 0)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('0');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(foodInput),
                    new ActionRowBuilder().addComponents(woodInput),
                    new ActionRowBuilder().addComponents(stoneInput),
                    new ActionRowBuilder().addComponents(goldInput)
                );

                return await interaction.showModal(modal);
            } else if (interaction.customId.startsWith('ticket_panel_')) {
                const value = interaction.values[0];
                if (!value.startsWith('ticket_opt_')) return;
                
                const parts = value.split('_');
                const panelId = parts[2];
                const dIdx = parseInt(parts[3]);
                const oIdx = parseInt(parts[4]);

                const db = await getDb();
                const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                if (!panelRec) return interaction.reply({ content: 'It looks like your ticket is already being processed. Please check your DMs or your open ticket channel.', ephemeral: true });

                const data = JSON.parse(panelRec.panelData);
                const opt = data.dropdowns[dIdx].options[oIdx];
                
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs, panelId, dIdx, oIdx);
            } else if (interaction.customId === 'app_edit_select') {
                await handleApplicationStartButton(interaction);
            } else if (interaction.customId === 'help_category') {
                await interaction.deferUpdate().catch(() => {});
                const category = interaction.values[0];
                const { EmbedBuilder } = require('discord.js');
                const helpEmbed = new EmbedBuilder().setColor('#111827');

                if (category === 'help_mafia') {
                    helpEmbed.setTitle('🌑 Mafia & Economy — Detailed Guide')
                        .setDescription('Master the criminal underworld and the city economy.')
                        .addFields(
                            { name: '💰 Earning Money', value: '• **Private Businesses:** View openings with `/jobs vacancies` and apply with `/jobs apply`. Work using `/work` to earn salaries paid by the owners.\n• **Illegal acts:** Use `/mafia heist` (rob dynamic banks) or `/mafia raid` (raid citizen-owned businesses) for massive loot.' },
                            { name: '🏦 The Mafia Vault', value: '• **Taxation:** Mafias have an automatic tax (max 20%) that funds the vault.\n• **Upgrades:** The Don uses vault funds in the `/mafia armory` for upgrades (vests, cars, hackers).' },
                            { name: '🧼 Dirty Money & Cleaning', value: '• Underworld acts pay in unlaundered bills.\n• Use `/mafia clean` to process them into clean cash (20% fee).' },
                            { name: '👛 Wallet vs 🏦 Private Banks', value: '• **Wallet:** Cash on hand. Risk of loss if robbed or jailed!\n• **Private Banks:** Switch to a citizen-owned bank using `/bank switch bank:ID`. You pay deposit fees, but get higher security and insurance protecting your coins.\n• **Bank Ownership:** Found your own bank using `/bank found <name>` for 500,000 coins! Earn money passively from deposit fees (1%+), and upgrade its security, vaults, guards, and insurance using `/bank manage`!' },
                            { name: '⚖️ Jail & Justice', value: '• Getting caught sends you to jail.\n• Use `/jail info` to see your sentence, or try a `/jail trial` or `/jail bribe`.' },
                            { name: '🚩 Turfs & Control', value: '• Mafias battle for city turfs using `/mafia turfs` to get global bonuses (discounts, extra loot).' },
                            { name: '🌟 Community Rewards', value: '• Earn coins passively by being active!\n• **Chatting:** Coins per message.\n• **Invites:** Rewards for each friend invited.\n• **VC Activity:** Earnings for every minute in voice channels.' }
                        );
                } else if (category === 'help_community') {
                    helpEmbed.setTitle('📊 Community & Ranking — Detailed Guide')
                        .setDescription('Track your progress and influence.')
                        .addFields(
                            { name: '📈 Leveling & XP', value: '• Earn XP by chatting and being active.\n• Use `/rank` to see your progress and level rewards.' },
                            { name: '🏛️ Influence Market', value: '• Invest in city sectors (Casino, Bank, etc.) using `/influence buy`.\n• Controlling sectors gives the entire community special perks.' },
                            { name: '🏆 Competition', value: '• Use `/leaderboard` to see the top earners and most powerful mafias.' }
                        );
                } else if (category === 'help_staff') {
                    helpEmbed.setTitle('⚙️ Staff & Administration')
                        .setDescription('Administrative tools for kingdom management.')
                        .addFields(
                            { name: 'Economy Management', value: '`/eco-admin setbalance`, `/eco-admin reset-jail`, `/market-setup`' },
                            { name: 'Ads & Activity', value: '`/add-ads`, `/setup-ads-panel`, `/activity-check`, `/r4-stats`' },
                            { name: 'Member Tools', value: '`/export-members`, `/import-members`, `/giveaway`' }
                        );
                }

                await interaction.editReply({ embeds: [helpEmbed] });
            } else if (interaction.customId.startsWith('bank_upgrade_')) {
                const bankId = interaction.customId.split('_').pop();
                const upgradeId = interaction.values[0];
                if (upgradeId === 'max') return interaction.reply({ content: '❌ All upgrades for this bank are already at max level!', ephemeral: true });

                const db = await getDb();
                
                const bank = await db.get(`SELECT * FROM economy_banks WHERE id = ?`, [bankId]);
                if (!bank || bank.ownerId !== interaction.user.id) return interaction.reply({ content: '❌ You do not own this bank.', ephemeral: true });

                const UPGRADES_CFG = {
                    vaults: { name: 'Reinforced Vaults', emoji: '🛡️', baseCost: 50000, costMultiplier: 1.5, maxLevel: 5, sec: 0.05, ins: 0, res: 0, fee: 0 },
                    encryption: { name: 'Advanced Encryption', emoji: '🔐', baseCost: 100000, costMultiplier: 1.6, maxLevel: 5, sec: 0.08, ins: 0, res: 0, fee: 0 },
                    insurance: { name: 'Gold Insurance', emoji: '📜', baseCost: 150000, costMultiplier: 1.5, maxLevel: 5, sec: 0, ins: 0.15, res: 0, fee: 0 },
                    reserve: { name: 'Reserve Expansion', emoji: '🏦', baseCost: 200000, costMultiplier: 1.7, maxLevel: 5, sec: 0, ins: 0, res: 100000, fee: 0 },
                    guards: { name: 'Armed Guards', emoji: '💂', baseCost: 75000, costMultiplier: 1.4, maxLevel: 5, sec: 0.04, ins: 0, res: 0, fee: 0 },
                    auditing: { name: 'Automated Auditing', emoji: '📈', baseCost: 120000, costMultiplier: 1.5, maxLevel: 5, sec: 0, ins: 0, res: 0, fee: 0.005 }
                };

                const getUpgradeLevels = (upgradesJson) => {
                    let levels = { vaults: 0, encryption: 0, insurance: 0, reserve: 0, guards: 0, auditing: 0 };
                    if (!upgradesJson) return levels;
                    try {
                        const parsed = JSON.parse(upgradesJson);
                        if (Array.isArray(parsed)) {
                            parsed.forEach(name => {
                                if (name.includes('Vaults')) levels.vaults = 1;
                                if (name.includes('Encryption')) levels.encryption = 1;
                                if (name.includes('Insurance')) levels.insurance = 1;
                                if (name.includes('Reserve')) levels.reserve = 1;
                            });
                        } else if (typeof parsed === 'object') {
                            levels = { ...levels, ...parsed };
                        }
                    } catch (e) {}
                    return levels;
                };

                const up = UPGRADES_CFG[upgradeId];
                if (!up) return interaction.reply({ content: '❌ Invalid upgrade selected!', ephemeral: true });

                const levels = getUpgradeLevels(bank.upgrades);
                const currentLvl = levels[upgradeId] || 0;

                if (currentLvl >= up.maxLevel) {
                    return interaction.reply({ content: `❌ **${up.name}** is already at the maximum level (${up.maxLevel})!`, ephemeral: true });
                }

                const cost = Math.floor(up.baseCost * Math.pow(up.costMultiplier, currentLvl));
                const { removeBalance } = require('../utils/economyHandler');
                
                const removed = await removeBalance(interaction.user.id, cost);
                if (!removed) return interaction.reply({ content: `❌ You need **${cost.toLocaleString()}** coins in your wallet for this upgrade!`, ephemeral: true });

                levels[upgradeId] = currentLvl + 1;

                await db.run(
                    `UPDATE economy_banks SET 
                        security = security + ?, 
                        insurance = insurance + ?, 
                        reserve = reserve + ?, 
                        fee = fee + ?, 
                        upgrades = ? 
                     WHERE id = ?`,
                    [up.sec, up.ins, up.res, up.fee, JSON.stringify(levels), bankId]
                );

                await interaction.reply({ 
                    content: `✅ **Upgrade Purchased!** You successfully upgraded **${up.name}** to **Level ${currentLvl + 1}** for **${cost.toLocaleString()}** coins.`, 
                    ephemeral: true 
                });
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('rss_buy_modal_submit_')) {
                const modalParts = interaction.customId.replace('rss_buy_modal_submit_', '').split('_');
                const targetSellerId = modalParts[0];
                const paymentMethod = modalParts[1] || 'unspecified';
                await interaction.deferReply({ ephemeral: true });

                const db = await getDb();
                const { parseRssAmount, formatRssAmount } = require('../commands/economy/rss-stock');

                const reqFood = parseRssAmount(interaction.fields.getTextInputValue('food') || '0') || 0;
                const reqWood = parseRssAmount(interaction.fields.getTextInputValue('wood') || '0') || 0;
                const reqStone = parseRssAmount(interaction.fields.getTextInputValue('stone') || '0') || 0;
                const reqGold = parseRssAmount(interaction.fields.getTextInputValue('gold') || '0') || 0;

                if (reqFood === 0 && reqWood === 0 && reqStone === 0 && reqGold === 0) {
                    return interaction.editReply('❌ You must purchase at least one resource and enter a valid quantity (e.g. 50M or 100k).');
                }

                // Fetch RSS Sellers
                const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
                const roleNameOrId = config?.rssSellerRole || 'RSS Seller';

                const sellersRole = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                if (!sellersRole) {
                    return interaction.editReply(`❌ The configured RSS Seller role (\`${roleNameOrId}\`) does not exist on this server.`);
                }

                let fetchedMembers;
                try {
                    fetchedMembers = await interaction.guild.members.fetch();
                } catch (e) {
                    console.error('Error fetching members in modal submit:', e);
                    return interaction.editReply('❌ Failed to fetch server members. Please try again.');
                }

                const activeSellerIds = Array.from(fetchedMembers.filter(m => m.roles.cache.has(sellersRole.id)).keys());
                if (activeSellerIds.length === 0) {
                    return interaction.editReply('❌ No verified RSS Sellers found in this server.');
                }

                // Fetch stocks and sales
                const stockRows = await db.all(`SELECT * FROM rss_seller_stocks WHERE sellerId IN (${activeSellerIds.map(() => '?').join(',')})`, activeSellerIds);
                const salesRows = await db.all(`SELECT * FROM rss_seller_sales WHERE sellerId IN (${activeSellerIds.map(() => '?').join(',')})`, activeSellerIds);

                const sellerData = activeSellerIds.map(sid => {
                    const st = stockRows.find(r => r.sellerId === sid) || { food: 0, wood: 0, stone: 0, gold: 0, paymentMethods: 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay' };
                    const sa = salesRows.find(r => r.sellerId === sid) || { totalSoldFood: 0, totalSoldWood: 0, totalSoldStone: 0, totalSoldGold: 0, totalTransactions: 0 };
                    return {
                        sellerId: sid,
                        stock: st,
                        sales: sa
                    };
                });

                // Parse and filter sellers by matching payment methods
                const chosenPayments = paymentMethod.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
                const matchingSellers = sellerData.filter(s => {
                    const sellerPayments = (s.stock.paymentMethods || 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay')
                        .toLowerCase()
                        .split(/[,\s]+/)
                        .map(p => p.trim())
                        .filter(Boolean);
                    return chosenPayments.some(cp => sellerPayments.includes(cp));
                });

                let seller1 = null;
                let seller2 = null;
                let splitOrder = false;

                // Sort matching sellers by totalTransactions ascending, then total sales sum ascending to keep them balanced
                const sortedSellers = [...matchingSellers].sort((a, b) => {
                    if (a.sales.totalTransactions !== b.sales.totalTransactions) {
                        return a.sales.totalTransactions - b.sales.totalTransactions;
                    }
                    const sumA = Number(a.sales.totalSoldFood) + Number(a.sales.totalSoldWood) + Number(a.sales.totalSoldStone) + Number(a.sales.totalSoldGold);
                    const sumB = Number(b.sales.totalSoldFood) + Number(b.sales.totalSoldWood) + Number(b.sales.totalSoldStone) + Number(b.sales.totalSoldGold);
                    return sumA - sumB;
                });

                if (targetSellerId === 'auto') {
                    // Try to find a single seller who can fulfill 100%
                    const perfectSeller = sortedSellers.find(s => 
                        s.stock.food >= reqFood && 
                        s.stock.wood >= reqWood && 
                        s.stock.stone >= reqStone && 
                        s.stock.gold >= reqGold
                    );

                    if (perfectSeller) {
                        seller1 = perfectSeller.sellerId;
                    } else {
                        // Split 50/50
                        const halfFood1 = Math.floor(reqFood / 2);
                        const halfFood2 = reqFood - halfFood1;
                        const halfWood1 = Math.floor(reqWood / 2);
                        const halfWood2 = reqWood - halfWood1;
                        const halfStone1 = Math.floor(reqStone / 2);
                        const halfStone2 = reqStone - halfStone1;
                        const halfGold1 = Math.floor(reqGold / 2);
                        const halfGold2 = reqGold - halfGold1;

                        const possibleSeller1s = sortedSellers.filter(s => 
                            s.stock.food >= halfFood1 &&
                            s.stock.wood >= halfWood1 &&
                            s.stock.stone >= halfStone1 &&
                            s.stock.gold >= halfGold1
                        );

                        if (possibleSeller1s.length > 0) {
                            const bestSeller1 = possibleSeller1s[0];
                            const possibleSeller2s = sortedSellers.filter(s => 
                                s.sellerId !== bestSeller1.sellerId &&
                                s.stock.food >= halfFood2 &&
                                s.stock.wood >= halfWood2 &&
                                s.stock.stone >= halfStone2 &&
                                s.stock.gold >= halfGold2
                            );

                            if (possibleSeller2s.length > 0) {
                                seller1 = bestSeller1.sellerId;
                                seller2 = possibleSeller2s[0].sellerId;
                                splitOrder = true;
                            }
                        }

                        // If not found, search pairs in general
                        if (!seller1) {
                            for (const s1 of sortedSellers) {
                                for (const s2 of sortedSellers) {
                                    if (s1.sellerId === s2.sellerId) continue;
                                    if (
                                        s1.stock.food >= halfFood1 && s1.stock.wood >= halfWood1 && s1.stock.stone >= halfStone1 && s1.stock.gold >= halfGold1 &&
                                        s2.stock.food >= halfFood2 && s2.stock.wood >= halfWood2 && s2.stock.stone >= halfStone2 && s2.stock.gold >= halfGold2
                                    ) {
                                        seller1 = s1.sellerId;
                                        seller2 = s2.sellerId;
                                        splitOrder = true;
                                        break;
                                    }
                                }
                                if (seller1) break;
                            }
                        }
                    }
                } else {
                    const chosenSeller = sellerData.find(s => s.sellerId === targetSellerId);
                    if (!chosenSeller) {
                        return interaction.editReply('❌ Selected favorite RSS Seller is not active or not found.');
                    }

                    if (
                        chosenSeller.stock.food >= reqFood &&
                        chosenSeller.stock.wood >= reqWood &&
                        chosenSeller.stock.stone >= reqStone &&
                        chosenSeller.stock.gold >= reqGold
                    ) {
                        seller1 = chosenSeller.sellerId;
                    } else {
                        // Split 50/50
                        const halfFood1 = Math.floor(reqFood / 2);
                        const halfFood2 = reqFood - halfFood1;
                        const halfWood1 = Math.floor(reqWood / 2);
                        const halfWood2 = reqWood - halfWood1;
                        const halfStone1 = Math.floor(reqStone / 2);
                        const halfStone2 = reqStone - halfStone1;
                        const halfGold1 = Math.floor(reqGold / 2);
                        const halfGold2 = reqGold - halfGold1;

                        if (
                            chosenSeller.stock.food >= halfFood1 &&
                            chosenSeller.stock.wood >= halfWood1 &&
                            chosenSeller.stock.stone >= halfStone1 &&
                            chosenSeller.stock.gold >= halfGold1
                        ) {
                            const possibleSeller2s = sortedSellers.filter(s => 
                                s.sellerId !== chosenSeller.sellerId &&
                                s.stock.food >= halfFood2 &&
                                s.stock.wood >= halfWood2 &&
                                s.stock.stone >= halfStone2 &&
                                s.stock.gold >= halfGold2
                            );

                            if (possibleSeller2s.length > 0) {
                                seller1 = chosenSeller.sellerId;
                                seller2 = possibleSeller2s[0].sellerId;
                                splitOrder = true;
                            }
                        }
                    }
                }

                if (!seller1) {
                    return interaction.editReply('❌ Sorry, our RSS Sellers do not have enough stock to fulfill this order (either individually or split 50/50). Please try a lower quantity or contact a seller to restock.');
                }

                // Create Transaction in DB
                const txId = 'rss-' + Date.now().toString().slice(-6) + '-' + Math.floor(100 + Math.random() * 900);
                await db.run(
                    `INSERT INTO rss_transactions (id, buyerId, seller1Id, seller2Id, food, wood, stone, gold, status, channelId) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '')`,
                    [txId, interaction.user.id, seller1, seller2 || null, reqFood, reqWood, reqStone, reqGold]
                );

                // Create private channel topic stamp
                const guild = interaction.guild;
                const configMod = await db.get(`SELECT rssCategory FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                const guildConfigs = await db.get(`SELECT ticketCategoryId FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const categoryId = configMod?.rssCategory || guildConfigs?.ticketCategoryId;

                // Setup private permissions
                const permissionOverwrites = [
                    {
                        id: guild.id,
                        deny: [require('discord.js').PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [require('discord.js').PermissionsBitField.Flags.ViewChannel, require('discord.js').PermissionsBitField.Flags.SendMessages, require('discord.js').PermissionsBitField.Flags.ReadMessageHistory],
                    },
                    {
                        id: interaction.client.user.id,
                        allow: [require('discord.js').PermissionsBitField.Flags.ViewChannel, require('discord.js').PermissionsBitField.Flags.SendMessages, require('discord.js').PermissionsBitField.Flags.ReadMessageHistory, require('discord.js').PermissionsBitField.Flags.ManageChannels],
                    },
                    {
                        id: seller1,
                        allow: [require('discord.js').PermissionsBitField.Flags.ViewChannel, require('discord.js').PermissionsBitField.Flags.SendMessages, require('discord.js').PermissionsBitField.Flags.ReadMessageHistory],
                    }
                ];

                if (seller2) {
                    permissionOverwrites.push({
                        id: seller2,
                        allow: [require('discord.js').PermissionsBitField.Flags.ViewChannel, require('discord.js').PermissionsBitField.Flags.SendMessages, require('discord.js').PermissionsBitField.Flags.ReadMessageHistory],
                    });
                }

                let channelName = `rss-${interaction.user.username}-${Math.floor(1000 + Math.random() * 9000)}`;
                channelName = channelName.toLowerCase().replace(/[^a-zA-Z0-9-]/g, '').substring(0, 30);

                const ticketChannel = await guild.channels.create({
                    name: channelName,
                    type: require('discord.js').ChannelType.GuildText,
                    parent: categoryId || null,
                    topic: interaction.user.id,
                    permissionOverwrites: permissionOverwrites
                });

                // Update channel ID in DB
                await db.run(`UPDATE rss_transactions SET channelId = ? WHERE id = ?`, [ticketChannel.id, txId]);

                const { ButtonBuilder, ButtonStyle } = require('discord.js');
                // Create Action Buttons inside Ticket Channel
                const rowButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`rss_buy_complete_${txId}`).setLabel('Mark Complete').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`rss_buy_cancel_${txId}`).setLabel('Cancel Order').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );

                const paymentLabels = {
                    paypal: '💳 PayPal',
                    cashapp: '💵 Cash App',
                    venmo: '📱 Venmo',
                    zelle: '🏦 Zelle',
                    revolut: '🪙 Revolut',
                    crypto: '₿ Crypto (BTC/USDT)',
                    bank: '🏛️ Bank Transfer',
                    applepay: '🍎 Apple Pay / Google Pay',
                    unspecified: '❔ Unspecified'
                };
                const readablePayment = chosenPayments.length > 0 
                    ? chosenPayments.map(p => paymentLabels[p] || p.toUpperCase()).join(', ') 
                    : '❔ Unspecified';

                const summaryEmbed = new EmbedBuilder()
                    .setTitle('🌾 RSS Purchase Order Summary')
                    .setDescription(`Welcome to your private RSS trade channel! An order has been placed successfully.\n\n**Order ID:** \`${txId}\``)
                    .addFields(
                        { name: '👤 Buyer', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '💳 Payment Method(s)', value: readablePayment, inline: true }
                    )
                    .setColor('#10b981')
                    .setTimestamp();

                // Add resources details
                const items = [];
                if (reqFood > 0) items.push(`🌾 **Food:** ${formatRssAmount(reqFood)}`);
                if (reqWood > 0) items.push(`🪵 **Wood:** ${formatRssAmount(reqWood)}`);
                if (reqStone > 0) items.push(`🪨 **Stone:** ${formatRssAmount(reqStone)}`);
                if (reqGold > 0) items.push(`🪙 **Gold:** ${formatRssAmount(reqGold)}`);
                summaryEmbed.addFields({ name: '🛒 Resources Requested', value: items.join('\n'), inline: false });

                // Add Seller details
                if (splitOrder) {
                    summaryEmbed.addFields(
                        { name: '🤝 Sellers Assigned (50/50 Split)', value: `1. <@${seller1}>\n2. <@${seller2}>`, inline: false }
                    );
                } else {
                    summaryEmbed.addFields(
                        { name: '👤 Seller Assigned', value: `<@${seller1}>`, inline: false }
                    );
                }

                summaryEmbed.addFields({ name: '⏳ Delivery Status', value: 'Pending delivery. The seller(s) will contact you shortly to coordinate resource transfer.', inline: false });

                let pingText = `<@${interaction.user.id}> <@${seller1}>`;
                if (seller2) pingText += ` <@${seller2}>`;

                await ticketChannel.send({
                    content: `🔔 **New RSS Order Opened!**\n${pingText}`,
                    embeds: [summaryEmbed],
                    components: [rowButtons]
                });

                await interaction.editReply(`✅ **Trade channel created!** Please join ${ticketChannel} to complete your transaction.`);
            } else if (interaction.customId === 'modal_register_ads') {
                const amountStr = interaction.fields.getTextInputValue('adsAmount');
                const amount = parseInt(amountStr, 10);

                if (isNaN(amount) || amount <= 0) {
                    return interaction.reply({ content: "❌ Please enter a valid number greater than 0.", ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });
                await processAdsSubmission(interaction, amount);
            } else if (interaction.customId === 'rss_stock_modal_submit') {
                await interaction.deferReply({ ephemeral: true });

                const db = await getDb();
                const { parseRssAmount, formatRssAmount } = require('../commands/economy/rss-stock');

                const addFood = parseRssAmount(interaction.fields.getTextInputValue('food') || '0') || 0;
                const addWood = parseRssAmount(interaction.fields.getTextInputValue('wood') || '0') || 0;
                const addStone = parseRssAmount(interaction.fields.getTextInputValue('stone') || '0') || 0;
                const addGold = parseRssAmount(interaction.fields.getTextInputValue('gold') || '0') || 0;

                if (addFood === 0 && addWood === 0 && addStone === 0 && addGold === 0) {
                    return interaction.editReply('❌ You must add at least one resource and enter a valid quantity (e.g. 50M or 100k).');
                }

                const existing = await db.get(`SELECT * FROM rss_seller_stocks WHERE sellerId = ?`, [interaction.user.id]);
                const newFood = (existing?.food || 0) + addFood;
                const newWood = (existing?.wood || 0) + addWood;
                const newStone = (existing?.stone || 0) + addStone;
                const newGold = (existing?.gold || 0) + addGold;

                await db.run(
                    `INSERT INTO rss_seller_stocks (sellerId, food, wood, stone, gold, updatedAt) 
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(sellerId) DO UPDATE SET 
                        food = EXCLUDED.food,
                        wood = EXCLUDED.wood,
                        stone = EXCLUDED.stone,
                        gold = EXCLUDED.gold,
                        updatedAt = CURRENT_TIMESTAMP`,
                    [interaction.user.id, newFood, newWood, newStone, newGold]
                );

                // Update collective stock message if applicable
                try {
                    const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                    const roleNameOrId = config?.rssSellerRole || 'RSS Seller';
                    let sellers = [];
                    let sellerListStr = 'No verified RSS Sellers found.';

                    try {
                        const role = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                        if (role) {
                            await interaction.guild.members.fetch();
                            const membersWithRole = role.members;
                            sellers = membersWithRole.map(m => m.id);
                            if (membersWithRole.size > 0) {
                                sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                            }
                        } else {
                            await interaction.guild.members.fetch();
                            const membersWithRole = interaction.guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase()));
                            sellers = membersWithRole.map(m => m.id);
                            if (membersWithRole.size > 0) {
                                sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                            }
                        }
                    } catch (err) {
                        console.error('[Update Panel] Error fetching members/roles:', err);
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

                    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setFields(
                            { name: '👥 Verified Sellers', value: sellerListStr },
                            { name: '🌾 Collective Stocks', value: `**Food:** ${formatNumber(totalFood)}\n**Wood:** ${formatNumber(totalWood)}\n**Stone:** ${formatNumber(totalStone)}\n**Gold:** ${formatNumber(totalGold)}` }
                        );

                    await interaction.message.edit({ embeds: [updatedEmbed] });
                } catch (editErr) {
                    console.error('Failed to update collective stock embed:', editErr);
                }

                return interaction.editReply(`✅ **Stock added successfully!**\n\n**Your Current Inventory:**\n🌾 Food: ${formatRssAmount(newFood)}\n🪵 Wood: ${formatRssAmount(newWood)}\n🪨 Stone: ${formatRssAmount(newStone)}\n🪙 Gold: ${formatRssAmount(newGold)}`);
            } else if (interaction.customId === 'rss_stock_remove_modal_submit') {
                await interaction.deferReply({ ephemeral: true });

                const db = await getDb();
                const { parseRssAmount, formatRssAmount } = require('../commands/economy/rss-stock');

                const subFood = parseRssAmount(interaction.fields.getTextInputValue('food') || '0') || 0;
                const subWood = parseRssAmount(interaction.fields.getTextInputValue('wood') || '0') || 0;
                const subStone = parseRssAmount(interaction.fields.getTextInputValue('stone') || '0') || 0;
                const subGold = parseRssAmount(interaction.fields.getTextInputValue('gold') || '0') || 0;

                if (subFood === 0 && subWood === 0 && subStone === 0 && subGold === 0) {
                    return interaction.editReply('❌ You must specify at least one resource to remove and enter a valid quantity (e.g. 50M or 100k).');
                }

                const existing = await db.get(`SELECT * FROM rss_seller_stocks WHERE sellerId = ?`, [interaction.user.id]);
                const newFood = Math.max(0, (existing?.food || 0) - subFood);
                const newWood = Math.max(0, (existing?.wood || 0) - subWood);
                const newStone = Math.max(0, (existing?.stone || 0) - subStone);
                const newGold = Math.max(0, (existing?.gold || 0) - subGold);

                await db.run(
                    `INSERT INTO rss_seller_stocks (sellerId, food, wood, stone, gold, updatedAt) 
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(sellerId) DO UPDATE SET 
                        food = EXCLUDED.food,
                        wood = EXCLUDED.wood,
                        stone = EXCLUDED.stone,
                        gold = EXCLUDED.gold,
                        updatedAt = CURRENT_TIMESTAMP`,
                    [interaction.user.id, newFood, newWood, newStone, newGold]
                );

                // Update collective stock message if applicable
                try {
                    const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                    const roleNameOrId = config?.rssSellerRole || 'RSS Seller';
                    let sellers = [];
                    let sellerListStr = 'No verified RSS Sellers found.';

                    try {
                        const role = interaction.guild.roles.cache.get(roleNameOrId) || interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                        if (role) {
                            await interaction.guild.members.fetch();
                            const membersWithRole = role.members;
                            sellers = membersWithRole.map(m => m.id);
                            if (membersWithRole.size > 0) {
                                sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                            }
                        } else {
                            await interaction.guild.members.fetch();
                            const membersWithRole = interaction.guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase()));
                            sellers = membersWithRole.map(m => m.id);
                            if (membersWithRole.size > 0) {
                                sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                            }
                        }
                    } catch (err) {
                        console.error('[Update Panel] Error fetching members/roles:', err);
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

                    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setFields(
                            { name: '👥 Verified Sellers', value: sellerListStr },
                            { name: '🌾 Collective Stocks', value: `**Food:** ${formatNumber(totalFood)}\n**Wood:** ${formatNumber(totalWood)}\n**Stone:** ${formatNumber(totalStone)}\n**Gold:** ${formatNumber(totalGold)}` }
                        );

                    await interaction.message.edit({ embeds: [updatedEmbed] });
                } catch (editErr) {
                    console.error('Failed to update collective stock embed:', editErr);
                }

                return interaction.editReply(`✅ **Stock removed successfully!**\n\n**Your Current Inventory:**\n🌾 Food: ${formatRssAmount(newFood)}\n🪵 Wood: ${formatRssAmount(newWood)}\n🪨 Stone: ${formatRssAmount(newStone)}\n🪙 Gold: ${formatRssAmount(newGold)}`);
            }
            else if (interaction.customId.startsWith('modal_ticket_app_')) {
                const parts = interaction.customId.split('_');
                const panelId = parts[3];
                const dIdx = parseInt(parts[4]);
                const oIdx = parseInt(parts[5]);

                const db = await getDb();
                const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                if (!panelRec) return interaction.reply({ content: 'It looks like your ticket is already being processed. Please check your DMs or your open ticket channel.', ephemeral: true });

                const data = JSON.parse(panelRec.panelData);
                const opt = data.dropdowns[dIdx].options[oIdx];
                
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                if (!moduleConfigs || !moduleConfigs.ticketsEnabled) {
                    return interaction.reply({ content: '❌ The ticket system is currently disabled.', ephemeral: true });
                }

                const answers = [];
                // Only first 5 questions could be rendered in modal
                const numQuestions = Math.min(opt.questions.length, 5);
                for (let i = 0; i < numQuestions; i++) {
                    const rawQuestion = opt.questions[i];
                    const questionText = typeof rawQuestion === 'string'
                        ? rawQuestion
                        : (rawQuestion?.text || rawQuestion?.label || rawQuestion?.question || `Question ${i + 1}`);

                    answers.push({
                        question: questionText,
                        answer: interaction.fields.getTextInputValue(`q_${i}`)
                    });
                }

                const { createTicketChannel } = require('../utils/applicationHandler');
                await createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs);
            }
            else if (interaction.customId.startsWith('admin_app_decline_modal_')) {
                const uuid = interaction.customId.split('_').pop();
                const reason = interaction.fields.getTextInputValue('declineReason') || 'No specific reason provided.';
                
                const db = await getDb();
                const pending = await db.get(`SELECT * FROM pending_tickets WHERE uuid = ?`, [uuid]);
                if (!pending) return interaction.reply({ content: '❌ Application data not found.', ephemeral: true });

                const user = await client.users.fetch(pending.userId).catch(() => null);
                if (user) {
                    await user.send(`❌ Your application for **${JSON.parse(pending.optJson).label}** was declined.\n**Reason:** ${reason}`).catch(() => {});
                }

                await db.run(`DELETE FROM pending_tickets WHERE uuid = ?`, [uuid]);
                await interaction.update({ content: `❌ Application declined by <@${interaction.user.id}>.\n**Reason:** ${reason}`, embeds: interaction.message.embeds, components: [] });
            }
            else if (interaction.customId.startsWith('modal_market_')) {
                const { handleMarketInteraction } = require('../features/market');
                await handleMarketInteraction(interaction);
            }
        }
    },
};
