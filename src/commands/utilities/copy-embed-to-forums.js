const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

function cloneEmbed(embed) {
    if (!embed) return embed;
    try {
        return typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    } catch (e) { return embed; }
}

function cloneComponents(components) {
    if (!components || components.length === 0) return undefined;
    try {
        return components.map(row => typeof row.toJSON === 'function' ? row.toJSON() : row);
    } catch (e) { return undefined; }
}

// Helper to extract thread IDs from a block of text
function extractThreadIds(text) {
    if (!text) return [];
    const threadIds = new Set();
    
    // Pattern 1: Mentions like <#123456789012345678>
    const mentionRegex = /<#(\d+)>/g;
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
        threadIds.add(match[1]);
    }
    
    // Pattern 2: Direct thread URLs
    const urlRegex = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/\d+\/(?:\d+\/)?(\d+)/g;
    while ((match = urlRegex.exec(text)) !== null) {
        threadIds.add(match[1]);
    }
    
    return Array.from(threadIds);
}

// Helper to fetch all messages in a channel/thread chronologically (oldest first)
async function fetchAllMessages(channel) {
    const allMessages = [];
    let lastId = null;
    while (true) {
        try {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;
            allMessages.push(...messages.values());
            lastId = messages.lastKey();
            if (messages.size < 100) break;
        } catch (e) {
            console.error(`Failed to fetch messages for ${channel.name || channel.id}:`, e);
            break;
        }
    }
    return allMessages.reverse();
}

// Helper to fetch all active and archived threads in a text channel
async function fetchAllChannelThreads(sourceChannel) {
    const allThreads = [];
    
    // 1. Fetch active threads
    try {
        const active = await sourceChannel.threads.fetchActive();
        allThreads.push(...active.threads.values());
    } catch (err) {
        console.error('Error fetching active threads:', err);
    }
    
    // 2. Fetch public archived threads in pagination loop
    try {
        let hasMore = true;
        let before = null;
        while (hasMore) {
            const options = { type: 'public', limit: 100 };
            if (before) options.before = before;
            const fetched = await sourceChannel.threads.fetchArchived(options);
            allThreads.push(...fetched.threads.values());
            hasMore = fetched.hasMore;
            if (fetched.threads.size > 0) {
                before = fetched.threads.lastKey();
            } else {
                hasMore = false;
            }
        }
    } catch (err) {
        console.error('Error fetching public archived threads:', err);
    }
    
    // 3. Fetch private archived threads in pagination loop
    try {
        let hasMore = true;
        let before = null;
        while (hasMore) {
            const options = { type: 'private', limit: 100 };
            if (before) options.before = before;
            const fetched = await sourceChannel.threads.fetchArchived(options);
            allThreads.push(...fetched.threads.values());
            hasMore = fetched.hasMore;
            if (fetched.threads.size > 0) {
                before = fetched.threads.lastKey();
            } else {
                hasMore = false;
            }
        }
    } catch (err) {
        console.warn('Skipped private archived threads:', err.message);
    }
    
    return allThreads;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('copy-embed-to-forums')
        .setDescription('Parse an embed or section threads to copy referenced threads into Forum Channels.')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The target category where the new Forum Channels will be created')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The source text channel containing threads or the directory message')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('source_url')
                .setDescription('Channel ID or URL from another server (Optional)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('The message ID or URL containing the embed configuration (Optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply();
        
        let sourceChannel = interaction.options.getChannel('channel');
        const sourceUrl = interaction.options.getString('source_url');
        const targetCategory = interaction.options.getChannel('category');
        const messageId = interaction.options.getString('message_id');
        
        if (!sourceChannel && !sourceUrl) {
            return await interaction.editReply('❌ You must provide either a `channel` or a `source_url`.');
        }

        if (sourceUrl) {
            try {
                const urlMatch = sourceUrl.match(/https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/);
                let channelId = sourceUrl;
                
                if (urlMatch) {
                    let srcGuild = interaction.client.guilds.cache.get(urlMatch[1]);
                    if (!srcGuild) {
                        try {
                            srcGuild = await interaction.client.guilds.fetch(urlMatch[1]);
                        } catch (e) {
                            throw new Error('El bot no está en el servidor de origen (debe estar en ambos).');
                        }
                    }
                    channelId = urlMatch[2];
                }
                
                sourceChannel = await interaction.client.channels.fetch(channelId);
                if (!sourceChannel) throw new Error('Canal de origen no encontrado.');
            } catch (err) {
                return await interaction.editReply(`❌ Error al buscar el canal: ${err.message}`);
            }
        }

        const guild = interaction.guild;
        const sections = []; // Array of { id?: string, name: string, threadIds: string[] }
        const allReferencedThreadIds = new Set();
        
        if (messageId) {
            // Method B: Parse markdown headers or embed fields from the message
            try {
                let message = null;
                const urlMatch = messageId.match(/https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
                
                if (urlMatch) {
                    let srcGuild = interaction.client.guilds.cache.get(urlMatch[1]);
                    if (!srcGuild) {
                        try {
                            srcGuild = await interaction.client.guilds.fetch(urlMatch[1]);
                        } catch (e) {
                            throw new Error('Bot is not in the source server.');
                        }
                    }
                    const srcChan = await interaction.client.channels.fetch(urlMatch[2]);
                    if (!srcChan) throw new Error('Source channel not found.');
                    message = await srcChan.messages.fetch(urlMatch[3]);
                } else {
                    message = await sourceChannel.messages.fetch(messageId);
                }
                
                // 1. Check message content for markdown headers (# or ##)
                const content = message.content || '';
                if (content.includes('#')) {
                    const lines = content.split('\n');
                    let currentSection = null;
                    
                    for (const line of lines) {
                        const headerMatch = line.match(/^(?:##?|###)\s+(.+)$/);
                        if (headerMatch) {
                            if (currentSection) sections.push(currentSection);
                            currentSection = { name: headerMatch[1].trim(), threadIds: [] };
                        } else if (currentSection) {
                            const ids = extractThreadIds(line);
                            currentSection.threadIds.push(...ids);
                        }
                    }
                    if (currentSection) sections.push(currentSection);
                }
                
                // 2. Parse from embeds (first embed description & fields)
                if (message.embeds && message.embeds.length > 0) {
                    const embed = message.embeds[0];
                    
                    // Parse description if it has headers
                    const desc = embed.description || '';
                    if (desc.includes('#')) {
                        const lines = desc.split('\n');
                        let currentSection = null;
                        
                        for (const line of lines) {
                            const headerMatch = line.match(/^(?:##?|###)\s+(.+)$/);
                            if (headerMatch) {
                                if (currentSection) sections.push(currentSection);
                                currentSection = { name: headerMatch[1].trim(), threadIds: [] };
                            } else if (currentSection) {
                                const ids = extractThreadIds(line);
                                currentSection.threadIds.push(...ids);
                            }
                        }
                        if (currentSection) sections.push(currentSection);
                    }
                    
                    // Parse fields
                    if (embed.fields && embed.fields.length > 0) {
                        for (const field of embed.fields) {
                            const ids = extractThreadIds(field.value);
                            if (ids.length > 0) {
                                sections.push({
                                    name: field.name.replace(/[#*`_~]/g, '').trim(),
                                    threadIds: ids
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                return await interaction.editReply(`❌ Failed to fetch or parse the message: ${err.message}`);
            }
        } else {
            // Method A: Parse from active/archived threads in the source channel
            try {
                const allThreads = await fetchAllChannelThreads(sourceChannel);
                
                for (const thread of allThreads) {
                    // Check if this thread represents a section by checking its messages for other threads
                    // We fetch up to 50 messages to check for references
                    const msgs = await thread.messages.fetch({ limit: 50 });
                    const threadIds = new Set();
                    
                    for (const msg of msgs.values()) {
                        const ids = extractThreadIds(msg.content);
                        ids.forEach(id => {
                            if (id !== thread.id) threadIds.add(id); // Don't include the section thread itself
                        });
                        
                        if (msg.embeds && msg.embeds.length > 0) {
                            const embed = msg.embeds[0];
                            const descIds = extractThreadIds(embed.description);
                            descIds.forEach(id => {
                                if (id !== thread.id) threadIds.add(id);
                            });
                            
                            if (embed.fields) {
                                for (const field of embed.fields) {
                                    const fieldIds = extractThreadIds(field.value);
                                    fieldIds.forEach(id => {
                                        if (id !== thread.id) threadIds.add(id);
                                    });
                                }
                            }
                        }
                    }
                    
                    if (threadIds.size > 0) {
                        sections.push({
                            id: thread.id,
                            name: thread.name,
                            threadIds: Array.from(threadIds)
                        });
                        // Track which threads are referenced
                        threadIds.forEach(id => allReferencedThreadIds.add(id));
                    }
                }
            } catch (err) {
                return await interaction.editReply(`❌ Failed to fetch source channel threads: ${err.message}`);
            }
        }
        
        // Filter sections: if a thread is referenced as a sub-thread in any other section, it is a TOPIC, not a SECTION!
        // We only filter for Method A, since Method B has explicit header structures.
        const finalSections = messageId ? sections : sections.filter(section => !allReferencedThreadIds.has(section.id));
        
        if (finalSections.length === 0) {
            return await interaction.editReply('❌ No sections or referenced threads were identified. Make sure threads are properly linked inside the source/embed.');
        }
        
        await interaction.editReply(`ℹ️ Found **${finalSections.length}** sections to replicate. Starting clone process...`);
        
        for (const section of finalSections) {
            try {
                let forumName = section.name.toLowerCase()
                    .replace(/[^a-z0-9-_]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 100);
                if (!forumName) {
                    forumName = `forum-${section.id || Math.floor(Math.random() * 10000)}`;
                }

                console.log(`[CLONER] Creating forum channel: ${forumName}`);
                const forumChannel = await guild.channels.create({
                    name: forumName,
                    type: ChannelType.GuildForum,
                    parent: targetCategory.id,
                    reason: 'Cloned from Section'
                });
                
                // 2. Clone each referenced thread into the forum
                for (const threadId of section.threadIds) {
                    try {
                        const originalThread = await interaction.client.channels.fetch(threadId).catch(() => null);
                        if (!originalThread || !originalThread.isThread()) continue;
                        
                        console.log(`[CLONER] Cloning thread ${originalThread.name} into forum ${forumChannel.name}`);
                        
                        // Fetch ALL messages of original thread chronologically (oldest first)
                        const sortedMsgs = await fetchAllMessages(originalThread);
                        const firstMsg = sortedMsgs[0];
                        if (!firstMsg) continue;
                        
                        const finalFirstEmbeds = firstMsg.embeds
                            .filter(e => e.data && (e.data.type === 'rich' || e.data.title || e.data.description || e.data.fields || e.data.image || e.data.author))
                            .map(cloneEmbed);
                        let firstSendContent = firstMsg.content;
                        if (!firstMsg.author.bot) {
                            firstSendContent = firstMsg.content ? `**${firstMsg.author.username}**: ${firstMsg.content}` : `**${firstMsg.author.username}** created this post.`;
                        } else if (!firstSendContent && finalFirstEmbeds.length === 0 && firstMsg.attachments.size === 0 && firstMsg.components.length === 0) {
                            firstSendContent = `**${firstMsg.author.username}** created this post.`;
                        }

                        // Create the Forum Post (Thread)
                        let post;
                        const postName = originalThread.name.slice(0, 100) || 'Untitled Post';
                        try {
                            post = await forumChannel.threads.create({
                                name: postName,
                                message: {
                                    content: firstSendContent || null,
                                    embeds: finalFirstEmbeds.length > 0 ? finalFirstEmbeds : undefined,
                                    files: Array.from(firstMsg.attachments.values()).map(a => a.url),
                                    components: cloneComponents(firstMsg.components)
                                }
                            });
                        } catch (err) {
                            console.error(`Failed to create forum post for ${postName}:`, err.message);
                            post = await forumChannel.threads.create({
                                name: postName,
                                message: {
                                    content: firstSendContent || null,
                                    embeds: finalFirstEmbeds.length > 0 ? finalFirstEmbeds : undefined
                                }
                            }).catch(() => null);
                        }
                        
                        if (!post) continue;
                        
                        // Clone the rest of the messages
                        for (const msg of sortedMsgs.slice(1)) {
                            if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) continue;
                            
                            const finalEmbeds = msg.embeds
                                .filter(e => e.data && (e.data.type === 'rich' || e.data.title || e.data.description || e.data.fields || e.data.image || e.data.author))
                                .map(cloneEmbed);
                            let sendContent = msg.content;
                            if (!msg.author.bot) {
                                sendContent = msg.content ? `**${msg.author.username}**: ${msg.content}` : `**${msg.author.username}** sent an embed/attachment.`;
                            } else if (!sendContent && finalEmbeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) {
                                continue;
                            }

                            const payload = {
                                content: sendContent || null,
                                embeds: finalEmbeds.length > 0 ? finalEmbeds : undefined,
                                files: Array.from(msg.attachments.values()).map(a => a.url),
                                components: cloneComponents(msg.components)
                            };
                            
                            try {
                                await post.send(payload);
                            } catch (err) {
                                payload.files = undefined;
                                payload.components = undefined;
                                await post.send(payload).catch(() => {});
                            }
                        }
                    } catch (threadErr) {
                        console.error(`Error cloning thread ${threadId}:`, threadErr);
                    }
                }
            } catch (sectionErr) {
                console.error(`Error creating forum channel for section ${section.name}:`, sectionErr);
            }
        }
        
        return await interaction.followUp('✅ Replicated all sections into new Forum Channels successfully!');
    }
};
