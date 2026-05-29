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
            
            client.once('ready', async () => {
                console.log(`[CustomBotManager] ✅ Custom bot for guild ${guildId} logged in as ${client.user.tag}`);
                
                this.activeBots.set(client.user.id, client);
                
                // Save client ID and update status
                const db = await getDb();
                await db.run(
                    `UPDATE custom_bots SET clientId = ?, status = 'active', errorMessage = NULL WHERE botToken = ?`,
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
