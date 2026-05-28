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
        
        // 1. Fetch all threads of the source channel
        let allSourceThreads = [];
        try {
            const activeThreads = await sourceChannel.threads.fetchActive();
            const archivedThreads = await sourceChannel.threads.fetchArchived();
            allSourceThreads = [
                ...Array.from(activeThreads.threads.values()),
                ...Array.from(archivedThreads.threads.values())
            ];
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
        
        // 4. Fetch and clone main channel messages
        try {
            const channelMsgs = await sourceChannel.messages.fetch({ limit: 100 });
            const sortedChannelMsgs = Array.from(channelMsgs.values()).reverse();
            
            for (const msg of sortedChannelMsgs) {
                if (msg.author.bot && msg.webhookId) continue;
                if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) continue;
                
                const finalContent = remapContent(msg.content, threadMap, guild.id);
                const finalEmbeds = msg.embeds.map(e => remapEmbed(e, threadMap, guild.id));
                
                await targetChannel.send({
                    content: `**${msg.author.username}**: ${finalContent || ''}`,
                    embeds: finalEmbeds,
                    files: Array.from(msg.attachments.values()).map(a => a.url)
                });
            }
        } catch (err) {
            console.error(`Failed to clone main channel messages:`, err);
        }
        
        await interaction.editReply(`ℹ️ Cloned main channel messages. Replicating message history inside threads...`);
        
        // 5. Replicate messages inside each thread
        for (const thread of allSourceThreads) {
            const newThreadId = threadMap.get(thread.id);
            if (!newThreadId) continue;
            
            try {
                const newThread = await guild.channels.fetch(newThreadId);
                console.log(`[CLONER] Copying messages for thread: ${thread.name}`);
                
                const threadMsgs = await thread.messages.fetch({ limit: 100 });
                const sortedThreadMsgs = Array.from(threadMsgs.values()).reverse();
                
                for (const msg of sortedThreadMsgs) {
                    if (msg.author.bot && msg.webhookId) continue;
                    if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) continue;
                    
                    const finalContent = remapContent(msg.content, threadMap, guild.id);
                    const finalEmbeds = msg.embeds.map(e => remapEmbed(e, threadMap, guild.id));
                    
                    await newThread.send({
                        content: `**${msg.author.username}**: ${finalContent || ''}`,
                        embeds: finalEmbeds,
                        files: Array.from(msg.attachments.values()).map(a => a.url)
                    });
                }
            } catch (err) {
                console.error(`Failed to clone messages inside thread ${thread.name}:`, err);
            }
        }
        
        return await interaction.followUp(`✅ Successfully duplicated ${sourceChannel} to ${targetChannel} with all threads and remapped links!`);
    }
};
