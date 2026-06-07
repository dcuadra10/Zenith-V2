const { getDb } = require('../config/database');
const { EmbedBuilder } = require('discord.js');

/**
 * Helper to log economy events to the server's surveillance logging channel.
 */
async function logEconomyEvent(guildId, userId, amount, type, details = {}) {
    if (!guildId) return;
    try {
        const db = await getDb();
        const conf = await db.get(`SELECT loggingEnabled, loggingChannel FROM module_configs WHERE guildId = ?`, [guildId]);
        if (!conf || !conf.loggingEnabled || !conf.loggingChannel) return;

        const { client } = require('../index');
        if (!client || !client.isReady()) return;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = guild.channels.cache.get(conf.loggingChannel);
        if (!channel) return;

        let userMention = userId ? `<@${userId}>` : 'System/Syndicate';
        let userTag = '';
        if (userId) {
            try {
                const userObj = await client.users.fetch(userId);
                if (userObj) userTag = ` (${userObj.tag})`;
            } catch (e) {}
        }

        const embed = new EmbedBuilder().setTimestamp();
        let title = '💰 Economy Event';
        let color = '#3498db';
        let desc = '';

        switch (type) {
            case 'deposit':
                title = '💰 Economy: Wallet Deposit';
                color = '#2ecc71';
                desc = `**User:** ${userMention}${userTag}\n**Amount:** +${amount.toLocaleString()} coins\n**New Balance:** ${details.newBalance !== undefined ? details.newBalance.toLocaleString() : 'N/A'} coins\n**Reason:** ${details.reason || 'Deposit'}`;
                if (details.baseAmount !== undefined && details.baseAmount !== amount) {
                    embed.addFields(
                        { name: 'Base Amount', value: `${details.baseAmount.toLocaleString()} coins`, inline: true },
                        { name: 'Final Amount (after Taxes/Multipliers)', value: `${amount.toLocaleString()} coins`, inline: true }
                    );
                }
                break;
            case 'withdrawal':
                title = '💸 Economy: Wallet Withdrawal';
                color = '#e74c3c';
                desc = `**User:** ${userMention}${userTag}\n**Amount:** -${amount.toLocaleString()} coins\n**New Balance:** ${details.newBalance !== undefined ? details.newBalance.toLocaleString() : 'N/A'} coins\n**Reason:** ${details.reason || 'Withdrawal'}`;
                break;
            case 'mafia_vault_deposit':
                title = '🏦 Mafia: Vault Deposit';
                color = '#2ecc71';
                desc = `**Mafia:** ${details.mafiaName || 'Unknown Mafia'} (ID: \`${details.mafiaId}\`)\n**User:** ${userMention}${userTag}\n**Amount:** +${amount.toLocaleString()} coins\n**Reason:** ${details.reason || 'Vault Contribution'}`;
                break;
            case 'mafia_vault_withdraw':
                title = '💸 Mafia: Vault Withdrawal';
                color = '#e74c3c';
                desc = `**Mafia:** ${details.mafiaName || 'Unknown Mafia'} (ID: \`${details.mafiaId}\`)\n**Amount:** -${amount.toLocaleString()} coins\n**Reason:** ${details.reason || 'Vault Expenditure'}`;
                break;
            case 'mafia_treasury_deposit':
                title = '👑 Mafia: Treasury Deposit';
                color = '#2ecc71';
                desc = `**Mafia:** ${details.mafiaName || 'Unknown Mafia'} (ID: \`${details.mafiaId}\`)\n**User:** ${userMention}${userTag}\n**Amount:** +${amount.toLocaleString()} coins\n**Reason:** ${details.reason || 'Donation'}`;
                break;
            case 'mafia_treasury_withdraw':
                title = '💸 Mafia: Treasury Withdrawal';
                color = '#e74c3c';
                desc = `**Mafia:** ${details.mafiaName || 'Unknown Mafia'} (ID: \`${details.mafiaId}\`)\n**Amount:** -${amount.toLocaleString()} coins\n**Reason:** ${details.reason || 'Upgrade/Expense'}`;
                break;
            case 'dirty_money_gain':
                title = '💵 Mafia: Dirty Money Earned';
                color = '#f1c40f';
                desc = `**User:** ${userMention}${userTag}\n**Amount:** +${amount.toLocaleString()} dirty bills\n**Reason:** ${details.reason || 'Criminal Activity'}`;
                break;
            case 'dirty_money_clean':
                title = '🧼 Mafia: Money Laundering';
                color = '#2ecc71';
                desc = `**User:** ${userMention}${userTag}\n**Dirty Cleaned:** -${amount.toLocaleString()} dirty bills\n**Clean Received:** +${(details.cleanAmount || 0).toLocaleString()} coins\n**Laundering Fee:** ${(details.feePercent || 0)}%`;
                break;
            case 'bank_robbery':
                title = '🚨 Heist: Bank Robbed';
                color = '#e74c3c';
                desc = `**Bank:** ${details.bankName} (ID: \`${details.bankId}\`)\n**Total Looted:** ${amount.toLocaleString()} coins\n**Vault Payout:** +${(details.vaultShare || 0).toLocaleString()} coins\n**Participant Cut:** +${(details.participantCut || 0).toLocaleString()} coins per user\n**Team:** ${details.team || 'Unknown'}`;
                break;
            case 'business_raid':
                title = '💥 Raid: Business Raided';
                color = '#e74c3c';
                desc = `**Business ID:** \`${details.businessId}\` (Type: ${details.businessType})\n**Owner:** <@${details.ownerId}>\n**Total Stolen:** ${amount.toLocaleString()} coins\n**Vault Share (20%):** +${(details.vaultShare || 0).toLocaleString()} coins\n**Participant Cut (80%):** +${(details.participantCut || 0).toLocaleString()} coins per user\n**Team:** ${details.team || 'Unknown'}`;
                break;
            default:
                title = `💰 Economy: ${type}`;
                desc = `**User:** ${userMention}${userTag}\n**Amount:** ${amount.toLocaleString()} coins\n**Reason:** ${details.reason || 'Event'}`;
        }

        embed.setTitle(title).setColor(color).setDescription(desc);
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        console.error('[Economy/Mafia Log Error]', err);
    }
}

/**
 * Adds coins to a user's balance, applying social bonuses if guildId is provided.
 * @param {string} userId - The Discord User ID
 * @param {number} amount - Base amount of coins to add
 * @param {string} [guildId] - The Discord Guild ID for social bonus calculation
 * @param {boolean} [bypassTax] - Whether to skip mafia tax
 * @param {string} [reason] - The reason for adding coins (for logging)
 * @param {boolean} [bypassBonus] - Whether to skip social bonus calculations
 * @returns {Promise<number>} - The new balance
 */
async function addBalance(userId, amount, guildId = null, bypassTax = false, reason = null, bypassBonus = false) {
    if (amount === 0) return 0;
    const db = await getDb();
    const finalGuildId = guildId || 'global';
    
    let finalAmount = amount;
    if (guildId && !bypassBonus) {
        finalAmount = await calculateBonuses(userId, guildId, amount);
    }

    // --- Mafia Tax System ---
    if (!bypassTax) {
        const userData = await db.get(`SELECT mafiaId FROM users WHERE userId = ? AND guildId = ?`, [userId, finalGuildId]);
        let mafiaId = userData?.mafiaId;
        if (!mafiaId) {
            const memberData = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [userId, finalGuildId]);
            mafiaId = memberData?.mafiaId;
        }
        if (mafiaId) {
            const mafia = await db.get(`SELECT taxRate FROM economy_mafias WHERE id = ?`, [mafiaId]);
            if (mafia && mafia.taxRate > 0) {
                const tax = Math.floor(finalAmount * mafia.taxRate);
                if (tax > 0) {
                    finalAmount -= tax;
                    await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [tax, mafiaId]);
                    await db.run(`UPDATE mafia_members SET contributed = contributed + ? WHERE userId = ? AND mafiaId = ?`, [tax, userId, mafiaId]);
                }
            }
        }
    }

    await db.run(
        `INSERT INTO users (userId, guildId, balance) VALUES (?, ?, ?)
         ON CONFLICT(userId, guildId) DO UPDATE SET balance = users.balance + ?`,
        [userId, finalGuildId, finalAmount, finalAmount]
    );
    const user = await db.get(`SELECT balance FROM users WHERE userId = ? AND guildId = ?`, [userId, finalGuildId]);
    const newBalance = user ? user.balance : 0;

    if (guildId) {
        await logEconomyEvent(guildId, userId, finalAmount, 'deposit', {
            newBalance,
            reason: reason || 'Deposit',
            baseAmount: amount
        });
    }

    return newBalance;
}

/**
 * Calculates bonus coins based on marriage and family size.
 */
async function calculateBonuses(userId, guildId, amount) {
    const db = await getDb();
    const finalGuildId = guildId || 'global';
    const user = await db.get(`SELECT partnerId FROM users WHERE userId = ? AND guildId = ?`, [userId, finalGuildId]);
    let multiplier = 1.0;

    // Marriage Bonus (+10%)
    if (user && user.partnerId) {
        multiplier += 0.10;
    }

    // Family Bonus (+5% per child, max 25%)
    const children = await db.all(`SELECT childId FROM social_adoptions WHERE parentId = ? AND guildId = ?`, [userId, guildId]);
    if (children && children.length > 0) {
        multiplier += Math.min(children.length * 0.05, 0.25);
    }

    return Math.floor(amount * multiplier);
}

/**
 * Deducts coins from a user's balance.
 * @param {string} userId - The Discord User ID
 * @param {number} amount - Amount of coins to deduct
 * @param {string} [guildId] - The Discord Guild ID for logging
 * @param {string} [reason] - The reason for deducting coins (for logging)
 * @returns {Promise<boolean>} - True if successful, false if insufficient funds
 */
async function removeBalance(userId, amount, guildId = null, reason = null) {
    const db = await getDb();
    const finalGuildId = guildId || 'global';
    const result = await db.run(`UPDATE users SET balance = balance - ? WHERE userId = ? AND guildId = ? AND balance >= ?`, [amount, userId, finalGuildId, amount]);
    const success = result.changes > 0;

    if (success && guildId) {
        const user = await db.get(`SELECT balance FROM users WHERE userId = ? AND guildId = ?`, [userId, finalGuildId]);
        const newBalance = user ? user.balance : 0;
        await logEconomyEvent(guildId, userId, amount, 'withdrawal', {
            newBalance,
            reason: reason || 'Withdrawal'
        });
    }

    return success;
}

module.exports = { addBalance, removeBalance, logEconomyEvent };
