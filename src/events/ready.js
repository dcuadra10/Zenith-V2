module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`🤖 Logged in as ${client.user.tag}!`);
        
        // Initialize Database Schema
        try {
            const { initializeSchema } = require('../config/database');
            await initializeSchema();
        } catch (e) {
            console.error('[DB] Failed to initialize schema at startup:', e);
        }
        
        // Registrar Comandos
        try {
            const devGuildId = '1431859727285092403'; 
            const devGuild = client.guilds.cache.get(devGuildId);
            
            if (devGuild) {
                // Delete global commands to avoid duplicates
                await client.application.commands.set([]);
                
                await devGuild.commands.set(client.commands.map(c => c.data));
                console.log(`✅ Slash Commands Cargados (Guild: ${devGuildId})`);
            } else {
                // Fallback to global if guild not found
                await client.application.commands.set(client.commands.map(c => c.data));
                console.log('✅ Slash Commands Cargados (Global)');
            }
        } catch(e) {
            console.error('Error cargando comandos', e);
        }
        
        // Cachear invitaciones
        client.invites = new Map();
        try {
            const guilds = client.guilds.cache.map(guild => guild);
            for (const guild of guilds) {
                const firstInvites = await guild.invites.fetch().catch(() => null);
                if (firstInvites) {
                    client.invites.set(guild.id, new Map(firstInvites.map((invite) => [invite.code, invite.uses])));
                }
            }
            console.log('✅ Sistema de Invitaciones Cacheado');
        } catch (e) {
            console.error('Error cacheando invitaciones', e);
        }

        // Auto-initialize module_configs for all guilds
        try {
            const { getDb } = require('../config/database');
            const db = await getDb();
            const guilds = client.guilds.cache.map(g => g);
            for (const guild of guilds) {
                await db.run(
                    `INSERT INTO module_configs (guildId) VALUES (?) ON CONFLICT(guildId) DO NOTHING`,
                    [guild.id]
                );
            }
            console.log('✅ Module configs initialized for all guilds');
        } catch (e) {
            console.error('Error initializing module configs', e);
        }
    },
};
