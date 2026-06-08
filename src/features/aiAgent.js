const { getDb } = require('../config/database');
const axios = require('axios');

// Available Claude models for dashboard selection
const CLAUDE_MODELS = {
    'haiku': 'claude-haiku-4-5-20250514',
    'sonnet': 'claude-sonnet-4-6-20250514',
    'opus': 'claude-opus-4-8-20250514'
};
const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS['haiku'];

// Available OpenAI models
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getLanguageInstruction(languageMode) {
    if (languageMode === 'en') {
        return '\n\nIMPORTANT: ALWAYS speak and respond strictly in English. Do not use any other language, regardless of the language used by the user.';
    }
    if (languageMode === 'es') {
        return '\n\nIMPORTANTE: Habla y responde SIEMPRE estrictamente en Español (Castellano). No uses ningún otro idioma, independientemente del idioma del usuario.';
    }
    if (languageMode === 'fr') {
        return '\n\nIMPORTANT: Répondez TOUJOURS strictement en Français. N\'utilisez aucun autre langage, quelle que soit la langue de l\'utilisateur.';
    }
    if (languageMode === 'de') {
        return '\n\nWICHTIG: Antworte IMMER streng auf Deutsch. Verwende keine andere Sprache, unabhängig von der Sprache des Benutzers.';
    }
    if (languageMode === 'pt') {
        return '\n\nIMPORTANTE: Responda SEMPRE estritamente em Português. Não use outro idioma, independentemente da língua do usuário.';
    }
    // Default is 'auto'
    return '\n\nIMPORTANT: Dynamically match and respond in the language of the user who is interacting with you. If they speak Spanish, respond in Spanish. If they speak English, respond in English; if you are unsure, adapt gracefully.';
}

// In-memory turn tracking and cooldown management scoped to channel
const channelTurnCounts = {}; // 'guildId:channelId' -> number
const channelCooldownEndTimes = {}; // 'guildId:channelId' -> timestamp

/**
 * Resolve the Claude model ID from config.
 * Supports both short names ('haiku', 'sonnet', 'opus') and full model IDs.
 */
function resolveClaudeModel(configModel) {
    if (!configModel) return DEFAULT_CLAUDE_MODEL;
    // If it's a short name, look it up
    if (CLAUDE_MODELS[configModel.toLowerCase()]) {
        return CLAUDE_MODELS[configModel.toLowerCase()];
    }
    // If it already looks like a full model ID, use as-is
    if (configModel.startsWith('claude-')) {
        return configModel;
    }
    return DEFAULT_CLAUDE_MODEL;
}

/**
 * Split a message into Discord-safe chunks (max 2000 chars).
 * Tries to split at newlines for readability.
 */
function splitMessage(text, maxLength = 1990) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        // Try to find a newline to split at
        let splitIdx = remaining.lastIndexOf('\n', maxLength);
        if (splitIdx <= 0 || splitIdx < maxLength * 0.5) {
            // Fallback: split at space
            splitIdx = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitIdx <= 0) {
            // Hard split
            splitIdx = maxLength;
        }
        chunks.push(remaining.substring(0, splitIdx));
        remaining = remaining.substring(splitIdx).trimStart();
    }
    return chunks;
}

async function askOpenAI(apiKey, systemPrompt, messageHistory) {
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: DEFAULT_OPENAI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messageHistory
                ],
                max_tokens: 300,
                temperature: 0.8
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        return response.data?.choices?.[0]?.message?.content;
    } catch (err) {
        console.error('[OpenAI API Error]:', err.response?.data || err.message);
        return null;
    }
}

async function askClaude(apiKey, systemPrompt, messageHistory, modelOverride) {
    const model = modelOverride || DEFAULT_CLAUDE_MODEL;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // Convert OpenAI-style message history to Claude format
            const messages = messageHistory.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }));

            // Claude requires alternating user/assistant messages; merge consecutive same-role messages
            const mergedMessages = [];
            for (const msg of messages) {
                if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
                    mergedMessages[mergedMessages.length - 1].content += '\n' + msg.content;
                } else {
                    mergedMessages.push({ ...msg });
                }
            }

            // Ensure first message is from user (Claude requirement)
            if (mergedMessages.length === 0 || mergedMessages[0].role !== 'user') {
                mergedMessages.unshift({ role: 'user', content: '...' });
            }

            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: model,
                    max_tokens: 300,
                    system: systemPrompt,
                    messages: mergedMessages
                },
                {
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    timeout: 20000
                }
            );
            return response.data?.content?.[0]?.text;
        } catch (err) {
            const status = err.response?.status;
            // Retry on rate limit (429) or overloaded (529)
            if ((status === 429 || status === 529) && attempt < MAX_RETRIES - 1) {
                const retryAfter = err.response?.headers?.['retry-after'];
                const delay = retryAfter
                    ? parseInt(retryAfter) * 1000
                    : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
                console.warn(`[Claude API] Rate limited (${status}). Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            console.error('[Claude API Error]:', err.response?.data || err.message);
            return null;
        }
    }
    return null;
}

async function askAI(provider, apiKey, systemPrompt, messageHistory, claudeModel) {
    if (provider === 'claude') {
        return askClaude(apiKey, systemPrompt, messageHistory, claudeModel);
    }
    return askOpenAI(apiKey, systemPrompt, messageHistory);
}

module.exports = function setupAIAgent(client) {
    if (!client.isCustomBot) return;

    // 1. WELCOME GATE EVENT
    client.on('guildMemberAdd', async member => {
        if (client.isCustomBot && member.guild.id !== client.customGuildId) return;

        try {
            const db = await getDb();
            let config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND clientId = ?`, [member.guild.id, client.user.id]);
            if (!config && client.token) {
                config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND botToken = ?`, [member.guild.id, client.token]);
            }
            const welcomeKey = config?.welcomeOpenaiApiKey || config?.openaiApiKey
                || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
            if (!config || config.enabled === 0 || !config.welcomeEnabled || !config.welcomeChannel || !welcomeKey) return;

            // Wait 1.5 seconds for the Discord system join message to appear in the channel
            await new Promise(resolve => setTimeout(resolve, 1500));

            const welcomeChan = member.guild.channels.cache.get(config.welcomeChannel);
            if (!welcomeChan) return;

            welcomeChan.sendTyping().catch(() => {});

            // Construct rich prompt
            let baseInstructions = `Saluda al nuevo miembro "${member.user.username}" (menciónalo usando <@${member.user.id}>) que acaba de unirse al servidor de Discord. Dale una bienvenida extremadamente cálida y divertida acorde a tu personalidad en una sola respuesta corta de Discord.`;
            
            if (config.welcomeMessage) {
                let template = config.welcomeMessage
                    .replace(/{user}/g, `<@${member.user.id}>`)
                    .replace(/{server}/g, member.guild.name)
                    .replace(/{memberCount}/g, member.guild.memberCount);

                baseInstructions = `Saluda al nuevo miembro "${member.user.username}" (menciónalo usando <@${member.user.id}>).
Debes reescribir y transmitir el siguiente mensaje de bienvenida de forma divertida y adaptada completamente a tu personalidad, estilo, tono y rasgos de personaje:
"${template}"
Asegúrate de incluir la mención al usuario <@${member.user.id}> de forma natural en tu respuesta.`;
            }

            const charName = config.welcomeCharacterName || config.characterName || 'Welcome Host';
            const charTraits = config.welcomeCharacterTraits || config.characterTraits || '';

            const systemPrompt = `Eres un personaje de Discord llamado "${charName}".
Tus rasgos y personalidad son:
${charTraits}
 
Instrucciones:
${baseInstructions}${getLanguageInstruction(config.languageMode)}`;

            let provider = config.welcomeProvider || config.aiProvider || 'openai';
            if (welcomeKey.startsWith('sk-ant-')) provider = 'claude';
            else if (welcomeKey.startsWith('sk-proj-') || welcomeKey.startsWith('sk-svc-')) provider = 'openai';

            const claudeModel = resolveClaudeModel(config.claudeModel);
            const welcomeMessage = await askAI(provider, welcomeKey, systemPrompt, [
                { role: 'user', content: `Dale la bienvenida a <@${member.user.id}>` }
            ], claudeModel);

            if (welcomeMessage) {
                // Fetch the last 10 messages in the welcome channel to find the Discord system join message for this user
                const messages = await welcomeChan.messages.fetch({ limit: 10 }).catch(() => null);
                let joinMsg = null;
                if (messages) {
                    joinMsg = messages.find(m => m.author.id === member.id || (m.system && m.type === 7 && m.mentions.users.has(member.id)));
                }

                const chunks = splitMessage(welcomeMessage);
                if (joinMsg) {
                    // Simulates pressing the "Wave to say hi!" system button
                    await joinMsg.react('👋').catch(() => null);
                    await joinMsg.reply({ content: chunks[0] }).catch(() => null);
                } else {
                    await welcomeChan.send({ content: chunks[0] }).catch(() => null);
                }
                // Send remaining chunks if message was long
                for (let i = 1; i < chunks.length; i++) {
                    await welcomeChan.send({ content: chunks[i] }).catch(() => null);
                }
            }
        } catch (e) {
            console.error('[AI Agent Welcome Gate Error]:', e);
        }
    });

    // 2. MESSAGE CREATE EVENT (CHAT & RAG SUPPORT & BOT-TO-BOT)
    client.on('messageCreate', async message => {
        // Enforce custom bot scope and self exclusion
        if (client.isCustomBot && message.guild.id !== client.customGuildId) return;
        if (!message.guild) return;
        if (message.author.id === client.user.id) return;

        try {
            const db = await getDb();
            let config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND clientId = ?`, [message.guild.id, client.user.id]);
            // Fallback: if no config found by clientId, try matching by botToken
            if (!config && client.token) {
                config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ? AND botToken = ?`, [message.guild.id, client.token]);
            }
            if (!config || config.enabled === 0) return;

            const channelKey = `${message.guild.id}:${message.channel.id}`;

            // --- REINICIO POR HUMANO ---
            // If a human writes a message, reset consecutive turns to 0 immediately and lift any active cooldown
            if (!message.author.bot) {
                channelTurnCounts[channelKey] = 0;
                channelCooldownEndTimes[channelKey] = 0;
            }

            // Determine if the message is in a configured channel
            let chatChannels = [];
            try {
                const parsed = JSON.parse(config.chatChannels || '[]');
                chatChannels = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                chatChannels = String(config.chatChannels || '').split(',').map(id => id.trim()).filter(id => id.length > 0);
            }

            let supportKnowledgeChannels = [];
            try {
                const parsed = JSON.parse(config.supportKnowledgeChannels || '[]');
                supportKnowledgeChannels = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                supportKnowledgeChannels = String(config.supportKnowledgeChannels || '').split(',').map(id => id.trim()).filter(id => id.length > 0);
            }
            
            const isChatChannel = config.chatEnabled && chatChannels.includes(message.channel.id);
            const isSupportChannel = config.supportEnabled && config.supportChannel === message.channel.id;
            const isMentioned = message.mentions.has(client.user);

            // If not in a support channel, not in a chat channel, and not explicitly mentioned, ignore
            if (!isChatChannel && !isSupportChannel && !isMentioned) return;

            let chatKey = config.chatOpenaiApiKey || config.openaiApiKey;
            let supportKey = config.supportOpenaiApiKey || config.openaiApiKey;
            
            // Fallback to .env global key if no per-agent key configured
            if (!chatKey) chatKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
            if (!supportKey) supportKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

            // Prevent using corrupted masked keys
            if (chatKey && chatKey.includes('••••')) chatKey = config.openaiApiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
            if (supportKey && supportKey.includes('••••')) supportKey = config.openaiApiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
            if (config.openaiApiKey && config.openaiApiKey.includes('••••')) {
                // Main key is corrupted, try env fallback
                if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return;
            }

            const activeKey = isSupportChannel ? supportKey : chatKey;
            if (!activeKey || activeKey.includes('••••')) return;

            // Handle Cooldown Protection for bot-to-bot chat in chat channels
            if (message.author.bot) {
                // If bot-to-bot chat is disabled, ignore messages from other bots
                if (!config.botToBotChatEnabled || !isChatChannel) return;

                // Check active cooldown
                const cooldownEnd = channelCooldownEndTimes[channelKey] || 0;
                if (Date.now() < cooldownEnd) {
                    console.log(`[AI Agent] Cooldown active in ${message.channel.name}. Ignoring bot message.`);
                    return;
                }

                // Increment consecutive bot turns
                channelTurnCounts[channelKey] = (channelTurnCounts[channelKey] || 0) + 1;

                // Check if loop limit is reached
                if (channelTurnCounts[channelKey] >= config.maxBotTurns) {
                    // Set 5-minute cooldown
                    channelCooldownEndTimes[channelKey] = Date.now() + 5 * 60 * 1000;
                    
                    // Send premium visual alert and in-character message explaining the rest
                    await message.channel.sendTyping().catch(() => {});
                    const chatCharName = config.chatCharacterName || config.characterName || 'Assistant';
                    const chatCharTraits = config.chatCharacterTraits || config.characterTraits || '';
                    const systemPrompt = `Eres el personaje "${chatCharName}".
Tus rasgos y personalidad son:
${chatCharTraits}
 
Instrucciones:
Explica de manera divertida y totalmente metido en tu personaje que has estado hablando demasiado seguido y que te vas a tomar un breve descanso (de exactamente 5 minutos) para tomar aire.${getLanguageInstruction(config.languageMode)}`;

                    let chatProvider = config.chatProvider || config.aiProvider || 'openai';
                    if (chatKey.startsWith('sk-ant-')) chatProvider = 'claude';
                    else if (chatKey.startsWith('sk-proj-') || chatKey.startsWith('sk-svc-')) chatProvider = 'openai';

                    const claudeModel = resolveClaudeModel(config.claudeModel);
                    const cooldownText = await askAI(chatProvider, chatKey, systemPrompt, [
                        { role: 'user', content: 'Di que te vas a tomar un descanso de 5 minutos.' }
                    ], claudeModel);

                    const finalMsg = `⚠️ **[Protección contra Bucles Activada - Pausa de Costes de 5 Minutos]**\n${cooldownText || '¡Vaya, hemos estado chateando demasiado! Me tomaré un respiro de 5 minutos.'}`;
                    await message.channel.send(finalMsg).catch(() => {});
                    return;
                }
            }

            // Build dynamic RAG context if in support channel
            let knowledgeContext = '';
            if (isSupportChannel && supportKnowledgeChannels.length > 0) {
                for (const kbChanId of supportKnowledgeChannels) {
                    const kbChan = message.guild.channels.cache.get(kbChanId);
                    if (kbChan) {
                        const kbMessages = await kbChan.messages.fetch({ limit: 50 }).catch(() => null);
                        if (kbMessages) {
                            const sortedKb = Array.from(kbMessages.values()).reverse();
                            for (const kbMsg of sortedKb) {
                                if (kbMsg.author.bot || !kbMsg.content) continue;
                                knowledgeContext += `[FAQ/Info de #${kbChan.name}] ${kbMsg.author.username}: ${kbMsg.content}\n`;
                            }
                        }
                    }
                }
            }

            // Fetch recent conversation history
            const historyMessages = await message.channel.messages.fetch({ limit: 12 }).catch(() => null);
            const history = [];
            if (historyMessages) {
                const sortedHistory = Array.from(historyMessages.values()).reverse();
                for (const hMsg of sortedHistory) {
                    if (!hMsg.content) continue;
                    // Format message role and clean author name
                    const role = hMsg.author.id === client.user.id ? 'assistant' : 'user';
                    const name = hMsg.author.username.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
                    history.push({
                        role,
                        name: name || 'User',
                        content: hMsg.content
                    });
                }
            }

            // Construct rich system prompt
            const charName = isSupportChannel
                ? (config.supportCharacterName || config.characterName || 'Support Agent')
                : (config.chatCharacterName || config.characterName || 'Chat Agent');
            const charTraits = isSupportChannel
                ? (config.supportCharacterTraits || config.characterTraits || '')
                : (config.chatCharacterTraits || config.characterTraits || '');

            const systemPrompt = `Eres un personaje interactivo de Discord llamado "${charName}".
Tus rasgos y personalidad son:
${charTraits}

Instrucciones de comportamiento:
1. Responde SIEMPRE metido completamente en tu personaje, manteniendo tu tono, estilo y personalidad en cada respuesta.
2. Si estás respondiendo en un canal de soporte, utiliza la siguiente información del servidor para responder la duda de forma precisa e in-character:
--- INICIO INFORMACIÓN OFICIAL ---
${knowledgeContext || 'No hay información oficial disponible en este momento.'}
--- FIN INFORMACIÓN OFICIAL ---
Si la información oficial no responde la duda, explica de forma educada (en tu personaje) que no lo sabes o que un humano administrador deberá responder.

3. Si eres provocado por un humano (ej. si saludan o preguntan), respóndele de manera atenta y salúdale amistosamente.
4. Mantén tus respuestas concisas y adaptadas a Discord (utiliza formato markdown cuando sea apropiado).${getLanguageInstruction(config.languageMode)}`;

            // Start typing animation to look extremely alive and premium
            await message.channel.sendTyping().catch(() => {});
            
            // Introduce a small typing delay for realism (1.5s - 3s)
            await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

            let activeProvider = isSupportChannel 
                ? (config.supportProvider || config.aiProvider || 'openai')
                : (config.chatProvider || config.aiProvider || 'openai');
            
            // Auto-detect provider based on key prefix to prevent mismatch errors
            if (activeKey.startsWith('sk-ant-')) {
                activeProvider = 'claude';
            } else if (activeKey.startsWith('sk-proj-') || activeKey.startsWith('sk-svc-')) {
                activeProvider = 'openai';
            }
            
            // Resolve the Claude model from config
            const claudeModel = resolveClaudeModel(config.claudeModel);

            // Diagnostic logging
            console.log(`[AI Agent Debug] Guild: ${message.guild.id}, Channel: ${message.channel.id}, Provider: ${activeProvider}, Model: ${activeProvider === 'claude' ? claudeModel : DEFAULT_OPENAI_MODEL}, KeyPrefix: ${activeKey ? activeKey.substring(0, 8) + '...' : 'NULL'}, isChatChannel: ${isChatChannel}, isSupportChannel: ${isSupportChannel}, isMentioned: ${isMentioned}`);
            const responseText = await askAI(activeProvider, activeKey, systemPrompt, history, claudeModel);
            if (responseText) {
                // Discord 2000-char limit safety — split into chunks
                const chunks = splitMessage(responseText);
                await message.reply(chunks[0]).catch(err => {
                    console.error('[AI Agent Reply Error]:', err.message);
                });
                // Send remaining chunks as follow-up messages
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]).catch(() => {});
                }
            } else {
                console.error(`[AI Agent] API returned null for guild ${message.guild.id}, provider: ${activeProvider}`);
                await message.reply('⚠️ I tried to respond but my AI brain had a hiccup. Please check the API key configuration in the dashboard.').catch(() => {});
            }
        } catch (e) {
            console.error('[AI Agent Message Handle Error]:', e);
        }
    });
};

// Export model constants for use in commands/dashboard
module.exports.CLAUDE_MODELS = CLAUDE_MODELS;
module.exports.DEFAULT_CLAUDE_MODEL = DEFAULT_CLAUDE_MODEL;
