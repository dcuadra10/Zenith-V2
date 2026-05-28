const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js'); // Zenith City Life Update
require('./utils/memberCache');
require('dotenv').config();
const { validateEnv } = require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const { getDb, initializeSchema } = require('./config/database');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Request logging for debugging
app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
        console.log(`[API] ${req.method} ${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, '../dashboard')));

// Middleware to verify Discord Token
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies.discord_token;
    
    if (!token) {
        console.log('[Auth] No token found in headers or cookies');
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        req.user = userRes.data;
        req.token = token; // Store for reuse
        next();
    } catch (e) {
        console.error('[Auth] Token verification failed:', e.response?.data || e.message);
        res.status(401).json({ error: 'Sesión expirada' });
    }
}

// Helper to check if user has admin permissions in a guild
async function checkAdmin(userId, guildId) {
    if (!client.isReady()) return false;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;
        return member.permissions.has('Administrator');
    } catch (e) {
        return false;
    }
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
client.activeApplications = new Collection();

// Endpoints de API Local
app.use(express.json()); // Necesario para parsear el req.body del POST config

// Health Check endpoint for UptimeRobot / healthchecks.io
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now(),
        bot: client.isReady() ? 'connected' : 'disconnected'
    });
});

// Ping healthchecks.io on interval (if configured)
if (process.env.HEALTHCHECKS_URL) {
    setInterval(async () => {
        try {
            const axios = require('axios');
            await axios.get(process.env.HEALTHCHECKS_URL);
        } catch (e) { /* silent */ }
    }, 5 * 60 * 1000); // Every 5 minutes
}

app.get('/api/stats', async (req, res) => {
    try {
        const db = await getDb();
        const adStat = await db.get(`SELECT value FROM global_stats WHERE statName = 'total_ads_globales'`);
        const userCount = await db.get(`SELECT COUNT(*) as count FROM users`);
        
        res.json({
            totalAds: adStat ? adStat.value : 0,
            totalUsers: userCount ? userCount.count : 0
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error fetching stats' });
    }
});

// OAuth2 Auth Flow
app.get('/api/auth/discord', (req, res) => {
    const clientId = process.env.CLIENT_ID;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = process.env.DASHBOARD_URL || `${protocol}://${host}`;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback`);
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('No code provided');
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const baseUrl = process.env.DASHBOARD_URL || `${protocol}://${host}`;
        
        const params = new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${baseUrl}/api/auth/callback`
        });
        
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const accessToken = tokenRes.data.access_token;
        
        // Guardar token en cookie segura y regresar al dashboard
        res.cookie('discord_token', accessToken, { 
            httpOnly: false, 
            secure: true, 
            sameSite: 'Lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        res.redirect(`/?token=success&access_token=${accessToken}`);
    } catch (error) {
        console.error('Error en callback Oauth2:', error.response?.data || error.message);
        res.status(500).send('Error durante OAuth2');
    }
});

app.get('/api/guilds', authenticateToken, async (req, res) => {
    try {
        const token = req.cookies.discord_token;
        const userGuildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const userGuilds = userGuildsRes.data;

        const adminGuilds = userGuilds.filter(g => (g.permissions & 0x8) === 0x8);
        const botGuildIds = client.guilds.cache.map(g => g.id);
        const validGuilds = adminGuilds.filter(g => botGuildIds.includes(g.id));

        res.json(validGuilds);
    } catch (error) {
        console.error('Error fetching guilds', error.response?.data || error);
        res.status(500).json({ error: 'Error procesando servidores' });
    }
});

app.get('/api/guild/:id/stats', authenticateToken, async (req, res) => {
    try {
        const guildId = req.params.id;
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const citizens = guild.memberCount - bots;
        const communications = guild.channels.cache.size;
        const boosts = guild.premiumSubscriptionCount || 0;

        res.json({
            citizens,
            bots,
            communications,
            boosts
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/guild/:id/channels', authenticateToken, async (req, res) => {
    try {
        const guildId = req.params.id;
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        const channels = guild.channels.cache.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            parentId: c.parentId
        }));
        res.json(channels);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/guild/:id/roles', authenticateToken, async (req, res) => {
    try {
        const guildId = req.params.id;
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        const roles = guild.roles.cache.map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor
        }));
        res.json(roles);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET Settings for a specific Guild
app.get('/api/config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json(config || { spreadsheetId: '', leadershipChannelId: '' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error reading config' });
    }
});

// POST Settings for a specific Guild
app.post('/api/config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const { spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName, brandingAvatar } = req.body;
        const db = await getDb();
        await db.run(
            `INSERT INTO guild_configs (guildId, spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName, brandingAvatar) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON CONFLICT(guildId) DO UPDATE SET 
             spreadsheetId=excluded.spreadsheetId, 
             leadershipChannelId=excluded.leadershipChannelId,
             welcomeChannelId=excluded.welcomeChannelId,
             logChannelId=excluded.logChannelId,
             ticketCategoryId=excluded.ticketCategoryId,
             brandingName=excluded.brandingName,
             brandingAvatar=excluded.brandingAvatar`,
             [req.params.guildId, spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName || null, brandingAvatar || null]
        );
        const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json({ success: true, config });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error saving config' });
    }
});

// ============================================
// MARKET+ ROUTES (DEFINED BELOW)
// ============================================

// Branding Management Removed

// GET Custom Bot Info
app.get('/api/custom-bot/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const bot = await db.get(`SELECT botToken, clientId, status, errorMessage FROM custom_bots WHERE guildId = ?`, [req.params.guildId]);
        if (bot) {
            // Mask the token partially for safety
            bot.botToken = bot.botToken ? bot.botToken.substring(0, 15) + '...' : null;
        }
        res.json(bot || { status: 'none' });
    } catch (e) {
        console.error('Error fetching custom bot:', e);
        res.status(500).json({ error: 'Error fetching custom bot' });
    }
});

// POST Custom Bot Connect
app.post('/api/custom-bot/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const { botToken } = req.body;
        if (!botToken) return res.status(400).json({ error: 'Falta el Token del Bot' });

        const db = await getDb();
        await db.run(
            `INSERT INTO custom_bots (guildId, botToken, status) VALUES (?, ?, 'starting') 
             ON CONFLICT(guildId) DO UPDATE SET botToken=excluded.botToken, status='starting'`,
            [req.params.guildId, botToken]
        );

        const customBotManager = require('./managers/CustomBotManager');
        const result = await customBotManager.startBot(req.params.guildId, botToken);

        if (result.success) {
            res.json({ success: true, clientId: result.client.user.id });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (e) {
        console.error('Error connecting custom bot:', e);
        res.status(500).json({ error: 'Error al conectar el bot personalizado' });
    }
});

// DELETE Custom Bot Disconnect
app.delete('/api/custom-bot/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const customBotManager = require('./managers/CustomBotManager');
        await customBotManager.stopBot(req.params.guildId);

        res.json({ success: true });
    } catch (e) {
        console.error('Error disconnecting custom bot:', e);
        res.status(500).json({ error: 'Error al desconectar el bot personalizado' });
    }
});

// Branding & Custom Bot APIs Removed

// GET Panels for a specific Guild
app.get('/api/panels/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const panels = await db.all(`SELECT * FROM ticket_panels WHERE guildId = ?`, [req.params.guildId]);
        res.json(panels);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching panels' });
    }
});

// POST Create or Update Panel
app.post('/api/panels/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const { id, channelId, messageId, panelData } = req.body;
        const guildId = req.params.guildId;
        const panelId = id || Math.random().toString(36).substring(2, 10);
        
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(400).json({ error: 'Bot is not in this guild' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found' });

        const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const { buildMessage } = require('./utils/messageBuilder');

        const rows = [];
        panelData.dropdowns.forEach((dd, i) => {
            if (!dd.options || dd.options.length === 0) return;
            const selectOptions = dd.options.map((opt, optIdx) => {
                return {
                    label: opt.label,
                    description: opt.description || 'Select this option',
                    emoji: opt.emoji || '🎫',
                    value: `ticket_opt_${panelId}_${i}_${optIdx}`
                };
            });
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_panel_${panelId}_${i}`)
                .setPlaceholder(dd.placeholder || 'Select an option...')
                .addOptions(selectOptions.slice(0, 25)); // Discord max 25
            rows.push(new ActionRowBuilder().addComponents(menu));
        });

        
        if (panelData.buttonRows) {
            panelData.buttonRows.forEach((br, i) => {
                if (!br.options || br.options.length === 0) return;
                const row = new ActionRowBuilder();
                br.options.forEach((opt, optIdx) => {
                    let style = ButtonStyle.Primary;
                    if (opt.buttonStyle === 'Secondary') style = ButtonStyle.Secondary;
                    if (opt.buttonStyle === 'Success') style = ButtonStyle.Success;
                    if (opt.buttonStyle === 'Danger') style = ButtonStyle.Danger;
                    
                    const btn = new ButtonBuilder()
                        .setCustomId(`ticket_panel_${panelId}_btn_${i}_${optIdx}`)
                        .setLabel(opt.label || 'Ticket')
                        .setStyle(style);
                    if (opt.emoji) btn.setEmoji(opt.emoji);
                    row.addComponents(btn);
                });
                rows.push(row);
            });
        }

        const useEmbed = panelData.useEmbed === undefined || panelData.useEmbed === null ? true : !!panelData.useEmbed;
        const panelTitle = (panelData.emoji ? panelData.emoji + ' ' : '') + (panelData.title || 'Support');
        const panelDesc = (panelData.descEmoji ? panelData.descEmoji + ' ' : '') + (panelData.description || 'Select an option to open a ticket.');

        const payload = buildMessage(useEmbed, {
            title: panelTitle,
            description: panelDesc,
            color: panelData.color || '#a855f7',
            imageUrl: panelData.imageUrl || null,
            v2Components: panelData.v2Components || [],
            actionRows: rows
        });

        let postedMsg;
        if (messageId) {
            try {
                const oldMsg = await channel.messages.fetch(messageId);
                if (oldMsg) {
                    await oldMsg.delete().catch(() => {});
                }
            } catch(e) {
                // Ignore if the message was already deleted or doesn't exist
            }
        }
        postedMsg = await channel.send(payload);

        const db = await getDb();
        await db.run(
            `INSERT INTO ticket_panels (id, guildId, channelId, messageId, panelData) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET 
             channelId=excluded.channelId,
             messageId=excluded.messageId,
             panelData=excluded.panelData`,
             [panelId, guildId, channelId, postedMsg.id, JSON.stringify(panelData)]
        );
        res.json({ success: true, panelId });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Error saving panel to discord' });
    }
});

// DELETE Panel
app.delete('/api/panels/:id', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const panel = await db.get(`SELECT guildId FROM ticket_panels WHERE id = ?`, [req.params.id]);
        if (!panel) return res.status(404).json({ error: 'Panel not found' });

        const hasAdmin = await checkAdmin(req.user.id, panel.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        await db.run(`DELETE FROM ticket_panels WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Error deleting panel' });
    }
});

// Update Panel (EDIT)
app.put('/api/panels/:id', authenticateToken, async (req, res) => {
    const { panelData } = req.body;
    try {
        const db = await getDb();
        const panel = await db.get(`SELECT guildId FROM ticket_panels WHERE id = ?`, [req.params.id]);
        if (!panel) return res.status(404).json({ error: 'Panel not found' });

        const hasAdmin = await checkAdmin(req.user.id, panel.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        await db.run(
            `UPDATE ticket_panels SET panelData = ? WHERE id = ?`,
            [JSON.stringify(panelData), req.params.id]
        );
        res.json({ success: true });
    } catch(e) {
        console.error('Error updating panel:', e);
        res.status(500).json({ error: 'Error updating panel' });
    }
});

// GET Giveaways
app.get('/api/giveaways/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const giveaways = await db.all(`SELECT * FROM giveaways WHERE guildId = ? ORDER BY endTime DESC`, [req.params.guildId]);
        res.json(giveaways || []);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching giveaways' });
    }
});

// POST Giveaways
app.post('/api/giveaways/:guildId', authenticateToken, async (req, res) => {
    const { channelId, prize, winnersCount, durationMs, color, requiredRole, pingRole } = req.body;
    const guildId = req.params.guildId;
    
    try {
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(400).json({ error: 'Bot is not in this guild' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found' });
        
        const userId = req.user.id;
        const endTime = Date.now() + durationMs;
        const endUnix = Math.floor(endTime / 1000); // Unix for Discord <t:...>
        
        let desc = `React with 🎉 to enter!\n\n**Winners:** ${winnersCount}\n**Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)\n**Hosted By:** <@${userId}>`;
        if (requiredRole) {
            desc += `\n**Required Role:** <@&${requiredRole}>`;
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle(`Giveaway: ${prize}`)
            .setDescription(desc)
            .setColor(color || '#a855f7')
            .setTimestamp(new Date(endTime));
            
        const msgContent = pingRole ? `<@&${pingRole}>` : undefined;
        const message = await channel.send({ content: msgContent, embeds: [embed] });
        await message.react('🎉');
        
        const db = await getDb();
        await db.run(
            `INSERT INTO giveaways (id, guildId, channelId, prize, winnersCount, endTime, hostedBy, requiredRole, pingRole, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [message.id, guildId, channelId, prize, winnersCount, endTime, userId, requiredRole || null, pingRole || null]
        );
        res.json({ success: true, messageId: message.id });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Error processing giveaway' });
    }
});

// ============================================
// MARKET+ ROUTES
// ============================================
app.get('/api/market-config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json(config || {});
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/market-config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const { marketEnabled, forumChannelId, approvalChannelId, ownerChannelId, paymentMethods, middlemanRole, marketFeePct, middlemanFeePct, marketQuestions, mmPaymentMethods } = req.body;
        
        await db.run(
            `INSERT INTO market_configs (guildId, marketEnabled, forumChannelId, approvalChannelId, ownerChannelId, paymentMethods, middlemanRole, marketFeePct, middlemanFeePct, marketQuestions, mmPaymentMethods)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET 
             marketEnabled = excluded.marketEnabled,
             forumChannelId = excluded.forumChannelId,
             approvalChannelId = excluded.approvalChannelId,
             ownerChannelId = excluded.ownerChannelId,
             paymentMethods = excluded.paymentMethods,
             middlemanRole = excluded.middlemanRole,
             marketFeePct = excluded.marketFeePct,
             middlemanFeePct = excluded.middlemanFeePct,
             marketQuestions = excluded.marketQuestions,
             mmPaymentMethods = excluded.mmPaymentMethods`,
            [
                req.params.guildId, 
                marketEnabled ? 1 : 0, 
                forumChannelId, 
                approvalChannelId, 
                ownerChannelId, 
                paymentMethods, 
                middlemanRole, 
                parseInt(marketFeePct) || 5, 
                parseInt(middlemanFeePct) || 5, 
                marketQuestions ? JSON.stringify(marketQuestions) : null, 
                mmPaymentMethods
            ]
        );
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// AI AGENTS ROUTES
// ============================================
app.get('/api/ai-agent/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ?`, [req.params.guildId]);
        if (!config) {
            return res.json({
                guildId: req.params.guildId,
                openaiApiKey: '',
                characterName: '',
                characterTraits: '',
                welcomeEnabled: 0,
                welcomeChannel: '',
                welcomeMessage: '',
                chatEnabled: 0,
                chatChannels: '[]',
                supportEnabled: 0,
                supportChannel: '',
                supportKnowledgeChannels: '[]',
                botToBotChatEnabled: 0,
                maxBotTurns: 5,
                enabled: 1,
                languageMode: 'en'
            });
        }
        
        // Mask OpenAI API Key for security if it exists
        if (config.openaiApiKey) {
            config.openaiApiKey = '••••••••••••';
        }
        
        res.json(config);
    } catch (e) {
        console.error('[AI Agent API GET Error]:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/ai-agent/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const guildId = req.params.guildId;
        const {
            openaiApiKey,
            characterName,
            characterTraits,
            welcomeEnabled,
            welcomeChannel,
            welcomeMessage,
            chatEnabled,
            chatChannels,
            supportEnabled,
            supportChannel,
            supportKnowledgeChannels,
            botToBotChatEnabled,
            maxBotTurns,
            enabled,
            languageMode
        } = req.body;
        
        // Fetch existing config to see if key needs update or preservation
        const existing = await db.get(`SELECT openaiApiKey FROM ai_agent_configs WHERE guildId = ?`, [guildId]);
        
        let keyToSave = openaiApiKey;
        if (openaiApiKey === '••••••••••••' || !openaiApiKey) {
            keyToSave = existing ? existing.openaiApiKey : '';
        }

        await db.run(
            `INSERT INTO ai_agent_configs (
                guildId, openaiApiKey, characterName, characterTraits,
                welcomeEnabled, welcomeChannel, welcomeMessage, chatEnabled, chatChannels,
                supportEnabled, supportChannel, supportKnowledgeChannels,
                botToBotChatEnabled, maxBotTurns, enabled, languageMode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET
             openaiApiKey = excluded.openaiApiKey,
             characterName = excluded.characterName,
             characterTraits = excluded.characterTraits,
             welcomeEnabled = excluded.welcomeEnabled,
             welcomeChannel = excluded.welcomeChannel,
             welcomeMessage = excluded.welcomeMessage,
             chatEnabled = excluded.chatEnabled,
             chatChannels = excluded.chatChannels,
             supportEnabled = excluded.supportEnabled,
             supportChannel = excluded.supportChannel,
             supportKnowledgeChannels = excluded.supportKnowledgeChannels,
             botToBotChatEnabled = excluded.botToBotChatEnabled,
             maxBotTurns = excluded.maxBotTurns,
             enabled = excluded.enabled,
             languageMode = excluded.languageMode`,
            [
                guildId,
                keyToSave,
                characterName || '',
                characterTraits || '',
                welcomeEnabled ? 1 : 0,
                welcomeChannel || '',
                welcomeMessage || '',
                chatEnabled ? 1 : 0,
                chatChannels || '[]',
                supportEnabled ? 1 : 0,
                supportChannel || '',
                supportKnowledgeChannels || '[]',
                botToBotChatEnabled ? 1 : 0,
                parseInt(maxBotTurns) || 5,
                enabled !== undefined ? (enabled ? 1 : 0) : 1,
                languageMode || 'en'
            ]
        );

        res.json({ success: true });
    } catch (e) {
        console.error('[AI Agent API POST Error]:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST AI Research
app.post('/api/ai-agent/:guildId/research', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const guildId = req.params.guildId;
        const { characterName, language } = req.body;

        if (!characterName) {
            return res.status(400).json({ error: 'Character name is required' });
        }

        // Get saved OpenAI API key for this server
        const config = await db.get(`SELECT openaiApiKey FROM ai_agent_configs WHERE guildId = ?`, [guildId]);
        const apiKey = config ? config.openaiApiKey : null;

        if (!apiKey) {
            return res.status(400).json({ error: 'Please configure your OpenAI API Key first before using AI Research.' });
        }

        let languageName = 'English Only';
        if (language === 'es') languageName = 'Spanish Only (Español)';
        else if (language === 'fr') languageName = 'French Only (Français)';
        else if (language === 'de') languageName = 'German Only (Deutsch)';
        else if (language === 'pt') languageName = 'Portuguese Only (Português)';
        else if (language === 'auto') languageName = 'the user\'s language dynamically';

        const systemPrompt = `You are a professional character personality researcher and prompt engineer.
Your task is to research the character named "${characterName}" and write a detailed set of character traits and behavior instructions to be used as a system prompt for a Discord AI bot.
Include their:
- Voice, style, and tone of speaking.
- Personality traits, backstory, and attitudes.
- Standard phrases, idioms, or quotes.
- Instructions on how they should act in a Discord chat.

Keep it highly structured and detailed, and write the instructions in English so that the LLM understands it perfectly, but specify in the traits that they must speak/respond in ${languageName}. Output ONLY the traits and behavior instructions. Do not include any intro, outro, or conversational text.`;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Analyze the character: ${characterName}` }
                ],
                max_tokens: 450,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );

        const characterTraits = response.data?.choices?.[0]?.message?.content;
        if (!characterTraits) {
            return res.status(500).json({ error: 'OpenAI returned an empty response.' });
        }

        res.json({ characterTraits });
    } catch (err) {
        console.error('[AI Agent API Research Error]:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to research character. Please verify your OpenAI key.' });
    }
});


// GET Module Configs
app.get('/api/modules/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const configRaw = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [req.params.guildId]);
        if (!configRaw) return res.json({});
        
        // Normalize keys to lowercase for the dashboard
        const config = Object.keys(configRaw).reduce((acc, key) => {
            acc[key.toLowerCase()] = configRaw[key];
            return acc;
        }, {});
        
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching module configs' });
    }
});

// GET Guild Roles
app.get('/api/guild/:guildId/roles', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });
        
        const roles = guild.roles.cache
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => ({ id: r.id, name: r.name }));
        
        res.json(roles);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching roles' });
    }
});

// POST Module Configs
app.post('/api/modules/:guildId', authenticateToken, async (req, res) => {
    const b = req.body;
    const guildId = req.params.guildId;
    
    try {
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        
        // Build dynamic upsert
        const fields = [
            'welcomeEnabled', 'welcomeChannel', 'welcomeEmbedTitle', 'welcomeEmbedDesc', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
            'levelingEnabled', 'xpMin', 'xpMax', 'xpCooldown', 'levelUpChannel', 'roleRewards',
            'ticketsEnabled', 'ticketsMaxActive', 'ticketsTranscriptChannel', 'ticketCategoryId', 'ticketsApprovalChannel',
            'automodEnabled', 'automodSpam', 'automodLinks', 'automodMentions', 'automodCaps', 'automodWords',
            'automodWordList', 'automodMaxMentions', 'automodLogChannel',
            'loggingEnabled', 'loggingChannel', 'logEdits', 'logDeletes', 'logMembers', 'logRoles', 'logChannels', 'logBans',
            'autoroleEnabled', 'autoroleIds',
            'countingEnabled', 'countingChannel', 'countingCurrent', 'countingSameUser', 'countingReset', 'countingMath',
            'serverStatsEnabled', 'statsTotalMembers', 'statsOnline', 'statsBots', 'statsChannels', 'statsCategoryId',
            'antinukeEnabled', 'antinukeBan', 'antinukeChannel', 'antinukeRole', 'antinukeWebhook', 'antinukeThreshold', 'antinukeWhitelist',
            'r4TrackingEnabled', 'r4TrackingRole', 'r4TrackingAdQuota', 'r4TrackingMsgQuota',
            'swearJarEnabled', 'swearJarChannel', 'swearJarWords', 'swearJarPing',
            'newKingdomEnabled', 'newKingdomSourceChannel', 'newKingdomTargetChannel', 'newKingdomPingRole',
            'ecoEnabled', 'ecoCoinsPerMessage', 'ecoCoinsPerAd', 'ecoCoinsPerInvite', 'ecoCoinsPerWelcome', 'ecoCoinsPerBoost', 'ecoCoinsPerGiveaway', 'ecoCoinsPerVCMinute', 'ecoWelcomeKeywords', 'ecoWelcomeNotifyChannel',
            'rssEnabled', 'rssSellerRole', 'rssTaxRate', 'rssCategory'
        ];
        
        const allFields = ['guildId', ...fields];
        const placeholders = allFields.map(() => '?').join(',');
        const updateSet = fields.map(f => `${f}=excluded.${f}`).join(',');
        const values = [guildId, ...fields.map(f => {
            const foundKey = Object.keys(b).find(k => k.toLowerCase() === f.toLowerCase());
            return (foundKey !== undefined && b[foundKey] !== undefined) ? b[foundKey] : null;
        })];

        
        await db.run(
            `INSERT INTO module_configs (${allFields.join(',')}) VALUES (${placeholders}) ON CONFLICT(guildId) DO UPDATE SET ${updateSet}`,
            values
        );
        
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving module configs:', e);
        res.status(500).json({ error: 'Error saving module configs' });
    }
});

// GET RSS Collective Stock
app.get('/api/rss/collective-stock/:guildId', authenticateToken, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const config = await db.get(`SELECT rssSellerRole FROM module_configs WHERE guildId = ?`, [guildId]);
        const roleNameOrId = config?.rssSellerRole || 'RSS Seller';

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Servidor no encontrado' });

        let sellers = [];
        try {
            const role = guild.roles.cache.get(roleNameOrId) || guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
            if (role) {
                await guild.members.fetch();
                sellers = role.members.map(m => m.id);
            } else {
                await guild.members.fetch();
                sellers = guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase())).map(m => m.id);
            }
        } catch (err) {
            console.error('[Collective Stock] Error fetching members/roles:', err);
        }

        if (sellers.length === 0) {
            return res.json({ food: 0, wood: 0, stone: 0, gold: 0 });
        }

        const placeholders = sellers.map(() => '?').join(',');
        const query = `SELECT 
            SUM(food) as total_food, 
            SUM(wood) as total_wood, 
            SUM(stone) as total_stone, 
            SUM(gold) as total_gold 
            FROM rss_seller_stocks WHERE sellerId IN (${placeholders})`;
        
        const row = await db.get(query, sellers);
        
        res.json({
            food: Number(row?.total_food || 0),
            wood: Number(row?.total_wood || 0),
            stone: Number(row?.total_stone || 0),
            gold: Number(row?.total_gold || 0)
        });
    } catch (e) {
        console.error('[API] Error in collective stock:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST Deploy RSS Panel
app.post('/api/rss/deploy-panel/:guildId', authenticateToken, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const hasAdmin = await checkAdmin(req.user.id, guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const { channelId, panelType } = req.body;
        if (!channelId || !panelType) {
            return res.status(400).json({ error: 'Missing channelId or panelType' });
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Servidor no encontrado' });

        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Canal no encontrado' });

        const db = await getDb();
        const config = await db.get(`SELECT rssEnabled, rssSellerRole FROM module_configs WHERE guildId = ?`, [guildId]);
        if (!config || !config.rssEnabled) {
            return res.status(400).json({ error: 'El módulo RSS está deshabilitado en este servidor.' });
        }

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        if (panelType === 'buy') {
            const embed = new EmbedBuilder()
                .setTitle('🌾 Alliance Resource Purchase')
                .setDescription('Welcome to the **Official Resource Purchase Market**!\n\nBuy resources (Food, Wood, Stone, Gold) securely from our verified RSS Sellers.\n\nClick the button below to select a seller, submit your desired amounts, and open a private trade ticket.')
                .setColor('#10b981');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rss_buy_start')
                    .setLabel('Buy RSS')
                    .setEmoji('🛒')
                    .setStyle(ButtonStyle.Success)
            );

            await channel.send({ embeds: [embed], components: [row] });
        } else if (panelType === 'stock') {
            const roleNameOrId = config.rssSellerRole || 'RSS Seller';
            let sellers = [];
            let sellerListStr = 'No verified RSS Sellers found.';

            try {
                const role = guild.roles.cache.get(roleNameOrId) || guild.roles.cache.find(r => r.name.toLowerCase() === roleNameOrId.toLowerCase());
                if (role) {
                    await guild.members.fetch();
                    const membersWithRole = role.members;
                    sellers = membersWithRole.map(m => m.id);
                    if (membersWithRole.size > 0) {
                        sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                    }
                } else {
                    await guild.members.fetch();
                    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.some(r => r.name.toLowerCase() === roleNameOrId.toLowerCase()));
                    sellers = membersWithRole.map(m => m.id);
                    if (membersWithRole.size > 0) {
                        sellerListStr = membersWithRole.map(m => `<@${m.id}>`).join(', ');
                    }
                }
            } catch (err) {
                console.error('[API Panel Setup] Error fetching members/roles:', err);
            }

            let totalFood = 0, totalWood = 0, totalStone = 0, totalGold = 0;
            if (sellers.length > 0) {
                const placeholders = sellers.map(() => '?').join(',');
                const row = await db.get(`SELECT SUM(food) as f, SUM(wood) as w, SUM(stone) as s, SUM(gold) as g FROM rss_seller_stocks WHERE sellerId IN (${placeholders})`, sellers);
                if (row) {
                    totalFood = row.f || 0;
                    totalWood = row.w || 0;
                    totalStone = row.s || 0;
                    totalGold = row.g || 0;
                }
            }

            const formatNumber = (num) => {
                if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
                if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
                if (num >= 1e3) return (num / 1e3).toFixed(1) + 'k';
                return num.toString();
            };

            const embed = new EmbedBuilder()
                .setTitle('📦 Collective RSS Stock Management')
                .setDescription(`Welcome to the **RSS Stock Management Portal**.\n\nSellers can add to their private stock directly from this panel using the button below. Individual stocks remain private, only the aggregate collective total is visible.`)
                .addFields(
                    { name: '👥 Verified Sellers', value: sellerListStr },
                    { name: '🌾 Collective Stocks', value: `**Food:** ${formatNumber(totalFood)}\n**Wood:** ${formatNumber(totalWood)}\n**Stone:** ${formatNumber(totalStone)}\n**Gold:** ${formatNumber(totalGold)}` }
                )
                .setColor('#4f46e5')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rss_stock_add_click')
                    .setLabel('Add Stock')
                    .setEmoji('➕')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('rss_stock_remove_click')
                    .setLabel('Remove Stock')
                    .setEmoji('➖')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });
        } else {
            return res.status(400).json({ error: 'Invalid panelType' });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[API] Error deploying panel:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET R4 Tracking Data
app.get('/api/r4-tracking/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const records = await db.all(`SELECT * FROM r4_tracking WHERE guildId = ? ORDER BY weekId DESC`, [req.params.guildId]);
        
        // Retrieve active multi-week excuses for this guild
        const excuses = await db.all(`SELECT * FROM r4_excuses WHERE guildId = ?`, [req.params.guildId]);
        const excusesMap = {};
        excuses.forEach(exc => {
            excusesMap[exc.userId] = exc;
        });

        let membersMap = {};
        if (client.isReady()) {
            const guild = client.guilds.cache.get(req.params.guildId);
            if (guild) {
                try {
                    await guild.members.fetch();
                    guild.members.cache.forEach(m => {
                        membersMap[m.id] = {
                            username: m.user.username,
                            displayName: m.displayName,
                            avatar: m.user.displayAvatarURL({ dynamic: true })
                        };
                    });
                } catch (err) {
                    console.error('[API] Error fetching guild members:', err);
                }
            }
        }

        const { isWeekWithinExcuse } = require('./utils/dateHelpers');

        const enrichedRecords = records.map(r => {
            const exc = excusesMap[r.userId];
            let isExcused = r.excused === 1;
            let excuseReason = r.excuseReason;
            let excuseWeeksRemaining = 0;

            if (exc) {
                const check = isWeekWithinExcuse(exc.startWeekId, exc.durationWeeks, r.weekId);
                if (check.excused) {
                    isExcused = true;
                    excuseReason = exc.excuseReason || 'Excusado';
                    excuseWeeksRemaining = check.weeksRemaining;
                }
            }

            return {
                ...r,
                username: membersMap[r.userId]?.username || r.userId,
                displayName: membersMap[r.userId]?.displayName || r.userId,
                avatar: membersMap[r.userId]?.avatar || null,
                excused: isExcused ? 1 : 0,
                excuseReason: excuseReason,
                excuseWeeksRemaining: excuseWeeksRemaining
            };
        });

        res.json(enrichedRecords || []);
    } catch (e) {
        console.error('Error fetching R4 tracking:', e);
        res.status(500).json({ error: 'Error fetching R4 tracking' });
    }
});

// POST Excuse R4 User
app.post('/api/r4-tracking/excuse/:guildId', authenticateToken, async (req, res) => {
    const { userId, weekId, excused, excuseReason, durationWeeks } = req.body;
    const duration = parseInt(durationWeeks, 10) || 1;
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();

        if (excused) {
            // Save excuse in r4_excuses table
            await db.run(
                `INSERT INTO r4_excuses (userId, guildId, startWeekId, durationWeeks, excuseReason)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(userId, guildId) DO UPDATE SET 
                    startWeekId = EXCLUDED.startWeekId,
                    durationWeeks = EXCLUDED.durationWeeks,
                    excuseReason = EXCLUDED.excuseReason`,
                [userId, req.params.guildId, weekId, duration, excuseReason || 'Excusado']
            );

            // Sync r4_tracking row for current week for compatibility
            await db.run(
                `INSERT INTO r4_tracking (userId, guildId, weekId, excused, excuseReason, messages, ads, isProcessed)
                 VALUES (?, ?, ?, 1, ?, 0, 0, 0)
                 ON CONFLICT(userId, guildId, weekId) DO UPDATE SET 
                    excused = 1,
                    excuseReason = EXCLUDED.excuseReason`,
                [userId, req.params.guildId, weekId, excuseReason || 'Excusado']
            );
        } else {
            // Clear excuse in r4_excuses table
            await db.run(
                `DELETE FROM r4_excuses WHERE userId = ? AND guildId = ?`,
                [userId, req.params.guildId]
            );

            // Clear excuse in r4_tracking row for current week
            await db.run(
                `UPDATE r4_tracking SET excused = 0, excuseReason = NULL 
                 WHERE userId = ? AND guildId = ? AND weekId = ?`,
                 [userId, req.params.guildId, weekId]
            );
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Error excusing user:', e);
        res.status(500).json({ error: 'Error excusing user' });
    }
});

// GET Transcripts List
app.get('/api/transcripts/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const logs = await db.all('SELECT ticketId, userId, closedAt FROM ticket_transcripts WHERE guildId = ? ORDER BY closedAt DESC', [req.params.guildId]);
        res.json(logs);
    } catch (e) {
        console.error('Error fetching transcripts:', e);
        res.status(500).json({ error: 'Error fetching transcripts' });
    }
});

// GET Single Transcript Content
app.get('/api/transcripts/:guildId/:ticketId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const db = await getDb();
        const transcript = await db.get('SELECT logContent FROM ticket_transcripts WHERE guildId = ? AND ticketId = ?', [req.params.guildId, req.params.ticketId]);
        if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

        res.json({ content: decodeURIComponent(transcript.logContent) });
    } catch (e) {
        console.error('Error fetching transcript content:', e);
        res.status(500).json({ error: 'Error fetching transcript content' });
    }
});

// POST Import Levels from Backup
app.post('/api/levels/import/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'No autorizado' });

        const levelsData = req.body.levels;
        if (!levelsData || !Array.isArray(levelsData)) {
            return res.status(400).json({ error: 'Invalid backup format. Missing "levels" array.' });
        }

        const db = await getDb();
        let successCount = 0;

        await db.run('BEGIN TRANSACTION');
        try {
            for (const item of levelsData) {
                if (!item.userId || item.level === undefined) continue;
                await db.run(
                    `INSERT INTO users (userId, level, xp) VALUES (?, ?, 0)
                     ON CONFLICT(userId) DO UPDATE SET level = excluded.level, xp = 0`,
                    [item.userId, item.level]
                );
                successCount++;
            }
            await db.run('COMMIT');
            res.json({ success: true, count: successCount });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (e) {
        console.error('Error importing levels:', e);
        res.status(500).json({ error: 'Internal error during import' });
    }
});

// GET Economy Shop
app.get('/api/economy/shop/:guildId', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const items = await db.all(`SELECT * FROM economy_shop WHERE guildId = ?`, [req.params.guildId]);
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching shop' });
    }
});

// POST Add Shop Item
app.post('/api/economy/shop/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const { name, description, price, type, roleId } = req.body;
        const db = await getDb();
        const id = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await db.run(
            `INSERT INTO economy_shop (id, guildId, name, description, price, type, roleId) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.guildId, name, description, price, type, roleId || null]
        );
        res.json({ success: true, id });
    } catch (e) {
        res.status(500).json({ error: 'Error adding item' });
    }
});

// DELETE Shop Item
app.delete('/api/economy/shop/:id', authenticateToken, async (req, res) => {
    try {
        const db = await getDb();
        const item = await db.get(`SELECT guildId FROM economy_shop WHERE id = ?`, [req.params.id]);
        if (!item) return res.status(404).json({ error: 'Item not found' });

        const hasAdmin = await checkAdmin(req.user.id, item.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        await db.run(`DELETE FROM economy_shop WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Error deleting item' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Dashboard Web corriendo en puerto ${PORT}`));

// Validar Entorno
validateEnv();

// Iniciar Manejadores
require('./handlers/commandHandler')(client);
require('./handlers/eventHandler')(client);
require('./features/logging')(client);
require('./features/serverStats')(client);
require('./features/giveaways')(client);
require('./features/r4Tracker')(client);

// Iniciar bots personalizados
const customBotManager = require('./managers/CustomBotManager');
customBotManager.initAll();

// Business Update Loop (GTA Style) - Every 15 minutes
setInterval(async () => {
    try {
        const db = await getDb();
        // --- MARKET COMPETITION SYSTEM ---
        const businessTypes = ['car_wash', 'nightclub', 'law_firm', 'tech_lab', 'lab', 'cash'];
        
        for (const type of businessTypes) {
            // Get all businesses of this type (Legal and Mafia)
            const legal = await db.all(`SELECT * FROM economy_operations WHERE type = ?`, [type]);
            const mafia = await db.all(`SELECT * FROM mafia_businesses WHERE type = ?`, [type]);
            const all = [...legal.map(l => ({ ...l, isLegal: true })), ...mafia.map(m => ({ ...m, isMafia: true }))];
            
            if (all.length === 0) continue;

            // Calculate Competitive Scores
            let totalScore = 0;
            const scored = all.map(b => {
                const score = (b.level || 1) * (1 + (b.employeeCount || 0) * 0.2);
                totalScore += score;
                return { ...b, score };
            });

            // Distribute Market Share and Process Bot Purchases
            const totalBotPurchases = 100 * all.length; // 100 purchases per business on average
            for (const b of scored) {
                const share = b.score / totalScore;
                const purchases = Math.floor(totalBotPurchases * share);
                
                // Update Market Share in DB
                if (b.isLegal) {
                    await db.run(`UPDATE economy_operations SET marketShare = ? WHERE id = ?`, [share, b.id]);
                    // Bot purchases boost pending profits (add time to lastCollect)
                    const boostMinutes = purchases * 2; 
                    await db.run(`UPDATE economy_operations SET lastCollect = lastCollect - interval '${boostMinutes} minutes' WHERE id = ?`, [b.id]);
                } else {
                    await db.run(`UPDATE mafia_businesses SET marketShare = ? WHERE mafiaId = ? AND type = ?`, [share, b.mafiaId, b.type]);
                    // Bot purchases consume stock and give money to vault
                    if (b.stock >= purchases) {
                        const revenue = purchases * 50; // 50 coins per purchase
                        await db.run(`UPDATE mafia_businesses SET stock = stock - ? WHERE mafiaId = ? AND type = ?`, [purchases, b.mafiaId, b.type]);
                        await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [revenue, b.mafiaId]);
                    }
                }
            }
        }

        // --- ORIGINAL PRODUCTION LOOP ---
        const businesses = await db.all(`SELECT * FROM mafia_businesses WHERE supplies > 0 OR type IN ('nightclub', 'car_wash', 'tech_lab', 'law_firm')`);
        
        for (const b of businesses) {
            const levelMult = b.level || 1;
            const legalIncomes = { car_wash: 200, nightclub: 1000, law_firm: 3000, tech_lab: 8000 };
            
            if (legalIncomes[b.type]) {
                // Passive clean cash to vault
                const income = legalIncomes[b.type] * levelMult;
                await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [income, b.mafiaId]);
                await db.run(`UPDATE mafia_businesses SET lastUpdate = CURRENT_TIMESTAMP WHERE mafiaId = ? AND type = ?`, [b.mafiaId, b.type]);
            } else if (b.type === 'lab' && b.supplies >= 10) {
                await db.run(`UPDATE mafia_businesses SET stock = stock + ?, supplies = supplies - 10, lastUpdate = CURRENT_TIMESTAMP WHERE mafiaId = ? AND type = ?`, [50 * levelMult, b.mafiaId, b.type]);
            } else if (b.type === 'cash' && b.supplies >= 5) {
                await db.run(`UPDATE mafia_businesses SET stock = stock + ?, supplies = supplies - 5, lastUpdate = CURRENT_TIMESTAMP WHERE mafiaId = ? AND type = ?`, [25 * levelMult, b.mafiaId, b.type]);
            }
        }
    } catch (e) {
        console.error('[Business Loop Error]:', e);
    }
}, 15 * 60 * 1000);

client.login(process.env.DISCORD_TOKEN);
