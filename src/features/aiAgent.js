const { getDb } = require('../config/database');
const axios = require('axios');

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

module.exports = function setupAIAgent(client) {
    // 1. WELCOME GATE EVENT
    client.on('guildMemberAdd', async member => {
        if (!client.isCustomBot || member.guild.id !== client.customGuildId) return;

        try {
            const db = await getDb();
            const config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ?`, [member.guild.id]);
            if (!config || config.enabled === 0 || !config.welcomeEnabled || !config.welcomeChannel || !config.openaiApiKey) return;

            const welcomeChan = member.guild.channels.cache.get(config.welcomeChannel);
            if (!welcomeChan) return;

            welcomeChan.sendTyping().catch(() => {});

            const systemPrompt = `Eres un personaje de Discord llamado "${config.characterName}".
Tus rasgos y personalidad son:
${config.characterTraits}

Instrucciones:
Saluda al nuevo miembro "${member.user.username}" (menciónalo usando <@${member.user.id}>) que acaba de unirse al servidor de Discord. Dale una bienvenida extremadamente cálida y divertida acorde a tu personalidad en una sola respuesta corta de Discord.`;

            const welcomeMessage = await askOpenAI(config.openaiApiKey, systemPrompt, [
                { role: 'user', content: `Dale la bienvenida a <@${member.user.id}>` }
            ]);

            if (welcomeMessage) {
                await welcomeChan.send(welcomeMessage);
            }
        } catch (e) {
            console.error('[AI Agent Welcome Gate Error]:', e);
        }
    });

    // 2. MESSAGE CREATE EVENT (CHAT & RAG SUPPORT & BOT-TO-BOT)
    client.on('messageCreate', async message => {
        // Enforce custom bot scope and self exclusion
        if (!client.isCustomBot || !message.guild || message.guild.id !== client.customGuildId) return;
        if (message.author.id === client.user.id) return;

        try {
            const db = await getDb();
            const config = await db.get(`SELECT * FROM ai_agent_configs WHERE guildId = ?`, [message.guild.id]);
            if (!config || config.enabled === 0 || !config.openaiApiKey) return;

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
                    const systemPrompt = `Eres el personaje "${config.characterName}".
Tus rasgos y personalidad son:
${config.characterTraits}

Instrucciones:
Explica de manera divertida y totalmente metido en tu personaje que has estado hablando demasiado seguido y que te vas a tomar un breve descanso (de exactamente 5 minutos) para tomar aire.`;

                    const cooldownText = await askOpenAI(config.openaiApiKey, systemPrompt, [
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
            const systemPrompt = `Eres un personaje interactivo de Discord llamado "${config.characterName}".
Tus rasgos y personalidad son:
${config.characterTraits}

Instrucciones de comportamiento:
1. Responde SIEMPRE metido completamente en tu personaje, manteniendo tu tono, estilo y personalidad en cada respuesta.
2. Si estás respondiendo en un canal de soporte, utiliza la siguiente información del servidor para responder la duda de forma precisa e in-character:
--- INICIO INFORMACIÓN OFICIAL ---
${knowledgeContext || 'No hay información oficial disponible en este momento.'}
--- FIN INFORMACIÓN OFICIAL ---
Si la información oficial no responde la duda, explica de forma educada (en tu personaje) que no lo sabes o que un humano administrador deberá responder.

3. Si eres provocado por un humano (ej. si saludan o preguntan), respóndele de manera atenta y salúdale amistosamente.
4. Mantén tus respuestas concisas y adaptadas a Discord (utiliza formato markdown cuando sea apropiado).`;

            // Start typing animation to look extremely alive and premium
            await message.channel.sendTyping().catch(() => {});
            
            // Introduce a small typing delay for realism (1.5s - 3s)
            await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

            const responseText = await askOpenAI(config.openaiApiKey, systemPrompt, history);
            if (responseText) {
                await message.reply(responseText).catch(() => {});
            }
        } catch (e) {
            console.error('[AI Agent Message Handle Error]:', e);
        }
    });
};
