const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    const eventsPath = path.join(__dirname, '../events');
    
    if(!fs.existsSync(eventsPath)) fs.mkdirSync(eventsPath, {recursive: true});

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);

        const names = Array.isArray(event.name) ? event.name : [event.name];

        for (const name of names) {
            if (event.once) {
                client.once(name, async (...args) => {
                    try { await event.execute(...args, client); }
                    catch (err) { console.error(`[EVENT ERROR] ${name}:`, err); }
                });
            } else {
                client.on(name, async (...args) => {
                    try { await event.execute(...args, client); }
                    catch (err) { console.error(`[EVENT ERROR] ${name}:`, err); }
                });
            }
        }
    }
};
