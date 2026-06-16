const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');
const { buildMessage } = require('../utils/messageBuilder');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        const db = await getDb();
        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [member.guild.id]);

        if (conf) {
            // --- 1. Welcome Message ---
            if (conf.welcomeEnabled && conf.welcomeChannel) {
                const channel = member.guild.channels.cache.get(conf.welcomeChannel);
                if (channel) {
                    let title = conf.welcomeEmbedTitle || `Welcome to {server}!`;
                    let desc = conf.welcomeEmbedDesc || `Hello {user}, we hope you have a great time here.`;

                    const pTitle = title.replace('{user}', `<@${member.id}>`)
                        .replace('{server}', member.guild.name)
                        .replace('{memberCount}', member.guild.memberCount);

                    const pDesc = desc.replace('{user}', `<@${member.id}>`)
                        .replace('{server}', member.guild.name)
                        .replace('{memberCount}', member.guild.memberCount);

                    const useEmbed = conf.welcomeUseEmbed === undefined || conf.welcomeUseEmbed === null ? true : !!conf.welcomeUseEmbed;

                    const payload = buildMessage(useEmbed, {
                        title: pTitle,
                        description: pDesc,
                        color: conf.welcomeColor || '#a855f7',
                        imageUrl: conf.welcomeImage || null,
                        thumbnailUrl: useEmbed ? member.user.displayAvatarURL() : null
                    });

                    payload.content = `<@${member.id}>`;
                    await channel.send(payload).catch(() => { });

                    // --- Welcome Reward Notification ---
                    if (conf.ecoEnabled) {
                        const notifyChannelId = conf.ecoWelcomeNotifyChannel || conf.welcomeChannel;
                        const notifyChannel = member.guild.channels.cache.get(notifyChannelId);

                        if (notifyChannel) {
                            const amount = conf.ecoCoinsPerWelcome || 5;
                            const notifyEmbed = new EmbedBuilder()
                                .setDescription(`✨ **A new citizen has arrived!**\n\n💰 Be the first to say **Welcome** in <#${conf.welcomeChannel}> to earn **${amount}** coins!`)
                                .setColor('#f59e0b');

                            await notifyChannel.send({ embeds: [notifyEmbed] }).catch(() => { });
                        }
                    }
                }
            }

            // --- 2. Auto-Role ---
            if (conf.autoroleEnabled && conf.autoroleIds) {
                try {
                    let rolesIds = [];
                    try {
                        const parsed = JSON.parse(conf.autoroleIds);
                        rolesIds = Array.isArray(parsed) ? parsed : [];
                    } catch (jsonErr) {
                        // Fallback if configured as a plain comma-separated string list of IDs
                        rolesIds = String(conf.autoroleIds).split(',').map(id => id.trim()).filter(id => id.length > 0);
                    }
                    for (const roleId of rolesIds) {
                        const role = member.guild.roles.cache.get(roleId);
                        if (role) await member.roles.add(role).catch(() => { });
                    }
                } catch (e) { }
            }
        }

        // --- 3. Economy Starter Bonus (5000 coins) ---
        if (conf && conf.ecoEnabled && !member.user.bot) {
            try {
                await db.run(
                    `INSERT INTO users (userId, guildId, balance) VALUES (?, ?, 5000)
                     ON CONFLICT(userId, guildId) DO NOTHING`,
                    [member.id, member.guild.id]
                );
            } catch (e) {
                console.error('[Economy] Failed to give starter bonus:', e.message);
            }
        }

        // --- 4. Invite Tracker ---
        try {
            const newInvites = await member.guild.invites.fetch();
            const oldInvites = client.invites.get(member.guild.id);

            if (oldInvites) {
                const usedInvite = newInvites.find(inv => inv.uses > oldInvites.get(inv.code));

                if (usedInvite) {
                    const inviterId = usedInvite.inviter.id;
                    const db = await getDb();
                    await db.run(
                        `INSERT INTO users (userId, guildId, invites) VALUES (?, ?, 1)
                         ON CONFLICT(userId, guildId) DO UPDATE SET invites = users.invites + 1`,
                        [inviterId, member.guild.id]
                    );

                    // Economy reward for inviter
                    if (conf && (conf.ecoEnabled || conf.ecoenabled)) {
                        const { addBalance } = require('../utils/economyHandler');
                        const amount = (conf.ecoCoinsPerInvite || conf.ecocoinsperinvite) || 50;
                        await addBalance(inviterId, amount, member.guild.id, false, `Reward for inviting ${member.user.tag}`);
                    }

                    oldInvites.set(usedInvite.code, usedInvite.uses);
                }
            }
        } catch (e) {
            console.error('Error tracking invite on guildMemberAdd', e);
        }
    }
};
