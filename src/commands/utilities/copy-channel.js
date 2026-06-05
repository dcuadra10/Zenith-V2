const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');

// Helper to remap thread IDs and URLs in message text
function remapContent(content, threadMap, sourceGuildId, targetGuildId) {
    if (!content) return content;
    let remapped = content;
    
    for (const [oldId, newId] of threadMap.entries()) {
        // Remap mentions: <#oldId> -> <#newId>
        const mentionRegex = new RegExp(`<#${oldId}>`, 'g');
        remapped = remapped.replace(mentionRegex, `<#${newId}>`);
        
        // Remap direct URLs: https://discord.com/channels/guildId/oldId
        // and https://discord.com/channels/guildId/parentId/oldId
        const urlRegex = new RegExp(`https?:\\/\\/(?:ptb\\.|canary\\.)?discord(?:app)?\\.com\\/channels\\/${sourceGuildId}\\/(?:\\d+\\/)?${oldId}`, 'g');
        remapped = remapped.replace(urlRegex, `https://discord.com/channels/${targetGuildId}/${newId}`);
    }
    return remapped;
}

// Helper to remap content inside embeds
function remapEmbed(embed, threadMap, sourceGuildId, targetGuildId) {
    if (!embed) return embed;
    try {
        const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
        
        if (data.description) data.description = remapContent(data.description, threadMap, sourceGuildId, targetGuildId);
        if (data.title) data.title = remapContent(data.title, threadMap, sourceGuildId, targetGuildId);
        if (data.url) data.url = remapContent(data.url, threadMap, sourceGuildId, targetGuildId);
        
        if (data.fields && data.fields.length > 0) {
            data.fields = data.fields.map(f => ({
                ...f,
                name: remapContent(f.name, threadMap, sourceGuildId, targetGuildId),
                value: remapContent(f.value, threadMap, sourceGuildId, targetGuildId)
            }));
        }
        
        if (data.author) {
            if (data.author.name) data.author.name = remapContent(data.author.name, threadMap, sourceGuildId, targetGuildId);
            if (data.author.url) data.author.url = remapContent(data.author.url, threadMap, sourceGuildId, targetGuildId);
        }
        
        if (data.footer && data.footer.text) {
            data.footer.text = remapContent(data.footer.text, threadMap, sourceGuildId, targetGuildId);
        }
        
        return data;
    } catch (e) {
        console.error('Embed remap error', e);
        return embed;
    }
}

// Helper to remap URLs inside message components (Buttons)
function remapComponents(components, threadMap, sourceGuildId, targetGuildId) {
    if (!components || components.length === 0) return undefined;
    try {
        return components.map(row => {
            const rowData = typeof row.toJSON === 'function' ? row.toJSON() : row;
            if (rowData.components) {
                rowData.components = rowData.components.map(comp => {
                    // Type 2 = Button, Style 5 = Link Button
                    if (comp.type === 2 && comp.style === 5 && comp.url) {
                        comp.url = remapContent(comp.url, threadMap, sourceGuildId, targetGuildId);
                    }
                    return comp;
                });
            }
            return rowData;
        });
    } catch (e) {
        console.error('Failed to remap components', e);
        return undefined;
    }
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
                .setDescription('The source text channel to duplicate (In this server)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('source_url')
                .setDescription('Channel ID or URL from another server (Optional)')
                .setRequired(false)
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
        
        let sourceChannel = interaction.options.getChannel('source');
        const sourceUrl = interaction.options.getString('source_url');
        const customName = interaction.options.getString('name');
        const targetCategory = interaction.options.getChannel('category');
        
        if (!sourceChannel && !sourceUrl) {
            return await interaction.editReply('❌ You must provide either a `source` channel or a `source_url`.');
        }

        if (sourceUrl) {
            try {
                const urlMatch = sourceUrl.match(/https?:\/\/discord\.com\/channels\/(\d+)\/(\d+)/);
                let channelId = sourceUrl;
                
                if (urlMatch) {
                    const srcGuild = interaction.client.guilds.cache.get(urlMatch[1]);
                    if (!srcGuild) throw new Error('El bot no está en el servidor de origen (debe estar en ambos).');
                    channelId = urlMatch[2];
                }
                
                sourceChannel = await interaction.client.channels.fetch(channelId);
                if (!sourceChannel) throw new Error('Canal de origen no encontrado.');
            } catch (err) {
                return await interaction.editReply(`❌ Error al buscar el canal: ${err.message}`);
            }
        }

        const guild = interaction.guild;
        const isSameGuild = sourceChannel.guildId === guild.id;
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
            let overwrites = [];
            if (isSameGuild) {
                overwrites = sourceChannel.permissionOverwrites.cache.map(p => ({
                    id: p.id,
                    type: p.type,
                    allow: p.allow,
                    deny: p.deny
                }));
            }

            targetChannel = await guild.channels.create({
                name: customName || `${sourceChannel.name}-copy`,
                type: ChannelType.GuildText,
                parent: targetCategory ? targetCategory.id : (isSameGuild ? sourceChannel.parent?.id : null),
                topic: sourceChannel.topic,
                rateLimitPerUser: sourceChannel.rateLimitPerUser,
                nsfw: sourceChannel.nsfw,
                permissionOverwrites: overwrites,
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
                if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) continue;
                
                const finalContent = remapContent(msg.content, threadMap, sourceChannel.guildId, guild.id);
                const finalEmbeds = msg.embeds
                    .map(e => remapEmbed(e, threadMap, sourceChannel.guildId, guild.id))
                    .filter(e => e && (e.title || e.description || (e.fields && e.fields.length > 0) || e.image || e.author));
                
                let sendContent = finalContent;
                if (!msg.author.bot) {
                    sendContent = finalContent ? `**${msg.author.username}**: ${finalContent}` : `**${msg.author.username}** sent an embed/attachment.`;
                } else if (!sendContent && finalEmbeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) {
                    continue;
                }

                try {
                    const payload = {
                        content: sendContent || null,
                        embeds: finalEmbeds.length > 0 ? finalEmbeds : undefined,
                        files: Array.from(msg.attachments.values()).map(a => a.url),
                        components: remapComponents(msg.components, threadMap, sourceChannel.guildId, guild.id)
                    };
                    
                    try {
                        await targetChannel.send(payload);
                    } catch (sendErr) {
                        console.error(`[CLONER] Failed to send msg ${msg.id}, retrying without files/components:`, sendErr.message);
                        payload.files = undefined;
                        payload.components = undefined;
                        await targetChannel.send(payload).catch(e => console.error(`[CLONER] Final retry failed for msg ${msg.id}:`, e.message));
                    }
                } catch (err) {
                    console.error(`[CLONER] Unhandled error processing msg ${msg.id}:`, err);
                }
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
                    if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) continue;
                    
                    const finalContent = remapContent(msg.content, threadMap, sourceChannel.guildId, guild.id);
                    const finalEmbeds = msg.embeds
                        .map(e => remapEmbed(e, threadMap, sourceChannel.guildId, guild.id))
                        .filter(e => e && (e.title || e.description || (e.fields && e.fields.length > 0) || e.image || e.author));
                    
                    let sendContent = finalContent;
                    if (!msg.author.bot) {
                        sendContent = finalContent ? `**${msg.author.username}**: ${finalContent}` : `**${msg.author.username}** sent an embed/attachment.`;
                    } else if (!sendContent && finalEmbeds.length === 0 && msg.attachments.size === 0 && msg.components.length === 0) {
                        continue;
                    }

                    try {
                        const payload = {
                            content: sendContent || null,
                            embeds: finalEmbeds.length > 0 ? finalEmbeds : undefined,
                            files: Array.from(msg.attachments.values()).map(a => a.url),
                            components: remapComponents(msg.components, threadMap, sourceChannel.guildId, guild.id)
                        };
                        try {
                            await newThread.send(payload);
                        } catch (sendErr) {
                            payload.files = undefined;
                            payload.components = undefined;
                            await newThread.send(payload).catch(() => {});
                        }
                    } catch (err) {}
                }
                
                if (thread.archived) {
                    try {
                        await newThread.setArchived(true, 'Cloned archived thread');
                    } catch (archiveErr) {
                        console.error(`Failed to archive thread ${newThread.name}:`, archiveErr.message);
                    }
                }
            } catch (err) {
                console.error(`Failed to clone messages inside thread ${thread.name}:`, err);
            }
        }
        
        return await interaction.followUp(`✅ Successfully duplicated ${sourceChannel} to ${targetChannel} with all threads and remapped links!`);
    }
};
