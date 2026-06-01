const { getDb } = require('../config/database');
const { getISOWeekString, isWeekWithinExcuse } = require('../utils/dateHelpers');
const { exportR4WeeklyData } = require('../utils/googleSheetsConnector');

module.exports = (client) => {
    // Run every hour to check for past weeks that haven't been processed
    setInterval(async () => {
        try {
            const db = await getDb();
            const currentWeekId = getISOWeekString();

            // Find all records that are from previous weeks and haven't been processed
            const unprocessed = await db.all(`SELECT * FROM r4_tracking WHERE weekId < ? AND isProcessed = 0`, [currentWeekId]);
            if (!unprocessed || unprocessed.length === 0) return;

            // Group by guildId and weekId to process them together
            const groups = {};
            for (const record of unprocessed) {
                const key = `${record.guildId}_${record.weekId}`;
                if (!groups[key]) groups[key] = { guildId: record.guildId, weekId: record.weekId, records: [] };
                groups[key].records.push(record);
            }

            for (const key in groups) {
                const group = groups[key];
                const conf = await db.get(`SELECT r4TrackingAdQuota, r4TrackingMsgQuota, r4TrackingRole, spreadsheetId FROM module_configs mc JOIN guild_configs gc ON mc.guildId = gc.guildId WHERE mc.guildId = ?`, [group.guildId]);
                
                if (!conf) {
                    console.log(`[R4Tracker] No config found for guild ${group.guildId}. Marking records as processed to prevent queue bloat.`);
                    for (const record of group.records) {
                        await db.run(`UPDATE r4_tracking SET isProcessed = 1 WHERE userId = ? AND guildId = ? AND weekId = ?`, [record.userId, record.guildId, record.weekId]);
                    }
                    continue;
                }

                const adQuota = conf.r4TrackingAdQuota || 40;
                const msgQuota = conf.r4TrackingMsgQuota || 245;
                const roleIdRaw = conf.r4TrackingRole || conf.r4trackingrole;
                const r4RoleId = roleIdRaw ? roleIdRaw.replace(/[^0-9]/g, '') : null;

                let guild = null;
                try {
                    guild = await client.guilds.fetch(group.guildId);
                } catch (e) {
                    console.log(`Could not fetch guild ${group.guildId} for R4 tracking evaluation`);
                }

                if (!guild || !r4RoleId) {
                    // Mark as processed if guild or role is missing/invalid to keep the queue clean
                    for (const record of group.records) {
                        await db.run(`UPDATE r4_tracking SET isProcessed = 1 WHERE userId = ? AND guildId = ? AND weekId = ?`, [record.userId, record.guildId, record.weekId]);
                    }
                    continue;
                }

                const sheetData = [];

                for (const record of group.records) {
                    let member = null;
                    try {
                        member = await guild.members.fetch(record.userId);
                    } catch (e) {
                        // User left the guild or failed to fetch
                    }

                    if (!member || !member.roles.cache.has(r4RoleId)) {
                        // User is no longer in the guild or no longer has the R4 role.
                        // Mark as processed so we don't check again, but do NOT send DM or add to Sheets.
                        await db.run(`UPDATE r4_tracking SET isProcessed = 1 WHERE userId = ? AND guildId = ? AND weekId = ?`, [record.userId, record.guildId, record.weekId]);
                        continue;
                    }

                    // Check if they are excused under r4_excuses
                    const excuse = await db.get(`SELECT startWeekId, durationWeeks, excuseReason FROM r4_excuses WHERE userId = ? AND guildId = ?`, [record.userId, record.guildId]);
                    let isExcused = record.excused === 1;
                    let excuseReason = record.excuseReason;

                    if (excuse) {
                        const excuseCheck = isWeekWithinExcuse(excuse.startWeekId, excuse.durationWeeks, record.weekId);
                        if (excuseCheck.excused) {
                            isExcused = true;
                            excuseReason = excuse.excuseReason || 'Excusado';
                        }
                    }

                    const adPct = (record.ads / adQuota) * 100;
                    const msgPct = (record.messages / msgQuota) * 100;
                    const totalPct = Math.min(Math.round(adPct + msgPct), 200);

                    let status = 'Failing';
                    if (isExcused) status = 'Excused';
                    else if (totalPct >= 100) status = 'Passed';
                    else if (totalPct >= 75) status = 'Warning';

                    sheetData.push({
                        userId: record.userId,
                        weekId: record.weekId,
                        ads: record.ads,
                        messages: record.messages,
                        progressPct: totalPct,
                        status: status
                    });

                    // If failing (<75%) and not excused, send DM
                    if (totalPct < 75 && !isExcused) {
                        try {
                            const user = await client.users.fetch(record.userId);
                            if (user) {
                                await user.send(`⚠️ **R4 Activity Warning**\n\nYou did not meet the minimum required activity quota (75%) for week **${record.weekId}**.\nYour total completion was **${totalPct}%**.\n\nPlease ensure you maintain your activity. If you need to be excused, contact leadership.`);
                            }
                        } catch (e) {
                            console.log(`Could not send DM to failing user ${record.userId}`);
                        }
                    }

                    // Mark as processed
                    await db.run(`UPDATE r4_tracking SET isProcessed = 1 WHERE userId = ? AND guildId = ? AND weekId = ?`, [record.userId, record.guildId, record.weekId]);
                }

                // Export to Google Sheets
                if (conf.spreadsheetId) {
                    try {
                        await exportR4WeeklyData(conf.spreadsheetId, group.weekId, sheetData);
                    } catch (e) {
                        console.log(`Error syncing R4 week ${group.weekId} to sheets for guild ${group.guildId}:`, e.message);
                    }
                }
            }
        } catch (error) {
            console.error('Error in R4 Tracker Cron Job:', error);
        }
    }, 60 * 60 * 1000); // 1 hour
};
