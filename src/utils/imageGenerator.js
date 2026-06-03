const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');

async function getAvatar(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return await loadImage(Buffer.from(response.data));
    } catch (e) {
        return null;
    }
}

function drawMafiaBackground(ctx, width, height, bgPath = null) {
    // Base gradient: dark crimson to pitch black
    const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, Math.max(width, height) * 0.8);
    grad.addColorStop(0, '#2a0808');
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid/texture lines in deep red/gold
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 30) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
    }
    for (let i = 0; i < height; i += 30) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke();
    }
}

function drawCurve(ctx, startX, startY, endX, endY) {
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'; // Gold connection lines
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    const midY = (startY + endY) / 2;
    ctx.bezierCurveTo(startX, midY, endX, midY, endX, endY);
    ctx.stroke();
}

async function drawNode(ctx, x, y, user, label = null, color = '#dc2626') {
    const avatarSize = 70;
    
    // Glow Effect
    ctx.shadowBlur = 15;
    ctx.shadowColor = color;
    
    // Node Background (Mafia Dossier Card Style)
    ctx.fillStyle = 'rgba(18, 18, 22, 0.95)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - 100, y - 45, 200, 90, 8); // slightly wider to prevent text clipping
    ctx.fill();
    ctx.stroke();
    
    // Reset Shadow
    ctx.shadowBlur = 0;

    // Inner subtle border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 95, y - 40, 190, 80, 6);
    ctx.stroke();

    // Avatar Circle
    if (user.avatarUrl) {
        const img = await getAvatar(user.avatarUrl);
        if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x - 50, y, avatarSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x - 50 - avatarSize / 2, y - avatarSize / 2, avatarSize, avatarSize);
            ctx.restore();
            
            // Avatar Border
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x - 50, y, avatarSize / 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Text Section (Dossier Typeface Look)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(user.username.substring(0, 12), x - 5, y - 5);
    
    if (label) {
        ctx.fillStyle = color;
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(label.toUpperCase(), x - 5, y + 15);
    }
}

async function generateFamilyTree(mainUser, data, backgroundPath = null) {
    const canvas = createCanvas(1000, 700);
    const ctx = canvas.getContext('2d');
    const fs = require('fs');
    const path = require('path');

    const defaultBg = path.join(process.cwd(), 'godfather_bg.png');
    const bgToUse = backgroundPath || (fs.existsSync(defaultBg) ? defaultBg : null);

    if (bgToUse) {
        try {
            const bg = await loadImage(bgToUse);
            ctx.drawImage(bg, 0, 0, 1000, 700);
        } catch(e) {
            drawMafiaBackground(ctx, 1000, 700);
        }
    } else {
        drawMafiaBackground(ctx, 1000, 700);
    }

    const centerX = 500;
    const centerY = 350;

    // Parent Connectors
    if (data.parent) {
        drawCurve(ctx, centerX, centerY - 45, centerX, centerY - 155);
        await drawNode(ctx, centerX, centerY - 200, data.parent, 'Godfather / Parent', '#b91c1c');
    }

    // Spouse Connector
    if (data.spouse) {
        drawCurve(ctx, centerX + 90, centerY, centerX + 210, centerY);
        await drawNode(ctx, centerX + 300, centerY, data.spouse, 'Partner in Crime', '#fbbf24');
    }

    // Children Connectors
    if (data.children && data.children.length > 0) {
        const totalWidth = (data.children.length - 1) * 250;
        const startX = centerX - totalWidth / 2;
        
        for (let i = 0; i < data.children.length; i++) {
            const childX = startX + i * 250;
            drawCurve(ctx, centerX, centerY + 45, childX, centerY + 155);
            await drawNode(ctx, childX, centerY + 200, data.children[i], 'Protege / Child', '#9ca3af');
        }
    }

    // Main User
    await drawNode(ctx, centerX, centerY, mainUser, 'The Boss (You)', '#dc2626');

    return canvas.toBuffer('image/png');
}

async function generateMafiaHierarchy(mafiaName, members, extraData = {}, backgroundPath = null) {
    const canvas = createCanvas(1200, 1000);
    const ctx = canvas.getContext('2d');
    const fs = require('fs');
    const path = require('path');

    const defaultBg = path.join(process.cwd(), 'godfather_bg.png');
    const bgToUse = backgroundPath || (fs.existsSync(defaultBg) ? defaultBg : null);

    if (bgToUse) {
        try {
            const bg = await loadImage(bgToUse);
            ctx.drawImage(bg, 0, 0, 1200, 1000);
        } catch(e) {
            drawMafiaBackground(ctx, 1200, 1000);
        }
    } else {
        drawMafiaBackground(ctx, 1200, 1000);
    }
    
    // Header Info
    ctx.textAlign = 'center';
    
    // Title Shadow
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(220, 38, 38, 0.8)';
    ctx.fillStyle = '#dc2626'; // Blood red title
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(mafiaName.toUpperCase(), 600, 55);
    ctx.shadowBlur = 0;
    
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#fbbf24'; // Gold subtitle
    ctx.fillText(`LEVEL ${extraData.level || 1} • ${extraData.specialization || 'Unspecialized'}`, 600, 90);

    const rankColors = {
        'Don': '#dc2626', // Blood Red
        'Consigliere': '#fbbf24', // Gold
        'Underboss': '#f59e0b', // Amber/Orange
        'Soldier': '#3b82f6', // Steel Blue
        'Associate': '#9ca3af' // Silver/Gray
    };

    const ranks = ['Don', 'Consigliere', 'Underboss', 'Soldier', 'Associate'];
    const grouped = {};
    ranks.forEach(r => grouped[r] = members.filter(m => m.rank === r));

    let currentY = 180; // Shifted down to prevent overlap
    const levelHeight = 180; // Adjusted spacing to fit height perfectly
    const prevLevelNodes = [];

    for (let i = 0; i < ranks.length; i++) {
        const rank = ranks[i];
        const rankMembers = grouped[rank];
        if (!rankMembers || rankMembers.length === 0) continue;

        const totalWidth = (rankMembers.length - 1) * 230;
        const startX = 600 - totalWidth / 2;
        const currentLevelNodes = [];

        for (let j = 0; j < rankMembers.length; j++) {
            const x = startX + j * 230;
            currentLevelNodes.push({x, y: currentY});
            
            // Connect to the closest node in previous level by X coordinate
            if (prevLevelNodes.length > 0) {
                let closestParent = prevLevelNodes[0];
                let minDistance = Math.abs(x - prevLevelNodes[0].x);
                for (let k = 1; k < prevLevelNodes.length; k++) {
                    const dist = Math.abs(x - prevLevelNodes[k].x);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestParent = prevLevelNodes[k];
                    }
                }
                drawCurve(ctx, closestParent.x, closestParent.y + 45, x, currentY - 45);
            }

            await drawNode(ctx, x, currentY, rankMembers[j], rank, rankColors[rank] || '#ffffff');
        }
        
        prevLevelNodes.length = 0;
        prevLevelNodes.push(...currentLevelNodes);
        currentY += levelHeight;
    }

    return canvas.toBuffer('image/png');
}

async function generateLeaderboardImage(title, entries, backgroundPath) {
    const canvas = createCanvas(900, 600);
    const ctx = canvas.getContext('2d');

    // Load and draw background image
    try {
        const bg = await loadImage(backgroundPath);
        ctx.drawImage(bg, 0, 0, 900, 600);
    } catch (e) {
        // Fallback gradient if image fails
        const grad = ctx.createLinearGradient(0, 0, 0, 600);
        grad.addColorStop(0, '#0f0c29');
        grad.addColorStop(0.5, '#302b63');
        grad.addColorStop(1, '#24243e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 900, 600);
    }

    // Dark glass overlay panel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.beginPath();
    ctx.roundRect(40, 30, 820, 540, 20);
    ctx.fill();

    // Subtle border glow
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(40, 30, 820, 540, 20);
    ctx.stroke();

    // Title with gold gradient
    const titleGrad = ctx.createLinearGradient(200, 60, 700, 60);
    titleGrad.addColorStop(0, '#fbbf24');
    titleGrad.addColorStop(0.5, '#fde68a');
    titleGrad.addColorStop(1, '#f59e0b');
    ctx.fillStyle = titleGrad;
    ctx.textAlign = 'center';
    ctx.font = 'bold 32px sans-serif';
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
    ctx.fillText(title, 450, 85);
    ctx.shadowBlur = 0;

    // Decorative separator line
    const lineGrad = ctx.createLinearGradient(100, 105, 800, 105);
    lineGrad.addColorStop(0, 'transparent');
    lineGrad.addColorStop(0.3, 'rgba(251, 191, 36, 0.5)');
    lineGrad.addColorStop(0.7, 'rgba(251, 191, 36, 0.5)');
    lineGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(100, 105);
    ctx.lineTo(800, 105);
    ctx.stroke();

    // Medal colors and labels
    const medalColors = ['#fbbf24', '#c0c0c0', '#cd7f32'];
    const medalLabels = ['🥇', '🥈', '🥉'];

    // Render each entry
    const startY = 135;
    const rowHeight = 42;
    const maxEntries = Math.min(entries.length, 10);

    for (let i = 0; i < maxEntries; i++) {
        const entry = entries[i];
        const y = startY + i * rowHeight;

        // Row highlight for top 3
        if (i < 3) {
            ctx.fillStyle = `rgba(251, 191, 36, ${0.08 - i * 0.02})`;
            ctx.beginPath();
            ctx.roundRect(60, y - 5, 780, 36, 8);
            ctx.fill();
        }

        // Rank number / medal
        ctx.textAlign = 'left';
        ctx.font = 'bold 20px sans-serif';
        if (i < 3) {
            ctx.fillStyle = medalColors[i];
            ctx.shadowBlur = 8;
            ctx.shadowColor = medalColors[i];
            ctx.fillText(`#${i + 1}`, 80, y + 22);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = '#9ca3af';
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText(`#${i + 1}`, 80, y + 22);
        }

        // Username
        ctx.fillStyle = i < 3 ? '#ffffff' : '#d1d5db';
        ctx.font = i < 3 ? 'bold 18px sans-serif' : '500 17px sans-serif';
        const displayName = entry.name.length > 22 ? entry.name.substring(0, 22) + '…' : entry.name;
        ctx.fillText(displayName, 130, y + 22);

        // Value (right-aligned)
        ctx.textAlign = 'right';
        ctx.fillStyle = i < 3 ? '#fde68a' : '#9ca3af';
        ctx.font = i < 3 ? 'bold 18px sans-serif' : '500 17px sans-serif';
        ctx.fillText(entry.value, 820, y + 22);
    }

    if (entries.length === 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b7280';
        ctx.font = 'italic 18px sans-serif';
        ctx.fillText('The board is currently vacant. Be the first!', 450, 300);
    }

    // Footer branding
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.font = '500 13px sans-serif';
    ctx.fillText('Powered by Zenith', 450, 555);

    return canvas.toBuffer('image/png');
}

async function generateLevelUpImage(username, avatarUrl, newLevel, backgroundPath = null) {
    const canvas = createCanvas(800, 250);
    const ctx = canvas.getContext('2d');
    const path = require('path');
    const fs = require('fs');

    // Clean and validate background path to prevent string 'null'/'undefined' issues
    let bgToUse = null;
    if (backgroundPath && typeof backgroundPath === 'string' && backgroundPath.toLowerCase() !== 'null' && backgroundPath.toLowerCase() !== 'undefined' && backgroundPath.trim() !== '') {
        if (backgroundPath.startsWith('http')) {
            bgToUse = backgroundPath;
        } else {
            const resolvedPath = path.resolve(process.cwd(), backgroundPath);
            if (fs.existsSync(resolvedPath)) {
                bgToUse = resolvedPath;
            }
        }
    }
    if (!bgToUse) {
        const defaultBg = path.join(process.cwd(), 'zenith_bg - Copy.png');
        if (fs.existsSync(defaultBg)) {
            bgToUse = defaultBg;
        }
    }

    // Draw background image
    if (bgToUse) {
        try {
            const bg = await loadImage(bgToUse);
            ctx.drawImage(bg, 0, 0, 800, 250);
            
            // Darken background slightly to increase readability of card details
            ctx.fillStyle = 'rgba(10, 10, 12, 0.35)';
            ctx.fillRect(0, 0, 800, 250);
        } catch (e) {
            // Premium fallback gradient
            const grad = ctx.createLinearGradient(0, 0, 800, 250);
            grad.addColorStop(0, '#0d0b18');
            grad.addColorStop(0.5, '#1e1b30');
            grad.addColorStop(1, '#0e0b16');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 800, 250);
        }
    } else {
        // Premium fallback gradient
        const grad = ctx.createLinearGradient(0, 0, 800, 250);
        grad.addColorStop(0, '#0d0b18');
        grad.addColorStop(0.5, '#1e1b30');
        grad.addColorStop(1, '#0e0b16');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 800, 250);
    }

    // Glass panel overlay with shadow
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    const cardGrad = ctx.createLinearGradient(25, 20, 25, 230);
    cardGrad.addColorStop(0, 'rgba(17, 12, 28, 0.85)');
    cardGrad.addColorStop(1, 'rgba(8, 5, 15, 0.95)');
    ctx.fillStyle = cardGrad;
    ctx.beginPath();
    ctx.roundRect(25, 20, 750, 210, 16);
    ctx.fill();
    ctx.restore();

    // Border with gold gradient
    const borderGrad = ctx.createLinearGradient(25, 20, 775, 230);
    borderGrad.addColorStop(0, 'rgba(251, 191, 36, 0.5)');
    borderGrad.addColorStop(0.3, 'rgba(251, 191, 36, 0.15)');
    borderGrad.addColorStop(0.7, 'rgba(217, 119, 6, 0.15)');
    borderGrad.addColorStop(1, 'rgba(217, 119, 6, 0.4)');
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(25, 20, 750, 210, 16);
    ctx.stroke();

    // User Avatar
    if (avatarUrl) {
        const img = await getAvatar(avatarUrl);
        if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(110, 125, 55, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, 55, 70, 110, 110);
            ctx.restore();

            // Avatar border with glow
            ctx.save();
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 3.5;
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(251, 191, 36, 0.8)';
            ctx.beginPath();
            ctx.arc(110, 125, 55, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Level Up title text with gold gradient
    const titleGrad = ctx.createLinearGradient(200, 50, 450, 50);
    titleGrad.addColorStop(0, '#fbbf24');
    titleGrad.addColorStop(0.5, '#fde68a');
    titleGrad.addColorStop(1, '#f59e0b');
    
    ctx.save();
    ctx.fillStyle = titleGrad;
    ctx.textAlign = 'left';
    ctx.font = 'bold 36px sans-serif';
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
    ctx.fillText('LEVEL UP!', 195, 90);
    ctx.restore();

    // Congratulations text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    const displayName = username.length > 22 ? username.substring(0, 22) + '…' : username;
    ctx.fillText(`Congratulations, ${displayName}!`, 195, 135);

    // Decorative separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(195, 155);
    ctx.lineTo(520, 155);
    ctx.stroke();

    // New Level text
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 17px sans-serif';
    ctx.fillText('You just reached', 195, 185);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`Level ${newLevel}`, 340, 185);

    // Level Badge Shield on the Right Side
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(251, 191, 36, 0.4)';
    
    // Outer golden ring
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(670, 125, 46, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner dark circle
    ctx.fillStyle = 'rgba(20, 15, 30, 0.85)';
    ctx.beginPath();
    ctx.arc(670, 125, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Badge details
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('NEW RANK', 670, 112);
    
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(String(newLevel), 670, 148);

    return canvas.toBuffer('image/png');
}

module.exports = { generateFamilyTree, generateMafiaHierarchy, generateLeaderboardImage, generateLevelUpImage };
