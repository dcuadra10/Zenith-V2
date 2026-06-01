const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { getDb } = require('../config/database');
const { deployCommands } = require('../utils/deployCustomCommands');

class CustomBotManager {
    constructor() {
        this.activeBots = new Map(); // clientId -> Client
    }

    async initAll() {
        const db = await getDb();
        const bots = await db.all(`SELECT * FROM custom_bots WHERE status = 'active'`);
        
        console.log(`[CustomBotManager] Found ${bots.length} active custom bots to initialize.`);
        
        for (const bot of bots) {
            await this.startBot(bot.guildId, bot.botToken);
        }
    }

    async startBot(guildId, token) {
        // Prevent double starts of the same token
        let existingClientId = null;
        for (const [cId, c] of this.activeBots.entries()) {
            if (c.token === token) {
                existingClientId = cId;
                break;
            }
        }
        if (existingClientId) {
            console.log(`[CustomBotManager] Bot with this token is already running. Stopping it first.`);
            await this.stopBot(guildId, existingClientId);
        }

        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildPresences,
                GatewayIntentBits.GuildMessageReactions
            ],
            partials: [Partials.Channel, Partials.Message, Partials.Reaction]
        });

        client.commands = new Collection();
        client.isCustomBot = true;
        client.customGuildId = guildId; // Important: to scope this bot to only its assigned guild

        // Attach Handlers & Features
        require('../handlers/commandHandler')(client);
        require('../handlers/eventHandler')(client);
        require('../features/logging')(client);
        require('../features/serverStats')(client);
        require('../features/giveaways')(client);
        require('../features/r4Tracker')(client);
        require('../features/aiAgent')(client);

        try {
            await client.login(token);
            
            // Handle post-login errors (e.g. "Used disallowed intents" closes the websocket AFTER login resolves)
            const errorHandler = async (error) => {
                console.error(`[CustomBotManager] ❌ Post-login error for guild ${guildId}:`, error.message || error);
                client.destroy();
                
                // Purge from activeBots to prevent memory leak / stale reference blocking restarts
                if (client.user && client.user.id) {
                    this.activeBots.delete(client.user.id);
                } else {
                    for (const [cId, c] of this.activeBots.entries()) {
                        if (c.token === token) {
                            this.activeBots.delete(cId);
                        }
                    }
                }

                const db = await getDb();
                const errMsg = error.message || String(error);
                await db.run(
                    `UPDATE custom_bots SET status = 'error', errorMessage = ? WHERE botToken = ?`,
                    [errMsg, token]
                );
                await db.run(
                    `UPDATE ai_agent_configs SET status = 'error', errorMessage = ? WHERE botToken = ?`,
                    [errMsg, token]
                );
            };

            client.on('error', errorHandler);
            client.on('shardError', errorHandler);
            client.once('disconnect', () => errorHandler(new Error('Disconnected from Discord')));

            // Timeout: if 'ready' doesn't fire within 30 seconds, mark as error
            const readyTimeout = setTimeout(async () => {
                if (!client.isReady()) {
                    console.error(`[CustomBotManager] ⏰ Ready timeout for guild ${guildId} — bot never became ready.`);
                    client.destroy();

                    // Purge potential stale instance reference
                    for (const [cId, c] of this.activeBots.entries()) {
                        if (c.token === token) {
                            this.activeBots.delete(cId);
                        }
                    }

                    const db = await getDb();
                    await db.run(
                        `UPDATE custom_bots SET status = 'error', errorMessage = 'Connection timed out' WHERE botToken = ?`,
                        [token]
                    );
                    await db.run(
                        `UPDATE ai_agent_configs SET status = 'error', errorMessage = 'Connection timed out' WHERE botToken = ?`,
                        [token]
                    );
                }
            }, 30000);

            client.once('ready', async () => {
                clearTimeout(readyTimeout);
                console.log(`[CustomBotManager] ✅ Custom bot for guild ${guildId} logged in as ${client.user.tag}`);
                
                this.activeBots.set(client.user.id, client);
                
                // Save client ID and update status
                const db = await getDb();
                await db.run(
                    `UPDATE custom_bots SET clientId = ?, status = 'active', errorMessage = NULL WHERE botToken = ?`,
                    [client.user.id, token]
                );
                await db.run(
                    `UPDATE ai_agent_configs SET clientId = ?, status = 'active', errorMessage = NULL WHERE botToken = ?`,
                    [client.user.id, token]
                );

                // Deploy Slash Commands
                await deployCommands(token, client.user.id);
            });

            return { success: true, client };

        } catch (error) {
            console.error(`[CustomBotManager] ❌ Failed to login custom bot for guild ${guildId}:`, error.message);
            const db = await getDb();
            await db.run(
                `UPDATE custom_bots SET status = 'error', errorMessage = ? WHERE botToken = ?`,
                [error.message, token]
            );
            await db.run(
                `UPDATE ai_agent_configs SET status = 'error', errorMessage = ? WHERE botToken = ?`,
                [error.message, token]
            );
            return { success: false, error: error.message };
        }
    }

    async stopBot(guildId, clientId) {
        const client = this.activeBots.get(clientId);
        if (client) {
            console.log(`[CustomBotManager] Stopping custom bot ${clientId} for guild ${guildId}`);
            client.destroy();
            this.activeBots.delete(clientId);
            
            const db = await getDb();
            await db.run(`UPDATE custom_bots SET status = 'inactive' WHERE guildId = ? AND clientId = ?`, [guildId, clientId]);
            await db.run(`UPDATE ai_agent_configs SET status = 'inactive' WHERE guildId = ? AND clientId = ?`, [guildId, clientId]);
            return true;
        }
        return false;
    }

    async stopBotByToken(guildId, token) {
        let foundClientId = null;
        for (const [cId, c] of this.activeBots.entries()) {
            if (c.token === token) {
                foundClientId = cId;
                break;
            }
        }
        if (foundClientId) {
            return await this.stopBot(guildId, foundClientId);
        } else {
            const db = await getDb();
            await db.run(`UPDATE custom_bots SET status = 'inactive' WHERE guildId = ? AND botToken = ?`, [guildId, token]);
            await db.run(`UPDATE ai_agent_configs SET status = 'inactive' WHERE guildId = ? AND botToken = ?`, [guildId, token]);
            return true;
        }
    }

    async restartBot(guildId, token) {
        let foundClientId = null;
        for (const [cId, c] of this.activeBots.entries()) {
            if (c.token === token) {
                foundClientId = cId;
                break;
            }
        }
        if (foundClientId) {
            await this.stopBot(guildId, foundClientId);
        }
        return await this.startBot(guildId, token);
    }
}

const customBotManager = new CustomBotManager();
module.exports = customBotManager;
