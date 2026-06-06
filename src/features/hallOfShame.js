const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');

module.exports = function setupHallOfShame(client) {
    async function handleReaction(reaction, user) {
        if (user.bot) return;

        // Resolve partials
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (err) {
                console.error('[Hall of Shame] Error fetching reaction:', err.message);
                return;
            }
        }
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (err) {
                console.error('[Hall of Shame] Error fetching message:', err.message);
                return;
            }
        }

        const { message } = reaction;
        if (!message.guild) return;

        try {
            const db = await getDb();
            const config = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [message.guild.id]);
            if (!config || !config.hallOfShameEnabled) return;

            const configEmoji = config.hallOfShameEmoji || '💀';
            
            // Check if reaction emoji matches configured emoji
            const isMatch = (reaction.emoji.name === configEmoji) || 
                            (reaction.emoji.id === configEmoji) || 
                            (reaction.emoji.toString() === configEmoji);
            if (!isMatch) return;

            const threshold = parseInt(config.hallOfShameThreshold, 10) || 3;
            const shameChannelId = config.hallOfShameChannel;
            if (!shameChannelId) return;

            const shameChannel = message.guild.channels.cache.get(shameChannelId) || 
                                 await message.guild.channels.fetch(shameChannelId).catch(() => null);
            if (!shameChannel) return;

            const count = reaction.count;

            const existingPost = await db.get(
                `SELECT * FROM hall_of_shame_posts WHERE guildId = ? AND originalMessageId = ?`,
                [message.guild.id, message.id]
            );

            if (count >= threshold) {
                const author = message.author;
                const embed = new EmbedBuilder()
                    .setAuthor({ 
                        name: `${author.username} (${author.id})`, 
                        iconURL: author.displayAvatarURL({ dynamic: true }) 
                    })
                    .setDescription(message.content || '*No content*')
                    .setColor('#ef4444') // Red theme
                    .addFields(
                        { name: 'Original', value: `[Go to Message](${message.url})`, inline: true },
                        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true }
                    )
                    .setTimestamp(message.createdAt);

                const attachment = message.attachments.first();
                if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
                    embed.setImage(attachment.url);
                }

                const messageContent = `${configEmoji} **${count}** | <#${message.channel.id}>`;

                if (existingPost) {
                    try {
                        const shameMessage = await shameChannel.messages.fetch(existingPost.shameMessageId);
                        if (shameMessage) {
                            await shameMessage.edit({ content: messageContent, embeds: [embed] });
                        }
                    } catch (err) {
                        // If it was deleted manually, post a new one
                        const newMsg = await shameChannel.send({ content: messageContent, embeds: [embed] });
                        await db.run(
                            `UPDATE hall_of_shame_posts SET shameMessageId = ? WHERE guildId = ? AND originalMessageId = ?`,
                            [newMsg.id, message.guild.id, message.id]
                        );
                    }
                } else {
                    const newMsg = await shameChannel.send({ content: messageContent, embeds: [embed] });
                    await db.run(
                        `INSERT INTO hall_of_shame_posts (guildId, originalMessageId, shameMessageId) VALUES (?, ?, ?)`,
                        [message.guild.id, message.id, newMsg.id]
                    );
                }
            } else {
                // If it falls below threshold, delete it
                if (existingPost) {
                    try {
                        const shameMessage = await shameChannel.messages.fetch(existingPost.shameMessageId);
                        if (shameMessage) {
                            await shameMessage.delete();
                        }
                    } catch (err) {
                        // Ignore if already deleted
                    }
                    await db.run(
                        `DELETE FROM hall_of_shame_posts WHERE guildId = ? AND originalMessageId = ?`,
                        [message.guild.id, message.id]
                    );
                }
            }
        } catch (err) {
            console.error('[Hall of Shame Error]:', err);
        }
    }

    client.on('messageReactionAdd', handleReaction);
    client.on('messageReactionRemove', handleReaction);
};
