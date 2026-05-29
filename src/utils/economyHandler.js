const { getDb } = require('../config/database');

/**
 * Adds coins to a user's balance, applying social bonuses if guildId is provided.
 * @param {string} userId - The Discord User ID
 * @param {number} amount - Base amount of coins to add
 * @param {string} [guildId] - The Discord Guild ID for social bonus calculation
 * @param {boolean} [bypassTax] - Whether to skip mafia tax
 * @returns {Promise<number>} - The new balance
 */
async function addBalance(userId, amount, guildId = null, bypassTax = false) {
    if (amount === 0) return 0;
    const db = await getDb();
    
    let finalAmount = amount;
    if (guildId) {
        finalAmount = await calculateBonuses(userId, guildId, amount);
    }

    // --- Mafia Tax System ---
    if (!bypassTax) {
        const userData = await db.get(`SELECT mafiaId FROM users WHERE userId = ?`, [userId]);
        if (userData && userData.mafiaId) {
            const mafia = await db.get(`SELECT taxRate FROM economy_mafias WHERE id = ?`, [userData.mafiaId]);
            if (mafia && mafia.taxRate > 0) {
                const tax = Math.floor(finalAmount * mafia.taxRate);
                if (tax > 0) {
                    finalAmount -= tax;
                    await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [tax, userData.mafiaId]);
                    await db.run(`UPDATE mafia_members SET contributed = contributed + ? WHERE userId = ? AND mafiaId = ?`, [tax, userId, userData.mafiaId]);
                }
            }
        }
    }

    await db.run(
        `INSERT INTO users (userId, balance) VALUES (?, ?)
         ON CONFLICT(userId) DO UPDATE SET balance = users.balance + ?`,
        [userId, finalAmount, finalAmount]
    );
    const user = await db.get(`SELECT balance FROM users WHERE userId = ?`, [userId]);
    return user ? user.balance : 0;
}

/**
 * Calculates bonus coins based on marriage and family size.
 */
async function calculateBonuses(userId, guildId, amount) {
    const db = await getDb();
    const user = await db.get(`SELECT partnerId FROM users WHERE userId = ?`, [userId]);
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
 * @returns {Promise<boolean>} - True if successful, false if insufficient funds
 */
async function removeBalance(userId, amount) {
    const db = await getDb();
    const result = await db.run(`UPDATE users SET balance = balance - ? WHERE userId = ? AND balance >= ?`, [amount, userId, amount]);
    return result.changes > 0;
}

module.exports = { addBalance, removeBalance };
