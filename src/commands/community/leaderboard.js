const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Displays a server leaderboard.')
    .addStringOption(option =>
        option.setName('type')
            .setDescription('The type of leaderboard to display')
            .setRequired(false)
            .addChoices(
                { name: 'Levels & XP', value: 'levels' },
                { name: 'Economy & Balance', value: 'economy' },
                { name: 'Swear Jar', value: 'swears' }
            )),
            
  async execute(interaction) {
    await interaction.deferReply();
    const db = await getDb();
    
    const type = interaction.options.getString('type') || 'levels';
    const conf = await db.get(`SELECT levelingBackground, leaderboardImageEnabled FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
    
    const defaultBgPath = path.join(process.cwd(), 'zenith_bg - Copy.png');
    const background = conf?.levelingBackground || null;
    const useImage = true;
    const bgPath = background || defaultBgPath;

    let title = '🏆 Zenith Leaderboard';
    let embedTitle = '🏆 Zenith Leaderboard';
    let entries = [];
    let embedDesc = '';
    let color = '#FFD700';

    if (type === 'levels') {
        title = '🏆  Leveling Leaderboard';
        embedTitle = '🏆 Leveling Leaderboard';
        const topUsers = await db.all(`SELECT userId, xp, level FROM users ORDER BY level DESC, xp DESC LIMIT 10`);
        
        if (useImage) {
            for (const u of topUsers) {
                let name = `User ${u.userId.slice(-4)}`;
                try {
                    const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                    if (member) name = member.displayName || member.user.username;
                } catch (e) {}
                entries.push({ name, value: `Lv.${u.level}  •  ${u.xp} XP` });
            }
        } else {
            embedDesc = topUsers.length > 0
                ? topUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> - Level **${u.level}** (${u.xp} XP)`).join('\n')
                : 'No users found in the leaderboard.';
        }
    } 
    else if (type === 'economy') {
        title = '🪙  Economy Leaderboard';
        embedTitle = '🪙 Economy Leaderboard';
        color = '#F59E0B';
        const topUsersRaw = await db.all(`SELECT userId, balance, bank FROM users`);
        
        const processedUsers = topUsersRaw.map(u => {
            const balanceVal = BigInt(u.balance || 0);
            const bankVal = BigInt(u.bank || 0);
            return {
                userId: u.userId,
                balance: balanceVal,
                bank: bankVal,
                total: balanceVal + bankVal
            };
        })
        .filter(u => u.total > 0n)
        .sort((a, b) => {
            if (b.total > a.total) return 1;
            if (b.total < a.total) return -1;
            if (b.balance > a.balance) return 1;
            if (b.balance < a.balance) return -1;
            return 0;
        })
        .slice(0, 10);
        
        if (useImage) {
            for (const u of processedUsers) {
                let name = `User ${u.userId.slice(-4)}`;
                try {
                    const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                    if (member) name = member.displayName || member.user.username;
                } catch (e) {}
                entries.push({ name, value: `🪙 ${u.total.toLocaleString()}` });
            }
        } else {
            embedDesc = processedUsers.length > 0
                ? processedUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> - **🪙 ${u.total.toLocaleString()}** (Cash: ${u.balance.toLocaleString()}, Bank: ${u.bank.toLocaleString()})`).join('\n')
                : 'No economy data found.';
        }
    } 
    else if (type === 'swears') {
        title = '🤬  Swears Leaderboard';
        embedTitle = '🤬 Swears Leaderboard';
        color = '#EF4444';
        const topUsers = await db.all(`SELECT userId, count FROM swear_jar_counts WHERE count > 0 AND guildId = ? ORDER BY count DESC LIMIT 10`, [interaction.guild.id]);
        
        if (useImage) {
            for (const u of topUsers) {
                let name = `User ${u.userId.slice(-4)}`;
                try {
                    const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
                    if (member) name = member.displayName || member.user.username;
                } catch (e) {}
                entries.push({ name, value: `🤬 ${u.count.toLocaleString()} swears` });
            }
        } else {
            embedDesc = topUsers.length > 0
                ? topUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> - **${u.count.toLocaleString()}** swears`).join('\n')
                : 'The swear jar is empty!';
        }
    }

    // --- IMAGE MODE ---
    if (useImage) {
        const { generateLeaderboardImage } = require('../../utils/imageGenerator');
        const buffer = await generateLeaderboardImage(title, entries, bgPath);
        const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
        return interaction.editReply({ files: [attachment] });
    }

    // --- CLASSIC MODE ---
    const files = [];
    let imageUrl = background;

    if (!background) {
        const attachment = new AttachmentBuilder(defaultBgPath, { name: 'leaderboard_bg.png' });
        files.push(attachment);
        imageUrl = 'attachment://leaderboard_bg.png';
    }

    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setColor(color)
        .setThumbnail(interaction.guild.iconURL())
        .setImage(imageUrl)
        .setDescription(embedDesc);

    interaction.editReply({ embeds: [embed], files });
  }
};
