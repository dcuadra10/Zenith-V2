const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

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
    const urlRegex = /https?:\/\/discord\.com\/channels\/\d+\/(?:\d+\/)?(\d+)/g;
    while ((match = urlRegex.exec(text)) !== null) {
        threadIds.add(match[1]);
    }
    
    return Array.from(threadIds);
}

// Helper to clone messages from source thread to target thread
async function cloneThreadMessages(originalThread, targetThread) {
    try {
        const messages = await originalThread.messages.fetch({ limit: 100 });
        const sortedMsgs = Array.from(messages.values()).reverse();
        
        // Skip first message if it was already sent to create the post
        const remainingMsgs = sortedMsgs.slice(1);
        
        for (const msg of remainingMsgs) {
            if (msg.author.bot && msg.webhookId) continue; // Skip bot webhook integration messages
            if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) continue;
            
            await targetThread.send({
                content: `**${msg.author.username}**: ${msg.content || ''}`,
                embeds: msg.embeds,
                files: Array.from(msg.attachments.values()).map(a => a.url)
            });
        }
    } catch (e) {
        console.error(`Failed to clone messages for thread ${originalThread.name}:`, e);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('copy-embed-to-forums')
        .setDescription('Parse an embed or section threads to copy referenced threads into Forum Channels.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The source text channel containing threads or the directory message')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The target category where the new Forum Channels will be created')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('The message ID containing the embed or markdown configuration (Optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply();
        
        const sourceChannel = interaction.options.getChannel('channel');
        const targetCategory = interaction.options.getChannel('category');
        const messageId = interaction.options.getString('message_id');
        
        const guild = interaction.guild;
        const sections = []; // Array of { name: string, threadIds: string[] }
        
        if (messageId) {
            // Method B: Parse markdown headers or embed fields from the message
            try {
                const message = await sourceChannel.messages.fetch(messageId);
                
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
                const activeThreads = await sourceChannel.threads.fetchActive();
                const archivedThreads = await sourceChannel.threads.fetchArchived();
                const allThreads = [
                    ...Array.from(activeThreads.threads.values()),
                    ...Array.from(archivedThreads.threads.values())
                ];
                
                for (const thread of allThreads) {
                    // Check if this thread represents a section by checking its messages for other threads
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
                            name: thread.name,
                            threadIds: Array.from(threadIds)
                        });
                    }
                }
            } catch (err) {
                return await interaction.editReply(`❌ Failed to fetch source channel threads: ${err.message}`);
            }
        }
        
        if (sections.length === 0) {
            return await interaction.editReply('❌ No sections or referenced threads were identified. Make sure threads are properly linked inside the source/embed.');
        }
        
        await interaction.editReply(`ℹ️ Found **${sections.length}** sections to replicate. Starting clone process...`);
        
        for (const section of sections) {
            try {
                // 1. Create the Forum Channel for the Section
                console.log(`[CLONER] Creating forum channel: ${section.name}`);
                const forumChannel = await guild.channels.create({
                    name: section.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 100),
                    type: ChannelType.GuildForum,
                    parent: targetCategory.id,
                    reason: 'Cloned from Section'
                });
                
                // 2. Clone each referenced thread into the forum
                for (const threadId of section.threadIds) {
                    try {
                        const originalThread = await guild.channels.fetch(threadId).catch(() => null);
                        if (!originalThread || !originalThread.isThread()) continue;
                        
                        console.log(`[CLONER] Cloning thread ${originalThread.name} into forum ${forumChannel.name}`);
                        
                        // Fetch messages of original thread
                        const messages = await originalThread.messages.fetch({ limit: 100 });
                        const sortedMsgs = Array.from(messages.values()).reverse();
                        
                        const firstMsg = sortedMsgs[0];
                        if (!firstMsg) continue;
                        
                        // Create the Forum Post (Thread)
                        const post = await forumChannel.threads.create({
                            name: originalThread.name,
                            message: {
                                content: firstMsg.content ? `**${firstMsg.author.username}**: ${firstMsg.content}` : `**${firstMsg.author.username}** created this post.`,
                                embeds: firstMsg.embeds,
                                files: Array.from(firstMsg.attachments.values()).map(a => a.url)
                            }
                        });
                        
                        // Clone the rest of the messages
                        await cloneThreadMessages(originalThread, post);
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
