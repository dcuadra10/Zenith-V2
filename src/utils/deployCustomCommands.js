const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function deployCommands(token, clientId) {
    // Custom bots only get the ai-agent command
    const commands = [];
    try {
        const aiAgentCommand = require('../commands/utilities/ai-agent');
        if (aiAgentCommand.data) {
            commands.push(aiAgentCommand.data.toJSON());
        }
    } catch (e) {
        console.error('[Deploy] Failed to load ai-agent command:', e.message);
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log(`[Deploy] Iniciando actualización de ${commands.length} application (/) commands para el Custom Bot ${clientId}...`);

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log(`[Deploy] ✅ ¡Se publicaron exitosamente comandos de forma Global para el Custom Bot ${clientId}!`);
        return true;
    } catch (error) {
        console.error(`[Deploy] ❌ Error publicando los comandos para ${clientId}:`, error);
        return false;
    }
}

module.exports = { deployCommands };
