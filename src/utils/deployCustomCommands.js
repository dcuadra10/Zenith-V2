const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function deployCommands(token, clientId) {
    // Do not load any commands for custom bots, pushing an empty array clears all of them globally
    const commands = [];

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
