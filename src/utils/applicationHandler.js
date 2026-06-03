const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const { getDb } = require('../config/database');
const { buildMessage } = require('./messageBuilder');

const activeTicketCreators = new Set();

async function handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs, panelId, dIdx, oIdx) {
    if (activeTicketCreators.has(interaction.user.id)) {
        const warningMsg = `⚠️ Your request is already being processed. Please wait a moment.`;
        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp({ content: warningMsg, ephemeral: true }).catch(() => {});
        } else {
            return await interaction.reply({ content: warningMsg, ephemeral: true }).catch(() => {});
        }
    }

    activeTicketCreators.add(interaction.user.id);
    try {
        const systemType = opt.systemType || 'ticket';
        const limit = moduleConfigs?.ticketsMaxActive || 2;
        
        // Count active tickets for user securely using channel topics
        const botGuild = interaction.client.guilds.cache.get(interaction.guildId);
        let openCount = 0;
        if (botGuild) {
            botGuild.channels.cache.forEach(c => {
                if (c.type === ChannelType.GuildText && c.topic === interaction.user.id) {
                    openCount++;
                }
            });
        }
        
        if (openCount >= limit) {
            // Reset the select menu back to its placeholder in Discord UI if it's a select menu
            if (interaction.isStringSelectMenu() && !interaction.replied && !interaction.deferred) {
                await interaction.update({ components: interaction.message.components }).catch(() => {});
            }
            
            const limitMsg = `❌ You have reached the maximum open limit of ${limit} active tickets. Please close them before opening a new one.`;
            if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ content: limitMsg, ephemeral: true }).catch(() => {});
            } else {
                return await interaction.reply({ content: limitMsg, ephemeral: true }).catch(() => {});
            }
        }

        const hasQuestions = opt.questions && opt.questions.length > 0;
        const delivery = opt.questionDelivery || 'dm';

        if (hasQuestions) {
            if (delivery === 'modal') {
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                const modal = new ModalBuilder()
                    .setCustomId(`modal_ticket_app_${panelId}_${dIdx}_${oIdx}`)
                    .setTitle((opt.label || 'Application').substring(0, 45));

                const numQuestions = Math.min(opt.questions.length, 5);
                for (let i = 0; i < numQuestions; i++) {
                    const rawQuestion = opt.questions[i];
                    const questionText = typeof rawQuestion === 'string'
                        ? rawQuestion
                        : (rawQuestion?.text || rawQuestion?.label || `Question ${i + 1}`);
                    const required = rawQuestion?.required !== false;

                    modal.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId(`q_${i}`)
                            .setLabel(questionText.substring(0, 45))
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(required)
                    ));
                }
                return await interaction.showModal(modal);
            } else {
                return await startApplication(interaction, opt, guildConfigs, moduleConfigs);
            }
        } else {
            await createTicketChannel(interaction, opt, {}, guildConfigs, moduleConfigs);
        }
    } finally {
        activeTicketCreators.delete(interaction.user.id);
    }
}

async function startApplication(interaction, opt, guildConfigs, moduleConfigs) {
    // Send a DM to start
    const embed = new EmbedBuilder()
        .setTitle(`📝 Application: ${opt.label}`)
        .setDescription(`You have initiated an application. I will ask you **${opt.questions.length} questions**.\n\nPlease answer each question fully. Reply with your answers here in DMs. Do you wish to begin?`)
        .setColor('#a855f7');
        
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`start_app_yes`)
            .setLabel('Begin Application')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`start_app_no`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    try {
        const dmMsg = await interaction.user.send({ embeds: [embed], components: [row] });

        // Reset the select menu back to its placeholder in Discord UI if it's a select menu
        if (interaction.isStringSelectMenu() && !interaction.replied && !interaction.deferred) {
            await interaction.update({ components: interaction.message.components }).catch(() => {});
        }
        
        const successMsg = `✅ I have sent you a DM to begin your application! Please open your DMs to proceed.`;
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: successMsg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: successMsg, ephemeral: true }).catch(() => {});
        }

        // Register active application
        interaction.client.activeApplications.set(interaction.user.id, {
            guildId: interaction.guildId,
            member: interaction.member,
            opt: opt,
            guildConfigs: guildConfigs,
            moduleConfigs: moduleConfigs,
            currentQuestion: 0,
            answers: [],
            currentBuffer: '',
            dmChannelId: dmMsg.channelId,
            status: 'waiting_to_start'
        });
    } catch(e) {
        // Reset select menu in case of DM failure too
        if (interaction.isStringSelectMenu() && !interaction.replied && !interaction.deferred) {
            await interaction.update({ components: interaction.message.components }).catch(() => {});
        }

        const errorMsg = `❌ I couldn't DM you! Please ensure your DMs are open and try again.`;
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMsg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
        }
    }
}

async function handleApplicationMessage(message, client) {
    if (message.author.bot) return;
    if (message.channel && message.channel.type !== ChannelType.DM) return;

    const appState = client.activeApplications.get(message.author.id);
    if (!appState || (appState.status !== 'in_progress' && appState.status !== 'review' && appState.status !== 'editing')) return;

    try {
        const content = message.content.toLowerCase().trim();
        const currentQ = getQuestion(appState);
        if (!currentQ) {
            if (Array.isArray(appState.opt?.questions) && appState.currentQuestion >= appState.opt.questions.length) {
                appState.status = 'review';
                return await showReviewScreen(message, appState);
            }
            return await message.author.send('⚠️ No active question found. Please type `next` to continue or restart the application.');
        }
        const qType = currentQ.type || 'text';

        // 2. Handle Navigation Commands
        if (content === 'back' || content === 'repeatq') {
            if (appState.currentQuestion > 0) {
                appState.currentQuestion--;
                appState.currentBuffer = '';
                appState.answers.pop();
                return await askQuestion(message, appState);
            } else {
                return await message.author.send('⚠️ You are already on the first question! You cannot go back further.');
            }
        }

        if (content === 'next') {
            const hasBuffer = appState.currentBuffer && appState.currentBuffer.trim() !== '';
            
            if (currentQ.required && !hasBuffer) {
                return await message.author.send('⚠️ This question is **Required**. Please provide an answer (text or image) before typing `next`.');
            }
            if (!hasBuffer && qType !== 'choice' && qType !== 'image' && qType !== 'text_image') {
                return await message.author.send('⚠️ You must provide an answer before typing `next`.');
            }

            saveCurrentAnswer(appState);

            if (appState.status === 'editing') {
                appState.status = 'review';
                return await showReviewScreen(message, appState);
            }

            appState.currentQuestion++;
            if (appState.currentQuestion >= appState.opt.questions.length) {
                appState.status = 'review';
                await showReviewScreen(message, appState);
            } else {
                await askQuestion(message, appState);
            }
            return;
        }

        if (appState.status === 'review') {
            return await message.author.send('⚠️ You are in the review phase. Please use the menu below to edit an answer or click **Finalize & Send**.');
        }

        // Capture attachments
        if (message.attachments.size > 0) {
            message.attachments.forEach(att => {
                appState.currentBuffer += `[Image/File]: ${att.url}\n`;
            });
            await message.react('✅').catch(() => {});
        }

        if (qType === 'image') {
            if (message.attachments.size === 0 && content !== '' && content !== 'next') {
                await message.author.send('📷 You can upload an image now, or type `next` to skip this optional step.');
            }
            return;
        }

        if (qType === 'choice') {
            if (appState.currentBuffer === '') {
                await message.author.send('⚠️ Please select an option using the buttons above.');
            }
            return;
        }

        if (message.content.trim() !== '') {
            appState.currentBuffer += message.content + '\n';

            // For text and text_image questions, do not advance automatically.
            // The user must explicitly type `next` to confirm and continue.
            if (qType === 'text' || qType === 'text_image') {
                return;
            }
        }
    } catch (err) {
        console.error('Error in handleApplicationMessage:', err);
    }
}

function getQuestionText(question) {
    if (!question) return '';
    if (typeof question === 'string') return question;
    if (typeof question === 'object') {
        return question.text || question.label || question.question || '';
    }
    return String(question);
}

function formatQuestionLabel(index, questionText, prefix = '') {
    const cleanText = getQuestionText(questionText).trim();
    // If it already starts with a number followed by a dot or parenthesis, don't add another number
    if (/^\d+[\.\)]/.test(cleanText)) {
        return prefix ? `${prefix}: ${cleanText}` : cleanText;
    }
    const num = index + 1;
    if (prefix === 'Q') return `Q${num}: ${cleanText}`;
    if (prefix) return `${prefix} ${num}: ${cleanText}`;
    return `Question ${num}: ${cleanText}`;
}

function saveCurrentAnswer(appState) {
    const currentQ = getQuestion(appState);
    const answerText = (appState.currentBuffer || '').trim() || 'No answer provided';
    if (currentQ.required && !answerText) {
        return false;
    }

    appState.answers[appState.currentQuestion] = {
        question: getQuestionText(currentQ),
        answer: answerText,
        type: currentQ.type || 'text'
    };
    appState.currentBuffer = '';
    return true;
}



async function showReviewScreen(messageOrInteraction, appState) {
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    const user = messageOrInteraction.user || messageOrInteraction.author;
    
    let summary = '';
    let imageUrl = null;
    let allImageUrls = [];
    appState.answers.forEach((ans, i) => {
        let displayAns = ans.answer;

        if (displayAns.includes('http://') || displayAns.includes('https://')) {
            let counter = 1;
            displayAns = displayAns.replace(/\[Image\/File\]:\s*(https?:\/\/[^\s>]+)/gi, (match, url) => {
                allImageUrls.push(url);
                return `\n🔗 [Attachment ${counter++}](<${url}>)`;
            }).trim();
        } else if (displayAns.length > 100) {
            displayAns = displayAns.substring(0, 97) + '...';
        }

        const questionLabel = formatQuestionLabel(i, ans.question);
        // Prefix every line with a quote marker for consistent Discord layout
        const quotedAns = displayAns.split('\n').map(line => `> ${line}`).join('\n');
        const line = `**${questionLabel}**\n${quotedAns}\n\n`;
        if ((summary + line).length < 4000) {
            summary += line;
        }
    });

    if (allImageUrls.length > 0) {
        imageUrl = allImageUrls[0];
    }

    const embed = new EmbedBuilder()
        .setTitle('🔍 Review Your Application')
        .setDescription(summary || 'No answers recorded yet.')
        .setColor('#ffd700');

    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('app_edit_select')
        .setPlaceholder('Modify a previous answer...')
        .addOptions(
            appState.answers.slice(0, 25).map((ans, i) => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Edit Question ${i + 1}`)
                    .setDescription(getQuestionText(ans.question).substring(0, 50))
                    .setValue(`${i}`)
            )
        );

    const rowMenu = new ActionRowBuilder().addComponents(selectMenu);
    const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('app_finalize_submit').setLabel('Finalize & Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('app_cancel_all').setLabel('Abort').setStyle(ButtonStyle.Danger)
    );

    return await user.send({ embeds: [embed], components: [rowMenu, rowButtons] });
}

async function submitApplication(interaction, appState) {
    // 1. Acknowledge the interaction immediately to prevent timeout (3s limit)
    const isApprovalMode = !!(appState.moduleConfigs && appState.moduleConfigs.ticketsApprovalChannel);
    
    await interaction.update({ 
        content: isApprovalMode ? '✅ Your application has been sent for admin review. You will be notified of the decision.' : '🚀 Creating your ticket channel now...', 
        embeds: [], 
        components: [] 
    }).catch(e => console.error('Failed to update interaction:', e));

    // 2. Process the rest in the background
    try {
        const db = await getDb();
        const config = appState.moduleConfigs;

        if (isApprovalMode) {
            const crypto = require('crypto');
            const uuid = crypto.randomUUID().substring(0, 8);
            
            await db.run(
                `INSERT INTO pending_tickets (uuid, guildId, userId, optJson, answersJson) VALUES (?, ?, ?, ?, ?)`,
                [uuid, appState.guildId, interaction.user.id, JSON.stringify(appState.opt), JSON.stringify(appState.answers)]
            );

            const adminChannel = interaction.client.channels.cache.get(config.ticketsApprovalChannel);
            if (adminChannel) {
                const adminEmbed = new EmbedBuilder()
                    .setTitle('📥 New Application for Review')
                    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                    .setDescription(`**User:** <@${interaction.user.id}>\n**Ticket Type:** ${appState.opt.label}\n\n**Answers Summary:**`)
                    .setColor('#ffd700');

                let fullAnswersText = '';
                let imageUrl = null;
                let allImageUrls = [];
                appState.answers.forEach((ans, i) => {
                    const questionLabel = formatQuestionLabel(i, ans.question);
                    let displayAns = ans.answer;

                    if (displayAns.includes('http://') || displayAns.includes('https://')) {
                        let counter = 1;
                        displayAns = displayAns.replace(/\[Image\/File\]:\s*(https?:\/\/[^\s>]+)/gi, (match, url) => {
                            allImageUrls.push(url);
                            return `\n🔗 [Attachment ${counter++}](<${url}>)`;
                        }).trim();
                    }

                    // Prefix every line with a quote marker for consistent Discord layout
                    const quotedAns = displayAns.split('\n').map(line => `> ${line}`).join('\n');
                    const line = `**${questionLabel}**\n${quotedAns}\n\n`;
                    if ((fullAnswersText + line).length < 4000) {
                        fullAnswersText += line;
                    }
                });
                
                if (allImageUrls.length > 0) {
                    imageUrl = allImageUrls[0];
                }

                adminEmbed.setDescription(adminEmbed.data.description + '\n\n' + fullAnswersText);
                if (imageUrl) {
                    adminEmbed.setImage(imageUrl);
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`admin_app_approve_${uuid}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`admin_app_decline_${uuid}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
                );

                // Add ping for staff (prioritize option-specific ping roles, fallback to global)
                let pingContent = '🔔 **New Application Received**';
                const guild = interaction.client.guilds.cache.get(appState.guildId);
                const optionPingRoles = appState.opt.pingRoles ? appState.opt.pingRoles.split(',')
                    .map(r => r.trim().replace(/[^0-9]/g, ''))
                    .filter(r => r)
                    .map(r => `<@&${r}>`)
                    .join(' ') : '';

                if (optionPingRoles) {
                    pingContent = `🔔 ${optionPingRoles} **New Application Received**`;
                } else if (config.ticketsPingRole) {
                    pingContent = `🔔 <@&${config.ticketsPingRole}> **New Application Received**`;
                }



                await adminChannel.send({ content: pingContent, embeds: [adminEmbed], components: [row] }).catch(async () => {
                    await adminChannel.send({ 
                        content: `${pingContent}\n⚠️ **New Application from <@${interaction.user.id}>** (Embed too large)\nUUID: \`${uuid}\``,
                        components: [row] 
                    });
                });
            }
        } else {
            await createTicketChannel(interaction, appState.opt, appState.answers, appState.guildConfigs, appState.moduleConfigs);
        }
    } catch (err) {
        console.error('Error in background submitApplication:', err);
    } finally {
        interaction.client.activeApplications.delete(interaction.user.id);
    }
}

function getQuestion(appState) {
    const questions = appState.opt?.questions;
    if (!Array.isArray(questions) || appState.currentQuestion == null || appState.currentQuestion < 0 || appState.currentQuestion >= questions.length) {
        return null;
    }
    const q = questions[appState.currentQuestion];
    return typeof q === 'string' ? { text: q, type: 'text' } : q || null;
}

async function askQuestion(messageOrInteraction, appState) {
    const user = messageOrInteraction.user || messageOrInteraction.author;
    const q = getQuestion(appState);
    const indicator = q.required ? ' *(Required)*' : '';
    
    const embed = new EmbedBuilder()
        .setTitle(`Question ${appState.currentQuestion + 1} of ${appState.opt.questions.length}${indicator}`)
        .setDescription(`**${q.text}**`)
        .setColor('#3498db')
        .setFooter({ text: 'Type "next" to skip/confirm, "back" to go back.' });

    if (q.type === 'image') {
        embed.addFields({ name: 'Requirement', value: '📷 Upload an image. Type `next` to skip.' });
    } else if (q.type === 'text_image') {
        embed.addFields({ name: 'Requirement', value: '📝 Provide text and/or 📷 upload an image.' });
    } else if (q.type === 'choice') {
        embed.addFields({ name: 'Requirement', value: '🔘 Select one of the options below.' });
        
        const options = (q.options || '').split(',').map(o => o.trim()).filter(o => o);
        if (options.length > 0) {
            const row = new ActionRowBuilder();
            // Up to 5 buttons for simplicity in DMs
            options.slice(0, 5).forEach((opt, i) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_choice_${i}`)
                        .setLabel(opt)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            return await user.send({ embeds: [embed], components: [row] });
        }
    }

    return await user.send({ embeds: [embed], components: [] });
}

async function handleApplicationStartButton(interaction) {
    const appState = interaction.client.activeApplications.get(interaction.user.id);

    if (interaction.customId === 'app_finalize_submit') {
        if (!appState) return interaction.reply({ content: 'Session expired.', ephemeral: true });
        return await submitApplication(interaction, appState);
    }

    if (interaction.customId === 'app_cancel_all') {
        interaction.client.activeApplications.delete(interaction.user.id);
        return await interaction.update({ content: '❌ Application cancelled.', embeds: [], components: [] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'app_edit_select') {
        if (!appState) return interaction.reply({ content: 'Session expired.', ephemeral: true });
        const idx = parseInt(interaction.values[0]);
        appState.status = 'editing';
        appState.currentQuestion = idx;
        appState.currentBuffer = '';
        await interaction.update({ content: `🔄 Re-answering Question ${idx + 1}...`, embeds: [], components: [] });
        return await askQuestion(interaction, appState);
    }

    if (!appState) {
        if (interaction.reply) await interaction.reply({ content: 'Session expired.', ephemeral: true });
        return;
    }

    if (interaction.customId === 'start_app_yes') {
        appState.status = 'in_progress';
        if (!interaction.replied && !interaction.deferred && !interaction.acknowledged) {
            await interaction.update({ content: 'Application process initiated.', embeds: [], components: [] }).catch(() => {});
        }
        await askQuestion(interaction, appState);
    } else if (interaction.customId.startsWith('app_choice_')) {
        const q = getQuestion(appState);
        const options = (q.options || '').split(',').map(o => o.trim()).filter(o => o);
        const choiceIdx = parseInt(interaction.customId.split('_').pop());
        const choice = options[choiceIdx];
        
        // 1. Instantly update the current choice message in Discord UI to show it's selected and remove buttons
        await interaction.update({ content: `✅ Selected: **${choice}**`, components: [] }).catch(() => {});
        
        // 2. Save the answer directly into appState.answers by current question index
        const newAnswer = {
            question: q.text || q,
            answer: choice,
            type: q.type
        };
        
        appState.answers[appState.currentQuestion] = newAnswer;
        appState.currentBuffer = '';
        
        // 3. Move to next question or show review screen
        if (appState.status === 'editing') {
            appState.status = 'review';
            return await showReviewScreen(interaction, appState);
        }
        
        appState.currentQuestion++;
        
        if (appState.currentQuestion >= appState.opt.questions.length) {
            appState.status = 'review';
            await showReviewScreen(interaction, appState);
        } else {
            await askQuestion(interaction, appState);
        }
    } else {
        interaction.client.activeApplications.delete(interaction.user.id);
        await interaction.update({ content: 'Application aborted.', embeds: [], components: [] });
    }
}

async function createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs, targetUserId = null) {
    const guild = interaction.guild;
    const finalUserId = targetUserId || interaction.user.id;
    
    // Ensure we have the user object
    let user;
    try {
        user = await interaction.client.users.fetch(finalUserId);
    } catch (e) {
        console.error('Failed to fetch user in createTicketChannel:', e);
        user = interaction.user; // fallback
    }

    let baseName = opt.ticketName ? opt.ticketName.replace('{username}', user.username).replace(/[^a-zA-Z0-9-]/g, '') : `ticket-${user.username}`;
    const channelName = baseName.toLowerCase().substring(0, 30);
    
    // Priority: Option Specific Category -> Global Config Category -> undefined
    const categoryId = opt.categoryId || guildConfigs?.ticketCategoryId;

    // Parse permitted roles
    let allowedRoles = [];
    if (opt.staffRoles) {
        allowedRoles = opt.staffRoles.split(',').map(r => r.trim().replace(/[^0-9]/g, '')).filter(r => guild.roles.cache.has(r));
    }

    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
            id: finalUserId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        },
        {
            id: interaction.client.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels],
        }
    ];

    allowedRoles.forEach(roleId => {
        permissionOverwrites.push({
            id: roleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        });
    });

    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        topic: user.id, // Stamping ownership permanently for quota tracking
        permissionOverwrites: permissionOverwrites
    });

    const useEmbed = opt.useEmbed === undefined || opt.useEmbed === null ? true : !!opt.useEmbed;

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_ticket_${user.id}`).setLabel('✋ Claim').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`close_ticket_${user.id}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
    );

    // Build fields from application answers
    const fields = [];
    
    // Core details styled professionally side-by-side
    fields.push({ name: '<:zenith_user:1510658870790590646> Ticket Owner', value: `${user} (${user.username})`, inline: true });
    fields.push({ name: '<:zenith_status:1510656159340695662> Status', value: '`OPEN`', inline: true });
    
    let imageUrl = null;
    let allImageUrls = [];
    if (answers && answers.length > 0) {
        answers.forEach((ans, i) => {
            const questionLabel = formatQuestionLabel(i, ans.question, 'Q');
            let displayAns = ans.answer.trim();

            if (displayAns.includes('http://') || displayAns.includes('https://')) {
                let counter = 1;
                displayAns = displayAns.replace(/\[Image\/File\]:\s*(https?:\/\/[^\s>]+)/gi, (match, url) => {
                    allImageUrls.push(url);
                    return `\n🔗 [Attachment ${counter++}](<${url}>)`;
                }).trim();
            }

            // Trim and format the answer into a beautiful quote block
            let formattedAnswer = displayAns.startsWith('>>>') ? displayAns : `>>> ${displayAns}`;
            if (formattedAnswer.length > 1024) {
                formattedAnswer = formattedAnswer.substring(0, 1021) + '...';
            }
            
            const fieldName = `<:zenith_question:1510656214613233725> ${questionLabel}`;
            fields.push({ 
                name: fieldName.substring(0, 256), 
                value: formattedAnswer, 
                inline: false 
            });
        });
        if (allImageUrls.length > 0) {
            imageUrl = allImageUrls[0];
        }
    }

    let pingText = `${user}`;
    const pingRoleSource = opt.pingRoles || moduleConfigs?.ticketsPingRole;
    if (pingRoleSource) {
        const pingRolesStr = pingRoleSource.split(',').map(r => `<@&${r.trim().replace(/[^0-9]/g, '')}>`).join(' ').trim();
        if (pingRolesStr) {
            pingText += ` ${pingRolesStr}`;
        }
    }

    let embedTitle = opt.embedTitle || 'Support Ticket Created';
    let embedDesc = opt.embedDescription || 'Welcome! An administrator or support representative will assist you shortly. Please describe your inquiry in detail.';
    
    embedTitle = embedTitle.replace(/{user}/g, `${user}`).replace(/{username}/g, user.username);
    embedDesc = embedDesc.replace(/{user}/g, `${user}`).replace(/{username}/g, user.username);

    const payload = buildMessage(useEmbed, {
        title: embedTitle,
        description: embedDesc,
        color: '#ffd700', // Premium KvK Gold/Yellow aesthetic color instead of hardcoded purple
        imageUrl: imageUrl || opt.imageUrl || null,
        fields: fields,
        actionRows: [closeRow]
    });

    payload.content = pingText;
    await ticketChannel.send(payload);

    // Only reply to interaction if this is the user opening their own ticket, not an admin approving an application
    if (!targetUserId) {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: `✅ Ticket opened in ${ticketChannel}`, ephemeral: true }).catch(() => {});
        } else if (interaction.reply) {
            await interaction.reply({ content: `✅ Ticket opened in ${ticketChannel}`, ephemeral: true }).catch(() => {});
        }
    }
    return ticketChannel;
}

module.exports = { handleTicketSelection, handleApplicationMessage, handleApplicationStartButton, createTicketChannel };
