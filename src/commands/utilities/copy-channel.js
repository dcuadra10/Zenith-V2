const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

// Helper to remap thread IDs and URLs in message text
function remapContent(content, threadMap, guildId) {
    if (!content) return content;
    let remapped = content;
    
    for (const [oldId, newId] of threadMap.entries()) {
        // Remap mentions: <#oldId> -> <#newId>
        const mentionRegex = new RegExp(`<#${oldId}>`, 'g');
        remapped = remapped.replace(mentionRegex, `<#${newId}>`);
        
        // Remap direct URLs: https://discord.com/channels/guildId/oldId
        // and https://discord.com/channels/guildId/parentId/oldId
        const urlRegex = new RegExp(`https?:\\/\\/discord\\.com\\/channels\\/${guildId}\\/(?:\\d+\\/)?${oldId}`, 'g');
        remapped = remapped.replace(urlRegex, `https://discord.com/channels/${guildId}/${newId}`);
    }
    return remapped;
}

// Helper to remap content inside embeds
function remapEmbed(embed, threadMap, guildId) {
    if (!embed) return embed;
    const builder = EmbedBuilder.from(embed);
    
    if (embed.description) {
        builder.setDescription(remapContent(embed.description, threadMap, guildId));
    }
    
    if (embed.fields && embed.fields.length > 0) {
        builder.setFields(
            embed.fields.map(f => ({
                name: f.name,
                value: remapContent(f.value, threadMap, guildId),
                inline: f.inline
            }))
        );
    }
    
    if (embed.title) {
        builder.setTitle(remapContent(embed.title, threadMap, guildId));
    }
    
    return builder;
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
        .setName('copy-channel')
        .setDescription('Duplicate a text channel along with all its active/archived threads and remap thread links.')
        .addChannelOption(option =>
            option.setName('source')
                .setDescription('The source text channel to duplicate')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the new cloned channel (Optional)')
                .setRequired(false)
        )
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('Target category for the cloned channel (Optional)')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply();
        
        const sourceChannel = interaction.options.getChannel('source');
        const customName = interaction.options.getString('name');
        const targetCategory = interaction.options.getChannel('category');
        
        const guild = interaction.guild;
        const threadMap = new Map(); // oldThreadId -> newThreadId
        
        // 1. Fetch all threads of the source channel paginated
        let allSourceThreads = [];
        try {
            allSourceThreads = await fetchAllChannelThreads(sourceChannel);
        } catch (err) {
            return await interaction.editReply(`❌ Failed to fetch threads from source channel: ${err.message}`);
        }
        
        // 2. Create the destination text channel
        let targetChannel;
        try {
            console.log(`[CLONER] Creating destination text channel...`);
            targetChannel = await guild.channels.create({
                name: customName || `${sourceChannel.name}-copy`,
                type: ChannelType.GuildText,
                parent: targetCategory ? targetCategory.id : sourceChannel.parent?.id,
                topic: sourceChannel.topic,
                rateLimitPerUser: sourceChannel.rateLimitPerUser,
                nsfw: sourceChannel.nsfw,
                permissionOverwrites: sourceChannel.permissionOverwrites.cache.map(p => ({
                    id: p.id,
                    type: p.type,
                    allow: p.allow,
                    deny: p.deny
                })),
                reason: 'Channel clone'
            });
        } catch (err) {
            return await interaction.editReply(`❌ Failed to create cloned channel: ${err.message}`);
        }
        
        await interaction.editReply(`ℹ️ Created target channel ${targetChannel}. Replicating threads...`);
        
        // 3. Replicate all threads in the target channel first to build the mapping
        for (const thread of allSourceThreads) {
            try {
                console.log(`[CLONER] Creating thread ${thread.name} inside ${targetChannel.name}`);
                const newThread = await targetChannel.threads.create({
                    name: thread.name,
                    autoArchiveDuration: thread.autoArchiveDuration,
                    type: thread.type,
                    reason: 'Cloned channel thread'
                });
                
                threadMap.set(thread.id, newThread.id);
            } catch (err) {
                console.error(`Failed to create thread ${thread.name}:`, err);
            }
        }
        
        await interaction.editReply(`ℹ️ Replicated all **${threadMap.size}** threads. Cloning channel messages and remapping links...`);
        
        // 4. Fetch and clone main channel messages paginated
        try {
            const sortedChannelMsgs = await fetchAllMessages(sourceChannel);
            
            for (const msg of sortedChannelMsgs) {
                if (msg.author.bot && msg.webhookId) continue;
                if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) continue;
                
                const finalContent = remapContent(msg.content, threadMap, guild.id);
                const finalEmbeds = msg.embeds.filter(e => e.data && e.data.type === 'rich').map(e => remapEmbed(e, threadMap, guild.id));
                
                let sendContent = finalContent;
                if (!msg.author.bot) {
                    sendContent = finalContent ? `**${msg.author.username}**: ${finalContent}` : `**${msg.author.username}** sent an embed/attachment.`;
                }

                await targetChannel.send({
                    content: sendContent || null,
                    embeds: finalEmbeds.length > 0 ? finalEmbeds : undefined,
                    files: Array.from(msg.attachments.values()).map(a => a.url),
                    components: msg.components && msg.components.length > 0 ? msg.components : undefined
                });
            }
        } catch (err) {
            console.error(`Failed to clone main channel messages:`, err);
        }
        
        await interaction.editReply(`ℹ️ Cloned main channel messages. Replicating message history inside threads...`);
        
        // 5. Replicate messages inside each thread paginated
        for (const thread of allSourceThreads) {
            const newThreadId = threadMap.get(thread.id);
            if (!newThreadId) continue;
            
            try {
                const newThread = await guild.channels.fetch(newThreadId);
                console.log(`[CLONER] Copying messages for thread: ${thread.name}`);
                
                const sortedThreadMsgs = await fetchAllMessages(thread);
                
                for (const msg of sortedThreadMsgs) {
                    if (msg.author.bot && msg.webhookId) continue;
                    if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) continue;
                    
                    const finalContent = remapContent(msg.content, threadMap, guild.id);
                    const finalEmbeds = msg.embeds.filter(e => e.data && e.data.type === 'rich').map(e => remapEmbed(e, threadMap, guild.id));
                    
                    let sendContent = finalContent;
                    if (!msg.author.bot) {
                        sendContent = finalContent ? `**${msg.author.username}**: ${finalContent}` : `**${msg.author.username}** sent an embed/attachment.`;
                    }

                    await newThread.send({
                        content: sendContent || null,
                        embeds: finalEmbeds.length > 0 ? finalEmbeds : undefined,
                        files: Array.from(msg.attachments.values()).map(a => a.url),
                        components: msg.components && msg.components.length > 0 ? msg.components : undefined
                    });
                }
            } catch (err) {
                console.error(`Failed to clone messages inside thread ${thread.name}:`, err);
            }
        }
        
        return await interaction.followUp(`✅ Successfully duplicated ${sourceChannel} to ${targetChannel} with all threads and remapped links!`);
    }
};
