const { Pool } = require('pg');

let dbInstance = null;
let _initializingDbPromise = null;

function convertSqliteToPg(query, params = []) {
    let i = 1;
    // Replace SQLite parameter bindings (?) with Postgres bindings ($1, $2, ...)
    const text = query.replace(/\?/g, () => `$${i++}`);
    return { text, values: params };
}

// Convert SQLite schema specifically
function convertSqliteSchemaToPg(query) {
    let pgQuery = query.replace(/DATETIME/gi, 'TIMESTAMP');
    // Remove SQLite PRAGMA statements that are invalid in Postgres
    pgQuery = pgQuery.replace(/PRAGMA[^;]*;?/gi, '');
    // Replace SQLite's INSERT OR IGNORE with Postgres ON CONFLICT DO NOTHING
    pgQuery = pgQuery.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
    pgQuery = pgQuery.replace(/ON CONFLICT\([^)]+\) DO UPDATE SET\s+([^;]+)/gi, (m) => m); // keep existing ON CONFLICT as-is
    return pgQuery;
}

// Map of lowercase PG column names to their original camelCase names
const columnNameMap = {};
function buildColumnMap(cols) {
    // Known camelCase column names used throughout the codebase
    const knownColumns = [
        'guildId', 'userId', 'statName',
        'welcomeEnabled', 'welcomeChannel', 'welcomeEmbedTitle', 'welcomeEmbedDesc', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
        'levelingEnabled', 'xpMin', 'xpMax', 'xpCooldown', 'levelUpChannel', 'roleRewards',
        'ticketsEnabled', 'ticketsMaxActive', 'ticketsTranscriptChannel', 'ticketCategoryId', 'ticketsApprovalChannel',
        'automodEnabled', 'automodSpam', 'automodLinks', 'automodMentions', 'automodCaps', 'automodWords',
        'automodWordList', 'automodMaxMentions', 'automodLogChannel',
        'loggingEnabled', 'loggingChannel', 'logEdits', 'logDeletes', 'logMembers', 'logRoles', 'logChannels', 'logBans',
        'autoroleEnabled', 'autoroleIds',
        'countingEnabled', 'countingChannel', 'countingCurrent', 'countingSameUser', 'countingReset', 'countingMath', 'countingLastUser', 'countingEmoji', 'countingEmojiFail',
        'serverStatsEnabled', 'statsTotalMembers', 'statsOnline', 'statsBots', 'statsChannels', 'statsCategoryId',
        'antinukeEnabled', 'antinukeBan', 'antinukeChannel', 'antinukeRole', 'antinukeWebhook', 'antinukeThreshold', 'antinukeWhitelist',
        'r4TrackingEnabled', 'r4TrackingRole', 'r4TrackingAdQuota', 'r4TrackingMsgQuota',
        'swearJarEnabled', 'swearJarChannel', 'swearJarWords', 'swearJarPing',
        'spreadsheetId', 'leadershipChannelId', 'welcomeChannelId', 'logChannelId',
        'brandingName', 'brandingAvatar',
        'panelData', 'channelId', 'messageId',
        'ticketId', 'logContent', 'closedAt',
        'weekId', 'messages', 'ads', 'excused', 'excuseReason',
        'uuid', 'optJson', 'answersJson',
        'winnersCount', 'endTime', 'prize', 'requiredRole', 'pingRole', 'durationMs', 'status',
        'botToken', 'clientId', 'errorMessage',
        'marketEnabled', 'forumChannelId', 'approvalChannelId', 'ownerChannelId', 'paymentMethods', 'middlemanRole', 'feePercentage', 'marketFeePct', 'middlemanFeePct', 'mmPaymentMethods',
        'sellerId', 'dataJson', 'imagesJson', 'forumThreadId', 'buyerId', 'middlemanId', 'offerJson', 'listingCode', 'seller1Id', 'seller2Id', 'totalSoldFood', 'totalSoldWood', 'totalSoldStone', 'totalSoldGold', 'totalTransactions', 'createdAt', 'updatedAt',
        'ecoEnabled', 'ecoCoinsPerMessage', 'ecoCoinsPerAd', 'ecoCoinsPerInvite', 'ecoCoinsPerWelcome', 'ecoCoinsPerBoost', 'ecoCoinsPerGiveaway', 'ecoCoinsPerVCMinute', 'ecoWelcomeKeywords', 'ecoWelcomeNotifyChannel',
        'mafiaId', 'leaderId', 'taxRate', 'vault', 'upgrades', 'contributed', 'ownerMafiaId', 'bonusType', 'bonusValue', 'turfId',
        'sectorId', 'totalInvested', 'dirtyMoney', 'jailUntil', 'reputation',
        'jobId', 'lastWork', 'workplaceId', 'employeeCount', 'hiringEnabled', 'salary', 'customName', 'workExperience',
        'rssEnabled', 'rssSellerRole', 'rssTaxRate', 'rssCategory',
        'pendingTaxFood', 'pendingTaxWood', 'pendingTaxStone', 'pendingTaxGold',
        'openaiApiKey', 'characterName', 'characterTraits', 'chatEnabled', 'chatChannels', 'supportEnabled', 'supportChannel', 'supportKnowledgeChannels', 'botToBotChatEnabled', 'maxBotTurns', 'enabled', 'clientId', 'languageMode',
        'giveawaysManagerRole', 'giveawaysLogChannel', 'giveawaysEcoReward', 'giveawaysEcoCoins',
        'rokVerifierEnabled', 'rokVerifierRole', 'rokVerifierTags', 'rokVerifierChannel',
        'governorId', 'governorName', 'allianceTag', 'power', 'killPoints', 'verifiedAt',
        'hallOfShameEnabled', 'hallOfShameEmoji', 'hallOfShameThreshold', 'hallOfShameChannel'
    ];
    knownColumns.forEach(col => {
        columnNameMap[col.toLowerCase()] = col;
    });
}
buildColumnMap();

// Restore camelCase keys on a row object
function restoreKeys(row) {
    if (!row) return row;
    const restored = {};
    for (const key of Object.keys(row)) {
        restored[columnNameMap[key] || key] = row[key];
    }
    return restored;
}

async function createDbInstance() {
    if (dbInstance) return dbInstance;
    if (_initializingDbPromise) return _initializingDbPromise;

    _initializingDbPromise = (async () => {
    try {
        let useSqlite = process.env.DB_TYPE === 'sqlite';
        
        if (!useSqlite && process.env.DATABASE_URL) {
            let pool;
            try {
                console.log("[DB] Attempting PostgreSQL connection...");
                pool = new Pool({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    },
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 10000
                });

                pool.on('error', (err) => {
                    console.error('[DB] Unexpected error on idle database pool client:', err.message || err);
                });

                // Test connection by executing a quick query to check for quota/permissions
                await pool.query('SELECT 1');
                console.log("[DB] PostgreSQL connection successful.");

                const wrapper = {
                    run: async (query, params = []) => {
                        const { text, values } = convertSqliteToPg(query, params);
                        const res = await pool.query(text, values);
                        return { changes: res.rowCount, rows: res.rows };
                    },
                    get: async (query, params = []) => {
                        const { text, values } = convertSqliteToPg(query, params);
                        const res = await pool.query(text, values);
                        return restoreKeys(res.rows[0]);
                    },
                    all: async (query, params = []) => {
                        // Handle SQLite PRAGMA calls gracefully in Postgres
                        const trimmed = query.trim();
                        const pragmaMatch = trimmed.match(/^PRAGMA\s+table_info\(([^)]+)\)/i);
                        if (pragmaMatch) {
                            const tableName = pragmaMatch[1].replace(/['"]+/g, '');
                            const res = await pool.query(`SELECT column_name as name FROM information_schema.columns WHERE table_name = $1`, [tableName]);
                            return res.rows.map(r => ({ name: r.name }));
                        }
                        const { text, values } = convertSqliteToPg(query, params);
                        const res = await pool.query(text, values);
                        return res.rows.map(restoreKeys);
                    },
                    exec: async (query) => {
                        const pgQuery = convertSqliteSchemaToPg(query);
                        // Skip empty queries after conversion
                        if (!pgQuery.trim()) return;
                        return pool.query(pgQuery);
                    },
                    transaction: async (callback) => {
                        const client = await pool.connect();
                        try {
                            await client.query('BEGIN');
                            const wrappedClient = {
                                query: async (query, params = []) => {
                                    const { text, values } = convertSqliteToPg(query, params);
                                    const res = await client.query(text, values);
                                    return { changes: res.rowCount, rows: res.rows.map(restoreKeys) };
                                }
                            };
                            const result = await callback(wrappedClient);
                            await client.query('COMMIT');
                            return result;
                        } catch (e) {
                            await client.query('ROLLBACK');
                            throw e;
                        } finally {
                            client.release();
                        }
                    }
                };
                
                dbInstance = wrapper;
            } catch (pgErr) {
                console.error("[DB WARNING] PostgreSQL connection failed. Error:", pgErr.message || pgErr);
                console.warn("[DB WARNING] Falling back to local SQLite database...");
                if (pool) {
                    try { await pool.end(); } catch (e) {}
                }
                useSqlite = true;
            }
        } else if (!useSqlite) {
            console.warn("[DB WARNING] DATABASE_URL not defined. Defaulting to local SQLite database...");
            useSqlite = true;
        }

        if (useSqlite) {
            console.log("[DB] Using local SQLite database...");
            const sqlite3 = require('sqlite3').verbose();
            const db = new sqlite3.Database(process.env.SQLITE_PATH || './database.sqlite');
            
            db.configure('busyTimeout', 5000); // 5s timeout instead of immediate lock error
            db.run('PRAGMA journal_mode=WAL;', (err) => {
                if (err) console.error('[DB ERROR] Failed to enable WAL mode:', err);
                else console.log('[DB] SQLite WAL mode enabled.');
            });
            db.run('PRAGMA synchronous=NORMAL;', (err) => {
                if (err) console.error('[DB ERROR] Failed to set synchronous=NORMAL:', err);
            });
            db.on('error', err => console.error('[DB ERROR] SQLite global error:', err.message || err));
            
            const wrapper = {
                run: (query, params = []) => {
                    return new Promise((resolve, reject) => {
                        db.run(query, params, function(err) {
                            if (err) reject(err);
                            else resolve({ changes: this.changes, lastID: this.lastID });
                        });
                    });
                },
                get: (query, params = []) => {
                    return new Promise((resolve, reject) => {
                        db.get(query, params, (err, row) => {
                            if (err) reject(err);
                            else resolve(restoreKeys(row));
                        });
                    });
                },
                all: (query, params = []) => {
                    return new Promise((resolve, reject) => {
                        db.all(query, params, (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows ? rows.map(restoreKeys) : []);
                        });
                    });
                },
                exec: (query) => {
                    return new Promise((resolve, reject) => {
                        db.exec(query, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                },
                transaction: async (callback) => {
                    return new Promise((resolve, reject) => {
                        db.serialize(async () => {
                            try {
                                await new Promise((res, rej) => db.run('BEGIN TRANSACTION', err => err ? rej(err) : res()));
                                
                                const client = {
                                    query: (query, params = []) => {
                                        return new Promise((res, rej) => {
                                            db.all(query, params, (err, rows) => {
                                                if (err) rej(err);
                                                else res({ rows });
                                            });
                                        });
                                    }
                                };
                                
                                const result = await callback(client);
                                await new Promise((res, rej) => db.run('COMMIT', err => err ? rej(err) : res()));
                                resolve(result);
                            } catch (e) {
                                db.run('ROLLBACK', () => reject(e));
                            }
                        });
                    });
                }
            };
            
            dbInstance = wrapper;
        }

        // Initialize tables
        await dbInstance.exec(`
            CREATE TABLE IF NOT EXISTS users (
                userId TEXT,
                guildId TEXT,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 0,
                invites INTEGER DEFAULT 0,
                balance INTEGER DEFAULT 0,
                bank INTEGER DEFAULT 0,
                bankCapacity INTEGER DEFAULT 5000,
                jobId TEXT,
                lastWork INTEGER,
                partnerId TEXT,
                mafiaId TEXT,
                PRIMARY KEY (userId, guildId)
            );
            
            CREATE TABLE IF NOT EXISTS global_stats (
                statName TEXT PRIMARY KEY,
                value INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS guild_configs (
                guildId TEXT PRIMARY KEY,
                spreadsheetId TEXT,
                leadershipChannelId TEXT,
                welcomeChannelId TEXT,
                logChannelId TEXT,
                ticketCategoryId TEXT
            );

            CREATE TABLE IF NOT EXISTS ticket_panels (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                channelId TEXT,
                messageId TEXT,
                panelData TEXT
            );
            
            CREATE TABLE IF NOT EXISTS ticket_transcripts (
                ticketId TEXT PRIMARY KEY,
                guildId TEXT,
                userId TEXT,
                closedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                logContent TEXT
            );
            
            CREATE TABLE IF NOT EXISTS giveaways (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                channelId TEXT,
                prize TEXT,
                winnersCount INTEGER,
                endTime BIGINT,
                hostedBy TEXT,
                requiredRole TEXT,
                pingRole TEXT,
                status TEXT DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS pending_tickets (
                uuid TEXT PRIMARY KEY,
                guildId TEXT,
                userId TEXT,
                optJson TEXT,
                answersJson TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS new_kingdom_logs (
                guildId TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rok_verifications (
                userId TEXT,
                guildId TEXT,
                governorId TEXT,
                governorName TEXT,
                allianceTag TEXT,
                power BIGINT DEFAULT 0,
                killPoints BIGINT DEFAULT 0,
                verifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (userId, guildId)
            );

            CREATE TABLE IF NOT EXISTS r4_tracking (
                userId TEXT,
                guildId TEXT,
                weekId TEXT,
                messages INTEGER DEFAULT 0,
                ads INTEGER DEFAULT 0,
                excused INTEGER DEFAULT 0,
                excuseReason TEXT,
                isProcessed INTEGER DEFAULT 0,
                PRIMARY KEY (userId, guildId, weekId)
            );

            CREATE TABLE IF NOT EXISTS r4_excuses (
                userId TEXT,
                guildId TEXT,
                startWeekId TEXT,
                durationWeeks INTEGER DEFAULT 1,
                excuseReason TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (userId, guildId)
            );

            CREATE TABLE IF NOT EXISTS module_configs (
                guildId TEXT PRIMARY KEY,
                -- Welcome
                welcomeEnabled INTEGER DEFAULT 0,
                welcomeChannel TEXT,
                welcomeEmbedTitle TEXT,
                welcomeEmbedDesc TEXT,
                welcomeColor TEXT DEFAULT '#6366f1',
                welcomeImage TEXT,
                welcomeUseEmbed INTEGER DEFAULT 1,
                -- Leveling
                levelingEnabled INTEGER DEFAULT 0,
                xpMin INTEGER DEFAULT 5,
                xpMax INTEGER DEFAULT 15,
                xpCooldown INTEGER DEFAULT 60,
                levelUpChannel TEXT,
                roleRewards TEXT DEFAULT '[]',
                -- Tickets
                ticketsEnabled INTEGER DEFAULT 1,
                ticketsMaxActive INTEGER DEFAULT 2,
                ticketsTranscriptChannel TEXT,
                ticketCategoryId TEXT,
                ticketsApprovalChannel TEXT,
                -- Automod
                automodEnabled INTEGER DEFAULT 0,
                automodSpam INTEGER DEFAULT 0,
                automodLinks INTEGER DEFAULT 0,
                automodMentions INTEGER DEFAULT 0,
                automodCaps INTEGER DEFAULT 0,
                automodWords INTEGER DEFAULT 0,
                automodWordList TEXT,
                automodMaxMentions INTEGER DEFAULT 5,
                automodLogChannel TEXT,
                -- Logging
                loggingEnabled INTEGER DEFAULT 0,
                loggingChannel TEXT,
                logEdits INTEGER DEFAULT 1,
                logDeletes INTEGER DEFAULT 1,
                logMembers INTEGER DEFAULT 1,
                logRoles INTEGER DEFAULT 0,
                logChannels INTEGER DEFAULT 0,
                logBans INTEGER DEFAULT 1,
                -- Auto-Role
                autoroleEnabled INTEGER DEFAULT 0,
                autoroleIds TEXT DEFAULT '[]',
                -- Counting
                countingEnabled INTEGER DEFAULT 0,
                countingChannel TEXT,
                countingCurrent INTEGER DEFAULT 0,
                countingSameUser INTEGER DEFAULT 0,
                countingReset INTEGER DEFAULT 1,
                countingMath INTEGER DEFAULT 0,
                countingLastUser TEXT,
                countingEmoji TEXT DEFAULT '✅',
                countingEmojiFail TEXT DEFAULT '❌',
                -- Server Stats
                serverStatsEnabled INTEGER DEFAULT 0,
                statsTotalMembers INTEGER DEFAULT 1,
                statsOnline INTEGER DEFAULT 0,
                statsBots INTEGER DEFAULT 0,
                statsChannels INTEGER DEFAULT 0,
                statsCategoryId TEXT,
                -- Anti-Nuke
                antinukeEnabled INTEGER DEFAULT 0,
                antinukeBan INTEGER DEFAULT 1,
                antinukeChannel INTEGER DEFAULT 1,
                antinukeRole INTEGER DEFAULT 1,
                antinukeWebhook INTEGER DEFAULT 0,
                antinukeThreshold INTEGER DEFAULT 5,
                antinukeWhitelist TEXT,
                -- R4 Tracking
                r4TrackingEnabled INTEGER DEFAULT 0,
                r4TrackingRole TEXT,
                r4TrackingAdQuota INTEGER DEFAULT 40,
                r4TrackingMsgQuota INTEGER DEFAULT 245,
                -- Swear Jar
                swearJarEnabled INTEGER DEFAULT 0,
                swearJarChannel TEXT,
                swearJarWords TEXT,
                swearJarPing INTEGER DEFAULT 1,
                swearJarTitle TEXT,
                swearJarMessage TEXT,
                swearJarColor TEXT,
                -- Logging Extras
                logVoice INTEGER DEFAULT 1,
                logServer INTEGER DEFAULT 1,
                logInvites INTEGER DEFAULT 1,
                -- Leveling Extras
                levelUpTitle TEXT,
                levelUpMessage TEXT,
                levelUpColor TEXT,
                levelUpUseEmbed INTEGER DEFAULT 1,
                levelingBackground TEXT,
                leaderboardImageEnabled INTEGER DEFAULT 0,
                -- Economy Rewards
                ecoEnabled INTEGER DEFAULT 0,
                ecoCoinsPerMessage INTEGER DEFAULT 1,
                ecoCoinsPerAd INTEGER DEFAULT 10,
                ecoCoinsPerInvite INTEGER DEFAULT 50,
                ecoCoinsPerWelcome INTEGER DEFAULT 5,
                ecoCoinsPerBoost INTEGER DEFAULT 100,
                ecoCoinsPerGiveaway INTEGER DEFAULT 200,
                ecoCoinsPerVCMinute INTEGER DEFAULT 1,
                ecoWelcomeKeywords TEXT DEFAULT 'welcome,bienvenido,bienvenida',
                -- RSS Buying System
                rssEnabled INTEGER DEFAULT 0,
                rssSellerRole TEXT DEFAULT 'RSS Seller',
                rssTaxRate REAL DEFAULT 10,
                rssCategory TEXT,
                -- Giveaways
                giveawaysEnabled INTEGER DEFAULT 0,
                giveawaysManagerRole TEXT,
                giveawaysLogChannel TEXT,
                giveawaysEcoReward INTEGER DEFAULT 0,
                giveawaysEcoCoins INTEGER DEFAULT 200,
                -- RoK Verifier Module
                rokVerifierEnabled INTEGER DEFAULT 0,
                rokVerifierRole TEXT,
                rokVerifierTags TEXT DEFAULT '',
                rokVerifierChannel TEXT,
                rokVerifierUniqueId INTEGER DEFAULT 0,
                -- Gift Codes Scanner Module
                giftCodesEnabled INTEGER DEFAULT 0,
                giftCodesSourceChannel TEXT,
                giftCodesTargetChannel TEXT,
                giftCodesPingRole TEXT
            );

            CREATE TABLE IF NOT EXISTS custom_bots (
                guildId TEXT,
                botToken TEXT PRIMARY KEY,
                clientId TEXT,
                status TEXT DEFAULT 'inactive',
                errorMessage TEXT
            );

            CREATE TABLE IF NOT EXISTS market_configs (
                guildId TEXT PRIMARY KEY,
                marketEnabled INTEGER DEFAULT 0,
                forumChannelId TEXT,
                approvalChannelId TEXT,
                ownerChannelId TEXT,
                paymentMethods TEXT,
                middlemanRole TEXT,
                marketFeePct INTEGER DEFAULT 5,
                middlemanFeePct INTEGER DEFAULT 5,
                marketQuestions TEXT,
                mmPaymentMethods TEXT
            );

            CREATE TABLE IF NOT EXISTS market_listings (
                code TEXT PRIMARY KEY,
                guildId TEXT,
                sellerId TEXT,
                status TEXT DEFAULT 'pending',
                price TEXT,
                dataJson TEXT,
                imagesJson TEXT,
                forumThreadId TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS market_transactions (
                id TEXT PRIMARY KEY,
                listingCode TEXT,
                guildId TEXT,
                buyerId TEXT,
                sellerId TEXT,
                middlemanId TEXT,
                status TEXT DEFAULT 'offer_sent',
                price TEXT,
                offerJson TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS economy_shop (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                name TEXT,
                description TEXT,
                price INTEGER,
                type TEXT,
                roleId TEXT
            );

            CREATE TABLE IF NOT EXISTS economy_inventory (
                userId TEXT,
                guildId TEXT,
                itemId TEXT,
                purchasedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS social_marriages (
                guildId TEXT,
                user1Id TEXT,
                user2Id TEXT,
                marriedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guildId, user1Id, user2Id)
            );

            CREATE TABLE IF NOT EXISTS social_adoptions (
                guildId TEXT,
                parentId TEXT,
                childId TEXT,
                adoptedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guildId, parentId, childId)
            );

            CREATE TABLE IF NOT EXISTS economy_mafias (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                name TEXT,
                leaderId TEXT,
                balance INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                taxRate REAL DEFAULT 0.05,
                vault INTEGER DEFAULT 0,
                upgrades TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS economy_turfs (
                turfId TEXT PRIMARY KEY,
                guildId TEXT,
                name TEXT,
                ownerMafiaId TEXT,
                bonusType TEXT,
                bonusValue REAL
            );

            CREATE TABLE IF NOT EXISTS economy_influence (
                sectorId TEXT PRIMARY KEY,
                guildId TEXT,
                name TEXT,
                price REAL DEFAULT 100,
                totalInvested INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS mafia_members (
                mafiaId TEXT,
                userId TEXT,
                rank TEXT,
                contributed INTEGER DEFAULT 0,
                dirtyMoney INTEGER DEFAULT 0,
                PRIMARY KEY (mafiaId, userId)
            );

            CREATE TABLE IF NOT EXISTS rss_seller_stocks (
                sellerId TEXT PRIMARY KEY,
                food BIGINT DEFAULT 0,
                wood BIGINT DEFAULT 0,
                stone BIGINT DEFAULT 0,
                gold BIGINT DEFAULT 0,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rss_seller_sales (
                sellerId TEXT PRIMARY KEY,
                totalSoldFood BIGINT DEFAULT 0,
                totalSoldWood BIGINT DEFAULT 0,
                totalSoldStone BIGINT DEFAULT 0,
                totalSoldGold BIGINT DEFAULT 0,
                totalTransactions INTEGER DEFAULT 0,
                pendingTaxFood BIGINT DEFAULT 0,
                pendingTaxWood BIGINT DEFAULT 0,
                pendingTaxStone BIGINT DEFAULT 0,
                pendingTaxGold BIGINT DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS rss_transactions (
                id TEXT PRIMARY KEY,
                buyerId TEXT,
                seller1Id TEXT,
                seller2Id TEXT,
                food BIGINT DEFAULT 0,
                wood BIGINT DEFAULT 0,
                stone BIGINT DEFAULT 0,
                gold BIGINT DEFAULT 0,
                status TEXT DEFAULT 'pending',
                channelId TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ai_agent_configs (
                guildId TEXT,
                clientId TEXT,
                openaiApiKey TEXT,
                characterName TEXT,
                characterTraits TEXT,
                welcomeEnabled INTEGER DEFAULT 0,
                welcomeChannel TEXT,
                welcomeMessage TEXT,
                chatEnabled INTEGER DEFAULT 0,
                chatChannels TEXT,
                supportEnabled INTEGER DEFAULT 0,
                supportChannel TEXT,
                supportKnowledgeChannels TEXT,
                botToBotChatEnabled INTEGER DEFAULT 0,
                maxBotTurns INTEGER DEFAULT 5,
                enabled INTEGER DEFAULT 1,
                languageMode TEXT DEFAULT 'en',
                welcomeOpenaiApiKey TEXT,
                chatOpenaiApiKey TEXT,
                supportOpenaiApiKey TEXT,
                aiProvider TEXT DEFAULT 'openai',
                welcomeProvider TEXT DEFAULT 'openai',
                chatProvider TEXT DEFAULT 'openai',
                supportProvider TEXT DEFAULT 'openai',
                PRIMARY KEY (guildId, clientId)
            );

            CREATE TABLE IF NOT EXISTS swear_jar_counts (
                userId TEXT,
                guildId TEXT,
                count INTEGER DEFAULT 0,
                PRIMARY KEY (userId, guildId)
            );

            CREATE TABLE IF NOT EXISTS hall_of_shame_posts (
                guildId TEXT,
                originalMessageId TEXT,
                shameMessageId TEXT,
                PRIMARY KEY (guildId, originalMessageId)
            );
        `);

        // Migrate enabled column if table already existed
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN enabled INTEGER DEFAULT 1`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN clientId TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN languageMode TEXT DEFAULT 'en'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN welcomeOpenaiApiKey TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN chatOpenaiApiKey TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN supportOpenaiApiKey TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN aiProvider TEXT DEFAULT 'openai'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN welcomeProvider TEXT DEFAULT 'openai'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN chatProvider TEXT DEFAULT 'openai'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN supportProvider TEXT DEFAULT 'openai'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN welcomeCharacterName TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN welcomeCharacterTraits TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN chatCharacterName TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN chatCharacterTraits TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN supportCharacterName TEXT`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE ai_agent_configs ADD COLUMN supportCharacterTraits TEXT`); } catch (e) {}

        // Migrate Hall of Shame columns
        try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN hallOfShameEnabled INTEGER DEFAULT 0`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN hallOfShameEmoji TEXT DEFAULT '💀'`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN hallOfShameThreshold INTEGER DEFAULT 3`); } catch (e) {}
        try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN hallOfShameChannel TEXT`); } catch (e) {}
        
        // Migrate custom_bots and ai_agent_configs schema to multi-bot support
        try {
            const tableInfo = await dbInstance.all("PRAGMA table_info(custom_bots)");
            const isGuildIdPk = tableInfo.some(col => col.name === 'guildId' && col.pk === 1);
            if (isGuildIdPk) {
                await dbInstance.exec(`ALTER TABLE custom_bots RENAME TO temp_custom_bots`);
                await dbInstance.exec(`
                    CREATE TABLE custom_bots (
                        guildId TEXT,
                        botToken TEXT PRIMARY KEY,
                        clientId TEXT,
                        status TEXT DEFAULT 'inactive',
                        errorMessage TEXT
                    )
                `);
                await dbInstance.exec(`INSERT OR IGNORE INTO custom_bots (guildId, botToken, clientId, status, errorMessage) SELECT guildId, botToken, clientId, status, errorMessage FROM temp_custom_bots`);
                await dbInstance.exec(`DROP TABLE temp_custom_bots`);
                console.log("[MIGRATION] custom_bots successfully migrated to botToken PRIMARY KEY");
            }
        } catch (e) {
            console.error("[MIGRATION] Failed migrating custom_bots table:", e.message);
        }

        try {
            const tableInfo = await dbInstance.all("PRAGMA table_info(ai_agent_configs)");
            const hasAgentId = tableInfo.some(col => col.name === 'agentId');
            if (!hasAgentId) {
                console.log("[MIGRATION] Migration triggered: Migrating ai_agent_configs to agentId Primary Key");
                await dbInstance.exec(`ALTER TABLE ai_agent_configs RENAME TO temp_ai_agent_configs`);
                await dbInstance.exec(`
                    CREATE TABLE ai_agent_configs (
                        guildId TEXT,
                        agentId TEXT,
                        botToken TEXT,
                        clientId TEXT,
                        openaiApiKey TEXT,
                        welcomeOpenaiApiKey TEXT,
                        chatOpenaiApiKey TEXT,
                        supportOpenaiApiKey TEXT,
                        aiProvider TEXT DEFAULT 'openai',
                        welcomeProvider TEXT DEFAULT 'openai',
                        chatProvider TEXT DEFAULT 'openai',
                        supportProvider TEXT DEFAULT 'openai',
                        characterName TEXT,
                        characterTraits TEXT,
                        welcomeCharacterName TEXT,
                        welcomeCharacterTraits TEXT,
                        chatCharacterName TEXT,
                        chatCharacterTraits TEXT,
                        supportCharacterName TEXT,
                        supportCharacterTraits TEXT,
                        welcomeEnabled INTEGER DEFAULT 0,
                        welcomeChannel TEXT,
                        welcomeMessage TEXT,
                        chatEnabled INTEGER DEFAULT 0,
                        chatChannels TEXT,
                        supportEnabled INTEGER DEFAULT 0,
                        supportChannel TEXT,
                        supportKnowledgeChannels TEXT,
                        botToBotChatEnabled INTEGER DEFAULT 0,
                        maxBotTurns INTEGER DEFAULT 5,
                        enabled INTEGER DEFAULT 1,
                        languageMode TEXT DEFAULT 'en',
                        status TEXT DEFAULT 'inactive',
                        errorMessage TEXT,
                        PRIMARY KEY (guildId, agentId)
                    )
                `);
                
                await dbInstance.exec(`
                    INSERT INTO ai_agent_configs (
                        guildId, agentId, botToken, clientId, status, errorMessage,
                        openaiApiKey, welcomeOpenaiApiKey, chatOpenaiApiKey, supportOpenaiApiKey,
                        aiProvider, welcomeProvider, chatProvider, supportProvider,
                        characterName, characterTraits, welcomeCharacterName, welcomeCharacterTraits,
                        chatCharacterName, chatCharacterTraits, supportCharacterName, supportCharacterTraits,
                        welcomeEnabled, welcomeChannel, welcomeMessage, chatEnabled, chatChannels,
                        supportEnabled, supportChannel, supportKnowledgeChannels,
                        botToBotChatEnabled, maxBotTurns, enabled, languageMode
                    ) SELECT 
                        t.guildId,
                        'agent_' || COALESCE(t.clientId, 'old_' || RANDOM()),
                        (SELECT cb.botToken FROM custom_bots cb WHERE cb.clientId = t.clientId LIMIT 1),
                        COALESCE(t.clientId, ''),
                        COALESCE((SELECT cb.status FROM custom_bots cb WHERE cb.clientId = t.clientId LIMIT 1), 'inactive'),
                        (SELECT cb.errorMessage FROM custom_bots cb WHERE cb.clientId = t.clientId LIMIT 1),
                        t.openaiApiKey, t.welcomeOpenaiApiKey, t.chatOpenaiApiKey, t.supportOpenaiApiKey,
                        t.aiProvider, t.welcomeProvider, t.chatProvider, t.supportProvider,
                        t.characterName, t.characterTraits, t.welcomeCharacterName, t.welcomeCharacterTraits,
                        t.chatCharacterName, t.chatCharacterTraits, t.supportCharacterName, t.supportCharacterTraits,
                        t.welcomeEnabled, t.welcomeChannel, t.welcomeMessage, t.chatEnabled, t.chatChannels,
                        t.supportEnabled, t.supportChannel, t.supportKnowledgeChannels,
                        t.botToBotChatEnabled, t.maxBotTurns, t.enabled, t.languageMode
                    FROM temp_ai_agent_configs t
                `);
                await dbInstance.exec(`DROP TABLE temp_ai_agent_configs`);
                console.log("[MIGRATION] ai_agent_configs successfully migrated to agentId PRIMARY KEY");
            }
        } catch (e) {
            console.error("[MIGRATION] Failed migrating ai_agent_configs table:", e.message);
        }
        
        // Auto-migrate ranks
        try { await dbInstance.exec(`UPDATE mafia_members SET rank = 'Consigliere' WHERE rank = 'Underboss'`); } catch (e) {}
        
        const ticketCols = [
            'ticketsMaxActive INTEGER DEFAULT 2', 'ticketsTranscriptChannel TEXT', 'countingMath INTEGER DEFAULT 0', 
            'countingLastUser TEXT', 'ticketCategoryId TEXT', 'ticketsApprovalChannel TEXT', 
            'r4TrackingEnabled INTEGER DEFAULT 0', 'r4TrackingRole TEXT', 'r4TrackingAdQuota INTEGER DEFAULT 40', 
            'r4TrackingMsgQuota INTEGER DEFAULT 245', 'welcomeImage TEXT', 'welcomeUseEmbed INTEGER DEFAULT 1', 
            'swearJarEnabled INTEGER DEFAULT 0', 'swearJarChannel TEXT', 'swearJarWords TEXT', 'swearJarPing INTEGER DEFAULT 1',
            'swearJarTitle TEXT', 'swearJarMessage TEXT', 'swearJarColor TEXT',
            'logVoice INTEGER DEFAULT 1', 'logServer INTEGER DEFAULT 1', 'logInvites INTEGER DEFAULT 1',
            'levelUpTitle TEXT', 'levelUpMessage TEXT', 'levelUpColor TEXT', 'levelUpUseEmbed INTEGER DEFAULT 1',
            'levelingBackground TEXT', 'leaderboardImageEnabled INTEGER DEFAULT 0',
            'newKingdomEnabled INTEGER DEFAULT 0', 'newKingdomSourceChannel TEXT', 'newKingdomTargetChannel TEXT', 'newKingdomPingRole TEXT',
            'ecoEnabled INTEGER DEFAULT 0', 'ecoCoinsPerMessage INTEGER DEFAULT 1', 'ecoCoinsPerAd INTEGER DEFAULT 10', 'ecoCoinsPerInvite INTEGER DEFAULT 50', 'ecoCoinsPerWelcome INTEGER DEFAULT 5', 'ecoCoinsPerBoost INTEGER DEFAULT 100', 'ecoCoinsPerGiveaway INTEGER DEFAULT 200', 'ecoCoinsPerVCMinute INTEGER DEFAULT 1', 'ecoWelcomeKeywords TEXT DEFAULT \'welcome,bienvenido,bienvenida\'', 'ecoWelcomeNotifyChannel TEXT',
            'rssEnabled INTEGER DEFAULT 0', 'rssSellerRole TEXT DEFAULT \'RSS Seller\'', 'rssTaxRate REAL DEFAULT 10', 'rssCategory TEXT',
            'giveawaysEnabled INTEGER DEFAULT 0', 'giveawaysManagerRole TEXT', 'giveawaysLogChannel TEXT', 'giveawaysEcoReward INTEGER DEFAULT 0', 'giveawaysEcoCoins INTEGER DEFAULT 200',
            'countingEmoji TEXT DEFAULT \'✅\'', 'countingEmojiFail TEXT DEFAULT \'❌\'',
            'rokVerifierEnabled INTEGER DEFAULT 0', 'rokVerifierRole TEXT', 'rokVerifierTags TEXT DEFAULT \'\'', 'rokVerifierChannel TEXT',
            'rokVerifierUniqueId INTEGER DEFAULT 0',
            'giftCodesEnabled INTEGER DEFAULT 0', 'giftCodesSourceChannel TEXT', 'giftCodesTargetChannel TEXT', 'giftCodesPingRole TEXT'
        ];
        for (const col of ticketCols) {
            try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN ${col}`); } catch (e) {}
        }
        try { await dbInstance.exec(`ALTER TABLE market_configs ADD COLUMN marketQuestions TEXT`); } catch (e) {}

        // Auto-migrate guild_configs columns
        const guildCols = ['welcomeChannelId', 'logChannelId', 'ticketCategoryId', 'brandingName', 'brandingAvatar'];
        for (const col of guildCols) {
            try { await dbInstance.exec(`ALTER TABLE guild_configs ADD COLUMN ${col} TEXT`); } catch (e) {}
        }
        
        // Auto-migrate giveaways columns
        const giveawayCols = ['requiredRole', 'pingRole'];
        for (const col of giveawayCols) {
            try { await dbInstance.exec(`ALTER TABLE giveaways ADD COLUMN ${col} TEXT`); } catch (e) {}
        }

        // Auto-migrate mafia columns
        const mafiaCols = ['taxRate REAL DEFAULT 0.05', 'vault INTEGER DEFAULT 0', 'upgrades TEXT DEFAULT \'[]\''];
        for (const col of mafiaCols) {
            try { await dbInstance.exec(`ALTER TABLE economy_mafias ADD COLUMN ${col}`); } catch (e) {}
        }
        try { await dbInstance.exec(`ALTER TABLE mafia_members ADD COLUMN contributed INTEGER DEFAULT 0`); } catch (e) {}

        return dbInstance;
    } catch (err) {
        console.error('Database Initialization Error:', err);
        throw err;
    } finally {
        _initializingDbPromise = null;
    }
    })();

    return _initializingDbPromise;
}

let migrationsDone = false;

async function initializeSchema() {
    const db = await getDb();
    if (migrationsDone) return db;

    console.log('[DB] Starting schema migrations...');

    // Migrate users table to composite key (userId, guildId)
    try {
        const tableInfo = await db.all("PRAGMA table_info(users)");
        const hasNoGuildId = !tableInfo.some(col => col.name.toLowerCase() === 'guildid');
        if (hasNoGuildId) {
            console.log("[MIGRATION] Migration triggered: Migrating users to (userId, guildId) Primary Key");
            await db.exec(`ALTER TABLE users RENAME TO temp_users`);
            await db.exec(`
                CREATE TABLE users (
                    userId TEXT,
                    guildId TEXT,
                    xp INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 0,
                    invites INTEGER DEFAULT 0,
                    balance BIGINT DEFAULT 0,
                    bank BIGINT DEFAULT 0,
                    bankCapacity BIGINT DEFAULT 5000,
                    bankId TEXT DEFAULT 'standard',
                    jobId TEXT,
                    lastWork INTEGER,
                    partnerId TEXT,
                    mafiaId TEXT,
                    dirtyMoney BIGINT DEFAULT 0,
                    jailUntil TIMESTAMP,
                    reputation INTEGER DEFAULT 0,
                    workplaceId TEXT DEFAULT NULL,
                    workExperience INTEGER DEFAULT 0,
                    PRIMARY KEY (userId, guildId)
                )
            `);
            
            const guildConfig = await db.get(`SELECT guildId FROM guild_configs LIMIT 1`);
            const fallbackGuildId = guildConfig?.guildId || 'global';
            
            await db.exec(`
                INSERT INTO users (
                    userId, guildId, xp, level, invites, balance, bank, bankCapacity, bankId,
                    jobId, lastWork, partnerId, mafiaId, dirtyMoney, jailUntil, reputation, workplaceId, workExperience
                ) SELECT 
                    userId, '${fallbackGuildId}', xp, level, invites, balance, bank, bankCapacity, bankId,
                    jobId, lastWork, partnerId, mafiaId, dirtyMoney, jailUntil, reputation, workplaceId, workExperience
                FROM temp_users
            `);
            await db.exec(`DROP TABLE temp_users`);
            console.log("[MIGRATION] users successfully migrated to (userId, guildId) PRIMARY KEY");
        }
    } catch (e) {
        console.error("[MIGRATION] Failed migrating users table:", e.message || e);
    }
    
    // Migrate economy_influence to (sectorId, guildId) Primary Key
    try {
        const tableInfo = await db.all("PRAGMA table_info(economy_influence)");
        const hasNoGuildId = !tableInfo.some(col => col.name.toLowerCase() === 'guildid');
        if (hasNoGuildId) {
            console.log("[MIGRATION] Migration triggered: Migrating economy_influence to (sectorId, guildId) Primary Key");
            await db.exec(`ALTER TABLE economy_influence RENAME TO temp_economy_influence`);
            await db.exec(`
                CREATE TABLE economy_influence (
                    sectorId TEXT,
                    guildId TEXT,
                    name TEXT,
                    price REAL DEFAULT 100,
                    totalInvested BIGINT DEFAULT 0,
                    controllingEntityId TEXT,
                    controllingEntityType TEXT,
                    PRIMARY KEY (sectorId, guildId)
                )
            `);
            
            const guildConfig = await db.get(`SELECT guildId FROM guild_configs LIMIT 1`);
            const fallbackGuildId = guildConfig?.guildId || 'global';
            
            await db.exec(`
                INSERT INTO economy_influence (
                    sectorId, guildId, name, price, totalInvested, controllingEntityId, controllingEntityType
                ) SELECT 
                    sectorId, '${fallbackGuildId}', name, price, totalInvested, controllingEntityId, controllingEntityType
                FROM temp_economy_influence
            `);
            await db.exec(`DROP TABLE temp_economy_influence`);
            console.log("[MIGRATION] economy_influence successfully migrated");
        }
    } catch (e) {
        console.error("[MIGRATION] Failed migrating economy_influence:", e.message || e);
    }

    // Migrate economy_entity_influence to include guildId
    try {
        const tableInfo = await db.all("PRAGMA table_info(economy_entity_influence)");
        const hasNoGuildId = !tableInfo.some(col => col.name.toLowerCase() === 'guildid');
        if (hasNoGuildId) {
            console.log("[MIGRATION] Migration triggered: Migrating economy_entity_influence to (entityId, entityType, sectorId, guildId) Primary Key");
            await db.exec(`ALTER TABLE economy_entity_influence RENAME TO temp_economy_entity_influence`);
            await db.exec(`
                CREATE TABLE economy_entity_influence (
                    entityId TEXT,
                    entityType TEXT,
                    sectorId TEXT,
                    guildId TEXT,
                    points BIGINT DEFAULT 0,
                    PRIMARY KEY(entityId, entityType, sectorId, guildId)
                )
            `);
            
            const guildConfig = await db.get(`SELECT guildId FROM guild_configs LIMIT 1`);
            const fallbackGuildId = guildConfig?.guildId || 'global';
            
            await db.exec(`
                INSERT INTO economy_entity_influence (
                    entityId, entityType, sectorId, guildId, points
                ) SELECT 
                    entityId, entityType, sectorId, '${fallbackGuildId}', points
                FROM temp_economy_entity_influence
            `);
            await db.exec(`DROP TABLE temp_economy_entity_influence`);
            console.log("[MIGRATION] economy_entity_influence successfully migrated");
        }
    } catch (e) {
        console.error("[MIGRATION] Failed migrating economy_entity_influence:", e.message || e);
    }
    

    // Migrate rss_seller_stocks to (sellerId, guildId) Primary Key
    try {
        const tableInfo = await db.all("PRAGMA table_info(rss_seller_stocks)");
        const hasNoGuildId = !tableInfo.some(col => col.name.toLowerCase() === 'guildid');
        if (hasNoGuildId) {
            console.log("[MIGRATION] Migration triggered: Migrating rss_seller_stocks to (sellerId, guildId) Primary Key");
            await db.exec(`ALTER TABLE rss_seller_stocks RENAME TO temp_rss_seller_stocks`);
            await db.exec(`
                CREATE TABLE rss_seller_stocks (
                    sellerId TEXT,
                    guildId TEXT,
                    food BIGINT DEFAULT 0,
                    wood BIGINT DEFAULT 0,
                    stone BIGINT DEFAULT 0,
                    gold BIGINT DEFAULT 0,
                    paymentMethods TEXT DEFAULT 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay',
                    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (sellerId, guildId)
                )
            `);
            
            const guildConfig = await db.get(`SELECT guildId FROM guild_configs LIMIT 1`);
            const fallbackGuildId = guildConfig?.guildId || 'global';
            
            await db.exec(`
                INSERT INTO rss_seller_stocks (
                    sellerId, guildId, food, wood, stone, gold, paymentMethods, updatedAt
                ) SELECT 
                    sellerId, '${fallbackGuildId}', food, wood, stone, gold, paymentMethods, updatedAt
                FROM temp_rss_seller_stocks
            `);
            await db.exec(`DROP TABLE temp_rss_seller_stocks`);
            console.log("[MIGRATION] rss_seller_stocks successfully migrated");
        }
    } catch (e) {
        console.error("[MIGRATION] Failed migrating rss_seller_stocks:", e.message || e);
    }

    // Migrate rss_seller_sales to (sellerId, guildId) Primary Key
    try {
        const tableInfo = await db.all("PRAGMA table_info(rss_seller_sales)");
        const hasNoGuildId = !tableInfo.some(col => col.name.toLowerCase() === 'guildid');
        if (hasNoGuildId) {
            console.log("[MIGRATION] Migration triggered: Migrating rss_seller_sales to (sellerId, guildId) Primary Key");
            await db.exec(`ALTER TABLE rss_seller_sales RENAME TO temp_rss_seller_sales`);
            await db.exec(`
                CREATE TABLE rss_seller_sales (
                    sellerId TEXT,
                    guildId TEXT,
                    totalSoldFood BIGINT DEFAULT 0,
                    totalSoldWood BIGINT DEFAULT 0,
                    totalSoldStone BIGINT DEFAULT 0,
                    totalSoldGold BIGINT DEFAULT 0,
                    totalTransactions INTEGER DEFAULT 0,
                    pendingTaxFood BIGINT DEFAULT 0,
                    pendingTaxWood BIGINT DEFAULT 0,
                    pendingTaxStone BIGINT DEFAULT 0,
                    pendingTaxGold BIGINT DEFAULT 0,
                    PRIMARY KEY (sellerId, guildId)
                )
            `);
            
            const guildConfig = await db.get(`SELECT guildId FROM guild_configs LIMIT 1`);
            const fallbackGuildId = guildConfig?.guildId || 'global';
            
            await db.exec(`
                INSERT INTO rss_seller_sales (
                    sellerId, guildId, totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, totalTransactions, pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                ) SELECT 
                    sellerId, '${fallbackGuildId}', totalSoldFood, totalSoldWood, totalSoldStone, totalSoldGold, totalTransactions, pendingTaxFood, pendingTaxWood, pendingTaxStone, pendingTaxGold
                FROM temp_rss_seller_sales
            `);
            await db.exec(`DROP TABLE temp_rss_seller_sales`);
            console.log("[MIGRATION] rss_seller_sales successfully migrated");
        }
    } catch (e) {
        console.error("[MIGRATION] Failed migrating rss_seller_sales:", e.message || e);
    }
    // Core Tables
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            userId TEXT,
            guildId TEXT,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 0,
            invites INTEGER DEFAULT 0,
            balance BIGINT DEFAULT 0,
            bank BIGINT DEFAULT 0,
            bankCapacity BIGINT DEFAULT 5000,
            bankId TEXT DEFAULT 'standard',
            jobId TEXT,
            lastWork INTEGER,
            partnerId TEXT,
            mafiaId TEXT,
            dirtyMoney BIGINT DEFAULT 0,
            jailUntil TIMESTAMP,
            reputation INTEGER DEFAULT 0,
            workplaceId TEXT DEFAULT NULL,
            workExperience INTEGER DEFAULT 0,
            PRIMARY KEY (userId, guildId)
        );
        
        CREATE TABLE IF NOT EXISTS global_stats (
            statName TEXT PRIMARY KEY,
            value INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS new_kingdom_logs (
            guildId TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS rok_verifications (
            userId TEXT,
            guildId TEXT,
            governorId TEXT,
            governorName TEXT,
            allianceTag TEXT,
            power BIGINT DEFAULT 0,
            killPoints BIGINT DEFAULT 0,
            verifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (userId, guildId)
        );

        CREATE TABLE IF NOT EXISTS guild_configs (
            guildId TEXT PRIMARY KEY,
            spreadsheetId TEXT,
            leadershipChannelId TEXT,
            welcomeChannelId TEXT,
            logChannelId TEXT,
            ticketCategoryId TEXT,
            brandingName TEXT,
            brandingAvatar TEXT
        );

        CREATE TABLE IF NOT EXISTS ticket_panels (
            id TEXT PRIMARY KEY,
            guildId TEXT,
            channelId TEXT,
            messageId TEXT,
            panelData TEXT
        );
        
        CREATE TABLE IF NOT EXISTS ticket_transcripts (
            ticketId TEXT PRIMARY KEY,
            guildId TEXT,
            userId TEXT,
            closedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            logContent TEXT
        );
        
        CREATE TABLE IF NOT EXISTS giveaways (
            id TEXT PRIMARY KEY,
            guildId TEXT,
            channelId TEXT,
            prize TEXT,
            winnersCount INTEGER,
            endTime BIGINT,
            hostedBy TEXT,
            requiredRole TEXT,
            pingRole TEXT,
            status TEXT DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS pending_tickets (
            uuid TEXT PRIMARY KEY,
            guildId TEXT,
            userId TEXT,
            optJson TEXT,
            answersJson TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS r4_tracking (
            userId TEXT,
            guildId TEXT,
            weekId TEXT,
            messages INTEGER DEFAULT 0,
            ads INTEGER DEFAULT 0,
            excused INTEGER DEFAULT 0,
            excuseReason TEXT,
            isProcessed INTEGER DEFAULT 0,
            PRIMARY KEY (userId, guildId, weekId)
        );

        CREATE TABLE IF NOT EXISTS r4_excuses (
            userId TEXT,
            guildId TEXT,
            startWeekId TEXT,
            durationWeeks INTEGER DEFAULT 1,
            excuseReason TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (userId, guildId)
        );

        CREATE TABLE IF NOT EXISTS module_configs (
            guildId TEXT PRIMARY KEY,
            -- Welcome
            welcomeEnabled INTEGER DEFAULT 0,
            welcomeChannel TEXT,
            welcomeEmbedTitle TEXT,
            welcomeEmbedDesc TEXT,
            welcomeColor TEXT DEFAULT '#6366f1',
            welcomeImage TEXT,
            welcomeUseEmbed INTEGER DEFAULT 1,
            -- Leveling
            levelingEnabled INTEGER DEFAULT 0,
            xpMin INTEGER DEFAULT 5,
            xpMax INTEGER DEFAULT 15,
            xpCooldown INTEGER DEFAULT 60,
            levelUpChannel TEXT,
            roleRewards TEXT DEFAULT '[]',
            -- Tickets
            ticketsEnabled INTEGER DEFAULT 1,
            ticketsMaxActive INTEGER DEFAULT 2,
            ticketsTranscriptChannel TEXT,
            ticketCategoryId TEXT,
            ticketsApprovalChannel TEXT,
            -- Automod
            automodEnabled INTEGER DEFAULT 0,
            automodSpam INTEGER DEFAULT 0,
            automodLinks INTEGER DEFAULT 0,
            automodMentions INTEGER DEFAULT 0,
            automodCaps INTEGER DEFAULT 0,
            automodWords INTEGER DEFAULT 0,
            automodWordList TEXT,
            automodMaxMentions INTEGER DEFAULT 5,
            automodLogChannel TEXT,
            -- Logging
            loggingEnabled INTEGER DEFAULT 0,
            loggingChannel TEXT,
            logEdits INTEGER DEFAULT 1,
            logDeletes INTEGER DEFAULT 1,
            logMembers INTEGER DEFAULT 1,
            logRoles INTEGER DEFAULT 0,
            logChannels INTEGER DEFAULT 0,
            logBans INTEGER DEFAULT 1,
            -- Auto-Role
            autoroleEnabled INTEGER DEFAULT 0,
            autoroleIds TEXT DEFAULT '[]',
            -- Counting
            countingEnabled INTEGER DEFAULT 0,
            countingChannel TEXT,
            countingCurrent INTEGER DEFAULT 0,
            countingSameUser INTEGER DEFAULT 0,
            countingReset INTEGER DEFAULT 1,
            countingMath INTEGER DEFAULT 0,
            countingLastUser TEXT,
            countingEmoji TEXT DEFAULT '✅',
            countingEmojiFail TEXT DEFAULT '❌',
            -- Server Stats
            serverStatsEnabled INTEGER DEFAULT 0,
            statsTotalMembers INTEGER DEFAULT 1,
            statsOnline INTEGER DEFAULT 0,
            statsBots INTEGER DEFAULT 0,
            statsChannels INTEGER DEFAULT 0,
            statsCategoryId TEXT,
            -- Anti-Nuke
            antinukeEnabled INTEGER DEFAULT 0,
            antinukeBan INTEGER DEFAULT 1,
            antinukeChannel INTEGER DEFAULT 1,
            antinukeRole INTEGER DEFAULT 1,
            antinukeWebhook INTEGER DEFAULT 0,
            antinukeThreshold INTEGER DEFAULT 5,
            antinukeWhitelist TEXT,
            -- R4 Tracking
            r4TrackingEnabled INTEGER DEFAULT 0,
            r4TrackingRole TEXT,
            r4TrackingAdQuota INTEGER DEFAULT 40,
            r4TrackingMsgQuota INTEGER DEFAULT 245,
            -- Swear Jar
            swearJarEnabled INTEGER DEFAULT 0,
            swearJarChannel TEXT,
            swearJarWords TEXT,
            swearJarPing INTEGER DEFAULT 1,
            swearJarTitle TEXT,
            swearJarMessage TEXT,
            swearJarColor TEXT,
            -- Logging Extras
            logVoice INTEGER DEFAULT 1,
            logServer INTEGER DEFAULT 1,
            logInvites INTEGER DEFAULT 1,
            -- Leveling Extras
            levelUpTitle TEXT,
            levelUpMessage TEXT,
            levelUpColor TEXT,
            levelUpUseEmbed INTEGER DEFAULT 1,
            levelingBackground TEXT,
            leaderboardImageEnabled INTEGER DEFAULT 0,
            -- Economy Rewards
            ecoEnabled INTEGER DEFAULT 0,
            ecoCoinsPerMessage INTEGER DEFAULT 1,
            ecoCoinsPerAd INTEGER DEFAULT 10,
            ecoCoinsPerInvite INTEGER DEFAULT 50,
            ecoCoinsPerWelcome INTEGER DEFAULT 5,
            ecoCoinsPerBoost INTEGER DEFAULT 100,
            ecoCoinsPerGiveaway INTEGER DEFAULT 200,
            ecoCoinsPerVCMinute INTEGER DEFAULT 1,
            ecoWelcomeKeywords TEXT DEFAULT 'welcome,bienvenido,bienvenida',
            ecoWelcomeNotifyChannel TEXT,
            -- RSS Buying System
            rssEnabled INTEGER DEFAULT 0,
            rssSellerRole TEXT DEFAULT 'RSS Seller',
            rssTaxRate REAL DEFAULT 10,
            rssCategory TEXT,
            -- Giveaways
            giveawaysEnabled INTEGER DEFAULT 0,
            giveawaysManagerRole TEXT,
            giveawaysLogChannel TEXT,
            giveawaysEcoReward INTEGER DEFAULT 0,
            giveawaysEcoCoins INTEGER DEFAULT 200,
            -- RoK Verifier Module
            rokVerifierEnabled INTEGER DEFAULT 0,
            rokVerifierRole TEXT,
            rokVerifierTags TEXT DEFAULT '',
            rokVerifierChannel TEXT,
            -- Gift Codes Scanner Module
            giftCodesEnabled INTEGER DEFAULT 0,
            giftCodesSourceChannel TEXT,
            giftCodesTargetChannel TEXT,
            giftCodesPingRole TEXT
        );

        CREATE TABLE IF NOT EXISTS economy_mafias (
            id TEXT PRIMARY KEY,
            guildId TEXT,
            name TEXT,
            leaderId TEXT,
            balance BIGINT DEFAULT 0,
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            specialization TEXT DEFAULT 'Unspecialized',
            taxRate REAL DEFAULT 0.05,
            vault BIGINT DEFAULT 0,
            upgrades TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS mafia_members (
            mafiaId TEXT,
            userId TEXT,
            rank TEXT,
            contributed BIGINT DEFAULT 0,
            dirtyMoney BIGINT DEFAULT 0,
            PRIMARY KEY (mafiaId, userId)
        );

        CREATE TABLE IF NOT EXISTS mafia_businesses (
            mafiaId TEXT,
            type TEXT, -- 'nightclub', 'lab', 'cash'
            stock BIGINT DEFAULT 0,
            supplies INTEGER DEFAULT 100,
            upgrades TEXT DEFAULT '[]',
            lastUpdate DATETIME DEFAULT CURRENT_TIMESTAMP,
            totalShares INTEGER DEFAULT 1000,
            publicShares INTEGER DEFAULT 0,
            sharePrice BIGINT DEFAULT 0,
            level INTEGER DEFAULT 1,
            hiringEnabled INTEGER DEFAULT 0,
            employeeCount INTEGER DEFAULT 0,
            salary BIGINT DEFAULT 100,
            cooldown INTEGER DEFAULT 14400,
            marketShare REAL DEFAULT 0,
            customName TEXT,
            PRIMARY KEY (mafiaId, type)
        );

        CREATE TABLE IF NOT EXISTS mafia_stocks (
            mafiaId TEXT,
            businessType TEXT,
            userId TEXT,
            shares INTEGER DEFAULT 0,
            PRIMARY KEY (mafiaId, businessType, userId)
        );
        
        CREATE TABLE IF NOT EXISTS economy_operations (
            id TEXT PRIMARY KEY,
            userId TEXT,
            guildId TEXT,
            type TEXT,
            level INTEGER DEFAULT 1,
            lastCollect TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            suspicion INTEGER DEFAULT 0,
            hiringEnabled INTEGER DEFAULT 0,
            employeeCount INTEGER DEFAULT 0,
            salary BIGINT DEFAULT 100,
            cooldown INTEGER DEFAULT 14400,
            marketShare REAL DEFAULT 0,
            customName TEXT
        );

        CREATE TABLE IF NOT EXISTS economy_influence (
            sectorId TEXT,
            guildId TEXT,
            name TEXT,
            price REAL DEFAULT 100,
            totalInvested BIGINT DEFAULT 0,
            controllingEntityId TEXT,
            controllingEntityType TEXT,
            PRIMARY KEY (sectorId, guildId)
        );

        CREATE TABLE IF NOT EXISTS economy_entity_influence (
            entityId TEXT,
            entityType TEXT, -- 'user' or 'mafia'
            sectorId TEXT,
            guildId TEXT,
            points BIGINT DEFAULT 0,
            PRIMARY KEY(entityId, entityType, sectorId, guildId)
        );

        CREATE TABLE IF NOT EXISTS economy_banks (
            id TEXT PRIMARY KEY,
            guildId TEXT,
            name TEXT,
            security REAL DEFAULT 0.2,
            requirement INTEGER DEFAULT 0,
            insurance REAL DEFAULT 0.0,
            reserve BIGINT DEFAULT 50000,
            ownerId TEXT DEFAULT NULL,
            fee REAL DEFAULT 0.01,
            upgrades TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS rss_seller_stocks (
            sellerId TEXT,
            guildId TEXT,
            food BIGINT DEFAULT 0,
            wood BIGINT DEFAULT 0,
            stone BIGINT DEFAULT 0,
            gold BIGINT DEFAULT 0,
            paymentMethods TEXT DEFAULT 'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay',
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (sellerId, guildId)
        );

        CREATE TABLE IF NOT EXISTS rss_seller_sales (
            sellerId TEXT,
            guildId TEXT,
            totalSoldFood BIGINT DEFAULT 0,
            totalSoldWood BIGINT DEFAULT 0,
            totalSoldStone BIGINT DEFAULT 0,
            totalSoldGold BIGINT DEFAULT 0,
            totalTransactions INTEGER DEFAULT 0,
            pendingTaxFood BIGINT DEFAULT 0,
            pendingTaxWood BIGINT DEFAULT 0,
            pendingTaxStone BIGINT DEFAULT 0,
            pendingTaxGold BIGINT DEFAULT 0,
            PRIMARY KEY (sellerId, guildId)
        );

        CREATE TABLE IF NOT EXISTS rss_transactions (
            id TEXT PRIMARY KEY,
            buyerId TEXT,
            seller1Id TEXT,
            seller2Id TEXT,
            food BIGINT DEFAULT 0,
            wood BIGINT DEFAULT 0,
            stone BIGINT DEFAULT 0,
            gold BIGINT DEFAULT 0,
            status TEXT DEFAULT 'pending',
            channelId TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS swear_jar_counts (
            userId TEXT,
            guildId TEXT,
            count INTEGER DEFAULT 0,
            PRIMARY KEY (userId, guildId)
        );
    `);

    // Dynamic Column Migrations (Ensure everything exists)
    const tablesToMigrate = {
        users: [
            'jobId TEXT', 'lastWork INTEGER', 'partnerId TEXT', 'mafiaId TEXT', 
            'balance BIGINT DEFAULT 0', 'bank BIGINT DEFAULT 0', 'bankCapacity BIGINT DEFAULT 5000',
            'dirtyMoney BIGINT DEFAULT 0', 'bankId TEXT DEFAULT \'standard\'',
            'jailUntil TIMESTAMP', 'reputation INTEGER DEFAULT 0', 'workplaceId TEXT DEFAULT NULL',
            'workExperience INTEGER DEFAULT 0'
        ],
        module_configs: [
            'ticketsMaxActive INTEGER DEFAULT 2', 'ticketsTranscriptChannel TEXT', 'countingMath INTEGER DEFAULT 0', 
            'countingLastUser TEXT', 'ticketCategoryId TEXT', 'ticketsApprovalChannel TEXT', 
            'r4TrackingEnabled INTEGER DEFAULT 0', 'r4TrackingRole TEXT', 'r4TrackingAdQuota INTEGER DEFAULT 40', 
            'r4TrackingMsgQuota INTEGER DEFAULT 245', 'welcomeImage TEXT', 'welcomeUseEmbed INTEGER DEFAULT 1', 
            'swearJarEnabled INTEGER DEFAULT 0', 'swearJarChannel TEXT', 'swearJarWords TEXT', 'swearJarPing INTEGER DEFAULT 1',
            'swearJarTitle TEXT', 'swearJarMessage TEXT', 'swearJarColor TEXT',
            'logVoice INTEGER DEFAULT 1', 'logServer INTEGER DEFAULT 1', 'logInvites INTEGER DEFAULT 1',
            'levelUpTitle TEXT', 'levelUpMessage TEXT', 'levelUpColor TEXT', 'levelUpUseEmbed INTEGER DEFAULT 1',
            'levelingBackground TEXT', 'leaderboardImageEnabled INTEGER DEFAULT 0',
            'newKingdomEnabled INTEGER DEFAULT 0', 'newKingdomSourceChannel TEXT', 'newKingdomTargetChannel TEXT', 'newKingdomPingRole TEXT',
            'ecoEnabled INTEGER DEFAULT 0', 'ecoCoinsPerMessage INTEGER DEFAULT 1', 'ecoCoinsPerAd INTEGER DEFAULT 10', 'ecoCoinsPerInvite INTEGER DEFAULT 50', 'ecoCoinsPerWelcome INTEGER DEFAULT 5', 'ecoCoinsPerBoost INTEGER DEFAULT 100', 'ecoCoinsPerGiveaway INTEGER DEFAULT 200', 'ecoCoinsPerVCMinute INTEGER DEFAULT 1', 'ecoWelcomeKeywords TEXT DEFAULT \'welcome,bienvenido,bienvenida\'', 'ecoWelcomeNotifyChannel TEXT',
            'rssEnabled INTEGER DEFAULT 0', 'rssSellerRole TEXT DEFAULT \'RSS Seller\'', 'rssTaxRate REAL DEFAULT 10', 'rssCategory TEXT',
            'countingEmoji TEXT DEFAULT \'✅\'', 'countingEmojiFail TEXT DEFAULT \'❌\'',
            'giftCodesEnabled INTEGER DEFAULT 0', 'giftCodesSourceChannel TEXT', 'giftCodesTargetChannel TEXT', 'giftCodesPingRole TEXT'
        ],
        economy_mafias: [
            'taxRate REAL DEFAULT 0.05', 'vault BIGINT DEFAULT 0', 'upgrades TEXT DEFAULT \'[]\'',
            'experience INTEGER DEFAULT 0', 'specialization TEXT DEFAULT \'Unspecialized\''
        ],
        mafia_members: [
            'contributed BIGINT DEFAULT 0', 'dirtyMoney BIGINT DEFAULT 0'
        ],
        economy_banks: [
            'guildId TEXT',
            'reserve BIGINT DEFAULT 50000', 'ownerId TEXT DEFAULT NULL', 
            'fee REAL DEFAULT 0.01', 'upgrades TEXT DEFAULT \'[]\''
        ],
        mafia_businesses: [
            'totalShares INTEGER DEFAULT 1000', 'publicShares INTEGER DEFAULT 0', 
            'sharePrice BIGINT DEFAULT 0', 'level INTEGER DEFAULT 1',
            'hiringEnabled INTEGER DEFAULT 0', 'employeeCount INTEGER DEFAULT 0', 'salary BIGINT DEFAULT 100',
            'cooldown INTEGER DEFAULT 14400', 'marketShare REAL DEFAULT 0', 'customName TEXT'
        ],
        economy_operations: [
            'level INTEGER DEFAULT 1', 'hiringEnabled INTEGER DEFAULT 0', 
            'employeeCount INTEGER DEFAULT 0', 'salary BIGINT DEFAULT 100',
            'cooldown INTEGER DEFAULT 14400', 'marketShare REAL DEFAULT 0', 'customName TEXT'
        ],
        r4_tracking: [
            'excuseReason TEXT'
        ],
        rss_seller_stocks: [
            'paymentMethods TEXT DEFAULT \'paypal,cashapp,venmo,zelle,revolut,crypto,bank,applepay\''
        ],
        rss_seller_sales: [
            'pendingTaxFood BIGINT DEFAULT 0',
            'pendingTaxWood BIGINT DEFAULT 0',
            'pendingTaxStone BIGINT DEFAULT 0',
            'pendingTaxGold BIGINT DEFAULT 0'
        ],
        ai_agent_configs: [
            'agentId TEXT', 'botToken TEXT', 'status TEXT DEFAULT \'inactive\'', 'errorMessage TEXT',
            'openaiApiKey TEXT', 'characterName TEXT', 'characterTraits TEXT',
            'welcomeEnabled INTEGER DEFAULT 0', 'welcomeChannel TEXT', 'welcomeMessage TEXT',
            'chatEnabled INTEGER DEFAULT 0', 'chatChannels TEXT',
            'supportEnabled INTEGER DEFAULT 0', 'supportChannel TEXT',
            'supportKnowledgeChannels TEXT', 'botToBotChatEnabled INTEGER DEFAULT 0',
            'maxBotTurns INTEGER DEFAULT 5', 'enabled INTEGER DEFAULT 1',
            'clientId TEXT', 'languageMode TEXT DEFAULT \'en\'',
            'welcomeOpenaiApiKey TEXT', 'chatOpenaiApiKey TEXT', 'supportOpenaiApiKey TEXT',
            'aiProvider TEXT DEFAULT \'openai\'', 'welcomeProvider TEXT DEFAULT \'openai\'', 'chatProvider TEXT DEFAULT \'openai\'', 'supportProvider TEXT DEFAULT \'openai\''
        ]
    };

    for (const [table, cols] of Object.entries(tablesToMigrate)) {
        console.log(`[DB] Checking columns for table: ${table}`);
        for (const col of cols) {
            try {
                await db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
            } catch (e) {
                // If column already exists, try to alter type to BIGINT if applicable
                if (col.includes('BIGINT')) {
                    const colName = col.split(' ')[0];
                    try { await db.exec(`ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE BIGINT`); } catch(e2) {}
                }
            }
        }
    }

    // Seed Data (After Migrations)
    await db.exec(`
        INSERT INTO economy_banks (id, name, security, requirement, insurance, reserve) VALUES 
        ('standard', 'Standard City Bank', 0.2, 0, 0.0, 50000),
        ('zenith', 'Zenith Central Bank', 0.5, 5, 0.5, 250000),
        ('royal', 'Royal Treasury', 0.8, 15, 0.9, 500000)
        ON CONFLICT(id) DO NOTHING;
    `);

    migrationsDone = true;
    console.log('[DB] Schema migrations complete.');
    return db;
}

async function getDb() {
    if (!dbInstance) {
        dbInstance = await createDbInstance();
    }
    return dbInstance;
}

module.exports = { getDb, initializeSchema };
