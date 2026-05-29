const { getDb } = require('../config/database');
const axios = require('axios');

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

async function askOpenAI(apiKey, systemPrompt, messageHistory) {
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
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

async function askClaude(apiKey, systemPrompt, messageHistory) {
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
                model: 'claude-3-5-sonnet-latest',
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
                timeout: 15000
            }
        );
        return response.data?.content?.[0]?.text;
    } catch (err) {
        console.error('[Claude API Error]:', err.response?.data || err.message);
        return null;
    }
}

async function askAI(provider, apiKey, systemPrompt, messageHistory) {
    if (provider === 'claude') {
        return askClaude(apiKey, systemPrompt, messageHistory);
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
            const welcomeKey = config?.welcomeOpenaiApiKey || config?.openaiApiKey;
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

            const provider = config.welcomeProvider || config.aiProvider || 'openai';
            const welcomeMessage = await askAI(provider, welcomeKey, systemPrompt, [
                { role: 'user', content: `Dale la bienvenida a <@${member.user.id}>` }
            ]);

            if (welcomeMessage) {
                // Fetch the last 10 messages in the welcome channel to find the Discord system join message for this user
                const messages = await welcomeChan.messages.fetch({ limit: 10 }).catch(() => null);
                let joinMsg = null;
                if (messages) {
                    joinMsg = messages.find(m => m.author.id === member.id || (m.system && m.type === 7 && m.mentions.users.has(member.id)));
                }

                if (joinMsg) {
                    // Simulates pressing the "Wave to say hi!" system button
                    await joinMsg.react('👋').catch(() => null);
                    await joinMsg.reply({ content: welcomeMessage }).catch(() => null);
                } else {
                    await welcomeChan.send({ content: welcomeMessage }).catch(() => null);
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
            const chatChannels = JSON.parse(config.chatChannels || '[]');
            const supportKnowledgeChannels = JSON.parse(config.supportKnowledgeChannels || '[]');
            
            const isChatChannel = config.chatEnabled && chatChannels.includes(message.channel.id);
            const isSupportChannel = config.supportEnabled && config.supportChannel === message.channel.id;
            const isMentioned = message.mentions.has(client.user);

            // If not in a support channel, not in a chat channel, and not explicitly mentioned, ignore
            if (!isChatChannel && !isSupportChannel && !isMentioned) return;

            const chatKey = config.chatOpenaiApiKey || config.openaiApiKey;
            const supportKey = config.supportOpenaiApiKey || config.openaiApiKey;
            const activeKey = isSupportChannel ? supportKey : chatKey;
            if (!activeKey) return;

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

                    const chatProvider = config.chatProvider || config.aiProvider || 'openai';
                    const cooldownText = await askAI(chatProvider, chatKey, systemPrompt, [
                        { role: 'user', content: 'Di que te vas a tomar un descanso de 5 minutos.' }
                    ]);

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

            const activeProvider = isSupportChannel 
                ? (config.supportProvider || config.aiProvider || 'openai')
                : (config.chatProvider || config.aiProvider || 'openai');
            
            // Diagnostic logging
            console.log(`[AI Agent Debug] Guild: ${message.guild.id}, Channel: ${message.channel.id}, Provider: ${activeProvider}, KeyPrefix: ${activeKey ? activeKey.substring(0, 8) + '...' : 'NULL'}, isChatChannel: ${isChatChannel}, isSupportChannel: ${isSupportChannel}, isMentioned: ${isMentioned}`);
            const responseText = await askAI(activeProvider, activeKey, systemPrompt, history);
            if (responseText) {
                await message.reply(responseText).catch(err => {
                    console.error('[AI Agent Reply Error]:', err.message);
                });
            } else {
                console.error(`[AI Agent] API returned null for guild ${message.guild.id}, provider: ${activeProvider}`);
                await message.reply('⚠️ I tried to respond but my AI brain had a hiccup. Please check the API key configuration in the dashboard.').catch(() => {});
            }
        } catch (e) {
            console.error('[AI Agent Message Handle Error]:', e);
        }
    });
};
