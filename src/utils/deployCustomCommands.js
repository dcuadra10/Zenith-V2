const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

async function deployCommands(token, clientId) {
    const commands = [];
    const commandsPath = path.join(__dirname, '../commands');
    
    if (!fs.existsSync(commandsPath)) return false;

    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(folderPath, file));
            if ('data' in command && 'execute' in command) {
                // Custom bots only get the ai-agent command
                if (command.data.name === 'ai-agent') {
                    commands.push(command.data.toJSON());
                }
            }
        }
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
