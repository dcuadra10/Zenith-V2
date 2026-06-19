import os
import json

base_path = r"c:\Users\David Jose Cuadra\Bot"

script_js_path = os.path.join(base_path, 'dashboard', 'script.js')
with open(script_js_path, 'r', encoding='utf-8') as f:
    script_content = f.read()

# Update HTML onClick
dashboard_html_path = os.path.join(base_path, 'dashboard', 'dashboard.html')
with open(dashboard_html_path, 'r', encoding='utf-8') as f:
    dashboard_html = f.read()
dashboard_html = dashboard_html.replace("alert('Not implemented yet')", "addButtonRow()")
with open(dashboard_html_path, 'w', encoding='utf-8') as f:
    f.write(dashboard_html)

# Update script.js panelDraft
script_content = script_content.replace('let panelDraft = { dropdowns: [] };', 'let panelDraft = { dropdowns: [], buttonRows: [] };')
script_content = script_content.replace('panelDraft.dropdowns = [];', 'panelDraft.dropdowns = []; panelDraft.buttonRows = [];')
script_content = script_content.replace("dropdowns: panelDraft.dropdowns", "dropdowns: panelDraft.dropdowns,\n                    buttonRows: panelDraft.buttonRows")

# Inject Button Row Logic
btn_row_logic = """
function addButtonRow() {
    if (!panelDraft.buttonRows) panelDraft.buttonRows = [];
    if (panelDraft.dropdowns.length + panelDraft.buttonRows.length >= 5) return showToast('Discord limits to 5 component rows max', true);
    panelDraft.buttonRows.push({ id: Date.now().toString(), options: [] });
    renderDropdowns();
}

function addBtnOption(rIdx) {
    if (panelDraft.buttonRows[rIdx].options.length >= 5) return showToast('Discord limits to 5 buttons per row', true);
    panelDraft.buttonRows[rIdx].options.push({
        label: 'New Button',
        emoji: '🎫',
        description: 'Open a general support ticket.',
        ticketName: 'ticket-{username}',
        embedTitle: 'Welcome to Support',
        embedDescription: 'Please wait, staff will be with you shortly.',
        systemType: 'ticket',
        staffRoles: '',
        pingRoles: '',
        questions: [],
        buttonStyle: 'Primary'
    });
    renderDropdowns();
}

function removeBtnRow(rIdx) {
    panelDraft.buttonRows.splice(rIdx, 1);
    renderDropdowns();
}

function removeBtnOption(rIdx, oIdx) {
    panelDraft.buttonRows[rIdx].options.splice(oIdx, 1);
    renderDropdowns();
}

function updateBtnField(rIdx, oIdx, field, val) {
    panelDraft.buttonRows[rIdx].options[oIdx][field] = val;
}
"""
script_content = script_content.replace('function addOption(dIdx) {', btn_row_logic + '\nfunction addOption(dIdx) {')

# Modify openOptionSettings to accept isBtn
script_content = script_content.replace('function openOptionSettings(dIdx, oIdx) {', 'function openOptionSettings(dIdx, oIdx, isBtn = false) {\n    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];\n    currentModalTarget = { dIdx, oIdx, isBtn };')
script_content = script_content.replace('const opt = panelDraft.dropdowns[dIdx].options[oIdx];', '')

script_content = script_content.replace('const opt = panelDraft.dropdowns[currentModalTarget.dIdx].options[currentModalTarget.oIdx];', 'const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[currentModalTarget.dIdx].options[currentModalTarget.oIdx] : panelDraft.dropdowns[currentModalTarget.dIdx].options[currentModalTarget.oIdx];')
script_content = script_content.replace('panelDraft.dropdowns[currentModalTarget.dIdx].options[currentModalTarget.oIdx].questions', '(currentModalTarget.isBtn ? panelDraft.buttonRows[currentModalTarget.dIdx] : panelDraft.dropdowns[currentModalTarget.dIdx]).options[currentModalTarget.oIdx].questions')

script_content = script_content.replace('const opt = panelDraft.dropdowns[dIdx].options[oIdx];', 'const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];')

# Render function refactor
render_func_replacement = """
    // Render Button Rows
    const btnRows = panelDraft.buttonRows || [];
    btnRows.forEach((br, rIdx) => {
        const wrap = document.createElement('div');
        wrap.style.background = 'rgba(255,255,255,0.01)';
        wrap.style.border = '1px solid var(--border-medium)';
        wrap.style.borderRadius = 'var(--radius-lg)';
        wrap.style.marginBottom = '20px';
        wrap.style.overflow = 'hidden';

        let optionsHtml = '';
        br.options.forEach((opt, oIdx) => {
            optionsHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle);">
                    <div style="display:flex; align-items:center; gap:16px; flex:1;">
                        <span style="color:var(--text-muted); cursor:grab;">☰</span>
                        <div style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; background:var(--accent-cyan); color:black; border-radius:var(--radius-md); font-size:1.2rem;">${opt.emoji || '🎫'}</div>
                        <div style="flex:1;">
                            <h4 style="font-size:0.95rem; font-weight:600; margin-bottom:4px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                <input class="z-input" style="padding:4px 8px; font-weight:600; font-size:0.9rem; background:transparent; border:none; border-bottom:1px dashed var(--border-medium); width:200px;" value="${opt.label}" onchange="updateBtnField(${rIdx},${oIdx},'label',this.value)" placeholder="Button Label">
                            </h4>
                        </div>
                    </div>
                    <div style="display:flex; gap:12px;">
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="openOptionSettings(${rIdx}, ${oIdx}, true)">⚙️</button>
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="removeBtnOption(${rIdx},${oIdx})">🗑️</button>
                    </div>
                </div>`;
        });

        optionsHtml += `
            <div style="padding:14px; text-align:center;">
                <button class="z-btn" style="width:100%; border:1px dashed var(--border-medium); background:rgba(255,255,255,0.015); color:var(--text-muted); font-size:0.85rem;" onclick="addBtnOption(${rIdx})">+ Add Button</button>
            </div>
        `;

        wrap.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:12px; color:var(--text-muted); font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                    <span style="cursor:grab;">☰</span>
                    <span style="color:var(--accent-cyan);">▶️ BUTTON ROW</span>
                </div>
                <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="removeBtnRow(${rIdx})">🗑️</button>
            </div>
            ${optionsHtml}
        `;
        c.appendChild(wrap);
    });
"""
script_content = script_content.replace("panelDraft.dropdowns.forEach((dd, dIdx) => {", render_func_replacement + "\n    panelDraft.dropdowns.forEach((dd, dIdx) => {")

with open(script_js_path, 'w', encoding='utf-8') as f:
    f.write(script_content)

# Now update src/index.js to parse buttonRows
index_api_path = os.path.join(base_path, 'src', 'index.js')
with open(index_api_path, 'r', encoding='utf-8') as f:
    api_content = f.read()

btn_row_builder = """
        if (panelData.buttonRows) {
            panelData.buttonRows.forEach((br, i) => {
                if (!br.options || br.options.length === 0) return;
                const { ButtonBuilder, ButtonStyle } = require('discord.js');
                const row = new ActionRowBuilder();
                br.options.forEach((opt, optIdx) => {
                    let style = ButtonStyle.Primary;
                    if (opt.buttonStyle === 'Secondary') style = ButtonStyle.Secondary;
                    if (opt.buttonStyle === 'Success') style = ButtonStyle.Success;
                    if (opt.buttonStyle === 'Danger') style = ButtonStyle.Danger;
                    
                    const btn = new ButtonBuilder()
                        .setCustomId(`ticket_panel_${panelId}_btn_${i}_${optIdx}`)
                        .setLabel(opt.label || 'Ticket')
                        .setStyle(style);
                    if (opt.emoji) btn.setEmoji(opt.emoji);
                    row.addComponents(btn);
                });
                rows.push(row);
            });
        }
"""
api_content = api_content.replace('let postedMsg;', btn_row_builder + '\n        let postedMsg;')
with open(index_api_path, 'w', encoding='utf-8') as f:
    f.write(api_content)
    
# Update interactionCreate.js
ic_path = os.path.join(base_path, 'src', 'events', 'interactionCreate.js')
with open(ic_path, 'r', encoding='utf-8') as f:
    ic_content = f.read()

btn_handler = """
            } else if (interaction.customId.startsWith('ticket_panel_')) {
                const parts = interaction.customId.split('_');
                // ticket_panel_{panelId}_btn_{rIdx}_{oIdx}
                if (parts[3] === 'btn') {
                    const panelId = parts[2];
                    const rIdx = parseInt(parts[4]);
                    const oIdx = parseInt(parts[5]);
                    
                    const db = await getDb();
                    const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                    if (!panelRec) return interaction.reply({ content: 'Panel data not found.', ephemeral: true });

                    const data = JSON.parse(panelRec.panelData);
                    const opt = data.buttonRows[rIdx].options[oIdx];
                    const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                    await handleTicketSelection(interaction, opt, guildConfigs);
                }
"""
ic_content = ic_content.replace("            } else if (interaction.customId.startsWith('close_ticket_')) {", btn_handler + "\n            } else if (interaction.customId.startsWith('close_ticket_')) {")
with open(ic_path, 'w', encoding='utf-8') as f:
    f.write(ic_content)

print("Patch applied for button rows")
