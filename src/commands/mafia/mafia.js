const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { addBalance, removeBalance, logEconomyEvent } = require('../../utils/economyHandler');
const { generateMafiaHierarchy } = require('../../utils/imageGenerator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mafia')
        .setDescription('Organized crime and mafia management')
        .addSubcommand(sub => 
            sub.setName('create')
                .setDescription('Found a new mafia (Costs 5000 coins)')
                .addStringOption(opt => opt.setName('name').setDescription('Name of your mafia').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('info')
                .setDescription('View your mafia information'))
        .addSubcommand(sub => 
            sub.setName('invite')
                .setDescription('Invite a user to your mafia')
                .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('heist')
                .setDescription('Coordinate a massive heist on a city or private bank')
                .addStringOption(opt => opt.setName('bank').setDescription('Target bank').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => 
            sub.setName('raid')
                .setDescription('Coordinate a mafia raid on a citizen\'s private business')
                .addStringOption(opt => opt.setName('business').setDescription('Target business').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('donate')
                .setDescription('Donate coins to your mafia treasury')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to donate').setRequired(true).setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('upgrade')
                .setDescription('Upgrade your mafia level (Costs treasury coins)'))
        .addSubcommand(sub =>
            sub.setName('tax')
                .setDescription('Set the mafia tax rate (Don only)')
                .addIntegerOption(opt => opt.setName('percent').setDescription('Tax percentage (0-20)').setRequired(true).setMinValue(0).setMaxValue(20)))
        .addSubcommand(sub =>
            sub.setName('kick')
                .setDescription('Kick a member from the mafia (Don only)')
                .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('promote')
                .setDescription('Change a members rank (Don only)')
                .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
                .addStringOption(opt => opt.setName('rank').setDescription('New rank').setRequired(true).addChoices(
                    { name: 'Consigliere', value: 'Consigliere' },
                    { name: 'Soldier', value: 'Soldier' },
                    { name: 'Associate', value: 'Associate' }
                )))
        .addSubcommand(sub =>
            sub.setName('vault')
                .setDescription('View mafia vault and financial info'))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all mafias in the server'))
        .addSubcommand(sub =>
            sub.setName('turfs')
                .setDescription('View and battle for city turfs'))
        .addSubcommand(sub =>
            sub.setName('apply')
                .setDescription('Apply to join a mafia')
                .addStringOption(opt => opt.setName('id').setDescription('The ID of the mafia you want to join').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('leave')
                .setDescription('Leave your current mafia'))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View the top mafias in the city'))
        .addSubcommand(sub =>
            sub.setName('armory')
                .setDescription('Buy equipment for your mafia')
                .addStringOption(opt => opt.setName('item').setDescription('Item to purchase').setRequired(true).addChoices(
                    { name: 'Bulletproof Vests (💰 5000) - +10% Success', value: 'vests' },
                    { name: 'Getaway Car (💰 15000) - -50% Jail/Fine', value: 'car' },
                    { name: 'Expert Hacker (💰 25000) - High Tier Missions', value: 'hacker' },
                    { name: 'Weapon Silencers (💰 8000) - -15% Jail Risk', value: 'silencers' },
                    { name: 'Safe-Cracking Kit (💰 12000) - +20% Mission Loot', value: 'safekit' },
                    { name: 'Police Scanner (💰 10000) - +5% Success All Acts', value: 'scanner' }
                )))
        .addSubcommand(sub =>
            sub.setName('mission')
                .setDescription('Execute a specialized mafia mission'))
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Change the mafia name (Don only)')
                .addStringOption(opt => opt.setName('name').setDescription('New name for your mafia').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('disband')
                .setDescription('Permanently dissolve your mafia (Don only)'))
        .addSubcommand(sub =>
            sub.setName('tree')
                .setDescription('View the visual hierarchy of your mafia'))
        .addSubcommand(sub =>
            sub.setName('specialize')
                .setDescription('Choose a specialization for your mafia (Level 5+)')
                .addStringOption(opt => opt.setName('path').setDescription('Specialization path').setRequired(true).addChoices(
                    { name: 'Cartel (+20% Mission Rewards)', value: 'Cartel' },
                    { name: 'Cyber-Crime (+15% Clean Money)', value: 'Cyber-Crime' },
                    { name: 'Enforcers (+10% Robbery Success)', value: 'Enforcers' }
                )))
        .addSubcommand(sub =>
            sub.setName('clean')
                .setDescription('Launder your dirty money into clean coins')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to clean').setRequired(false).setMinValue(1))
                .addBooleanOption(opt => opt.setName('max').setDescription('Launder all your dirty money').setRequired(false)))
        .addSubcommandGroup(group =>
            group.setName('business')
                .setDescription('Manage your criminal enterprises (GTA Style)')
                .addSubcommand(sub =>
                    sub.setName('buy')
                        .setDescription('Purchase a new criminal business or legal front')
                        .addStringOption(opt => opt.setName('type').setDescription('Type of business to buy').setRequired(true).addChoices(
                            { name: '🧼 Car Wash (Legal - 💰 50k)', value: 'car_wash' },
                            { name: '🌃 Nightclub (Legal/Front - 💰 200k)', value: 'nightclub' },
                            { name: '🧪 Tech Lab (Legal - 💰 500k)', value: 'tech_lab' },
                            { name: '⚖️ Law Firm (Legal - 💰 1M)', value: 'law_firm' },
                            { name: '💊 Underworld Lab (Illegal - 💰 750k)', value: 'lab' },
                            { name: '🖨️ Money Printing (Illegal - 💰 500k)', value: 'cash' }
                        ))
                        .addStringOption(opt => opt.setName('name').setDescription('Custom name for your business (e.g., Zenith Cleaners)').setRequired(false)))
                .addSubcommand(sub =>
                    sub.setName('status')
                        .setDescription('Check the status of your businesses'))
                .addSubcommand(sub =>
                    sub.setName('sell')
                        .setDescription('Sell your current stock for dirty money')
                        .addStringOption(opt => opt.setName('type').setDescription('Business to sell from').setRequired(true).setAutocomplete(true)))
                .addSubcommand(sub =>
                    sub.setName('restock')
                        .setDescription('Buy supplies for your businesses')
                        .addStringOption(opt => opt.setName('type').setDescription('Business to restock').setRequired(true).setAutocomplete(true)))
                .addSubcommand(sub =>
                    sub.setName('go-public')
                        .setDescription('Issue shares of your business to the public')
                        .addStringOption(opt => opt.setName('type').setDescription('Business type').setRequired(true).setAutocomplete(true))
                        .addIntegerOption(opt => opt.setName('shares').setDescription('Amount of shares to issue').setRequired(true).setMinValue(1).setMaxValue(500))
                        .addIntegerOption(opt => opt.setName('price').setDescription('Price per share').setRequired(true).setMinValue(100)))
                .addSubcommand(sub =>
                    sub.setName('upgrade')
                        .setDescription('Upgrade a business to increase production')
                        .addStringOption(opt => opt.setName('type').setDescription('Business to upgrade').setRequired(true).setAutocomplete(true)))
                .addSubcommand(sub =>
                    sub.setName('hire')
                        .setDescription('Toggle recruitment for a mafia business')
                        .addStringOption(opt => opt.setName('type').setDescription('Business type').setRequired(true).setAutocomplete(true))
                        .addBooleanOption(opt => opt.setName('status').setDescription('Set to True to open vacancies').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('salary')
                        .setDescription('Set the salary for your criminal employees')
                        .addStringOption(opt => opt.setName('type').setDescription('Business type').setRequired(true).setAutocomplete(true))
                        .addIntegerOption(opt => opt.setName('amount').setDescription('Dirty money per work cycle').setRequired(true).setMinValue(50).setMaxValue(2000)))
                .addSubcommand(sub =>
                    sub.setName('cooldown')
                        .setDescription('Set the work cooldown for your criminal employees (Minimum 4 hours)')
                        .addStringOption(opt => opt.setName('type').setDescription('Business type').setRequired(true).setAutocomplete(true))
                        .addIntegerOption(opt => opt.setName('hours').setDescription('Cooldown in hours (Minimum 4)').setRequired(true).setMinValue(4)))),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const db = await getDb();
        const sub = interaction.options.getSubcommand();
        const subGroup = interaction.options.getSubcommandGroup(false);

        if (sub === 'apply') {
            const mafias = await db.all(`SELECT id, name FROM economy_mafias WHERE guildId = ?`, [interaction.guild.id]);
            const choices = mafias.map(m => ({
                name: `${m.name} (ID: ${m.id})`,
                value: m.id
            }));
            const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);
            return await interaction.respond(filtered);
        }

        if (sub === 'heist') {
            const banks = await db.all(`SELECT id, name FROM economy_banks WHERE name LIKE ? OR id LIKE ? LIMIT 25`, [`%${focusedValue}%`, `%${focusedValue}%`]);
            const choices = banks.map(b => ({
                name: b.name,
                value: b.id
            }));
            return await interaction.respond(choices);
        }

        if (sub === 'raid') {
            const biz = await db.all(`SELECT id, type, userId FROM economy_operations WHERE id LIKE ? OR type LIKE ? LIMIT 25`, [`%${focusedValue}%`, `%${focusedValue}%`]);
            const bizNames = {
                car_wash: 'Car Wash',
                nightclub: 'Nightclub',
                law_firm: 'Law Firm',
                tech_lab: 'Tech Lab'
            };
            const choices = [];
            for (const b of biz) {
                let ownerName = 'Unknown';
                try {
                    const ownerUser = await interaction.client.users.fetch(b.userId);
                    ownerName = ownerUser.username;
                } catch(e) {}
                choices.push({
                    name: `${bizNames[b.type] || b.type.toUpperCase()} (ID: ${b.id} - Owner: ${ownerName})`,
                    value: b.id
                });
            }
            return await interaction.respond(choices);
        }

        if (subGroup === 'business') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.respond([]);

            const businesses = await db.all(`SELECT type, customName FROM mafia_businesses WHERE mafiaId = ?`, [user.mafiaId]);
            const bizNames = {
                car_wash: 'Car Wash',
                nightclub: 'Nightclub',
                tech_lab: 'Tech Lab',
                law_firm: 'Law Firm',
                lab: 'Underworld Lab',
                cash: 'Money Printing'
            };
            const choices = businesses.map(b => {
                const displayName = `${b.customName || b.type.toUpperCase()} (${bizNames[b.type] || b.type.toUpperCase()})`;
                return { name: displayName, value: b.type };
            });

            const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase())).slice(0, 25);
            await interaction.respond(filtered);
        }
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const subGroup = interaction.options.getSubcommandGroup(false);
        const db = await getDb();

        if (sub === 'create') {
            const name = interaction.options.getString('name');
            const cost = 5000;

            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (user && user.mafiaId) return await interaction.editReply({ content: '❌ You are already in a mafia!' });

            const success = await removeBalance(interaction.user.id, cost);
            if (!success) return await interaction.editReply({ content: `❌ You need **${cost}** coins to start a mafia!` });

            const id = Math.random().toString(36).substring(2, 8).toUpperCase();
            await db.run(
                `INSERT INTO economy_mafias (id, guildId, name, leaderId) VALUES (?, ?, ?, ?)`,
                [id, interaction.guild.id, name, interaction.user.id]
            );
            await db.run(`UPDATE users SET mafiaId = ? WHERE userId = ? AND guildId = ?`, [id, interaction.user.id, interaction.guild.id]);
            await db.run(`INSERT INTO mafia_members (mafiaId, userId, rank) VALUES (?, ?, ?)`, [id, interaction.user.id, 'Don']);

            const embed = new EmbedBuilder()
                .setTitle('🔫 New Mafia Founded')
                .setDescription(`The **${name}** mafia has been established by <@${interaction.user.id}>.`)
                .addFields({ name: 'Mafia ID', value: `\`${id}\`` })
                .setColor('#111827')
                .setTimestamp();

            return await interaction.editReply({ embeds: [embed] });
        }
        
        if (sub === 'list') {
            const mafias = await db.all(`SELECT id, name, leaderId, level FROM economy_mafias WHERE guildId = ? ORDER BY level DESC LIMIT 10`, [interaction.guild.id]);
            
            if (mafias.length === 0) return await interaction.editReply({ content: '🏙️ No mafias founded in this city yet.' });

            const embed = new EmbedBuilder()
                .setTitle('🔫 Zenith City Mafias')
                .setDescription('Active criminal organizations in the city.')
                .setColor('#111827')
                .setTimestamp();

            for (const m of mafias) {
                const memberCountRes = await db.get(`SELECT COUNT(*) as count FROM mafia_members WHERE mafiaId = ?`, [m.id]);
                const memberCount = memberCountRes ? memberCountRes.count : 0;
                embed.addFields({
                    name: `${m.name} (ID: ${m.id})`,
                    value: `👑 Leader: <@${m.leaderId}>\n📊 Level: ${m.level}\n👥 Members: ${memberCount}`
                });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'leave') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank === 'Don') return await interaction.editReply({ content: '❌ The Don cannot leave the mafia! You must disband it or transfer leadership first.' });

            await db.run(`UPDATE users SET mafiaId = NULL WHERE userId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
            await db.run(`DELETE FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);

            return await interaction.editReply({ content: '🚪 You have left the mafia.' });
        }

        if (sub === 'leaderboard') {
            const mafias = await db.all(`SELECT id, name, leaderId, level, vault FROM economy_mafias WHERE guildId = ? ORDER BY level DESC, vault DESC LIMIT 10`, [interaction.guild.id]);
            
            if (mafias.length === 0) return await (interaction.isRepliable() ? interaction.editReply({ content: '🏙️ No mafias founded in this city yet.' }) : null);

            const entries = [];
            for (let i = 0; i < mafias.length; i++) {
                const m = mafias[i];
                const memberCountRes = await db.get(`SELECT COUNT(*) as count FROM mafia_members WHERE mafiaId = ?`, [m.id]);
                const memberCount = memberCountRes ? memberCountRes.count : 0;
                
                let leaderName = `Don ${m.leaderId.slice(-4)}`;
                try {
                    const leaderUser = await interaction.client.users.fetch(m.leaderId).catch(() => null);
                    if (leaderUser) leaderName = leaderUser.username;
                } catch (e) {}

                entries.push({
                    name: m.name,
                    value: `Lvl: ${m.level} • Vault: 💰 ${m.vault.toLocaleString()} • Members: ${memberCount} • Don: ${leaderName}`
                });
            }

            const { generateLeaderboardImage } = require('../../utils/imageGenerator');
            const path = require('path');
            const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');
            const buffer = await generateLeaderboardImage('🏆  Zenith City — Mafia Leaderboard', entries, imagePath);
            const attachment = new AttachmentBuilder(buffer, { name: 'mafia_leaderboard.png' });

            return await (interaction.isRepliable() ? interaction.editReply({ files: [attachment] }) : null);
        }

        if (sub === 'apply') {
            const mafiaId = interaction.options.getString('id').toUpperCase();
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (user && user.mafiaId) return await interaction.editReply({ content: '❌ You are already in a mafia!' });

            const mafia = await db.get(`SELECT name, leaderId FROM economy_mafias WHERE id = ?`, [mafiaId]);
            if (!mafia) return await interaction.editReply({ content: '❌ Invalid Mafia ID.' });

            const embed = new EmbedBuilder()
                .setTitle('⚖️ Mafia Application')
                .setDescription(`<@${interaction.user.id}> wants to join the **${mafia.name}** mafia.\n\nLeader <@${mafia.leaderId}>, do you accept?`)
                .setColor('#111827')
                .setFooter({ text: `Mafia ID: ${mafiaId}` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('apply_accept').setLabel('Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('apply_deny').setLabel('Deny').setStyle(ButtonStyle.Danger)
            );

            const response = await interaction.editReply({ content: `<@${mafia.leaderId}>`, embeds: [embed], components: [row] });
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 3600000 }); // 1 hour

            collector.on('collect', async i => {
                if (i.user.id !== mafia.leaderId) return i.reply({ content: '❌ Only the Don can accept applications!', ephemeral: true });

                if (i.customId === 'apply_accept') {
                    const current = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
                    if (current && current.mafiaId) return i.update({ content: '❌ This user has already joined another mafia.', embeds: [], components: [] });

                    await db.run(`UPDATE users SET mafiaId = ? WHERE userId = ? AND guildId = ?`, [mafiaId, interaction.user.id, interaction.guild.id]);
                    await db.run(`INSERT INTO mafia_members (mafiaId, userId, rank) VALUES (?, ?, ?)`, [mafiaId, interaction.user.id, 'Soldier']);
                    await i.update({ content: `✅ <@${interaction.user.id}> is now a Soldier of **${mafia.name}**.`, embeds: [], components: [] });
                } else {
                    await i.update({ content: `❌ Application from <@${interaction.user.id}> was denied.`, embeds: [], components: [] });
                }
                collector.stop();
            });
            return;
        }

        if (sub === 'info') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ You are not in a mafia!' }) : null);

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            if (!mafia) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Mafia data not found.' }) : null);

            const members = await db.all(`SELECT userId, rank, contributed, dirtyMoney FROM mafia_members WHERE mafiaId = ? ORDER BY contributed DESC`, [user.mafiaId]);
            const upgrades = JSON.parse(mafia.upgrades || '[]');
            const self = members.find(m => m.userId === interaction.user.id);

            const embed = new EmbedBuilder()
                .setTitle(`<:zenith_mafia:1510658751261052968> Mafia: ${mafia.name}`)
                .setDescription(`**ID:** \`${mafia.id}\` | **Level:** ${mafia.level}\n**Treasury:** 💰 ${(mafia.balance || 0).toLocaleString('en-US')} coins\n**Vault:** 🏦 ${(mafia.vault || 0).toLocaleString('en-US')} coins\n**Tax Rate:** ${(mafia.taxRate * 100).toFixed(0)}%`)
                .setColor('#111827')
                .setTimestamp();

            embed.addFields({ name: '<:zenith_user:1510658870790590646> Your Status', value: `**Dirty Money:** 💵 ${(self?.dirtyMoney || 0).toLocaleString('en-US')}\n*Use \`/mafia clean\` to launder it.*` });

            let memberList = members.map(m => `<@${m.userId}> (${m.rank}) - 💸 ${(m.contributed || 0).toLocaleString('en-US')}`).join('\n');
            embed.addFields({ name: 'Mafia Members (By Contribution)', value: memberList || 'No members.' });

            if (upgrades.length > 0) {
                embed.addFields({ name: '🛠️ Mafia Armory', value: upgrades.map(u => `• ${u.toUpperCase()}`).join('\n') });
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'tax') {
            const percent = interaction.options.getInteger('percent');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank !== 'Don' && member.rank !== 'Consigliere') return await interaction.editReply({ content: '❌ Only the Don or Consigliere can set taxes!' });

            await db.run(`UPDATE economy_mafias SET taxRate = ? WHERE id = ?`, [percent / 100, user.mafiaId]);
            return await interaction.editReply({ content: `✅ Mafia tax rate set to **${percent}%**.` });
        }

        if (sub === 'rename') {
            const newName = interaction.options.getString('name');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Not in a mafia!' }) : null);

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank !== 'Don') return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Only the Don can rename the mafia!' }) : null);

            await db.run(`UPDATE economy_mafias SET name = ? WHERE id = ?`, [newName, user.mafiaId]);
            return await (interaction.isRepliable() ? interaction.editReply({ content: `✅ Mafia renamed to: **${newName}**.` }) : null);
        }

        if (sub === 'tree') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ You are not in a mafia!' }) : null);

            const mafia = await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const members = await db.all(`SELECT userId, rank FROM mafia_members WHERE mafiaId = ?`, [user.mafiaId]);

            const memberData = [];
            for (const m of members) {
                const u = await interaction.client.users.fetch(m.userId).catch(() => null);
                if (u) {
                    memberData.push({
                        username: u.username,
                        avatarUrl: u.displayAvatarURL({ extension: 'png' }),
                        rank: m.rank
                    });
                }
            }

            try {
                const imageBuffer = await generateMafiaHierarchy(mafia.name, memberData, { level: mafia.level, specialization: mafia.specialization });
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'mafia_hierarchy.png' });

                const embed = new EmbedBuilder()
                    .setTitle(`🌑 Mafia Hierarchy: ${mafia.name}`)
                    .setImage('attachment://mafia_hierarchy.png')
                    .setColor('#111827')
                    .setTimestamp();

                return await (interaction.isRepliable() ? interaction.editReply({ embeds: [embed], files: [attachment] }) : null);
            } catch (e) {
                console.error('Error generating mafia hierarchy:', e);
                return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ There was an error generating the hierarchy image.' }) : null);
            }
        }

        if (sub === 'specialize') {
            const path = interaction.options.getString('path');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Not in a mafia!' }) : null);

            const mafia = await db.get(`SELECT level, leaderId FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            if (mafia.leaderId !== interaction.user.id) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Only the Don can choose a specialization!' }) : null);
            if (mafia.level < 5) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Your mafia must be Level 5 or higher to specialize!' }) : null);

            await db.run(`UPDATE economy_mafias SET specialization = ? WHERE id = ?`, [path, user.mafiaId]);
            return await (interaction.isRepliable() ? interaction.editReply({ content: `🎭 **SPECIALIZATION CHOSEN!** Your mafia is now a **${path}**.` }) : null);
        }

        if (sub === 'disband') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ You are not in a mafia!' }) : null);

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (!member || member.rank !== 'Don') {
                return await (interaction.isRepliable() ? interaction.editReply({ content: '❌ Only the Don can disband the mafia!' }) : null);
            }

            const mafia = await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [user.mafiaId]);

            // Delete everything related to this mafia
            await db.run(`UPDATE users SET mafiaId = NULL WHERE mafiaId = ? AND guildId = ?`, [user.mafiaId, interaction.guild.id]);
            await db.run(`DELETE FROM mafia_members WHERE mafiaId = ?`, [user.mafiaId]);
            await db.run(`DELETE FROM economy_mafias WHERE id = ?`, [user.mafiaId]);

            return await (interaction.isRepliable() ? interaction.editReply({ content: `🚨 **${mafia.name}** has been disbanded. All members are now freelancers.` }) : null);
        }

        if (sub === 'kick') {
            const target = interaction.options.getUser('user');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can kick members!' });
            if (target.id === interaction.user.id) return await interaction.editReply({ content: '❌ You cannot kick yourself!' });

            // Verify target is in the same mafia
            const targetMember = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [target.id, user.mafiaId]);
            if (!targetMember) return await interaction.editReply({ content: '❌ That user is not a member of your mafia!' });

            await db.run(`UPDATE users SET mafiaId = NULL WHERE userId = ? AND mafiaId = ? AND guildId = ?`, [target.id, user.mafiaId, interaction.guild.id]);
            await db.run(`DELETE FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [target.id, user.mafiaId]);
            
            return await interaction.editReply({ content: `✅ <@${target.id}> has been kicked from the mafia.` });
        }

        if (sub === 'promote') {
            const target = interaction.options.getUser('user');
            const newRank = interaction.options.getString('rank');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can change ranks!' });

            // Verify target is in the same mafia
            const targetMember = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [target.id, user.mafiaId]);
            if (!targetMember) return await interaction.editReply({ content: '❌ That user is not a member of your mafia!' });

            await db.run(`UPDATE mafia_members SET rank = ? WHERE userId = ? AND mafiaId = ?`, [newRank, target.id, user.mafiaId]);
            return await interaction.editReply({ content: `✅ <@${target.id}> is now a **${newRank}**.` });
        }

        if (sub === 'vault') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const mafia = await db.get(`SELECT vault, taxRate, name FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const embed = new EmbedBuilder()
                .setTitle(`<:zenith_bank:1510681878032552166> ${mafia.name} Vault`)
                .setDescription(`**Current Vault:** 💰 ${mafia.vault} coins\n**Tax Rate:** ${(mafia.taxRate * 100).toFixed(0)}%\n\n*These funds are collected automatically from members and used for upgrades and wars.*`)
                .setColor('#f59e0b');
            
            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'turfs') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            const turfs = await db.all(`SELECT * FROM economy_turfs`);
            
            // Auto-init turfs if empty
            if (turfs.length === 0) {
                await db.run(`INSERT INTO economy_turfs (turfId, name, bonusType, bonusValue) VALUES 
                    ('casino', '🎰 The Grand Casino', 'gambling_cut', 0.02),
                    ('blackmarket', '⚖️ Black Market', 'shop_discount', 0.10),
                    ('bank', '🏦 Central Bank', 'heist_bonus', 0.10)`);
                return await interaction.editReply({ content: '⚠️ City turfs are being initialized. Please try again in a moment.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('🏙️ City Territory Control')
                .setDescription('Mafias battle for control of these key areas to get global bonuses.')
                .setColor('#3b82f6');

            for (const t of turfs) {
                const owner = t.ownerMafiaId ? (await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [t.ownerMafiaId]))?.name || 'Unknown' : 'No owner';
                embed.addFields({ name: t.name, value: `🚩 **Owner:** ${owner}\n✨ **Bonus:** ${t.bonusType === 'gambling_cut' ? '2% of all gambling losses' : t.bonusType === 'shop_discount' ? '10% Shop Discount' : '10% Heist Bonus'}` });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('mafia_turf_battle').setLabel('Battle for Control').setStyle(ButtonStyle.Danger)
            );

            const response = await interaction.editReply({ embeds: [embed], components: [row] });
            
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
            collector.on('collect', async i => {
                if (!user || !user.mafiaId) return i.reply({ content: '❌ You need a mafia to battle!', ephemeral: true });
                
                // Simplified battle logic
                const randomTurf = turfs[Math.floor(Math.random() * turfs.length)];
                const success = Math.random() > 0.7; // 30% success chance to take over

                if (success) {
                    await db.run(`UPDATE economy_turfs SET ownerMafiaId = ? WHERE turfId = ?`, [user.mafiaId, randomTurf.turfId]);
                    await i.update({ content: `🚩 **WAR UPDATE!** The mafia has taken control of **${randomTurf.name}**!`, embeds: [], components: [] });
                } else {
                    await i.update({ content: `🚑 **BATTLE LOST!** Your assault on ${randomTurf.name} failed miserably.`, embeds: [], components: [] });
                }
                collector.stop();
            });
        }

        if (sub === 'invite') {
            const target = interaction.options.getUser('user');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can invite members!' });

            const targetUser = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [target.id, interaction.guild.id]);
            if (targetUser && targetUser.mafiaId) return await interaction.editReply({ content: `❌ ${target.username} is already in a mafia!` });

            const embed = new EmbedBuilder()
                .setTitle('⚖️ Mafia Invitation')
                .setDescription(`<@${interaction.user.id}> invites <@${target.id}> to join the **${(await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [user.mafiaId])).name}** mafia.`)
                .setColor('#111827');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('mafia_accept').setLabel('Join Mafia').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('mafia_deny').setLabel('Refuse').setStyle(ButtonStyle.Danger)
            );

            const response = await interaction.editReply({ content: `<@${target.id}>`, embeds: [embed], components: [row] });
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== target.id) return i.reply({ content: '❌ This invitation is not for you!', ephemeral: true });

                if (i.customId === 'mafia_accept') {
                    await db.run(`UPDATE users SET mafiaId = ? WHERE userId = ? AND guildId = ?`, [user.mafiaId, target.id, interaction.guild.id]);
                    await db.run(`INSERT INTO mafia_members (mafiaId, userId, rank) VALUES (?, ?, ?)`, [user.mafiaId, target.id, 'Soldier']);
                    await i.update({ content: `✅ <@${target.id}> is now a Soldier of the mafia.`, embeds: [], components: [] });
                } else {
                    await i.update({ content: '❌ Invitation refused.', embeds: [], components: [] });
                }
                collector.stop();
            });
        }


        if (sub === 'armory') {
            const itemName = interaction.options.getString('item');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank !== 'Don' && member.rank !== 'Consigliere') return await interaction.editReply({ content: '❌ Only the Don or Consigliere can access the Armory!' });

            const mafia = await db.get(`SELECT vault, upgrades FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const currentUpgrades = JSON.parse(mafia.upgrades || '[]');
            if (currentUpgrades.includes(itemName)) return await interaction.editReply({ content: '❌ Your mafia already owns this equipment!' });

            const prices = { vests: 5000, car: 15000, hacker: 25000, silencers: 8000, safekit: 12000, scanner: 10000 };
            const price = prices[itemName];

            if (mafia.vault < price) return await interaction.editReply({ content: `❌ The mafia vault needs **${price}** coins for this!` });

            currentUpgrades.push(itemName);
            await db.run(`UPDATE economy_mafias SET vault = vault - ?, upgrades = ? WHERE id = ?`, [price, JSON.stringify(currentUpgrades), user.mafiaId]);
            
            const mafiaDetails = await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, price, 'mafia_vault_withdraw', {
                mafiaId: user.mafiaId,
                mafiaName: mafiaDetails?.name || 'Mafia',
                reason: `Armory Upgrade: Bought ${itemName.toUpperCase()}`
            });

            return await interaction.editReply({ content: `✅ **Equipment Purchased!** The mafia now has access to: **${itemName.toUpperCase()}**.` });
        }

        if (sub === 'clean') {
            let amount = interaction.options.getInteger('amount');
            const max = interaction.options.getBoolean('max');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const mafia = await db.get(`SELECT specialization FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const member = await db.get(`SELECT * FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);

            if (max) {
                amount = member.dirtyMoney;
            }

            if (!amount || amount <= 0) {
                return await interaction.editReply({ content: '❌ Please specify a valid amount of dirty money to clean or use the `max` option!' });
            }

            if (member.dirtyMoney < amount) return await interaction.editReply({ content: `❌ You only have **${member.dirtyMoney}** in dirty money!` });

            let cut = 0.20; // 20% laundering fee
            if (mafia.specialization === 'Cyber-Crime') cut = 0.05; // 5% fee for Cyber-Crime spec
            
            const cleanAmount = Math.floor(amount * (1 - cut));
            
            await db.run(`UPDATE mafia_members SET dirtyMoney = dirtyMoney - ? WHERE userId = ? AND mafiaId = ?`, [amount, interaction.user.id, user.mafiaId]);
            await addBalance(interaction.user.id, cleanAmount, interaction.guild.id, true, 'Laundered Dirty Money', true);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, amount, 'dirty_money_clean', {
                cleanAmount,
                feePercent: Math.round(cut * 100)
            });

            return await interaction.editReply({ content: `🧼 **Laundry Complete!** You cleaned **${amount}** dirty bills into **${cleanAmount}** clean coins. (${(cut * 100).toFixed(0)}% fee applied)` });
        }

        if (sub === 'mission') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Not in a mafia!' });

            const mafia = await db.get(`SELECT level, specialization, upgrades FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const upgrades = JSON.parse(mafia.upgrades || '[]');
            
            const missions = [
                { name: '🚚 Armored Truck Ambush', reward: 2500, difficulty: 0.7 },
                { name: '💎 Jewelry Store Smash & Grab', reward: 1500, difficulty: 0.5 },
                { name: '📦 Smuggle Illegal Goods', reward: 1000, difficulty: 0.3 }
            ];

            const mission = missions[Math.floor(Math.random() * missions.length)];
            let successChance = 1 - mission.difficulty;

            // Apply Bonuses
            if (upgrades.includes('vests')) successChance += 0.10;
            if (upgrades.includes('scanner')) successChance += 0.05;
            if (upgrades.includes('silencers')) successChance += 0.05; // Less likely to be caught
            
            if (mafia.specialization === 'Cartel') mission.reward = Math.floor(mission.reward * 1.2);
            if (upgrades.includes('safekit')) mission.reward = Math.floor(mission.reward * 1.2);

            const success = Math.random() < successChance;

            if (success) {
                await db.run(`UPDATE mafia_members SET dirtyMoney = dirtyMoney + ? WHERE userId = ? AND mafiaId = ?`, [mission.reward, interaction.user.id, user.mafiaId]);
                await db.run(`UPDATE economy_mafias SET experience = experience + 50 WHERE id = ?`, [user.mafiaId]);
                await logEconomyEvent(interaction.guild.id, interaction.user.id, mission.reward, 'dirty_money_gain', {
                    reason: `Completed mission: ${mission.name}`
                });
                return await interaction.editReply({ content: `✅ **MISSION SUCCESS!** You completed: **${mission.name}** and earned **${mission.reward}** dirty bills! (+50 Mafia XP)` });
            } else {
                let jailTime = 120; // 2 hours
                if (upgrades.includes('car')) jailTime = 60; // Getaway car reduces jail time
                
                const jailUntil = new Date(Date.now() + jailTime * 60000).toISOString();
                await removeBalance(interaction.user.id, 300, interaction.guild.id, `Failed mission: ${mission.name} (Jailed)`);
                await db.run(`UPDATE users SET jailUntil = ? WHERE userId = ? AND guildId = ?`, [jailUntil, interaction.user.id, interaction.guild.id]);
                return await interaction.editReply({ content: `❌ **MISSION FAILED!** You were caught during: **${mission.name}**. You lost 300 coins and have been jailed for **${jailTime} minutes**.` });
            }
        }

        if (sub === 'donate') {
            const amount = interaction.options.getInteger('amount');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });

            const removed = await removeBalance(interaction.user.id, amount, interaction.guild.id, 'Donated to Mafia Treasury');
            if (!removed) return await interaction.editReply({ content: '❌ You don\'t have enough coins!' });

            await db.run(`UPDATE economy_mafias SET balance = balance + ? WHERE id = ?`, [amount, user.mafiaId]);
            const mafiaName = (await db.get(`SELECT name FROM economy_mafias WHERE id = ?`, [user.mafiaId]))?.name || 'Mafia';
            await logEconomyEvent(interaction.guild.id, interaction.user.id, amount, 'mafia_treasury_deposit', {
                mafiaId: user.mafiaId,
                mafiaName: mafiaName,
                reason: 'Member donation'
            });
            return await interaction.editReply({ content: `✅ You donated **${amount}** coins to your mafia treasury!` });
        }

        if (sub === 'upgrade') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You are not in a mafia!' });

            const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
            if (member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can upgrade the mafia!' });

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const cost = mafia.level * 10000;

            if (mafia.balance < cost) {
                return await interaction.editReply({ content: `❌ Treasury needs **${cost}** coins to upgrade to Level ${mafia.level + 1}!` });
            }

            await db.run(`UPDATE economy_mafias SET balance = balance - ?, level = level + 1 WHERE id = ?`, [cost, user.mafiaId]);
            await logEconomyEvent(interaction.guild.id, interaction.user.id, cost, 'mafia_treasury_withdraw', {
                mafiaId: user.mafiaId,
                mafiaName: mafia.name,
                reason: `Upgrade Mafia to Level ${mafia.level + 1}`
            });
            
            const embed = new EmbedBuilder()
                .setTitle('👑 Mafia Level Up!')
                .setDescription(`The **${mafia.name}** mafia is now **Level ${mafia.level + 1}**!\n\n✨ Heist rewards have been increased.`)
                .setColor('#f59e0b');
            
            return await interaction.editReply({ embeds: [embed] });
        }

        if (sub === 'heist') {
            const targetBankId = interaction.options.getString('bank');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You must be in a mafia to coordinate a bank heist!' });

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const targetBank = await db.get(`SELECT * FROM economy_banks WHERE id = ?`, [targetBankId]);

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const participants = [interaction.user.id];
            const baseSuccess = 0.3 - (targetBank.security * 0.2);
            const upgrades = JSON.parse(mafia.upgrades || '[]');

            const getSuccessDisplay = (participantsCount) => {
                let rate = baseSuccess + Math.min(participantsCount * 0.05, 0.40);
                if (upgrades.includes('vests')) rate += 0.10;
                if (upgrades.includes('scanner')) rate += 0.05;
                if (mafia.specialization === 'Enforcers') rate += 0.10;
                if (mafia.level >= 10) rate += 0.05;
                const percent = Math.min(Math.floor(rate * 100), 99);
                const barLength = 15;
                const filled = Math.floor((percent / 100) * barLength);
                const bar = '🟩'.repeat(filled) + '⬜'.repeat(barLength - filled);
                return `**${percent}%**\n${bar}`;
            };

            const lobbyEmbed = new EmbedBuilder()
                .setTitle(`🚨 BANK HEIST IN PROGRESS: ${targetBank.name}`)
                .setDescription(`⚠️ **TACTICAL BRIEFING**\n<@${interaction.user.id}> is initiating a coordinated raid on the **${targetBank.name}**.\n\n*All active mafia members are requested to report for duty. High participation increases our window of success.*`)
                .addFields(
                    { name: '📊 Success Probability', value: getSuccessDisplay(participants.length), inline: false },
                    { name: '👥 Assault Team', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '⏳ Launch Window', value: '5 Minutes', inline: true },
                    { name: '🏛️ Bank Intel', value: `🛡️ Security: ${'⭐'.repeat(Math.ceil(targetBank.security * 5))}\n🛡️ Insurance: ${targetBank.insurance * 100}%`, inline: true }
                )
                .setFooter({ text: 'Click the button below to join the breach team!' })
                .setThumbnail('https://i.imgur.com/vH9Z3sW.png') // Generic heist icon
                .setColor('#ef4444');

            const joinBtn = new ButtonBuilder()
                .setCustomId('join_heist')
                .setLabel('Join Heist')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(joinBtn);

            const lobbyMsg = await interaction.editReply({ embeds: [lobbyEmbed], components: [row] });

            const collector = lobbyMsg.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async i => {
                if (participants.includes(i.user.id)) {
                    return await i.reply({ content: '❌ You are already in the heist!', ephemeral: true });
                }

                // Check if they are in the same mafia (query mafia_members which is always canonical)
                const pUser = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [i.user.id, interaction.guild.id]);
                if (!pUser || pUser.mafiaId !== user.mafiaId) {
                    return await i.reply({ content: '❌ You must be in this mafia to join the heist!', ephemeral: true });
                }

                participants.push(i.user.id);
                
                const updatedEmbed = EmbedBuilder.from(lobbyEmbed)
                    .setFields(
                        { name: '📊 Success Probability', value: getSuccessDisplay(participants.length), inline: false },
                        { name: '👥 Assault Team', value: participants.map(id => `<@${id}>`).join(', '), inline: true },
                        { name: '⏳ Launch Window', value: 'Lobby closing soon...', inline: true },
                        { name: '🏛️ Bank Intel', value: `🛡️ Security: ${'⭐'.repeat(Math.ceil(targetBank.security * 5))}\n🛡️ Insurance: ${targetBank.insurance * 100}%`, inline: true }
                    );

                await i.update({ embeds: [updatedEmbed] });
            });

            collector.on('end', async () => {
                // Calculate Success Rate based on participants
                let successRate = 0.3 - (targetBank.security * 0.2); // Lower base for collective
                
                // Participant Bonus: +5% per participant (max 40%)
                successRate += Math.min(participants.length * 0.05, 0.40);

                // Other Bonuses
                if (upgrades.includes('vests')) successRate += 0.10;
                if (upgrades.includes('scanner')) successRate += 0.05;
                if (mafia.specialization === 'Enforcers') successRate += 0.10;
                if (mafia.level >= 10) successRate += 0.05;

                const isSuccess = Math.random() < successRate;

                if (!isSuccess) {
                    const fine = Math.floor(2000 * (targetBank.security || 0.5) * 10);
                    await db.run(`UPDATE economy_mafias SET vault = MAX(0, vault - ?) WHERE id = ?`, [fine, user.mafiaId]);
                    
                    await logEconomyEvent(interaction.guild.id, null, fine, 'mafia_vault_withdraw', {
                        mafiaId: user.mafiaId,
                        mafiaName: mafia.name,
                        reason: `Failed Bank Heist on ${targetBank.name}`
                    });

                    // Owner of private bank gets the fine added to bank reserve!
                    if (targetBank.ownerId) {
                        await db.run(`UPDATE economy_banks SET reserve = reserve + ? WHERE id = ?`, [fine, targetBankId]);
                    }
                    
                    return await interaction.followUp({ 
                        content: `🧨 **HEIST FAILED!** The SWAT team arrived. The mafia lost **${fine}** in cleanup. Participants narrowly escaped.` 
                    });
                }

                // Success: Rob all users in the bank + Reserve
                const lootPercent = 0.05 + (Math.random() * 0.10);
                const usersInBank = await db.all(`SELECT userId, bank FROM users WHERE bankId = ? AND bank > 0 AND guildId = ?`, [targetBankId, interaction.guild.id]);
                
                let totalStolen = 0;
                for (const victim of usersInBank) {
                    const protection = targetBank.insurance || 0;
                    const actuallyStolen = Math.floor((victim.bank * lootPercent) * (1 - protection));
                    if (actuallyStolen > 0) {
                        totalStolen += actuallyStolen;
                        await db.run(`UPDATE users SET bank = bank - ? WHERE userId = ? AND guildId = ?`, [actuallyStolen, victim.userId, interaction.guild.id]);
                    }
                }

                // Steal from bank reserve too
                const reserveStolen = Math.floor((targetBank.reserve || 0) * (lootPercent / 2));
                if (reserveStolen > 0) {
                    totalStolen += reserveStolen;
                    await db.run(`UPDATE economy_banks SET reserve = reserve - ? WHERE id = ?`, [reserveStolen, targetBankId]);
                }

                // Distribution: 20% Vault, 80% Participants
                const vaultShare = Math.floor(totalStolen * 0.20);
                const memberShareTotal = totalStolen - vaultShare;
                const sharePerParticipant = Math.floor(memberShareTotal / participants.length);
                
                await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [vaultShare, user.mafiaId]);

                await logEconomyEvent(interaction.guild.id, null, vaultShare, 'mafia_vault_deposit', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Loot cut from Heist on ${targetBank.name}`
                });

                await logEconomyEvent(interaction.guild.id, null, totalStolen, 'bank_robbery', {
                    bankId: targetBankId,
                    bankName: targetBank.name,
                    vaultShare,
                    participantCut: sharePerParticipant,
                    team: participants.map(id => `<@${id}>`).join(', ')
                });

                if (sharePerParticipant > 0) {
                    for (const pid of participants) {
                        await db.run(
                            `INSERT INTO mafia_members (mafiaId, userId, dirtyMoney) VALUES (?, ?, ?)
                             ON CONFLICT(mafiaId, userId) DO UPDATE SET dirtyMoney = mafia_members.dirtyMoney + ?`,
                            [user.mafiaId, pid, sharePerParticipant, sharePerParticipant]
                        );
                        await logEconomyEvent(interaction.guild.id, pid, sharePerParticipant, 'dirty_money_gain', {
                            reason: `Breach team share from Heist on ${targetBank.name}`
                        });
                    }
                }

                const resultEmbed = new EmbedBuilder()
                    .setTitle('💣 HEIST COMPLETE: SUCCESS')
                    .setDescription(`The heist on **${targetBank.name}** was a total success!`)
                    .addFields(
                        { name: '<:zenith_coin:1510656265830011031> Total Loot', value: `**${totalStolen}** Zenith Coins`, inline: true },
                        { name: '<:zenith_bank:1510681878032552166> Vault Share (20%)', value: `+${vaultShare} <:zenith_coin:1510656265830011031>`, inline: true },
                        { name: '<:zenith_user:1510658870790590646> Participant Cut (80%)', value: `+${sharePerParticipant} <:zenith_coin:1510656265830011031> to each participant`, inline: true },
                        { name: '👥 Team', value: participants.map(id => `<@${id}>`).join(', ') }
                    )
                    .setColor('#10b981')
                    .setFooter({ text: '💡 You earned Dirty Money! Run "/mafia clean" to launder it into clean coins.' })
                    .setTimestamp();

                await interaction.followUp({ embeds: [resultEmbed] });
            });
            return;
        }

        if (sub === 'raid') {
            const targetBizId = interaction.options.getString('business');
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ You must be in a mafia to coordinate a raid!' });

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            const targetBiz = await db.get(`SELECT * FROM economy_operations WHERE id = ?`, [targetBizId]);

            if (!targetBiz) return await interaction.editReply({ content: '❌ Private business not found!' });

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const participants = [interaction.user.id];
            const baseSuccess = 0.5 - (targetBiz.level * 0.05); // more upgraded businesses are harder to raid
            const upgrades = JSON.parse(mafia.upgrades || '[]');

            const getSuccessDisplay = (participantsCount) => {
                let rate = baseSuccess + Math.min(participantsCount * 0.05, 0.40);
                if (upgrades.includes('vests')) rate += 0.10;
                if (upgrades.includes('scanner')) rate += 0.05;
                if (mafia.specialization === 'Enforcers') rate += 0.10;
                if (mafia.level >= 10) rate += 0.05;
                const percent = Math.min(Math.floor(rate * 100), 99);
                const barLength = 15;
                const filled = Math.floor((percent / 100) * barLength);
                const bar = '🟩'.repeat(filled) + '⬜'.repeat(barLength - filled);
                return `**${percent}%**\n${bar}`;
            };

            const lobbyEmbed = new EmbedBuilder()
                .setTitle(`💥 PRIVATE BUSINESS RAID: ${targetBiz.type.toUpperCase()}`)
                .setDescription(`⚠️ **ASSAULT BRIEFING**\n<@${interaction.user.id}> is planning a hostile raid on a private enterprise (**ID: ${targetBizId}**).\n\n*Gather the breach crew! This legal operations cash belongs to the family.*`)
                .addFields(
                    { name: '📊 Success Probability', value: getSuccessDisplay(participants.length), inline: false },
                    { name: '👥 Assault Team', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '⏳ Launch Window', value: '5 Minutes', inline: true },
                    { name: '🏢 Business Security', value: `🛡️ Defense Level: ${targetBiz.level} ⭐\n📍 Owner: <@${targetBiz.userId}>`, inline: true }
                )
                .setFooter({ text: 'Click the button below to join the raid team!' })
                .setThumbnail('https://i.imgur.com/vH9Z3sW.png')
                .setColor('#e11d48');

            const joinBtn = new ButtonBuilder()
                .setCustomId('join_heist') // re-use join heists lobby id for easy button handling
                .setLabel('Join Raid')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(joinBtn);

            const lobbyMsg = await interaction.editReply({ embeds: [lobbyEmbed], components: [row] });
            const collector = lobbyMsg.createMessageComponentCollector({ time: 300000 });

            collector.on('collect', async i => {
                if (participants.includes(i.user.id)) {
                    return await i.reply({ content: '❌ You are already in the raid!', ephemeral: true });
                }

                const pUser = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [i.user.id, interaction.guild.id]);
                if (!pUser || pUser.mafiaId !== user.mafiaId) {
                    return await i.reply({ content: '❌ You must be in this mafia to join the raid!', ephemeral: true });
                }

                participants.push(i.user.id);
                
                const updatedEmbed = EmbedBuilder.from(lobbyEmbed)
                    .setFields(
                        { name: '📊 Success Probability', value: getSuccessDisplay(participants.length), inline: false },
                        { name: '👥 Assault Team', value: participants.map(id => `<@${id}>`).join(', '), inline: true },
                        { name: '⏳ Launch Window', value: 'Lobby closing soon...', inline: true },
                        { name: '🏢 Business Security', value: `🛡️ Defense Level: ${targetBiz.level} ⭐\n📍 Owner: <@${targetBiz.userId}>`, inline: true }
                    );

                await i.update({ embeds: [updatedEmbed] });
            });

            collector.on('end', async () => {
                let successRate = baseSuccess + Math.min(participants.length * 0.05, 0.40);
                if (upgrades.includes('vests')) successRate += 0.10;
                if (upgrades.includes('scanner')) successRate += 0.05;
                if (mafia.specialization === 'Enforcers') successRate += 0.10;
                if (mafia.level >= 10) successRate += 0.05;

                const isSuccess = Math.random() < successRate;

                if (!isSuccess) {
                    const fine = 1000 * targetBiz.level;
                    await db.run(`UPDATE economy_mafias SET vault = MAX(0, vault - ?) WHERE id = ?`, [fine, user.mafiaId]);
                    
                    await logEconomyEvent(interaction.guild.id, null, fine, 'mafia_vault_withdraw', {
                        mafiaId: user.mafiaId,
                        mafiaName: mafia.name,
                        reason: `Failed Raid on Business ID ${targetBizId}`
                    });

                    // Owner of business gets the fine as insurance / defensive cleanup!
                    await addBalance(targetBiz.userId, fine, interaction.guild.id, true, `Defense payout from failed raid on business ${targetBizId}`, true);

                    return await interaction.followUp({ 
                        content: `👮 **RAID FOILED!** The security forces defended the building. The mafia lost **${fine}** in cleanup. Participants narrowly escaped.` 
                    });
                }

                // Success: Rob pending profits + 15% of owner's wallet cash (up to 5000)
                const bizData = {
                    car_wash: { income: 200 },
                    nightclub: { income: 1000 },
                    law_firm: { income: 3000 },
                    tech_lab: { income: 8000 }
                };
                const hoursPassed = Math.floor((new Date() - new Date(targetBiz.lastCollect + ' UTC')) / 3600000);
                const pendingProfits = hoursPassed * (bizData[targetBiz.type]?.income || 100) * targetBiz.level;
                
                // Steal wallet cash too
                const owner = await db.get(`SELECT balance FROM users WHERE userId = ? AND guildId = ?`, [targetBiz.userId, interaction.guild.id]);
                const walletStolen = Math.min(Math.floor((owner?.balance || 0) * 0.15), 5000);

                const totalStolen = pendingProfits + walletStolen;

                if (totalStolen > 0) {
                    // Reset business collect timestamp
                    await db.run(`UPDATE economy_operations SET lastCollect = CURRENT_TIMESTAMP WHERE id = ?`, [targetBizId]);
                    // Deduct from owner
                    if (walletStolen > 0) {
                        await removeBalance(targetBiz.userId, walletStolen, interaction.guild.id, `Stolen from wallet during raid on business ${targetBizId}`);
                    }
                }

                // Distribution: 20% Vault, 80% Participants
                const vaultShare = Math.floor(totalStolen * 0.20);
                const memberShareTotal = totalStolen - vaultShare;
                const sharePerParticipant = Math.floor(memberShareTotal / participants.length);

                await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [vaultShare, user.mafiaId]);

                await logEconomyEvent(interaction.guild.id, null, vaultShare, 'mafia_vault_deposit', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Raid share from business ${targetBizId}`
                });

                await logEconomyEvent(interaction.guild.id, null, totalStolen, 'business_raid', {
                    businessId: targetBizId,
                    businessType: targetBiz.type,
                    ownerId: targetBiz.userId,
                    vaultShare,
                    participantCut: sharePerParticipant,
                    team: participants.map(id => `<@${id}>`).join(', ')
                });

                if (sharePerParticipant > 0) {
                    for (const pid of participants) {
                        await addBalance(pid, sharePerParticipant, interaction.guild.id, true, `Raid share from business ${targetBizId}`, true);
                    }
                }

                const resultEmbed = new EmbedBuilder()
                    .setTitle('🔥 RAID COMPLETE: SUCCESS')
                    .setDescription(`The raid on **ID: ${targetBizId}** owned by <@${targetBiz.userId}> was a huge success!`)
                    .addFields(
                        { name: '💰 Stolen Profits', value: `**${pendingProfits}** 🪙`, inline: true },
                        { name: '🔑 Safe Stolen', value: `**${walletStolen}** 🪙`, inline: true },
                        { name: '🏢 Vault Share (20%)', value: `+${vaultShare} 🪙`, inline: true },
                        { name: '👥 Participant Cut (80%)', value: `+${sharePerParticipant} 🪙 to each participant`, inline: true },
                        { name: '👥 Team', value: participants.map(id => `<@${id}>`).join(', ') }
                    )
                    .setColor('#10b981')
                    .setTimestamp();

                await interaction.followUp({ embeds: [resultEmbed] });
            });
            return;
        }

        if (subGroup === 'business') {
            const user = await db.get(`SELECT mafiaId FROM mafia_members WHERE userId = ? AND mafiaId IN (SELECT id FROM economy_mafias WHERE guildId = ?)`, [interaction.user.id, interaction.guild.id]);
            if (!user || !user.mafiaId) return await interaction.editReply({ content: '❌ Need a mafia for this!' });

            const mafia = await db.get(`SELECT * FROM economy_mafias WHERE id = ?`, [user.mafiaId]);
            
            if (sub === 'buy') {
                const type = interaction.options.getString('type');
                const customName = interaction.options.getString('name') || type.toUpperCase();

                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can authorize business acquisitions!' });

                const existing = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                if (existing) return await interaction.editReply({ content: `❌ Your mafia already owns a **${type}** venture!` });

                const prices = { car_wash: 50000, nightclub: 200000, tech_lab: 500000, law_firm: 1000000, lab: 750000, cash: 500000 };
                const price = prices[type];

                if (mafia.vault < price) return await interaction.editReply({ content: `❌ Mafia vault needs **${price}** coins for this acquisition!` });

                await db.run(`UPDATE economy_mafias SET vault = vault - ? WHERE id = ?`, [price, user.mafiaId]);
                await db.run(`INSERT INTO mafia_businesses (mafiaId, type, customName) VALUES (?, ?, ?)`, [user.mafiaId, type, customName]);
                
                await logEconomyEvent(interaction.guild.id, interaction.user.id, price, 'mafia_vault_withdraw', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Acquired Underworld Venture: ${customName} (${type})`
                });

                const embed = new EmbedBuilder()
                    .setTitle('🏢 Zenith Foreclosures — Acquisition Confirmed')
                    .setDescription(`Congratulations! Your mafia now owns the **${customName}** (${type}).\n\nVisit your business empire status to manage it.`)
                    .setColor('#10b981');

                return await interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'status') {
                const businesses = await db.all(`SELECT * FROM mafia_businesses WHERE mafiaId = ?`, [user.mafiaId]);
                if (businesses.length === 0) return await interaction.editReply({ content: '❌ Your mafia owns no businesses. Use `/mafia business buy` to start your empire.' });

                const embed = new EmbedBuilder()
                    .setTitle(`💼 ${mafia.name} — Business Empire`)
                    .setColor('#6366f1');

                for (const b of businesses) {
                    const salary = b.salary || 0;
                    const expenses = (b.employeeCount || 0) * salary;
                    embed.addFields({
                        name: `${b.customName || b.type.toUpperCase()} (Lvl ${b.level})`,
                        value: `📦 Stock: ${b.stock.toLocaleString('en-US')}\n🔋 Supplies: ${b.supplies}%\n👥 Employees: ${b.employeeCount || 0}\n💸 Salary: ${salary.toLocaleString('en-US')} / cycle\n📉 Expenses: **${expenses.toLocaleString('en-US')}** / cycle\n📊 Market Share: **${(b.marketShare * 100).toFixed(1)}%**`,
                        inline: true
                    });
                }

                // If Don, show personal businesses too
                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (member && member.rank === 'Don') {
                    const personal = await db.all(`SELECT * FROM economy_operations WHERE userId = ?`, [interaction.user.id]);
                    if (personal.length > 0) {
                        embed.addFields({ name: '\u200B', value: '👤 **Don\'s Personal Portfolio**' });
                        for (const p of personal) {
                            embed.addFields({
                                name: `🏙️ ${p.type.replace('_', ' ').toUpperCase()} (ID: ${p.id})`,
                                value: `📊 Lvl: ${p.level} | 📈 Share: ${(p.marketShare * 100).toFixed(1)}%`,
                                inline: true
                            });
                        }
                    }
                }

                return await interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'sell') {
                const type = interaction.options.getString('type');
                const b = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                if (!b || b.stock <= 0) return await interaction.editReply({ content: '❌ No stock to sell!' });

                const multiplier = b.type === 'lab' ? 150 : (b.type === 'cash' ? 100 : 1);
                const totalValue = b.stock * multiplier;

                // Dividends
                let mafiaProfit = totalValue;
                if (b.publicShares > 0) {
                    const shareCut = Math.floor(totalValue * (b.publicShares / b.totalShares));
                    mafiaProfit -= shareCut;
                    
                    const holders = await db.all(`SELECT userId, shares FROM mafia_stocks WHERE mafiaId = ? AND businessType = ?`, [user.mafiaId, type]);
                    for (const h of holders) {
                        const hCut = Math.floor(shareCut * (h.shares / b.publicShares));
                        if (hCut > 0) {
                            await addBalance(h.userId, hCut, interaction.guild.id, true, `Stock dividend from ${b.customName || type.toUpperCase()}`, true);
                        }
                    }
                }

                await db.run(`UPDATE mafia_businesses SET stock = 0 WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                await db.run(`UPDATE economy_mafias SET vault = vault + ? WHERE id = ?`, [mafiaProfit, user.mafiaId]);

                await logEconomyEvent(interaction.guild.id, interaction.user.id, mafiaProfit, 'mafia_vault_deposit', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Profit from selling stock of ${b.customName || type.toUpperCase()}`
                });

                const embed = new EmbedBuilder()
                    .setTitle('🚚 Sell Mission Successful')
                    .setDescription(`You successfully moved the stock from the **${type.toUpperCase()}**.\n\n**Total Value:** ${totalValue} 🪙\n**Dividends Paid:** ${totalValue - mafiaProfit} 🪙\n**Mafia Profit:** ${mafiaProfit} 🪙`)
                    .setColor('#10b981');

                return await interaction.editReply({ embeds: [embed] });
            }

            if (sub === 'restock') {
                const type = interaction.options.getString('type');
                if (type === 'nightclub') return await interaction.editReply({ content: '❌ Nightclubs do not require supplies.' });

                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                const allowed = ['Don', 'Consigliere', 'Underboss', 'Advisor', 'Staff'];
                if (!member || !allowed.includes(member.rank)) return await interaction.editReply({ content: '❌ Only the Don and Management (Consigliere+) can restock!' });

                const cost = 75000;
                if (mafia.vault < cost) return await interaction.editReply({ content: `❌ Mafia vault needs **${cost}** coins for supplies!` });

                await db.run(`UPDATE economy_mafias SET vault = vault - ? WHERE id = ?`, [cost, user.mafiaId]);
                await db.run(`UPDATE mafia_businesses SET supplies = 100 WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                
                await logEconomyEvent(interaction.guild.id, interaction.user.id, cost, 'mafia_vault_withdraw', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Restocked supplies for business: ${b?.customName || type.toUpperCase()}`
                });

                return await interaction.editReply({ content: `✅ Supplies delivered to the **${type.toUpperCase()}**. Production resumed.` });
            }

            if (sub === 'go-public') {
                const type = interaction.options.getString('type');
                const shares = interaction.options.getInteger('shares');
                const price = interaction.options.getInteger('price');

                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can take the business public!' });

                const b = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                if (!b) return await interaction.editReply({ content: '❌ Business not found!' });

                if (b.publicShares + shares > 500) return await interaction.editReply({ content: '❌ You can only issue up to 50% (500 shares) of the company.' });

                await db.run(`UPDATE mafia_businesses SET publicShares = publicShares + ?, sharePrice = ? WHERE mafiaId = ? AND type = ?`, [shares, price, user.mafiaId, type]);

                return await interaction.editReply({ content: `✅ **IPO Successful!** You have issued **${shares}** shares of your **${type}** at **${price}** 🪙 each.` });
            }

            if (sub === 'upgrade') {
                const type = interaction.options.getString('type');
                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can authorize business expansions!' });

                const b = await db.get(`SELECT * FROM mafia_businesses WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);
                if (!b) return await interaction.editReply({ content: '❌ Business not found!' });

                const basePrices = { nightclub: 1000000, lab: 750000, cash: 500000 };
                const upgradeCost = Math.floor(basePrices[type] * (b.level + 1) * 0.75);

                if (mafia.vault < upgradeCost) return await interaction.editReply({ content: `❌ Mafia vault needs **${upgradeCost}** coins for this expansion!` });

                await db.run(`UPDATE economy_mafias SET vault = vault - ? WHERE id = ?`, [upgradeCost, user.mafiaId]);
                await db.run(`UPDATE mafia_businesses SET level = level + 1 WHERE mafiaId = ? AND type = ?`, [user.mafiaId, type]);

                await logEconomyEvent(interaction.guild.id, interaction.user.id, upgradeCost, 'mafia_vault_withdraw', {
                    mafiaId: user.mafiaId,
                    mafiaName: mafia.name,
                    reason: `Upgraded Underworld Venture ${b.customName || type.toUpperCase()} to Level ${b.level + 1}`
                });

                return await interaction.editReply({ content: `✅ **Expansion Complete!** The **${type.toUpperCase()}** is now **Level ${b.level + 1}**. Production capacity increased!` });
            }

            if (sub === 'hire') {
                const type = interaction.options.getString('type');
                const status = interaction.options.getBoolean('status');
                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || (member.rank !== 'Don' && member.rank !== 'Consigliere')) return await interaction.editReply({ content: '❌ Only the Don or Consigliere can manage recruitment!' });

                await db.run(`UPDATE mafia_businesses SET hiringEnabled = ? WHERE mafiaId = ? AND type = ?`, [status ? 1 : 0, user.mafiaId, type]);
                return await interaction.editReply({ content: `📢 Recruitment for **${type.toUpperCase()}** is now **${status ? 'OPEN' : 'CLOSED'}**.` });
            }

            if (sub === 'salary') {
                const type = interaction.options.getString('type');
                const amount = interaction.options.getInteger('amount');
                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can set salaries!' });

                await db.run(`UPDATE mafia_businesses SET salary = ? WHERE mafiaId = ? AND type = ?`, [amount, user.mafiaId, type]);
                return await interaction.editReply({ content: `💰 Underworld salary for **${type.toUpperCase()}** set to **${amount}** dirty bills.` });
            }

            if (sub === 'cooldown') {
                const type = interaction.options.getString('type');
                const hours = interaction.options.getInteger('hours');
                const member = await db.get(`SELECT rank FROM mafia_members WHERE userId = ? AND mafiaId = ?`, [interaction.user.id, user.mafiaId]);
                if (!member || member.rank !== 'Don') return await interaction.editReply({ content: '❌ Only the Don can set cooldowns!' });

                const cooldownSeconds = hours * 3600;
                await db.run(`UPDATE mafia_businesses SET cooldown = ? WHERE mafiaId = ? AND type = ?`, [cooldownSeconds, user.mafiaId, type]);
                return await interaction.editReply({ content: `⏱️ Underworld work cooldown for **${type.toUpperCase()}** set to **${hours}** hours (${cooldownSeconds} seconds).` });
            }
        }
    },
};
