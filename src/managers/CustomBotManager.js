const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { getDb } = require('../config/database');
const { deployCommands } = require('../utils/deployCustomCommands');

class CustomBotManager {
    constructor() {
        this.activeBots = new Map(); // guildId -> Client
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
        if (this.activeBots.has(guildId)) {
            console.log(`[CustomBotManager] Bot for guild ${guildId} is already running. Stopping it first.`);
            await this.stopBot(guildId);
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
        client.customGuildId = guildId; // Important: to scope this bot to only its assigned guild if necessary

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
                
                // Save client ID and update status
                const db = await getDb();
                await db.run(
                    `UPDATE custom_bots SET clientId = ?, status = 'active', errorMessage = NULL WHERE guildId = ?`,
                    [client.user.id, guildId]
                );

                // Deploy Slash Commands
                await deployCommands(token, client.user.id);
            });

            this.activeBots.set(guildId, client);
            return { success: true, client };

        } catch (error) {
            console.error(`[CustomBotManager] ❌ Failed to login custom bot for guild ${guildId}:`, error.message);
            const db = await getDb();
            await db.run(
                `UPDATE custom_bots SET status = 'error', errorMessage = ? WHERE guildId = ?`,
                [error.message, guildId]
            );
            return { success: false, error: error.message };
        }
    }

    async stopBot(guildId) {
        const client = this.activeBots.get(guildId);
        if (client) {
            console.log(`[CustomBotManager] Stopping custom bot for guild ${guildId}`);
            client.destroy();
            this.activeBots.delete(guildId);
            
            const db = await getDb();
            await db.run(`UPDATE custom_bots SET status = 'inactive' WHERE guildId = ?`, [guildId]);
            return true;
        }
        return false;
    }

    async restartBot(guildId, token) {
        await this.stopBot(guildId);
        return await this.startBot(guildId, token);
    }
}

const customBotManager = new CustomBotManager();
module.exports = customBotManager;
