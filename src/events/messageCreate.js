const { AttachmentBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');
const { handleApplicationMessage } = require('../utils/applicationHandler');
const { getISOWeekString } = require('../utils/dateHelpers');
const { buildMessage } = require('../utils/messageBuilder');
const { addBalance } = require('../utils/economyHandler');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        // We'll handle the bot check later to allow New Kingdom alerts (which usually come from bots)

        // Catch DMs for applications
        if (message.channel.type === ChannelType.DM) {
            return await handleApplicationMessage(message, message.client);
        }

        if (!message.guild) return;

        const db = await getDb();

        // 1. Intercept global New Kingdom feed alerts (channel 1505011607636414545)
        if (message.channel.id === '1505011607636414545' && message.author.id !== client.user.id) {
            const activeKingdomConfigs = await db.all(
                `SELECT * FROM module_configs WHERE newkingdomenabled = 1`
            );

            if (activeKingdomConfigs.length > 0) {
                const { handleNewKingdom } = require('../features/newKingdom');
                for (const cfgRaw of activeKingdomConfigs) {
                    const conf = Object.keys(cfgRaw).reduce((acc, key) => {
                        acc[key.toLowerCase()] = cfgRaw[key];
                        return acc;
                    }, {});
                    try {
                        await handleNewKingdom(message, conf);
                    } catch (e) {
                        console.error(`[New Kingdom Global Process Error] for guild ${conf.guildid}:`, e.message);
                    }
                }
            }
            // Return early to prevent executing welcome, auto-mod, leveled messages, or logging on foreign servers
            return;
        }


        const confRaw = await db.get(`SELECT * FROM module_configs WHERE guildid = ?`, [message.guild.id]);
        if (!confRaw) return;
        
        // Normalize keys to lowercase for consistent access across different DB providers
        const conf = Object.keys(confRaw).reduce((acc, key) => {
            acc[key.toLowerCase()] = confRaw[key];
            return acc;
        }, {});

        // Ignore other bots
        if (message.author.bot) return;
        // Ignore ourself to avoid infinite loops
        if (message.author.id === client.user.id) return;

        // Ensure message.member exists for all guild operations and checks
        if (!message.member) return;

        if (true) {
            // Custom bots should NOT run server management features (auto-mod, leveling, swear jar, etc.)
            // They only handle AI agent responses via aiAgent.js
            if (client.isCustomBot) return;

            // --- 1. AUTO-MODERATION ---
            if (conf.automodenabled) {
                let shouldDelete = false;
                let reason = '';

                // Anti-Mentions
                if (conf.automodmentions && message.mentions.users.size > conf.automodmaxmentions) {
                    shouldDelete = true;
                    reason = 'Too many mentions';
                }

                // Anti-Links (Ignore if admin)
                if (!shouldDelete && conf.automodlinks && !message.member.permissions.has('Administrator')) {
                    const linkRegex = new RegExp('https?://\\S+', 'g');
                    if (linkRegex.test(message.content)) {
                        shouldDelete = true;
                        reason = 'Unauthorized links';
                    }
                }

                // Anti-Caps
                if (!shouldDelete && conf.automodcaps && message.content.length > 5) {
                    const upper = message.content.replace(/[^A-Z]/g, '').length;
                    if ((upper / message.content.length) > 0.7) {
                        shouldDelete = true;
                        reason = 'Excessive CAPS';
                    }
                }

                // Bad Words
                if (!shouldDelete && conf.automodwords && conf.automodwordlist) {
                    const badWords = conf.automodwordlist.split(',').map(w => w.trim().toLowerCase());
                    const msgLower = message.content.toLowerCase();
                    for (const w of badWords) {
                        if (w) {
                            const escapedW = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedW}(?![\\p{L}\\p{N}_])`, 'iu');
                            if (regex.test(msgLower)) {
                                shouldDelete = true;
                                reason = 'Banned words';
                                break;
                            }
                        }
                    }
                }

                if (shouldDelete) {
                    await message.delete().catch(() => {});
                    const warningMsg = await message.channel.send(`⚠️ <@${message.author.id}>, your message was removed: **${reason}**.`);
                    setTimeout(() => warningMsg.delete().catch(() => {}), 3000);
                    
                    if (conf.automodlogchannel) {
                        const logChannel = message.guild.channels.cache.get(conf.automodlogchannel);
                        if (logChannel) {
                            const embed = new AttachmentBuilder(Buffer.from(''), { name: 'filler' }); // placeholder if needed
                            logChannel.send(`🛡️ **AutoMod Alert** | User: <@${message.author.id}> | Reason: ${reason}`);
                        }
                    }
                    return; // Stop processing further
                }
            }

            // --- 2. COUNTING GAME ---
            if (conf.countingenabled && conf.countingchannel === message.channel.id) {
                let num = null;
                
                if (conf.countingmath) {
                    const exprMatch = message.content.match(/^[-+*/%\s\d().]+/);
                    if (exprMatch) {
                        try {
                            const evaluated = new Function('return ' + exprMatch[0])();
                            if (typeof evaluated === 'number' && !isNaN(evaluated)) {
                                num = evaluated;
                            }
                        } catch(e) {}
                    }
                } else {
                    const match = message.content.match(/^\d+/);
                    if (match) num = parseInt(match[0], 10);
                }

                if (num === null) {
                    // Chat messages are not allowed in the counting channel
                    await message.delete().catch(() => {});
                    const chatEmbed = new EmbedBuilder()
                        .setDescription(`⚠️ <@${message.author.id}>, **this channel is only for counting!** Please use another channel for chatting.`)
                        .setColor('Orange');
                    const chatMsg = await message.channel.send({ embeds: [chatEmbed] });
                    setTimeout(() => chatMsg.delete().catch(() => {}), 5000);
                    return;
                }

                const isCorrectNum = (num === conf.countingcurrent + 1);
                const isSameUser = (message.author.id === conf.countinglastuser);

                if (isCorrectNum && !conf.countingsameuser && isSameUser) {
                    // Right number, but counting twice in a row (Warning, no reset)
                    await message.delete().catch(() => {});
                    const warnEmbed = new EmbedBuilder()
                        .setDescription(`⚠️ **<@${message.author.id}>, you cannot count twice in a row!** Wait for someone else to take a turn.`)
                        .setColor('Orange');
                    const warnMsg = await message.channel.send({ embeds: [warnEmbed] });
                    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
                }
                else if (isCorrectNum) {
                    // Right number, valid user (Proceed)
                    await message.react('✅').catch(() => {});
                    await db.run(`UPDATE module_configs SET countingcurrent = ?, countinglastuser = ? WHERE guildid = ?`, [num, message.author.id, message.guild.id]);
                } 
                else if (conf.countingreset) {
                    // Wrong number triggers nuclear reset
                    await message.react('❌').catch(() => {});
                    const resetEmbed = new EmbedBuilder()
                        .setTitle("💥 Sequence Detonated!")
                        .setDescription(`**<@${message.author.id}>** ruined the sequence by putting \`${num}\`!\n\nThe stack has been reset to **0**. Start again from \`1\`.`)
                        .setColor('Red');
                    await message.channel.send({ embeds: [resetEmbed] });
                    await db.run(`UPDATE module_configs SET countingcurrent = 0, countinglastuser = NULL WHERE guildid = ?`, [message.guild.id]);
                } 
                else {
                    // Wrong number, but Reset disabled (delete and warn user)
                    await message.delete().catch(() => {});
                    const wrongEmbed = new EmbedBuilder()
                        .setDescription(`⚠️ **<@${message.author.id}>, that is the wrong number!**\nThe current count is **${conf.countingcurrent}**, so the next number must be **${conf.countingcurrent + 1}**.`)
                        .setColor('Orange');
                    const wrongMsg = await message.channel.send({ embeds: [wrongEmbed] });
                    setTimeout(() => wrongMsg.delete().catch(() => {}), 5000);
                }
                return; // Don't give XP for just counting
            }

            // --- 3. LEVELING SYSTEM ---
            if (conf.levelingenabled) {
                try {
                    // XP Cooldown check (in-memory)
                    const cooldownMs = (conf.xpcooldown || 60) * 1000;
                    const cooldownKey = `${message.guild.id}_${message.author.id}`;
                    const now = Date.now();
                    const lastXp = module.exports._xpCooldowns.get(cooldownKey);
                    
                    if (!lastXp || (now - lastXp) >= cooldownMs) {
                        module.exports._xpCooldowns.set(cooldownKey, now);
                        
                        const xpAmount = Math.floor(Math.random() * ((conf.xpmax || 15) - (conf.xpmin || 5) + 1)) + (conf.xpmin || 5);
                        
                        await db.run(
                            `INSERT INTO users (userId, xp, level) VALUES (?, ?, 0)
                            ON CONFLICT(userId) DO UPDATE SET xp = users.xp + ?`,
                            [message.author.id, xpAmount, xpAmount]
                        );
                        
                        const userProfile = await db.get(`SELECT * FROM users WHERE userId = ?`, [message.author.id]);
                        if (!userProfile) return;
                        
                        const currentLevel = userProfile.level;
                        const requiredXP = 5 * (currentLevel ** 2) + 50 * currentLevel + 100;

                        if (userProfile.xp >= requiredXP) {
                            await db.run(`UPDATE users SET level = level + 1, xp = 0 WHERE userId = ?`, [message.author.id]);
                            
                            const upChannel = conf.levelupchannel ? message.guild.channels.cache.get(conf.levelupchannel) : message.channel;
                            if (upChannel) {
                                let title = conf.leveluptitle || '<:zenith_levelup:1510658706763944056> Level Up!';
                                let desc = conf.levelupmessage || `Congratulations <@${message.author.id}>, you just leveled up to **Level ${currentLevel + 1}**!`;
                                
                                const pTitle = title.replace('{user}', `<@${message.author.id}>`)
                                                    .replace('{level}', currentLevel + 1)
                                                    .replace('{server}', message.guild.name);
                                const pDesc = desc.replace('{user}', `<@${message.author.id}>`)
                                                .replace('{level}', currentLevel + 1)
                                                .replace('{server}', message.guild.name);

                                const payload = buildMessage(conf.levelupuseembed !== 0, {
                                    title: pTitle,
                                    description: pDesc,
                                    color: conf.levelupcolor || '#FFD700'
                                });
                                upChannel.send(payload).catch(() => {});
                            }

                            // Check Role Rewards (if configured)
                            try {
                                let rewards = [];
                                try {
                                    const parsed = JSON.parse(conf.rolerewards || '[]');
                                    rewards = Array.isArray(parsed) ? parsed : [];
                                } catch (e) {}

                                const reward = rewards.find(r => r && parseInt(r.level) === currentLevel + 1);
                                if (reward && reward.roleId) {
                                    const rr = message.guild.roles.cache.get(reward.roleId.replace(/[^0-9]/g, ''));
                                    if (rr) await message.member.roles.add(rr).catch(()=>{});
                                }
                            } catch(e) {}
                        }
                    }
                } catch (e) {
                    console.error('Leveling error:', e.message);
                }
            }

            // --- 3.5 ECONOMY REWARDS ---
            if (conf.ecoenabled) {
                try {
                    const cooldownMs = (conf.xpcooldown || 60) * 1000;
                    const cooldownKey = `eco_${message.guild.id}_${message.author.id}`;
                    const now = Date.now();
                    const lastReward = module.exports._ecoCooldowns.get(cooldownKey);

                    if (!lastReward || (now - lastReward) >= cooldownMs) {
                        module.exports._ecoCooldowns.set(cooldownKey, now);
                        
                        // Per-character reward: 0.2 to 1.0 coins per char
                        const charCount = message.content.length;
                        const multiplier = 0.2 + (Math.random() * 0.8); // random between 0.2 and 1.0
                        const amount = Math.max(1, Math.floor(charCount * multiplier));
                        
                        await addBalance(message.author.id, amount, message.guild.id);
                    }

                    // Welcome reward check
                    if (conf.welcomechannel === message.channel.id) {
                        const keywords = (conf.ecowelcomekeywords || 'welcome,bienvenido,bienvenida').split(',').map(k => k.trim().toLowerCase());
                        const content = message.content.toLowerCase();
                        if (keywords.some(k => k.length > 0 && content.includes(k))) {
                            const amount = conf.ecocoinsperwelcome || 5;
                            await addBalance(message.author.id, amount, message.guild.id);
                        }
                    }
                } catch (e) {
                    console.error('Economy reward error:', e.message);
                }
            }

            // --- 4. R4 TRACKING (MESSAGES) ---
            if (conf.r4trackingenabled && conf.r4trackingrole) {
                try {
                    if (message.member.roles.cache.has(conf.r4trackingrole.replace(/[^0-9]/g, ''))) {
                        const weekId = getISOWeekString();
                        await db.run(
                            `INSERT INTO r4_tracking (userId, guildId, weekId, messages, ads, excused) 
                            VALUES (?, ?, ?, 1, 0, 0)
                            ON CONFLICT(userId, guildId, weekId) DO UPDATE SET messages = r4_tracking.messages + 1`,
                            [message.author.id, message.guild.id, weekId]
                        );
                    }
                } catch (e) {
                    console.error('R4 tracking error:', e.message);
                }
            }

            // --- 5. SWEAR JAR ---
            if (conf.swearjarenabled && conf.swearjarchannel) {
                try {
                    const customWords = conf.swearjarwords ? conf.swearjarwords.split(',').map(w => w.trim().toLowerCase()) : [];
                    const autoWords = conf.automodwordlist ? conf.automodwordlist.split(',').map(w => w.trim().toLowerCase()) : [];
                    let words = customWords.length > 0 ? customWords : autoWords;
                    
                    // Fallback to default words list if none configured
                    if (words.length === 0 || (words.length === 1 && words[0] === '')) {
                        words = ['fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'pussy', 'motherfucker', 'puta', 'mierda', 'pendejo', 'cabron'];
                    }
                    
                    if (words.length > 0) {
                        const content = message.content.toLowerCase();
                        const counts = {};

                        words.forEach(w => {
                            if (!w) return;
                            const escapedW = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedW}(?![\\p{L}\\p{N}_])`, 'giu');
                            const matches = content.match(regex);
                            if (matches) {
                                counts[w] = matches.length;
                            }
                        });

                        const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
                        const foundWord = Object.keys(counts)[0];

                        if (totalCount > 0) {
                            // Increment swear count in database by the number of occurrences
                            await db.run(
                                `INSERT INTO swear_jar_counts (userId, guildId, count) VALUES (?, ?, ?)
                                 ON CONFLICT(userId, guildId) DO UPDATE SET count = swear_jar_counts.count + ?`,
                                [message.author.id, message.guild.id, totalCount, totalCount]
                            );
                            const countRow = await db.get(
                                `SELECT count FROM swear_jar_counts WHERE userId = ? AND guildId = ?`,
                                [message.author.id, message.guild.id]
                            );
                            const swearCount = countRow ? countRow.count : totalCount;

                            let sjChannel = message.guild.channels.cache.get(conf.swearjarchannel);
                            if (!sjChannel) {
                                try {
                                    sjChannel = await message.guild.channels.fetch(conf.swearjarchannel);
                                } catch (e) {}
                            }
                            if (sjChannel) {
                                const ping = conf.swearjarping ? `<@${message.author.id}>` : `**${message.author.username}**`;
                                
                                let title = conf.swearjartitle || '<:zenith_swear_jar:1510658808408440863> Swear Jar Contribution!';
                                let desc = conf.swearjarmessage || `${ping} just added a coin to the jar for using prohibited dialect: \`${foundWord}\``;

                                const pTitle = title.replace('{user}', ping).replace('{word}', foundWord).replace('{count}', swearCount);
                                const pDesc = desc.replace('{user}', ping).replace('{word}', foundWord).replace('{count}', swearCount);

                                const embed = new EmbedBuilder()
                                    .setTitle(pTitle)
                                    .setDescription(pDesc)
                                    .setColor(conf.swearjarcolor || '#FFD700')
                                    .setFooter({ text: `🪙 ${message.author.username}'s total contributions: ${swearCount}` })
                                    .setTimestamp();

                                sjChannel.send({ embeds: [embed] }).catch(() => {});
                            }
                        }
                    }
                } catch (e) {
                    console.error('Swear Jar error:', e.message);
                }
            }
        }

        // Handled globally at the top of messageCreate.js

    },
    // In-memory XP cooldown tracker
    _xpCooldowns: new Map(),
    _ecoCooldowns: new Map()
};
