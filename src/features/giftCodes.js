const { EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

async function downloadFile(url, destPath) {
    const writer = fs.createWriteStream(destPath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function runGiftCodeOcr(imagePath, msgText) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'utils', 'giftCodeOcr.py');
        const cmd = `python "${scriptPath}" "${imagePath || ''}"`;
        const child = exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error('[Gift Code OCR Error]', error.message);
                resolve({ success: false, error: error.message });
                return;
            }
            try {
                const res = JSON.parse(stdout.trim());
                resolve(res);
            } catch (e) {
                console.error('[Gift Code OCR Parse Error] Output was:', stdout);
                resolve({ success: false, error: 'Failed to parse Gift Code OCR response' });
            }
        });
        child.stdin.write(msgText);
        child.stdin.end();
    });
}

async function handleGiftCodeMessage(message, conf) {
    console.log(`[Gift Codes Debug] Processing message from ${message.author.username} in channel ${message.channel.id}`);

    let imagePath = '';
    const tempDir = path.join(__dirname, '..', '..', 'scratch');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // 1. Download attachment or embed image if present
    let imageUrl = '';
    const attachment = message.attachments.first();
    if (attachment && attachment.contentType && attachment.contentType.startsWith('image/')) {
        imageUrl = attachment.url;
    } else if (message.embeds && message.embeds.length > 0) {
        const embed = message.embeds[0];
        if (embed.image && embed.image.url) {
            imageUrl = embed.image.url;
        } else if (embed.thumbnail && embed.thumbnail.url) {
            imageUrl = embed.thumbnail.url;
        }
    }

    if (imageUrl) {
        const ext = '.png';
        imagePath = path.join(tempDir, `gift_code_temp_${Date.now()}${ext}`);
        try {
            await downloadFile(imageUrl, imagePath);
        } catch (err) {
            console.error('[Gift Codes] Failed to download image:', err.message);
            imagePath = '';
        }
    }

    // 2. Extract message text (plus embeds if present)
    let fullText = message.content || '';
    if (message.embeds && message.embeds.length > 0) {
        const embed = message.embeds[0];
        fullText += ' ' + (embed.description || embed.title || '');
    }

    // 3. Run OCR parser
    const ocrResult = await runGiftCodeOcr(imagePath, fullText);

    // Clean up temporary image
    if (imagePath && fs.existsSync(imagePath)) {
        try {
            fs.unlinkSync(imagePath);
        } catch (e) {}
    }

    if (!ocrResult || !ocrResult.success || !ocrResult.code) {
        console.log('[Gift Codes Debug] No valid gift code parsed from message.');
        return;
    }

    console.log('[Gift Codes Debug] Extracted Code:', ocrResult.code);

    // 4. Send to target channel
    const targetGuild = message.guild;
    const targetChannelId = conf.giftcodestargetchannel || '1512192056838328330';
    let targetChannel = targetGuild.channels.cache.get(targetChannelId);
    if (!targetChannel) {
        try {
            targetChannel = await targetGuild.channels.fetch(targetChannelId);
        } catch (e) {
            console.error(`[Gift Codes] Failed to fetch target channel ${targetChannelId}:`, e.message);
        }
    }

    if (targetChannel) {
        // Build the list of rewards
        let rewardsList = '*Could not read rewards card automatically.*';
        if (ocrResult.rewards && ocrResult.rewards.length > 0) {
            rewardsList = ocrResult.rewards.map(item => `🎁 **${item}**`).join('\n');
        }

        // Build the timestamp
        let expiryText = '📅 *No expiration date detected.*';
        if (ocrResult.expiration) {
            expiryText = `<t:${ocrResult.expiration}:F> (<t:${ocrResult.expiration}:R>)`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎁 New Redeem Code Detected!')
            .setDescription(`Double tap / click block below to copy the code:`)
            .addFields(
                { name: 'Redeem Code', value: `\`\`\`\n${ocrResult.code}\n\`\`\`` },
                { name: 'Rewards / Items List', value: rewardsList },
                { name: 'Expiration', value: expiryText }
            )
            .setColor('#14b8a6')
            .setTimestamp()
            .setFooter({ text: 'Rise of Kingdoms Gift Code Scanner' });

        const pingStr = conf.giftcodespingrole ? `<@&${conf.giftcodespingrole}>` : '';
        await targetChannel.send({ content: pingStr, embeds: [embed] });
        console.log(`[Gift Codes] Alert sent successfully to channel ${targetChannelId}`);
    }
}

module.exports = { handleGiftCodeMessage };
