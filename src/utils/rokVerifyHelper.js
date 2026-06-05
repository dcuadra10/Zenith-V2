const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { getDb } = require('../config/database');

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

function runOcr(imagePath) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'rokOcr.py');
        const cmd = `python "${scriptPath}" "${imagePath}"`;
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error('[OCR Error]', error.message);
                resolve({ success: false, error: error.message });
                return;
            }
            try {
                const res = JSON.parse(stdout.trim());
                resolve(res);
            } catch (e) {
                console.error('[OCR Parse Error] Output was:', stdout);
                resolve({ success: false, error: 'Failed to parse OCR response' });
            }
        });
    });
}

async function verifyProfile(member, guild, attachmentUrl) {
    const db = await getDb();
    
    // 1. Fetch module config
    const config = await db.get(
        `SELECT rokVerifierEnabled, rokVerifierRole, rokVerifierTags, rokVerifierChannel, rokVerifierUniqueId FROM module_configs WHERE guildId = ?`,
        [guild.id]
    );
    
    if (!config || !config.rokVerifierEnabled) {
        return { success: false, message: 'The RoK Verifier module is currently disabled on this server.' };
    }
    
    if (!config.rokVerifierRole) {
        return { success: false, message: 'The verification role has not been configured by an administrator.' };
    }
    
    // 2. Prepare temp file path
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFileName = `verify_${guild.id}_${member.id}_${Date.now()}.png`;
    const tempFilePath = path.join(tempDir, tempFileName);
    
    try {
        // 3. Download image
        await downloadFile(attachmentUrl, tempFilePath);
        
        // 4. Run OCR
        const ocrResult = await runOcr(tempFilePath);
        
        // Clean up immediately
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        
        if (!ocrResult || !ocrResult.success) {
            return { success: false, message: 'Could not process image or run OCR. Please ensure you uploaded a clear governor profile screenshot.' };
        }
        
        const { allianceTag, governorName, governorId, power, killPoints } = ocrResult;
        
        if (!allianceTag) {
            return { success: false, message: 'No Alliance Tag was found in the profile screenshot. Ensure it shows your tag in brackets, e.g. `[TAG]Name`.' };
        }

        // Check if Governor ID is already linked
        if (config.rokVerifierUniqueId && governorId) {
            const existingLink = await db.get(`SELECT userId FROM rok_verifications WHERE guildId = ? AND governorId = ?`, [guild.id, governorId]);
            if (existingLink && existingLink.userId !== member.id) {
                return { success: false, message: `The Governor ID \`${governorId}\` is already verified and linked to another member in this server.` };
            }
        }
        
        // 5. Validate alliance tag and determine role mapping
        const allowedTagsStr = config.rokVerifierTags || '';
        const tagMappings = {}; // tag lowercase -> roleId
        let allowedTags = [];
        
        allowedTagsStr.split(',').forEach(part => {
            const trimmed = part.trim();
            if (!trimmed) return;
            if (trimmed.includes(':')) {
                const [tag, roleId] = trimmed.split(':').map(x => x.trim());
                tagMappings[tag.toLowerCase()] = roleId;
                allowedTags.push(tag.toLowerCase());
            } else {
                allowedTags.push(trimmed.toLowerCase());
            }
        });
        
        if (allowedTags.length > 0 && !allowedTags.includes(allianceTag.toLowerCase())) {
            return { success: false, message: `Your alliance tag \`[${allianceTag}]\` is not permitted for verification. Allowed tags: \`${allowedTagsStr}\`` };
        }
        
        // 6. Assign verification role(s) (use specific roles if mapped, otherwise fall back to global verifier role)
        let roleIdsToAssign = [];
        if (tagMappings[allianceTag.toLowerCase()]) {
            roleIdsToAssign = tagMappings[allianceTag.toLowerCase()].split(/[+|;/]+/).map(r => r.trim()).filter(r => r.length > 0);
        } else if (config.rokVerifierRole) {
            roleIdsToAssign = [config.rokVerifierRole.trim()];
        }
        
        if (roleIdsToAssign.length === 0) {
            return { success: false, message: `No verification roles configured.` };
        }
        
        const rolesToAdd = [];
        for (const roleId of roleIdsToAssign) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return { success: false, message: `Configured verification role (ID: ${roleId}) was not found in the server.` };
            }
            rolesToAdd.push(role);
        }
        
        for (const role of rolesToAdd) {
            await member.roles.add(role);
        }
        
        // 7. Update nickname
        // Format to: [TAG] (Only the alliance tag as requested)
        const newNickname = `[${allianceTag}]`;
        
        let nickUpdated = false;
        try {
            await member.setNickname(newNickname);
            nickUpdated = true;
        } catch (nickErr) {
            console.error(`Failed to set nickname for ${member.user.tag}:`, nickErr.message);
            // We do not fail verification if nickname cannot be set (e.g. Server Owner / Hierarchy issues)
        }
        
        // 8. Save record in database
        await db.run(
            `INSERT INTO rok_verifications (userId, guildId, governorId, governorName, allianceTag, power, killPoints)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(userId, guildId) DO UPDATE SET
                 governorId = EXCLUDED.governorId,
                 governorName = EXCLUDED.governorName,
                 allianceTag = EXCLUDED.allianceTag,
                 power = EXCLUDED.power,
                 killPoints = EXCLUDED.killPoints,
                 verifiedAt = CURRENT_TIMESTAMP`,
            [member.id, guild.id, governorId || '', governorName || '', allianceTag, power || 0, killPoints || 0]
        );
        
        return {
            success: true,
            allianceTag,
            governorName,
            governorId,
            power,
            killPoints,
            nickUpdated,
            newNickname
        };
        
    } catch (err) {
        console.error('[Verification Helper Error]', err);
        // Clean up on error
        if (fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
        return { success: false, message: `An unexpected error occurred during verification: ${err.message}` };
    }
}

module.exports = {
    verifyProfile
};
