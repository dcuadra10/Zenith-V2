const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');

async function getLogChannel(guild) {
    if (!guild) return null;
    try {
        const db = await getDb();
        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [guild.id]);
        if (!conf || !conf.loggingEnabled || !conf.loggingChannel) return null;
        return { channel: guild.channels.cache.get(conf.loggingChannel), conf };
    } catch (e) {
        return null;
    }
}

module.exports = function setupLogging(client) {
    // Message Deleted
    client.on('messageDelete', async message => {
        let authorInfo = 'Unknown User';
        let contentInfo = '[Uncached Message Content]';
        
        if (!message.partial) {
            if (message.author?.bot) return;
            authorInfo = `${message.author} (${message.author.tag})`;
            contentInfo = message.content || '[Embed / Attachment]';
        } else {
            if (message.author) {
                if (message.author.bot) return;
                authorInfo = `${message.author} (${message.author.tag})`;
            }
        }

        const res = await getLogChannel(message.guild);
        if (!res || !res.conf.logDeletes || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Message Deleted')
            .setDescription(`**Author:** ${authorInfo}\n**Channel:** ${message.channel}\n**Content:** ${contentInfo}`)
            .setColor('#e74c3c')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Message Edited
    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (oldMessage.partial) {
            const res = await getLogChannel(newMessage.guild);
            if (!res || !res.conf.logEdits || !res.channel) return;
            if (newMessage.author?.bot) return;
            
            const embed = new EmbedBuilder()
                .setTitle('Message Edited (Uncached)')
                .setDescription(`**Author:** ${newMessage.author} (${newMessage.author.tag})\n**Channel:** ${newMessage.channel}\n\n*Old content was not cached.*\n**New:** ${newMessage.content || '[None]'}`)
                .setColor('#f39c12')
                .setTimestamp();
            res.channel.send({ embeds: [embed] }).catch(()=>{});
            return;
        }

        if (!oldMessage.guild || oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        
        const res = await getLogChannel(oldMessage.guild);
        if (!res || !res.conf.logEdits || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Message Edited')
            .setDescription(`**Author:** ${oldMessage.author} (${oldMessage.author.tag})\n**Channel:** ${oldMessage.channel}\n\n**Old:** ${oldMessage.content || '[None]'}\n**New:** ${newMessage.content || '[None]'}`)
            .setColor('#f39c12')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Member Joined
    client.on('guildMemberAdd', async member => {
        const res = await getLogChannel(member.guild);
        if (!res || !res.conf.logMembers || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Joined')
            .setDescription(`**User:** ${member} (${member.user.tag})\n**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
            .setColor('#2ecc71')
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Member Left
    client.on('guildMemberRemove', async member => {
        const res = await getLogChannel(member.guild);
        if (!res || !res.conf.logMembers || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Left')
            .setDescription(`**User:** ${member} (${member.user.tag})`)
            .setColor('#c0392b')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Member Banned
    client.on('guildBanAdd', async ban => {
        const res = await getLogChannel(ban.guild);
        if (!res || !res.conf.logBans || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Banned')
            .setDescription(`**User:** ${ban.user} (${ban.user.tag})\n**Reason:** ${ban.reason || 'None provided'}`)
            .setColor('#8e44ad')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Member Unbanned
    client.on('guildBanRemove', async ban => {
        const res = await getLogChannel(ban.guild);
        if (!res || !res.conf.logBans || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Unbanned')
            .setDescription(`**User:** ${ban.user} (${ban.user.tag})`)
            .setColor('#2ecc71')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Role Created
    client.on('roleCreate', async role => {
        const res = await getLogChannel(role.guild);
        if (!res || !res.conf.logRoles || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Role Created')
            .setDescription(`**Role:** ${role} (${role.name})\n**ID:** ${role.id}`)
            .setColor('#2ecc71')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Role Deleted
    client.on('roleDelete', async role => {
        const res = await getLogChannel(role.guild);
        if (!res || !res.conf.logRoles || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Role Deleted')
            .setDescription(`**Role Name:** ${role.name}\n**ID:** ${role.id}`)
            .setColor('#c0392b')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Role Updated
    client.on('roleUpdate', async (oldRole, newRole) => {
        const res = await getLogChannel(newRole.guild);
        if (!res || !res.conf.logRoles || !res.channel) return;

        const changes = [];
        if (oldRole.name !== newRole.name) {
            changes.push(`**Name:** \`${oldRole.name}\` ➡️ \`${newRole.name}\``);
        }
        if (oldRole.hexColor !== newRole.hexColor) {
            changes.push(`**Color:** \`${oldRole.hexColor}\` ➡️ \`${newRole.hexColor}\``);
        }
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
            changes.push(`**Permissions:** Changed (bitfield: \`${oldRole.permissions.bitfield}\` ➡️ \`${newRole.permissions.bitfield}\`)`);
        }

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('Role Updated')
            .setDescription(`**Role:** ${newRole}\n**ID:** ${newRole.id}\n\n**Changes:**\n${changes.join('\n')}`)
            .setColor('#f39c12')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Channel Created
    client.on('channelCreate', async channel => {
        if (!channel.guild) return;
        const res = await getLogChannel(channel.guild);
        if (!res || !res.conf.logChannels || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Channel Created')
            .setDescription(`**Channel:** ${channel} (${channel.name})\n**Type:** ${channel.type}\n**ID:** ${channel.id}`)
            .setColor('#2ecc71')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Channel Deleted
    client.on('channelDelete', async channel => {
        if (!channel.guild) return;
        const res = await getLogChannel(channel.guild);
        if (!res || !res.conf.logChannels || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Channel Deleted')
            .setDescription(`**Channel Name:** ${channel.name}\n**Type:** ${channel.type}\n**ID:** ${channel.id}`)
            .setColor('#c0392b')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Channel Updated
    client.on('channelUpdate', async (oldChannel, newChannel) => {
        if (!newChannel.guild) return;
        const res = await getLogChannel(newChannel.guild);
        if (!res || !res.conf.logChannels || !res.channel) return;

        const changes = [];
        if (oldChannel.name !== newChannel.name) {
            changes.push(`**Name:** \`${oldChannel.name}\` ➡️ \`${newChannel.name}\``);
        }
        if (oldChannel.topic !== newChannel.topic) {
            changes.push(`**Topic:** \`${oldChannel.topic || '[None]'}\` ➡️ \`${newChannel.topic || '[None]'}\``);
        }
        if (oldChannel.parentId !== newChannel.parentId) {
            changes.push(`**Category Parent:** <#${oldChannel.parentId}> ➡️ <#${newChannel.parentId}>`);
        }

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('Channel Updated')
            .setDescription(`**Channel:** ${newChannel}\n**ID:** ${newChannel.id}\n\n**Changes:**\n${changes.join('\n')}`)
            .setColor('#f39c12')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Voice State Updated (Join/Leave/Move)
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const guild = newState.guild || oldState.guild;
        const res = await getLogChannel(guild);
        if (!res || !res.conf.logVoice || !res.channel) return;

        const member = newState.member || oldState.member;
        if (!member) return;

        const embed = new EmbedBuilder()
            .setAuthor({ 
                name: `${member.user.username} (${member.user.tag})`, 
                iconURL: member.user.displayAvatarURL({ dynamic: true }) 
            })
            .setTimestamp();

        if (!oldState.channelId && newState.channelId) {
            embed.setTitle('Voice Channel Joined')
                 .setDescription(`**Member:** ${member}\n**Channel:** <#${newState.channelId}>`)
                 .setColor('#2ecc71');
        }
        else if (oldState.channelId && !newState.channelId) {
            embed.setTitle('Voice Channel Left')
                 .setDescription(`**Member:** ${member}\n**Channel:** <#${oldState.channelId}>`)
                 .setColor('#c0392b');
        }
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            embed.setTitle('Voice Channel Moved')
                 .setDescription(`**Member:** ${member}\n**Old Channel:** <#${oldState.channelId}>\n**New Channel:** <#${newState.channelId}>`)
                 .setColor('#3498db');
        } else {
            return;
        }

        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Guild Updated
    client.on('guildUpdate', async (oldGuild, newGuild) => {
        const res = await getLogChannel(newGuild);
        if (!res || !res.conf.logServer || !res.channel) return;

        const changes = [];
        if (oldGuild.name !== newGuild.name) {
            changes.push(`**Server Name:** \`${oldGuild.name}\` ➡️ \`${newGuild.name}\``);
        }
        if (oldGuild.icon !== newGuild.icon) {
            changes.push(`**Server Icon:** Updated.`);
        }
        if (oldGuild.banner !== newGuild.banner) {
            changes.push(`**Server Banner:** Updated.`);
        }

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('Server Settings Updated')
            .setDescription(`**Server:** ${newGuild.name}\n\n**Changes:**\n${changes.join('\n')}`)
            .setColor('#34495e')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Invite Created
    client.on('inviteCreate', async invite => {
        const res = await getLogChannel(invite.guild);
        if (!res || !res.conf.logInvites || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Invite Created')
            .setDescription(`**Created By:** ${invite.inviter || 'System'}\n**Code:** \`${invite.code}\`\n**Channel:** ${invite.channel}\n**Max Uses:** ${invite.maxUses || 'Infinite'}\n**Expires:** ${invite.expiresAt ? `<t:${Math.floor(invite.expiresAt.getTime() / 1000)}:R>` : 'Never'}`)
            .setColor('#2ecc71')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    // Invite Deleted
    client.on('inviteDelete', async invite => {
        const res = await getLogChannel(invite.guild);
        if (!res || !res.conf.logInvites || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Invite Deleted')
            .setDescription(`**Code:** \`${invite.code}\`\n**Channel:** ${invite.channel}`)
            .setColor('#c0392b')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });
};
