const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai-agent')
        .setDescription('Manage AI Agents on your server (Admins only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Enable or disable a specific AI agent.')
                .addStringOption(option =>
                    option.setName('agent')
                        .setDescription('The agent to configure')
                        .setRequired(true)
                        .addChoices(
                            { name: 'All Bots (Turn all on/off for this server)', value: 'all-bots' },
                            { name: 'This Bot\'s AI Agent (Turn this bot on/off)', value: 'system' },
                            { name: 'Welcome Host (Greetings)', value: 'welcome' },
                            { name: 'Conversational Chat', value: 'chat' },
                            { name: 'RAG Support (FAQ Support)', value: 'support' },
                            { name: 'Bot-to-Bot Chats', value: 'bot-to-bot' }
                        )
                )
                .addBooleanOption(option =>
                    option.setName('state')
                        .setDescription('Enable (True) or Disable (False)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show the current status of AI agents on this server.')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const db = await getDb();
        const guildId = interaction.guildId;
        const clientId = interaction.client.user.id;

        // Fetch or initialize config for this specific bot instance
        let config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND clientId = ?`, [guildId, clientId]);
        if (!config) {
            // BACKWARDS COMPATIBILITY: Check if there's an old config with no clientId, and associate it
            const oldConfig = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND (clientId IS NULL OR clientId = '')`, [guildId]);
            if (oldConfig) {
                await db.run(`UPDATE ai_agent_configs SET clientId = ? WHERE guildId = ? AND (clientId IS NULL OR clientId = '')`, [clientId, guildId]);
            } else {
                await db.run(
                    `INSERT INTO ai_agent_configs (guildId, agentId, clientId, welcomeEnabled, chatEnabled, supportEnabled, botToBotChatEnabled, maxBotTurns, enabled)
                     VALUES (?, ?, ?, 0, 0, 0, 0, 5, 1)`,
                    [guildId, `agent_${clientId}`, clientId]
                );
            }
            config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND clientId = ?`, [guildId, clientId]);
        }

        if (subcommand === 'toggle') {
            const agent = interaction.options.getString('agent');
            const state = interaction.options.getBoolean('state');
            const stateVal = state ? 1 : 0;

            let dbField = '';
            let agentName = '';

            if (agent === 'all-bots') {
                // Global operation: Turn off/on ALL bots in the current server simultaneously
                await db.run(`UPDATE ai_agent_configs SET enabled = ? WHERE guildId = ?`, [stateVal, guildId]);
                agentName = 'All Server Bots 🤖💯';
            } else {
                if (agent === 'system') {
                    dbField = 'enabled';
                    agentName = 'Full AI Agent 🧠';
                } else if (agent === 'welcome') {
                    dbField = 'welcomeEnabled';
                    agentName = 'Welcome Host 🚪';
                } else if (agent === 'chat') {
                    dbField = 'chatEnabled';
                    agentName = 'Conversational Chat 💬';
                } else if (agent === 'support') {
                    dbField = 'supportEnabled';
                    agentName = 'RAG Support Agent 🛠️';
                } else if (agent === 'bot-to-bot') {
                    dbField = 'botToBotChatEnabled';
                    agentName = 'Bot-to-Bot Chats 🤖🤖';
                }

                await db.run(`UPDATE ai_agent_configs SET ${dbField} = ? WHERE guildId = ? AND clientId = ?`, [stateVal, guildId, clientId]);
            }

            const embed = new EmbedBuilder()
                .setTitle('🧠 AI Agent Core Control')
                .setDescription(`The agent/system **${agentName}** has been successfully **${state ? 'ENABLED / TURNED ON' : 'DISABLED / COMPLETELY SHUT DOWN'}**.`)
                .setColor(state ? '#2ecc71' : '#e74c3c')
                .setFooter({ text: 'Project Zenith Command Center' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🧠 AI Agent — Server Status')
                .setDescription(`Here is the current status of bot **${interaction.client.user.username}** on your server:`)
                .addFields(
                    { name: 'Overall Status 🧠', value: config.enabled !== 0 ? '✅ **ACTIVE (On)**' : '❌ **INACTIVE (Completely Off)**', inline: false },
                    { name: 'Character Name 🎭', value: config.characterName || '*Not configured (See dashboard)*', inline: true },
                    { name: 'Turn Limit 🔄', value: `${config.maxBotTurns || 5} consecutive turns`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: false },
                    { name: 'Welcome Host 🚪', value: config.welcomeEnabled ? '✅ **Active**' : '❌ **Inactive**', inline: true },
                    { name: 'Conversational Chat 💬', value: config.chatEnabled ? '✅ **Active**' : '❌ **Inactive**', inline: true },
                    { name: 'RAG Support Agent 🛠️', value: config.supportEnabled ? '✅ **Active**' : '❌ **Inactive**', inline: true },
                    { name: 'Bot-to-Bot Chats 🤖🤖', value: config.botToBotChatEnabled ? '✅ **Active**' : '❌ **Inactive**', inline: true }
                )
                .setColor(config.enabled !== 0 ? '#ffd700' : '#4f545c')
                .setFooter({ text: 'Configure traits and channels in the Zenith dashboard.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    }
};
