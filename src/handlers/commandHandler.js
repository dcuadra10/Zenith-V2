const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    const commandsPath = path.join(__dirname, '../commands');
    
    // Ensure the directory exists
    if(!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath, {recursive: true});
    
    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if(!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                // If it's a custom bot, do not load ANY commands
                if (client.isCustomBot) {
                    continue;
                }
                
                client.commands.set(command.data.name, command);
                console.log(`[LOADER] Command loaded: ${command.data.name}`);
            } else {
                console.warn(`[LOADER] [WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }
    }
};
