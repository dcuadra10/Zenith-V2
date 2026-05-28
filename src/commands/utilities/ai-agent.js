const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai-agent')
        .setDescription('Gestión de Agentes de IA en tu servidor (Admins únicamente).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Activa o desactiva un agente de IA específico.')
                .addStringOption(option =>
                    option.setName('agente')
                        .setDescription('El agente a configurar')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Todos los Bots (Apagar/Encender todos en el servidor)', value: 'all-bots' },
                            { name: 'AI Agent de este Bot (Apagar/Encender este bot)', value: 'system' },
                            { name: 'Welcome Host (Bienvenidas)', value: 'welcome' },
                            { name: 'Conversational Chat (Chatear)', value: 'chat' },
                            { name: 'RAG Support (Soporte FAQ)', value: 'support' },
                            { name: 'Bot-to-Bot Chats (Chat entre bots)', value: 'bot-to-bot' }
                        )
                )
                .addBooleanOption(option =>
                    option.setName('estado')
                        .setDescription('Activar (True) o Desactivar (False)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Muestra el estado actual de los agentes de IA en el servidor.')
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
                    `INSERT INTO ai_agent_configs (guildId, clientId, welcomeEnabled, chatEnabled, supportEnabled, botToBotChatEnabled, maxBotTurns, enabled)
                     VALUES (?, ?, 0, 0, 0, 0, 5, 1)`,
                    [guildId, clientId]
                );
            }
            config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND clientId = ?`, [guildId, clientId]);
        }

        if (subcommand === 'toggle') {
            const agent = interaction.options.getString('agente');
            const estado = interaction.options.getBoolean('estado');
            const estadoVal = estado ? 1 : 0;

            let dbField = '';
            let agentName = '';

            if (agent === 'all-bots') {
                // Global operation: Turn off/on ALL bots in the current server simultaneously
                await db.run(`UPDATE ai_agent_configs SET enabled = ? WHERE guildId = ?`, [estadoVal, guildId]);
                agentName = 'Todos los Bots del Servidor 🤖💯';
            } else {
                if (agent === 'system') {
                    dbField = 'enabled';
                    agentName = 'AI Agent Completo 🧠';
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

                await db.run(`UPDATE ai_agent_configs SET ${dbField} = ? WHERE guildId = ? AND clientId = ?`, [estadoVal, guildId, clientId]);
            }

            const embed = new EmbedBuilder()
                .setTitle('🧠 AI Agent Core Control')
                .setDescription(`El agente/sistema **${agentName}** ha sido **${estado ? 'ACTIVADO / ENCENDIDO' : 'DESACTIVADO / APAGADO POR COMPLETO'}** con éxito.`)
                .setColor(estado ? '#2ecc71' : '#e74c3c')
                .setFooter({ text: 'Project Zenith Command Center' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🧠 AI Agent - Server Status')
                .setDescription(`Aquí tienes el estado actual del bot **${interaction.client.user.username}** en tu servidor:`)
                .addFields(
                    { name: 'Estado General 🧠', value: config.enabled !== 0 ? '✅ **ACTIVO (Encendido)**' : '❌ **INACTIVO (Apagado por Completo)**', inline: false },
                    { name: 'Nombre de Personaje 🎭', value: config.characterName || '*No configurado (Ver dashboard)*', inline: true },
                    { name: 'Límite de Turnos 🔄', value: `${config.maxBotTurns || 5} turnos consecutivas`, inline: true },
                    { name: '\u200b', value: '\u200b', inline: false },
                    { name: 'Welcome Host 🚪', value: config.welcomeEnabled ? '✅ **Activo**' : '❌ **Inactivo**', inline: true },
                    { name: 'Conversational Chat 💬', value: config.chatEnabled ? '✅ **Activo**' : '❌ **Inactivo**', inline: true },
                    { name: 'RAG Support Agent 🛠️', value: config.supportEnabled ? '✅ **Activo**' : '❌ **Inactivo**', inline: true },
                    { name: 'Bot-to-Bot Chats 🤖🤖', value: config.botToBotChatEnabled ? '✅ **Activo**' : '❌ **Inactivo**', inline: true }
                )
                .setColor(config.enabled !== 0 ? '#ffd700' : '#4f545c')
                .setFooter({ text: 'Configura rasgos y canales adicionales en el dashboard de Zenith.' })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    }
};
