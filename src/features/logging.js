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
    client.on('messageDelete', async message => {
        if (message.partial) return;
        if (!message.guild || message.author?.bot) return;
        const res = await getLogChannel(message.guild);
        if (!res || !res.conf.logDeletes || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Message Deleted')
            .setDescription(`**Author:** ${message.author} \n**Channel:** ${message.channel}\n**Content:** ${message.content || '[Embed / Attachment]'}`)
            .setColor('#e74c3c')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        if (oldMessage.partial || newMessage.partial) return;
        if (!oldMessage.guild || oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        
        const res = await getLogChannel(oldMessage.guild);
        if (!res || !res.conf.logEdits || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Message Edited')
            .setDescription(`**Author:** ${oldMessage.author} \n**Channel:** ${oldMessage.channel}\n**Old:** ${oldMessage.content || '[None]'}\n**New:** ${newMessage.content || '[None]'}`)
            .setColor('#f39c12')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    client.on('guildMemberRemove', async member => {
        const res = await getLogChannel(member.guild);
        if (!res || !res.conf.logMembers || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Left')
            .setDescription(`**User:** ${member.user.tag}`)
            .setColor('#c0392b')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    client.on('guildBanAdd', async ban => {
        const res = await getLogChannel(ban.guild);
        if (!res || !res.conf.logBans || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Member Banned')
            .setDescription(`**User:** ${ban.user.tag}\n**Reason:** ${ban.reason || 'None provided'}`)
            .setColor('#8e44ad')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    client.on('roleCreate', async role => {
        const res = await getLogChannel(role.guild);
        if (!res || !res.conf.logRoles || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Role Created')
            .setDescription(`**Role:** ${role.name}`)
            .setColor('#2ecc71')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });

    client.on('channelCreate', async channel => {
        if (!channel.guild) return;
        const res = await getLogChannel(channel.guild);
        if (!res || !res.conf.logChannels || !res.channel) return;

        const embed = new EmbedBuilder()
            .setTitle('Channel Created')
            .setDescription(`**Channel:** ${channel.name}`)
            .setColor('#2980b9')
            .setTimestamp();
        res.channel.send({ embeds: [embed] }).catch(()=>{});
    });
};
