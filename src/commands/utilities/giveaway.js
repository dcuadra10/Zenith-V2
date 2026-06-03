const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create and manage giveaways')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new giveaway in a channel')
                .addStringOption(option => option.setName('prize').setDescription('The prize to give away').setRequired(true))
                .addIntegerOption(option => option.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
                .addIntegerOption(option => option.setName('duration').setDescription('Duration in hours').setRequired(true).setMinValue(1))
                .addChannelOption(option => option.setName('channel').setDescription('The channel to post the giveaway in').setRequired(false))
                .addRoleOption(option => option.setName('required_role').setDescription('Role required to win').setRequired(false))
                .addRoleOption(option => option.setName('ping_role').setDescription('Role to ping').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('End an active giveaway early')
                .addStringOption(option => option.setName('message_id').setDescription('Giveaway Message ID').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reroll')
                .setDescription('Pick a new winner for an ended giveaway')
                .addStringOption(option => option.setName('message_id').setDescription('Giveaway Message ID').setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const db = await getDb();
        const conf = await db.get(`SELECT giveawaysManagerRole, giveawaysLogChannel FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
        
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasManagerRole = conf?.giveawaysManagerRole && interaction.member.roles.cache.has(conf.giveawaysManagerRole);

        if (!isAdmin && !hasManagerRole) {
            return interaction.editReply({ content: '❌ You do not have permission to manage giveaways.' });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'start') {
            const prize = interaction.options.getString('prize');
            const winners = interaction.options.getInteger('winners');
            const duration = interaction.options.getInteger('duration');
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const reqRole = interaction.options.getRole('required_role');
            const pingRole = interaction.options.getRole('ping_role');

            const durationMs = duration * 60 * 60 * 1000;
            const endTime = Date.now() + durationMs;
            const endUnix = Math.floor(endTime / 1000);

            let desc = `React with 🎉 to enter!\n\n**Winners:** ${winners}\n**Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)\n**Hosted By:** ${interaction.user}`;
            if (reqRole) desc += `\n**Required Role:** ${reqRole}`;

            const embed = new EmbedBuilder()
                .setTitle(`🎉 Giveaway: ${prize}`)
                .setDescription(desc)
                .setColor('#a855f7')
                .setTimestamp(new Date(endTime));

            try {
                const msgOpts = { embeds: [embed] };
                if (pingRole) msgOpts.content = `${pingRole}`;

                const message = await channel.send(msgOpts);
                await message.react('🎉');

                await db.run(
                    `INSERT INTO giveaways (id, guildId, channelId, prize, winnersCount, endTime, hostedBy, requiredRole, pingRole, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                    [message.id, interaction.guild.id, channel.id, prize, winners, endTime, interaction.user.id, reqRole ? reqRole.id : null, pingRole ? pingRole.id : null]
                );

                if (conf?.giveawaysLogChannel) {
                    const logChan = interaction.guild.channels.cache.get(conf.giveawaysLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('📢 Giveaway Started')
                            .setColor('#3498db')
                            .addFields(
                                { name: 'Prize', value: prize, inline: true },
                                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                                { name: 'Hosted By', value: `<@${interaction.user.id}>`, inline: true },
                                { name: 'Ends At', value: `<t:${endUnix}:f>`, inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }

                await interaction.editReply({ content: `✅ Giveaway started successfully in ${channel}!` });
            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ Failed to start giveaway. Ensure I have permissions to post and react in the selected channel.' });
            }
        
        } else if (sub === 'end') {
            const msgId = interaction.options.getString('message_id');
            const ga = await db.get(`SELECT * FROM giveaways WHERE id = ? AND guildId = ?`, [msgId, interaction.guild.id]);
            if (!ga) return interaction.editReply({ content: '❌ Giveaway not found in database.' });
            if (ga.status === 'ended') return interaction.editReply({ content: '❌ Giveaway has already ended.' });

            // Force end by setting endTime to now, interval will pick it up
            await db.run(`UPDATE giveaways SET endTime = ? WHERE id = ?`, [Date.now(), ga.id]);
            await interaction.editReply({ content: `✅ Giveaway ending accelerated! The system will process winners momentarily.` });

        } else if (sub === 'reroll') {
            const msgId = interaction.options.getString('message_id');
            const ga = await db.get(`SELECT * FROM giveaways WHERE id = ? AND guildId = ?`, [msgId, interaction.guild.id]);
            if (!ga) return interaction.editReply({ content: '❌ Giveaway not found in database.' });
            if (ga.status !== 'ended') return interaction.editReply({ content: '❌ Wait for the giveaway to end before rerolling.' });

            try {
                const channel = interaction.guild.channels.cache.get(ga.channelId);
                const message = await channel.messages.fetch(ga.id);
                const reaction = message.reactions.cache.find(r => r.emoji.name === '🎉');
                if (!reaction) return interaction.editReply({ content: '❌ No reactions found on the message.' });

                const users = await reaction.users.fetch();
                const validUsers = [];
                for (const [userId, user] of users) {
                    if (user.bot) continue;
                    if (ga.requiredRole) {
                        const member = await interaction.guild.members.fetch(userId).catch(() => null);
                        if (!member || !member.roles.cache.has(ga.requiredRole)) continue;
                    }
                    validUsers.push(user);
                }

                if (validUsers.length === 0) return interaction.editReply({ content: '❌ No valid entries left to pick from.' });
                
                const newWinner = validUsers[Math.floor(Math.random() * validUsers.length)];
                await channel.send(`🎉 **GIVEAWAY REROLL!** Congratulations <@${newWinner.id}>, you are the new winner of **${ga.prize}**!`);
                
                // Enviar DM al ganador
                try {
                    const winEmbed = new EmbedBuilder()
                        .setTitle('🎉 You won a giveaway!')
                        .setDescription(`Congratulations! You are the new winner of **${ga.prize}** in **${interaction.guild.name}**!\n\n**Click here to view the giveaway**`)
                        .setColor('#a855f7')
                        .setTimestamp();
                    await newWinner.send({ embeds: [winEmbed] });
                } catch (err) {
                    console.log(`[Giveaways] Could not DM the reroll winner ${newWinner.tag} (DMs might be closed).`);
                }
                
                if (conf?.giveawaysLogChannel) {
                    const logChan = interaction.guild.channels.cache.get(conf.giveawaysLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🔄 Giveaway Rerolled')
                            .setColor('#e67e22')
                            .addFields(
                                { name: 'Prize', value: ga.prize, inline: true },
                                { name: 'New Winner', value: `<@${newWinner.id}>`, inline: true },
                                { name: 'Action By', value: `<@${interaction.user.id}>`, inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }

                await interaction.editReply({ content: `✅ Giveaway rerolled! Winner: <@${newWinner.id}>` });
            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ Error rerolling the giveaway. Make sure the message still exists.' });
            }
        }
    }
};
