// ============================================
// ZENITH COMMAND CENTER — Full Dashboard Logic
// ============================================

const API_URL = '/api';
let activeGuild = null;
let editingPanelId = null;
let editingMessageId = null;

// ===== AUTO-DRAFT SYSTEM =====
const DRAFT_KEY = 'zenith_dashboard_draft';
let _draftSaveTimer = null;
let _draftDirty = false;

function getDraftKey() {
    return activeGuild ? `${DRAFT_KEY}_${activeGuild.id}` : null;
}

function saveDraft() {
    const key = getDraftKey();
    if (!key) return;
    try {
        const draft = {
            guildId: activeGuild.id,
            guild: activeGuild,
            activePage: document.querySelector('.sidebar-link.active')?.dataset?.page || 'overview',
            panelDraft: typeof panelDraft !== 'undefined' ? panelDraft : null,
            fields: {},
            timestamp: Date.now()
        };
        document.querySelectorAll('.z-input, input[type=checkbox], input[type=color]').forEach(el => {
            if (!el.id) return;
            if (el.type === 'checkbox') {
                draft.fields[el.id] = { type: 'check', value: el.checked };
            } else if (el.type === 'color') {
                draft.fields[el.id] = { type: 'color', value: el.value };
            } else if (el.tagName === 'SELECT') {
                if (tomSelects[el.id]) {
                    draft.fields[el.id] = { type: 'select', value: tomSelects[el.id].getValue() };
                } else {
                    draft.fields[el.id] = { type: 'select', value: el.value };
                }
            } else {
                draft.fields[el.id] = { type: 'input', value: el.value };
            }
        });
        localStorage.setItem(key, JSON.stringify(draft));
        _draftDirty = false;
    } catch (e) { /* quota exceeded or serialization error */ }
}

function restoreDraft(guildId) {
    const key = `${DRAFT_KEY}_${guildId}`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (Date.now() - draft.timestamp > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(key);
            return null;
        }
        return draft;
    } catch (e) { return null; }
}

function applyDraft(draft) {
    if (!draft || !draft.fields) return;
    if (draft.panelDraft) {
        try { 
            panelDraft = draft.panelDraft;
            if (!panelDraft.v2Components) panelDraft.v2Components = [];
        } catch(e) {}
    }
    Object.entries(draft.fields).forEach(([id, data]) => {
        const el = document.getElementById(id);
        if (!el) return;
        try {
            if (data.type === 'check') {
                el.checked = data.value;
            } else if (data.type === 'select' && tomSelects[id]) {
                tomSelects[id].setValue(data.value);
            } else {
                el.value = data.value;
            }
        } catch (e) {}
    });
    
    // Synchronize UI mode and content
    toggleV2Mode();
    renderV2Editor();
    renderDropdowns();

    if (draft.activePage) {
        const link = document.querySelector(`.sidebar-link[data-page="${draft.activePage}"]`);
        if (link) link.click();
    }
    showToast('\u{1f4dd} Draft restored from your last session');
}

function clearDraft() {
    const key = getDraftKey();
    if (key) localStorage.removeItem(key);
}

function markDirty() { _draftDirty = true; }

function startAutoSave() {
    if (_draftSaveTimer) clearInterval(_draftSaveTimer);
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);
    _draftSaveTimer = setInterval(() => {
        if (_draftDirty) saveDraft();
    }, 5000);
    window.addEventListener('beforeunload', () => {
        if (_draftDirty || activeGuild) saveDraft();
    });
}

// ===== UTILITIES =====
function getCookie(name) {
    const v = `; ${document.cookie}`;
    const parts = v.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('discord_token') || getCookie('discord_token');
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
        localStorage.removeItem('discord_token');
        document.cookie = 'discord_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        showScreen('loginScreen');
        throw new Error('Unauthorized');
    }
    return res;
}

function animateValue(el, start, end, duration) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    let startTs = null;
    const step = (ts) => {
        if (!startTs) startTs = ts;
        const p = Math.min((ts - startTs) / duration, 1);
        el.textContent = Math.floor(p * (end - start) + start);
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}


// ===== SCREEN MANAGEMENT =====
function showScreen(id) {
    ['loginScreen', 'guildScreen', 'dashboardScreen'].forEach(s => {
        document.getElementById(s).style.display = 'none';
    });
    document.getElementById(id).style.display = '';
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('token') === 'success') {
        const token = params.get('access_token');
        if (token) localStorage.setItem('discord_token', token);
        window.history.replaceState({}, document.title, '/');
        showScreen('guildScreen');
        fetchGuilds();
    } else if (localStorage.getItem('discord_token') || getCookie('discord_token')) {
        // Check if user had a guild session open
        const lastGuild = localStorage.getItem('zenith_last_guild');
        if (lastGuild) {
            try {
                const guild = JSON.parse(lastGuild);
                showScreen('guildScreen');
                fetchGuilds().then(() => selectGuild(guild));
            } catch(e) {
                showScreen('guildScreen');
                fetchGuilds();
            }
        } else {
            showScreen('guildScreen');
            fetchGuilds();
        }
    }

    // Sidebar navigation
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            const page = link.dataset.page;
            if (!page) return;
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById('page-' + page);
            if (target) target.classList.add('active');

            if (page === 'transcripts') {
                fetchTranscripts();
            }
            if (page === 'economy') {
                fetchShopItems();
            }
            if (page === 'rss') {
                fetchRssCollectiveStock();
            }
            markDirty(); // track page change for draft
        });
    });

    // Color pickers sync
    setupColorSync('panelColor', 'panelColorHex');
    setupColorSync('welcomeColor', 'welcomeColorHex');
});

function setupColorSync(inputId, hexId) {
    const input = document.getElementById(inputId);
    const hex = document.getElementById(hexId);
    if (input && hex) {
        input.addEventListener('input', () => { hex.textContent = input.value; });
    }
}

// ===== GUILD LOADING =====
async function fetchGuilds() {
    console.log('[Dashboard] Fetching guilds...');
    const list = document.getElementById('guildList');
    try {
        const res = await apiFetch('/guilds');
        const guilds = await res.json();
        console.log('[Dashboard] Loaded guilds:', guilds.length);

        if (guilds.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;width:100%;">No shared admin servers found.</p>';
            return;
        }

        list.innerHTML = '';
        guilds.forEach(g => {
            const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : '';
            const el = document.createElement('div');
            el.className = 'guild-item';
            el.innerHTML = `
                <div class="guild-avatar">
                    ${iconUrl ? `<img src="${iconUrl}" alt="${g.name}">` : g.name[0]}
                </div>
                <div class="guild-info">
                    <h3>${g.name}</h3>
                    <small>${g.owner ? 'Owner' : 'Admin'}</small>
                </div>
            `;
            el.onclick = () => selectGuild(g);
            list.appendChild(el);
        });
    } catch (e) {
        console.error('[Dashboard] Fetch Guilds Error:', e);
    }
}

function selectGuild(guild) {
    activeGuild = guild;
    document.getElementById('sidebarGuildName').textContent = guild.name;
    
    // Sidebar server avatar
    const avatarEl = document.getElementById('sidebarAvatar');
    if (guild.icon) {
        avatarEl.innerHTML = `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png" alt="${guild.name}">`;
    } else {
        avatarEl.textContent = guild.name[0];
        avatarEl.style.display = 'flex';
        avatarEl.style.alignItems = 'center';
        avatarEl.style.justifyContent = 'center';
        avatarEl.style.fontWeight = '700';
        avatarEl.style.color = 'var(--primary)';
    }

    // Topbar user
    document.getElementById('topbarUsername').textContent = guild.owner ? 'Owner' : 'Admin';

    showScreen('dashboardScreen');
    localStorage.setItem('zenith_last_guild', JSON.stringify(guild));
    loadDashboardData().then(() => {
        const draft = restoreDraft(guild.id);
        if (draft) setTimeout(() => applyDraft(draft), 500);
    });
    startAutoSave();
}

function goBackToGuilds() {
    saveDraft(); // save before leaving
    localStorage.removeItem('zenith_last_guild');
    activeGuild = null;
    showScreen('guildScreen');
    // Reset to overview
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    document.querySelector('.sidebar-link[data-page="overview"]').classList.add('active');
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById('page-overview').classList.add('active');
}

let currentGuildChannels = [];
let currentGuildRoles = [];
let tomSelects = {};

function initTomSelect(id, isMulti, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;

    // Destroy existing if any
    if (tomSelects[id]) {
        tomSelects[id].destroy();
        delete tomSelects[id];
    }

    try {
        tomSelects[id] = new TomSelect(el, {
            create: false,
            placeholder: placeholder || 'Select...',
            maxOptions: 500,
            plugins: isMulti ? ['remove_button'] : [],
            render: {
                option: function(data, escape) {
                    let icon = '';
                    if (id.toLowerCase().includes('channel')) icon = '<i class="fas fa-hashtag" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('role')) icon = '<i class="fas fa-at" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('category')) icon = '<i class="fas fa-folder" style="opacity:0.6; margin-right:8px;"></i>';
                    return `<div>${icon}${escape(data.text)}</div>`;
                },
                item: function(data, escape) {
                    let icon = '';
                    if (id.toLowerCase().includes('channel')) icon = '<i class="fas fa-hashtag" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('role')) icon = '<i class="fas fa-at" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('category')) icon = '<i class="fas fa-folder" style="opacity:0.6; margin-right:8px;"></i>';
                    return `<div>${icon}${escape(data.text)}</div>`;
                }
            }
        });
    } catch (e) {
        console.warn(`Could not init TomSelect for ${id}:`, e);
    }
}

function populateAllDropdowns() {
    // We will populate all <select> elements dynamically based on their purpose
    // Category dropdowns
    const categories = currentGuildChannels.filter(c => c.type === 4);
    const textChannels = currentGuildChannels.filter(c => c.type === 0 || c.type === 5);
    
    // Selects that need a channel
    const channelSelects = [
        'cfgWelcomeChannel', 'cfgLogChannel', 'cfgLeadershipChannel', 
        'panelChannelId', 'adminReviewChannel', 
        'marketApprovalChannel', 'marketFeeChannel', 'automodLogChannel', 
        'loggingChannel', 'countingChannel', 'swearJarChannel',
        'levelUpChannel', 'ticketsTranscriptChannel', 'ticketsApprovalChannel', 'marketOwnerChannel',
        'newKingdomTargetChannel', 'ecoWelcomeNotifyChannel', 'rssDeployChannel',
        'aiWelcomeChannel', 'aiSupportChannel'
    ];

    // Selects that need a category
    const categorySelects = ['cfgTicketCategory', 'statsCategoryId', 'modalCategoryId', 'rssCategory'];
    
    // Selects that need a role
    const roleSelects = ['marketMiddlemanRole', 'r4TrackingRole', 'autoRoleInput', 'newKingdomPingRole', 'rssSellerRole'];
    
    channelSelects.forEach(id => populateDropdown(id, textChannels, 'Select a Channel'));
    categorySelects.forEach(id => populateDropdown(id, categories, 'Select a Category'));
    roleSelects.forEach(id => populateDropdown(id, currentGuildRoles, 'Select a Role'));
    
    // Multi-select for channels
    const multiChannelSelects = ['aiChatChannels', 'aiSupportKnowledgeChannels'];
    multiChannelSelects.forEach(id => populateDropdown(id, textChannels, 'Select Channels', true));

    // Multi-select for roles
    const multiRoleSelects = ['modalStaffRoles', 'modalPingRoles', 'autoroleIds'];
    multiRoleSelects.forEach(id => populateDropdown(id, currentGuildRoles, 'Select Roles', true));
}

function populateDropdown(elementId, items, placeholder, isMulti = false) {
    const el = document.getElementById(elementId);
    if (!el || el.tagName !== 'SELECT') return;
    
    // Preserve existing value if any
    const currentValue = isMulti ? 
        Array.from(el.selectedOptions).map(o => o.value) : 
        el.value;
        
    el.innerHTML = '';
    
    if (!isMulti) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = `-- ${placeholder} --`;
        el.appendChild(defaultOpt);
    }

    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        el.appendChild(opt);
    });
    
    // Restore value
    if (isMulti) {
        Array.from(el.options).forEach(opt => {
            if (currentValue.includes(opt.value)) opt.selected = true;
        });
    } else {
        el.value = currentValue;
    }

    // Re-init TomSelect
    initTomSelect(elementId, isMulti, placeholder);
}


// ===== LOAD ALL DASHBOARD DATA =====
async function loadDashboardData() {
    if (!activeGuild) return;
    const gid = activeGuild.id;

    // Reset current data to avoid showing stale info from previous guild
    currentGuildChannels = [];
    currentGuildRoles = [];

    // Fetch channels and roles
    try {
        const [chanRes, roleRes] = await Promise.all([
            fetch(`${API_URL}/guild/${gid}/channels`),
            fetch(`${API_URL}/guild/${gid}/roles`)
        ]);
        if (chanRes.ok) currentGuildChannels = await chanRes.json();
        if (roleRes.ok) currentGuildRoles = await roleRes.json();
        
        // Populate all dropdowns (will add this function soon)
        populateAllDropdowns();
    } catch (e) { console.error('Error fetching guild data:', e); }

    // Stats
    try {
        const res = await fetch(`${API_URL}/guild/${gid}/stats`);
        if (res.ok) {
            const data = await res.json();
            animateValue('statHumans', 0, data.citizens || 0, 800);
            animateValue('statBots', 0, data.bots || 0, 800);
            animateValue('statChannels', 0, data.communications || 0, 800);
            animateValue('statBoosts', 0, data.boosts || 0, 800);
        }
    } catch (e) { console.error('Error fetching stats:', e); }

    // Config
    try {
        const res = await fetch(`${API_URL}/config/${gid}`);
        const cfg = await res.json();
        setVal('cfgWelcomeChannel', cfg.welcomeChannelId);
        setVal('cfgLogChannel', cfg.logChannelId);
        setVal('cfgLeadershipChannel', cfg.leadershipChannelId);
        setVal('cfgTicketCategory', cfg.ticketCategoryId);
        setVal('cfgSpreadsheetId', cfg.spreadsheetId);
    } catch (e) { console.error(e); }

    // Module configs
    try {
        const res = await fetch(`${API_URL}/modules/${gid}`);
        const mods = await res.json();
        loadModuleToggles(mods);
        
        // Populate new customization fields
        setVal('levelUpTitle', mods.levelUpTitle || '?? Level Up!');
        setVal('levelUpMessage', mods.levelUpMessage || '{user} just reached level **{level}**!');
        setVal('levelUpColor', mods.levelUpColor || '#FFD700');
        setCheck('levelUpUseEmbed', mods.levelUpUseEmbed !== undefined ? mods.levelUpUseEmbed : true);
        setVal('levelingBackground', mods.levelingBackground || '');
        
        setVal('swearJarTitle', mods.swearJarTitle || '?? Swear Jar Contribution!');
        setVal('swearJarMessage', mods.swearJarMessage || '{user} just added a coin to the jar for using prohibited dialect: `{word}`');
        setVal('swearJarColor', mods.swearJarColor || '#FFD700');
        
        // Update all previews initially
        updateWelcomePreview();
        updateLevelingPreview();
        updateSwearJarPreview();
    } catch (e) { console.error(e); }

    // Panels
    fetchPanels();
    fetchTranscripts();
    fetchGiveaways();
    fetchR4Tracking();
    fetchCustomBot();
    fetchAIAgentConfig();
    fetchMarketConfig();
    fetchRssCollectiveStock();
}

// ===== MARKET QUESTIONS LOGIC =====
let marketQuestionsArr = [];

function loadDefaultMarketQuestions() {
    marketQuestionsArr = [
        { key: 'price', prompt: '💰 **1. What is the Price of the account?**\n*(e.g. 1000$)*', isImage: false },
        { key: 'power', prompt: '<:power:1497402340892868618> **2. What is the Power?**\n*(e.g. 100m)*', isImage: false },
        { key: 'kp', prompt: '<:kp:1497402419665961001> **3. What are the Kill Points?**\n*(e.g. 30b)*', isImage: false },
        { key: 'deaths', prompt: '<:deaths:1497402636083662981> **4. What are the Deaths?**\n*(e.g. 30m)*', isImage: false },
        { key: 'vip', prompt: '<:VIP:1497401764717002924> **5. What is the VIP Level?**\n*(e.g. SVIP, VIP 17)*', isImage: false },
        { key: 'gems', prompt: '<:gem1:1497401988651159573> **6. How many Gems?**\n*(e.g. 50k)*', isImage: false },
        { key: 'skins', prompt: '<:skin:1497410065492086965> **7. How many Legendary City Skins?**\n*(e.g. 5)*', isImage: false },
        { key: 'equipment', prompt: '<:equip:1497405923189194863> **8. How many Legendary Equipment pieces?**\n*(e.g. 10)*', isImage: false },
        { key: 'passports', prompt: '<:passport:1495891858717671454> **9. How many Passports?**\n*(e.g. 100)*', isImage: false },
        { key: 'goldHeads', prompt: '<:gh:1497401912142729257> **10. How many Gold Heads?**\n*(e.g. 100)*', isImage: false },
        { key: 'commanders', prompt: '<:commander:1497711538906337451> **11. How many Expertise Legendary Commanders?**\n*(e.g. 10)*', isImage: false },
        { key: 'rss', prompt: '🌾🪵🪨🪙 **12. How many Resources (Food, Wood, Stone, Gold)?**\n*(e.g. 10b Food, 5b Wood...)*', isImage: false },
        { key: 'speedups', prompt: '⏱️ **13. How many Speedups (Universal, Healing, Training)?**\n*(e.g. 1000d Uni, 300d Heal...)*', isImage: false },
        { key: 'age', prompt: '<:days:1497712897181089802> **14. Account Age in days?**\n*(e.g. 1000 days)*', isImage: false },
        { key: 'migrate', prompt: '✈️ **15. Is the account ready to migrate?**\n*(Yes / No)*', isImage: false },
        { key: 'kvk', prompt: '⚔️ **16. Which KvK is it in?**\n*(1, 2, 3, or SOC)*', isImage: false },
        { key: 'notes', prompt: '<:notes:1500635402820780232> **17. Any additional notes?**\n*(e.g. N/A or details about farms)*', isImage: false },
        { key: 'images', prompt: '📸 **18. Please upload screenshots proving this information.**\n*(Upload all images in a single message, then wait).*', isImage: true }
    ];
    renderMarketQuestions();
}

function addMarketQuestion() {
    marketQuestionsArr.push({ key: 'custom_'+Date.now(), prompt: 'New Question?', isImage: false });
    renderMarketQuestions();
}

function removeMarketQuestion(idx) {
    marketQuestionsArr.splice(idx, 1);
    renderMarketQuestions();
}

function updateMarketQuestion(idx, field, val) {
    marketQuestionsArr[idx][field] = val;
}

function renderMarketQuestions() {
    const list = document.getElementById('marketQuestionsList');
    if (!list) return;
    if (marketQuestionsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">Using the default 17 RoK questions.</p></div>';
        return;
    }
    
    list.innerHTML = marketQuestionsArr.map((q, i) => `
        <div style="display:grid; grid-template-columns: 120px 1fr 100px 40px; gap:10px; align-items:center; padding:12px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">JSON KEY</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${q.key}" onchange="updateMarketQuestion(${i}, 'key', this.value)" placeholder="e.g. power">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">BOT PROMPT</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${q.prompt.replace(/"/g, '&quot;')}" onchange="updateMarketQuestion(${i}, 'prompt', this.value)" placeholder="e.g. What is the Power?">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <label style="font-size:0.65rem; color:var(--text-muted);">IS IMAGE?</label>
                <input type="checkbox" ${q.isImage ? 'checked' : ''} onchange="updateMarketQuestion(${i}, 'isImage', this.checked)">
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMarketQuestion(${i})">✕</button>
        </div>
    `).join('');
}

// ===== MARKET CHANNELS LOGIC =====
let marketForumChannelsArr = [];

function addMarketForumChannel() {
    marketForumChannelsArr.push({ min: 0, max: 999999, channelId: '' });
    renderMarketForumChannels();
}

function removeMarketForumChannel(idx) {
    marketForumChannelsArr.splice(idx, 1);
    renderMarketForumChannels();
}

function updateMarketForumChannel(idx, field, val) {
    marketForumChannelsArr[idx][field] = val;
}

function renderMarketForumChannels() {
    const list = document.getElementById('marketForumChannelsList');
    if (!list) return;
    if (marketForumChannelsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">No channels defined. Bot will not be able to post listings.</p></div>';
        return;
    }
    
    list.innerHTML = marketForumChannelsArr.map((c, i) => `
        <div style="display:grid; grid-template-columns: 100px 100px 1fr 40px; gap:10px; align-items:center; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MIN PRICE ($)</label>
                <input type="number" class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.min}" onchange="updateMarketForumChannel(${i}, 'min', parseFloat(this.value))">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MAX PRICE ($)</label>
                <input type="number" class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.max}" onchange="updateMarketForumChannel(${i}, 'max', parseFloat(this.value))">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">FORUM CHANNEL ID</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.channelId}" onchange="updateMarketForumChannel(${i}, 'channelId', this.value)" placeholder="e.g. 123456789">
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMarketForumChannel(${i})">✕</button>
        </div>
    `).join('');
}

// ===== MIDDLEMAN PAYMENTS LOGIC =====
let mmPaymentMethodsArr = [];

function addMmPaymentMethod() {
    mmPaymentMethodsArr.push({ userId: '', details: '' });
    renderMmPaymentMethods();
}

function removeMmPaymentMethod(idx) {
    mmPaymentMethodsArr.splice(idx, 1);
    renderMmPaymentMethods();
}

function updateMmPaymentMethod(idx, field, val) {
    mmPaymentMethodsArr[idx][field] = val;
}

function renderMmPaymentMethods() {
    const list = document.getElementById('mmPaymentList');
    if (!list) return;
    if (mmPaymentMethodsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">No middleman-specific payment info defined.</p></div>';
        return;
    }
    
    list.innerHTML = mmPaymentMethodsArr.map((m, i) => `
        <div style="display:grid; grid-template-columns: 200px 1fr 40px; gap:10px; align-items:start; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MIDDLEMAN USER ID</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${m.userId}" onchange="updateMmPaymentMethod(${i}, 'userId', this.value)" placeholder="e.g. 123456789">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">PAYMENT DETAILS</label>
                <textarea class="z-input" style="font-size:0.8rem; padding:6px;" rows="2" onchange="updateMmPaymentMethod(${i}, 'details', this.value)" placeholder="PayPal: mm@paypal.com">${m.details}</textarea>
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMmPaymentMethod(${i})">✕</button>
        </div>
    `).join('');
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    if (tomSelects[id]) {
        const values = (val || '').split(',').map(v => v.trim()).filter(v => v);
        tomSelects[id].setValue(values);
        return;
    }

    if (el.tagName === 'SELECT' && el.multiple) {
        const values = (val || '').split(',').map(v => v.trim());
        Array.from(el.options).forEach(opt => {
            opt.selected = values.includes(opt.value);
        });
    } else {
        el.value = val || '';
    }
}

function loadModuleToggles(mods) {
    if (!mods) return;
    // Welcome
    setCheck('toggleWelcome', mods.welcomeEnabled);
    setVal('welcomeChannelCfg', mods.welcomeChannel);
    setVal('welcomeTitle', mods.welcomeEmbedTitle);
    setVal('welcomeMessage', mods.welcomeEmbedDesc);
    if (mods.welcomeColor) {
        setVal('welcomeColor', mods.welcomeColor);
        const hex = document.getElementById('welcomeColorHex');
        if (hex) hex.textContent = mods.welcomeColor;
    }
    setVal('welcomeImage', mods.welcomeImage);
    setCheck('welcomeUseEmbed', mods.welcomeUseEmbed === undefined || mods.welcomeUseEmbed === null ? true : !!mods.welcomeUseEmbed);
    // Leveling
    setCheck('toggleLeveling', mods.levelingenabled);
    setVal('xpMin', mods.xpmin ?? 5);
    setVal('xpMax', mods.xpmax ?? 15);
    setVal('xpCooldown', mods.xpcooldown ?? 60);
    setVal('levelUpChannel', mods.levelupchannel);
    // Tickets
    setCheck('toggleTickets', mods.ticketsenabled);
    if(mods.ticketsmaxactive) setVal('ticketsMaxActive', mods.ticketsmaxactive ?? 2);
    setVal('ticketsTranscriptChannel', mods.ticketstranscriptchannel);
    setVal('ticketCategoryId', mods.ticketcategoryid);
    setVal('ticketsApprovalChannel', mods.ticketsapprovalchannel);
    // Automod
    setCheck('toggleAutomod', mods.automodenabled);
    setCheck('automodSpam', mods.automodspam);
    setCheck('automodLinks', mods.automodlinks);
    setCheck('automodMentions', mods.automodmentions);
    setCheck('automodCaps', mods.automodcaps);
    setCheck('automodWords', mods.automodwords);
    setVal('automodWordList', mods.automodwordlist || 'fuck,shit,bitch,asshole,dick,cunt,pussy,motherfucker,puta,mierda,pendejo,cabron');
    setVal('automodMaxMentions', mods.automodmaxmentions ?? 5);
    setVal('automodLogChannel', mods.automodlogchannel);
    // Logging
    setCheck('toggleLogging', mods.loggingenabled);
    setVal('loggingChannel', mods.loggingchannel);
    setCheck('logEdits', mods.logedits);
    setCheck('logDeletes', mods.logdeletes);
    setCheck('logMembers', mods.logmembers);
    setCheck('logRoles', mods.logroles);
    setCheck('logChannels', mods.logchannels);
    setCheck('logVoice', mods.logvoice);
    setCheck('logServer', mods.logserver);
    setCheck('logInvites', mods.loginvites);
    // Auto-Role
    setCheck('toggleAutorole', mods.autoroleenabled);
    setVal('autoroleIds', mods.autoroleids);
    // Swear Jar
    setCheck('toggleSwearJar', mods.swearjarenabled);
    setVal('swearJarChannel', mods.swearjarchannel);
    setVal('swearJarWords', mods.swearjarwords || 'fuck,shit,bitch,asshole,dick,cunt,pussy,motherfucker,puta,mierda,pendejo,cabron');
    setCheck('swearJarPing', mods.swearjarping === undefined || mods.swearjarping === null ? true : !!mods.swearjarping);
    // Counting
    setCheck('toggleCounting', mods.countingenabled);
    setVal('countingChannel', mods.countingchannel);
    setVal('countingCurrent', mods.countingcurrent);
    setCheck('countingSameUser', mods.countingsameuser);
    setCheck('countingReset', mods.countingreset);
    setCheck('countingMath', mods.countingmath);
    // Server Stats
    setCheck('toggleServerStats', mods.serverstatsenabled);
    setCheck('statsTotalMembers', mods.statstotalmembers);
    setCheck('statsOnline', mods.statsonline);
    setCheck('statsBots', mods.statsbots);
    setCheck('statsChannels', mods.statschannels);
    setVal('statsCategoryId', mods.statscategoryid);
    // Anti-Nuke
    setCheck('toggleAntinuke', mods.antinukeenabled);
    setCheck('antinukeBan', mods.antinukeban);
    setCheck('antinukeChannel', mods.antinukechannel);
    setCheck('antinukeRole', mods.antinukerole);
    setCheck('antinukeWebhook', mods.antinukewebhook);
    setVal('antinukeThreshold', mods.antinukethreshold ?? 5);
    setVal('antinukeWhitelist', mods.antinukewhitelist);
    // R4 Tracking
    setCheck('toggleR4Tracking', mods.r4trackingenabled);
    setVal('r4TrackingRole', mods.r4trackingrole);
    setVal('r4TrackingAdQuota', mods.r4trackingadquota ?? 40);
    setVal('r4TrackingMsgQuota', mods.r4trackingmsgquota ?? 245);
    setCheck('toggleNewKingdom', mods.newkingdomenabled);
    setVal('newKingdomTargetChannel', mods.newkingdomtargetchannel);

    setVal('newKingdomPingRole', mods.newkingdompingrole);
    // Economy
    setCheck('toggleEconomy', mods.ecoenabled);
    setVal('ecoCoinsPerMessage', mods.ecocoinspermessage ?? 1);
    setVal('ecoCoinsPerAd', mods.ecocoinsperad ?? 10);
    setVal('ecoCoinsPerInvite', mods.ecocoinsperinvite ?? 50);
    setVal('ecoCoinsPerWelcome', mods.ecocoinsperwelcome ?? 5);
    setVal('ecoCoinsPerBoost', mods.ecocoinsperboost ?? 100);
    setVal('ecoCoinsPerGiveaway', mods.ecocoinspergiveaway ?? 200);
    setVal('ecoCoinsPerVCMinute', mods.ecocoinspervcminute ?? 1);
    setVal('ecoWelcomeKeywords', mods.ecowelcomekeywords || 'welcome,bienvenido,bienvenida');
    setVal('ecoWelcomeNotifyChannel', mods.ecowelcomenotifychannel);
    
    // RSS
    setCheck('toggleRss', mods.rssenabled);
    setVal('rssSellerRole', mods.rsssellerrole);
    setVal('rssTaxRate', mods.rsstaxrate ?? 10);
    setVal('rssCategory', mods.rsscategory);
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
}

function getCheck(id) {
    const el = document.getElementById(id);
    return el ? (el.checked ? 1 : 0) : 0;
}

function getVal(id) {
    const el = document.getElementById(id);
    if (!el) return '';

    if (tomSelects[id]) {
        const val = tomSelects[id].getValue();
        return Array.isArray(val) ? val.join(', ') : val;
    }

    if (el.tagName === 'SELECT' && el.multiple) {
        return Array.from(el.selectedOptions).map(o => o.value).join(', ');
    }
    return el.value.trim();
}

// ===== SAVE GENERAL CONFIG =====
async function saveGeneralConfig() {
    if (!activeGuild) return;
    const btn = document.getElementById('btnSaveGeneral');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        await fetch(`${API_URL}/config/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                welcomeChannelId: getVal('cfgWelcomeChannel'),
                logChannelId: getVal('cfgLogChannel'),
                leadershipChannelId: getVal('cfgLeadershipChannel'),
                ticketCategoryId: getVal('cfgTicketCategory'),
                spreadsheetId: getVal('cfgSpreadsheetId')
            })
        });
        btn.textContent = '✅ Saved';
        btn.style.background = 'var(--accent-green)';
    } catch (e) {
        btn.textContent = '❌ Error';
        btn.style.background = 'var(--accent-red)';
    }
    setTimeout(() => {
        btn.textContent = '💾 Save Settings';
        btn.style.background = '';
        btn.disabled = false;
    }, 2000);
}

// ===== SAVE MODULE CONFIGS =====
async function saveModuleConfig(moduleName) {
    if (!activeGuild) return;

    const payload = {
        // Welcome
        welcomeEnabled: getCheck('toggleWelcome'),
        welcomeChannel: getVal('cfgWelcomeChannel'),
        welcomeEmbedTitle: getVal('welcomeTitle'),
        welcomeEmbedDesc: getVal('welcomeMessage'),
        welcomeColor: getVal('welcomeColor'),
        welcomeImage: getVal('welcomeImage'),
        welcomeUseEmbed: getCheck('welcomeUseEmbed'),
        // Leveling
        levelingEnabled: getCheck('toggleLeveling'),
        xpMin: parseInt(getVal('xpMin')) || 5,
        xpMax: parseInt(getVal('xpMax')) || 15,
        xpCooldown: parseInt(getVal('xpCooldown')) || 60,
        levelUpChannel: getVal('levelUpChannel'),
        levelUpTitle: getVal('levelUpTitle'),
        levelUpMessage: getVal('levelUpMessage'),
        levelUpColor: getVal('levelUpColor'),
        levelUpUseEmbed: getCheck('levelUpUseEmbed'),
        levelingBackground: getVal('levelingBackground'),
        // Tickets
        ticketsEnabled: getCheck('toggleTickets'),
        ticketsMaxActive: parseInt(getVal('ticketsMaxActive'), 10) || 2,
        ticketsTranscriptChannel: getVal('ticketsTranscriptChannel'),
        ticketCategoryId: getVal('cfgTicketCategory'),
        ticketsApprovalChannel: getVal('ticketsApprovalChannel'),
        // Swear Jar
        swearJarEnabled: getCheck('toggleSwearJar'),
        swearJarChannel: getVal('swearJarChannel'),
        swearJarWords: getVal('swearJarWords'),
        swearJarPing: getCheck('swearJarPing'),
        swearJarTitle: getVal('swearJarTitle'),
        swearJarMessage: getVal('swearJarMessage'),
        swearJarColor: getVal('swearJarColor'),
        // Automod
        automodEnabled: getCheck('toggleAutomod'),
        automodSpam: getCheck('automodSpam'),
        automodLinks: getCheck('automodLinks'),
        automodMentions: getCheck('automodMentions'),
        automodCaps: getCheck('automodCaps'),
        automodWords: getCheck('automodWords'),
        automodWordList: getVal('automodWordList'),
        automodMaxMentions: parseInt(getVal('automodMaxMentions')) || 5,
        automodLogChannel: getVal('automodLogChannel'),
        // Logging
        loggingEnabled: getCheck('toggleLogging'),
        loggingChannel: getVal('loggingChannel'),
        logEdits: getCheck('logEdits'),
        logDeletes: getCheck('logDeletes'),
        logMembers: getCheck('logMembers'),
        logRoles: getCheck('logRoles'),
        logChannels: getCheck('logChannels'),
        logBans: getCheck('logMembers'), // Syncing with members for simplicity
        logVoice: getCheck('logVoice'),
        logServer: getCheck('logServer'),
        logInvites: getCheck('logInvites'),
        // Auto-Role
        autoroleEnabled: getCheck('toggleAutorole'),
        autoroleIds: getVal('autoroleIds'),
        // Swear Jar
        swearJarEnabled: getCheck('toggleSwearJar'),
        swearJarChannel: getVal('swearJarChannel'),
        swearJarWords: getVal('swearJarWords'),
        swearJarPing: getCheck('swearJarPing'),
        // Counting
        countingEnabled: getCheck('toggleCounting'),
        countingChannel: getVal('countingChannel'),
        countingCurrent: parseInt(getVal('countingCurrent')) || 0,
        countingSameUser: getCheck('countingSameUser'),
        countingReset: getCheck('countingReset'),
        countingMath: getCheck('countingMath'),
        // Server Stats
        serverStatsEnabled: getCheck('toggleServerStats'),
        statsTotalMembers: getCheck('statsTotalMembers'),
        statsOnline: getCheck('statsOnline'),
        statsBots: getCheck('statsBots'),
        statsChannels: getCheck('statsChannels'),
        statsCategoryId: getVal('statsCategoryId'),
        // Anti-Nuke
        antinukeEnabled: getCheck('toggleAntinuke'),
        antinukeBan: getCheck('antinukeBan'),
        antinukeChannel: getCheck('antinukeChannel'),
        antinukeRole: getCheck('antinukeRole'),
        antinukeWebhook: getCheck('antinukeWebhook'),
        antinukeThreshold: parseInt(getVal('antinukeThreshold')) || 5,
        antinukeWhitelist: getVal('antinukeWhitelist'),
        // R4 Tracking
        r4TrackingEnabled: getCheck('toggleR4Tracking'),
        r4TrackingRole: getVal('r4TrackingRole'),
        r4TrackingAdQuota: parseInt(getVal('r4TrackingAdQuota')) || 40,
        r4TrackingMsgQuota: parseInt(getVal('r4TrackingMsgQuota')) || 245,
        newKingdomEnabled: getCheck('toggleNewKingdom'),
        newKingdomTargetChannel: getVal('newKingdomTargetChannel'),
        newKingdomPingRole: getVal('newKingdomPingRole'),


        // Economy
        ecoEnabled: getCheck('toggleEconomy'),
        ecoCoinsPerMessage: parseInt(getVal('ecoCoinsPerMessage')) || 1,
        ecoCoinsPerAd: parseInt(getVal('ecoCoinsPerAd')) || 10,
        ecoCoinsPerInvite: parseInt(getVal('ecoCoinsPerInvite')) || 50,
        ecoCoinsPerWelcome: parseInt(getVal('ecoCoinsPerWelcome')) || 5,
        ecoCoinsPerBoost: parseInt(getVal('ecoCoinsPerBoost')) || 100,
        ecoCoinsPerGiveaway: parseInt(getVal('ecoCoinsPerGiveaway')) || 200,
        ecoCoinsPerVCMinute: parseInt(getVal('ecoCoinsPerVCMinute')) || 1,
        ecoWelcomeKeywords: getVal('ecoWelcomeKeywords'),
        ecoWelcomeNotifyChannel: getVal('ecoWelcomeNotifyChannel'),
        
        // RSS
        rssEnabled: getCheck('toggleRss'),
        rssSellerRole: getVal('rssSellerRole'),
        rssTaxRate: parseInt(getVal('rssTaxRate')) || 10,
        rssCategory: getVal('rssCategory')
    };

    try {
        // Save Module Config
        await fetch(`${API_URL}/modules/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Also Save Core Config (Redistributed fields)
        await fetch(`${API_URL}/config/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                welcomeChannelId: getVal('cfgWelcomeChannel'),
                logChannelId: getVal('cfgLogChannel'),
                leadershipChannelId: getVal('cfgLeadershipChannel'),
                ticketCategoryId: getVal('cfgTicketCategory'),
                spreadsheetId: getVal('cfgSpreadsheetId')
            })
        });

        clearDraft(); // Clear draft on successful save
        const btn = event.target.closest('button');
        if (btn) {
            const oldText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> DEPLOYED';
            btn.classList.add('z-btn-success');
            setTimeout(() => {
                btn.innerHTML = oldText;
                btn.classList.remove('z-btn-success');
            }, 2000);
        }
    } catch (e) {
    }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError ? 'var(--accent-red)' : 'var(--accent-green)'};color:white;padding:12px 24px;border-radius:var(--radius-md);font-weight:600;font-size:0.9rem;z-index:999;animation:fadeIn 0.3s ease;box-shadow:0 4px 20px rgba(0,0,0,0.3);`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== AUTO-ROLE =====
let autoRoles = [];

function addAutoRole() {
    const val = getVal('autoRoleInput');
    if (!val) return;
    autoRoles.push(val);
    document.getElementById('autoRoleInput').value = '';
    renderAutoRoles(autoRoles);
}

function removeAutoRole(index) {
    autoRoles.splice(index, 1);
    renderAutoRoles(autoRoles);
}

function renderAutoRoles(roles) {
    autoRoles = roles;
    const list = document.getElementById('autoRoleList');
    if (roles.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏷️</div><p>No auto-roles configured.</p></div>';
        return;
    }
    list.innerHTML = roles.map((r, i) => `
        <div class="panel-item">
            <div class="panel-item-info">
                <span class="panel-item-dot"></span>
                <span>Role ID: <strong>${r}</strong></span>
            </div>
            <button class="z-btn z-btn-danger" onclick="removeAutoRole(${i})">Remove</button>
        </div>
    `).join('');
}

// ===== LEVEL MILESTONES (Inline Table Rows) =====
let levelMilestones = [];

function addLevelMilestone() {
    levelMilestones.push({ level: '', emoji: '', title: '', roleId: '' });
    renderMilestones();
}

function removeMilestone(i) {
    levelMilestones.splice(i, 1);
    renderMilestones();
}

function updateMilestone(i, field, val) {
    levelMilestones[i][field] = val;
}

function renderMilestones() {
    const list = document.getElementById('levelMilestonesList');
    if (levelMilestones.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🎖️</div><p>No milestones configured. Click + ADD NEW above.</p></div>';
        return;
    }
    list.innerHTML = levelMilestones.map((m, i) => `
        <div style="display:grid; grid-template-columns: 80px 120px 1fr 1fr 40px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
            <input class="z-input" type="number" value="${m.level}" placeholder="10" min="1" onchange="updateMilestone(${i},'level',this.value)" style="padding:8px; text-align:center; font-weight:700;">
            <input class="z-input" type="text" value="${m.emoji}" placeholder="✨ or <:id>" onchange="updateMilestone(${i},'emoji',this.value)" style="padding:8px; font-size:0.8rem;">
            <input class="z-input" type="text" value="${m.title}" placeholder="Bronze Age" onchange="updateMilestone(${i},'title',this.value)" style="padding:8px;">
            <input class="z-input" type="text" value="${m.roleId}" placeholder="@ · >> Role Name" onchange="updateMilestone(${i},'roleId',this.value)" style="padding:8px; font-size:0.8rem;">
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.7rem; width:32px; height:32px; display:flex; align-items:center; justify-content:center;" onclick="removeMilestone(${i})">✕</button>
        </div>
    `).join('');
}

// ===== VIP MULTIPLIERS =====
let vipMultipliers = [];

function addVipMultiplier() {
    vipMultipliers.push({ type: 'ROLE', value: '', multiplier: '1.5' });
    renderVipMultipliers();
}

function removeVipMultiplier(i) {
    vipMultipliers.splice(i, 1);
    renderVipMultipliers();
}

function updateVipMultiplier(i, field, val) {
    vipMultipliers[i][field] = val;
}

function renderVipMultipliers() {
    const list = document.getElementById('vipMultipliersList');
    if (vipMultipliers.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.82rem;">No VIP multipliers configured.</p></div>';
        return;
    }
    list.innerHTML = vipMultipliers.map((m, i) => `
        <div style="display:grid; grid-template-columns: 80px 1fr 100px 40px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
            <select class="z-input" onchange="updateVipMultiplier(${i},'type',this.value)" style="padding:8px; font-size:0.8rem;">
                <option value="ROLE" ${m.type==='ROLE'?'selected':''}>ROLE</option>
                <option value="USER" ${m.type==='USER'?'selected':''}>USER</option>
            </select>
            <input class="z-input" type="text" value="${m.value}" placeholder="Role or User ID" onchange="updateVipMultiplier(${i},'value',this.value)" style="padding:8px;">
            <input class="z-input" type="text" value="${m.multiplier}" placeholder="1.5" onchange="updateVipMultiplier(${i},'multiplier',this.value)" style="padding:8px; text-align:center; font-weight:700;">
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.7rem; width:32px; height:32px; display:flex; align-items:center; justify-content:center;" onclick="removeVipMultiplier(${i})">✕</button>
        </div>
    `).join('');
}

// ===== DISCORD PREVIEW (for Ticket Panel) =====
function formatDiscordText(text) {
    if (!text) return '';
    // Custom Emojis <:name:id> -> Icon
    let html = text.replace(/<a?:(\w+):(\d+)>/g, '<span class="discord-emoji-placeholder" title="$1"></span>');
    
    // Basic Markdown
    html = html.replace(/^# (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
    html = html.replace(/__(.*?)__/g, '<u>$1</u>');
    
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
}

function updatePanelPreview() {
    const titleVal = getVal('panelTitle') || 'Support Center';
    const emojiVal = getVal('panelEmoji') || '';
    const descVal = getVal('panelDescription') || 'Please select a category below to open a ticket...';
    const descEmojiVal = getVal('panelDescEmoji') || '';
    const useEmbed = getCheck('panelUseEmbed');
    const color = useEmbed ? (getVal('v2SidebarColor') || '#a855f7') : (getVal('panelColor') || '#ffd700');
    const isSpoiler = useEmbed && getCheck('v2IsSpoiler');

    const fullTitle = (emojiVal ? emojiVal + ' ' : '') + titleVal;
    const fullDesc = (descEmojiVal ? descEmojiVal + ' ' : '') + descVal;

    const cb = document.getElementById('previewColorBar');
    const content = document.getElementById('previewContentBlock');
    const titleEl = document.getElementById('previewTitle');
    const descEl = document.getElementById('previewDesc');
    const imgEl = document.getElementById('previewImage');
    const imageUrl = getVal('panelImageUrl');
    const embedWrap = cb.parentElement; // the flex wrapper

    if (useEmbed) {
        // Components V2 / Container — rounded card with thin sidebar color, everything inside
        cb.style.display = 'block';
        cb.style.background = color;
        
        // Handle Spoiler Preview
        if (isSpoiler) {
            content.style.filter = 'blur(10px) grayscale(1)';
            content.style.cursor = 'help';
        } else {
            content.style.filter = 'none';
            content.style.cursor = 'default';
        }

        cb.style.width = '4px';
        cb.style.borderRadius = '8px 0 0 8px';
        cb.style.flexShrink = '0';
        embedWrap.style.display = 'flex';
        content.style.background = '#2b2d31';
        content.style.border = 'none';
        content.style.borderLeft = 'none';
        content.style.borderRadius = '0 8px 8px 0';
        content.style.padding = '16px';
        content.style.boxShadow = 'none';

        // Dynamic V2 Rendering
        if (panelDraft.v2Components && panelDraft.v2Components.length > 0) {
            titleEl.style.display = 'none'; // Hide classic title/desc
            descEl.style.display = 'none';
            if (imgEl) imgEl.style.display = 'none';

            let v2Html = '';
            panelDraft.v2Components.forEach(comp => {
                if (comp.type === 'text') {
                    v2Html += `<div style="color:#dbdee1; font-size:0.85rem; line-height:1.5; margin-bottom:8px;">${formatDiscordText(comp.content || 'Text content...')}</div>`;
                } else if (comp.type === 'separator') {
                    const margin = comp.size === 'large' ? '16px' : '8px';
                    const border = comp.dividerLine ? '1px solid #3f4147' : 'none';
                    v2Html += `<div style="margin:${margin} 0; border-top:${border}; height:0;"></div>`;
                } else if (comp.type === 'section') {
                    v2Html += `<div style="display:flex; gap:12px; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1; color:#dbdee1; font-size:0.85rem; line-height:1.5;">${formatDiscordText(comp.content || 'Section content...')}</div>`;
                    if (comp.accessory && comp.accessory.type === 'thumbnail' && comp.accessory.url) {
                        v2Html += `<img src="${comp.accessory.url}" style="width:48px; height:48px; border-radius:4px; object-fit:cover;">`;
                    }
                    v2Html += `</div>`;
                } else if (comp.type === 'mediaGallery') {
                    v2Html += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-bottom:12px;">
                        ${(comp.items || []).filter(i => i.url).map(img => `<img src="${img.url}" style="width:100%; border-radius:4px;">`).join('')}
                    </div>`;
                } else if (comp.type === 'actionRow') {
                    v2Html += `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                        ${(comp.components || []).map(btn => {
                            if (btn.type === 'button') {
                                const colors = { primary: '#5865f2', secondary: '#4f545c', success: '#248046', danger: '#da373c' };
                                return `<div style="background:${colors[btn.style] || colors.primary}; color:white; padding:6px 16px; border-radius:3px; font-size:0.8rem; font-weight:500; display:flex; align-items:center; gap:6px;">
                                    ${btn.emoji || ''} ${btn.label || 'Button'}
                                </div>`;
                            } else {
                                return `<div style="flex:1; min-width:150px; background:#1e1f22; border:1px solid #1e1f22; color:#dbdee1; padding:8px 12px; border-radius:3px; font-size:0.8rem; display:flex; justify-content:space-between; align-items:center;">
                                    ${btn.placeholder || 'Select...'} <i class="fas fa-chevron-down" style="font-size:0.6rem;"></i>
                                </div>`;
                            }
                        }).join('')}
                    </div>`;
                }
            });
            
            // Check if there's already a v2 container, if not create one or use a placeholder
            let v2Wrap = content.querySelector('.v2-dynamic-content');
            if (!v2Wrap) {
                v2Wrap = document.createElement('div');
                v2Wrap.className = 'v2-dynamic-content';
                content.insertBefore(v2Wrap, titleEl);
            }
            v2Wrap.innerHTML = v2Html;
        } else {
            // Default V2 look if no components added
            titleEl.style.display = '';
            descEl.style.display = '';
            titleEl.innerHTML = formatDiscordText(fullTitle);
            descEl.innerHTML = formatDiscordText(fullDesc);
            const v2Wrap = content.querySelector('.v2-dynamic-content');
            if (v2Wrap) v2Wrap.innerHTML = '';
        }
    } else {
        // Remove V2 dynamic content if it exists
        const v2Wrap = content.querySelector('.v2-dynamic-content');
        if (v2Wrap) v2Wrap.remove();

        // Classic embed — color bar on the left, standard embed look
        cb.style.display = 'block';
        cb.style.background = color;
        cb.style.width = '4px';
        cb.style.borderRadius = '3px 0 0 3px';
        cb.style.flexShrink = '0';
        embedWrap.style.display = 'flex';
        content.style.background = '#2b2d31';
        content.style.border = '1px solid #1e1f22';
        content.style.borderLeft = 'none';
        content.style.borderRadius = '0 4px 4px 0';
        content.style.padding = '16px';
        content.style.boxShadow = 'none';
        titleEl.style.fontSize = '1rem';
        titleEl.style.fontWeight = '700';
        titleEl.style.color = '#f2f3f5';
        descEl.style.color = '#dbdee1';
        titleEl.style.display = '';
        descEl.style.display = '';
        
        titleEl.innerHTML = formatDiscordText(fullTitle);
        descEl.innerHTML = formatDiscordText(fullDesc);

        if (imgEl) {
            if (imageUrl) { imgEl.src = imageUrl; imgEl.style.display = 'block'; }
            else { imgEl.style.display = 'none'; }
        }
    }

    // Update select menu previews
    const menusContainer = document.getElementById('previewMenus');
    if (panelDraft.dropdowns.length === 0 && panelDraft.buttonRows.length === 0) {
        menusContainer.innerHTML = '<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;">Select an option...</div>';
    } else {
        let html = '';
        panelDraft.dropdowns.forEach(dd => {
            html += `<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;margin-bottom:4px;">${dd.placeholder || 'Select an option...'}</div>`;
        });
        panelDraft.buttonRows.forEach(row => {
            html += `<div style="display:flex; gap:4px; margin-top:4px;">${row.options.map(opt => `<div style="background:#4e5058; color:white; padding:4px 12px; border-radius:3px; font-size:0.8rem; cursor:default;">${opt.label}</div>`).join('')}</div>`;
        });
        menusContainer.innerHTML = html;
    }

    // V2: menus go INSIDE the container card. Classic: menus stay outside
    const discordPreview = document.getElementById('discordPreview');
    if (useEmbed) {
        // Move menus inside contentBlock (after image)
        content.appendChild(menusContainer);
        menusContainer.style.marginTop = '12px';
        menusContainer.style.borderTop = '1px solid #3f4147';
        menusContainer.style.paddingTop = '12px';
    } else {
        // Move menus back outside (after the embed wrapper)
        discordPreview.appendChild(menusContainer);
        menusContainer.style.marginTop = '10px';
        menusContainer.style.borderTop = 'none';
        menusContainer.style.paddingTop = '0';
    }
}

function updateWelcomePreview() {
    const title = getVal('welcomeTitle') || 'Welcome!';
    const desc = getVal('welcomeMessage') || 'Welcome to the server, {user}!';
    const color = getVal('welcomeColor') || '#FFD700';
    const image = getVal('welcomeImage');
    const useEmbed = getCheck('welcomeUseEmbed');

    const embedWrap = document.getElementById('welcomePreviewEmbed');
    const textWrap = document.getElementById('welcomePreviewText');
    const imgEl = document.getElementById('welcomePreviewImage');
    const imgPlainEl = document.getElementById('welcomePreviewImagePlain');

    if (useEmbed) {
        embedWrap.style.display = 'flex';
        textWrap.style.display = 'none';
        document.getElementById('welcomePreviewColorBar').style.background = color;
        document.getElementById('welcomePreviewTitle').innerHTML = formatDiscordText(title);
        document.getElementById('welcomePreviewDesc').innerHTML = formatDiscordText(desc);
        if (image) { imgEl.src = image; imgEl.style.display = 'block'; } else { imgEl.style.display = 'none'; }
    } else {
        embedWrap.style.display = 'none';
        textWrap.style.display = 'block';
        textWrap.innerHTML = formatDiscordText(desc);
        if (image) { imgPlainEl.src = image; imgPlainEl.style.display = 'block'; } else { imgPlainEl.style.display = 'none'; }
    }
}

function updateLevelingPreview() {
    const title = getVal('levelUpTitle') || 'GG!';
    const desc = getVal('levelUpMessage') || '{user} just reached level **{level}**!';
    const color = getVal('levelUpColor') || '#FFD700';
    const useEmbed = getCheck('levelUpUseEmbed');

    const embedWrap = document.getElementById('levelPreviewEmbed');
    const textWrap = document.getElementById('levelPreviewText');

    if (useEmbed) {
        embedWrap.style.display = 'flex';
        textWrap.style.display = 'none';
        document.getElementById('levelPreviewColorBar').style.background = color;
        document.getElementById('levelPreviewTitle').innerHTML = formatDiscordText(title);
        document.getElementById('levelPreviewDesc').innerHTML = formatDiscordText(desc);
    } else {
        embedWrap.style.display = 'none';
        textWrap.style.display = 'block';
        textWrap.innerHTML = formatDiscordText(desc);
    }
}

function updateSwearJarPreview() {
    const title = getVal('swearJarTitle') || 'Swear Jar Contribution!';
    const desc = getVal('swearJarMessage') || '{user} just added a coin to the jar for using prohibited dialect: `{word}`';
    const color = getVal('swearJarColor') || '#FFD700';

    document.getElementById('swearPreviewColorBar').style.background = color;
    document.getElementById('swearPreviewTitle').innerHTML = formatDiscordText(title);
    document.getElementById('swearPreviewDesc').innerHTML = formatDiscordText(desc);
}

// Add listeners to all preview-able inputs
document.addEventListener('DOMContentLoaded', () => {
    const ids = [
        'welcomeTitle', 'welcomeMessage', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
        'levelUpTitle', 'levelUpMessage', 'levelUpColor', 'levelUpUseEmbed',
        'swearJarTitle', 'swearJarMessage', 'swearJarColor',
        'panelTitle', 'panelEmoji', 'panelDescription', 'panelDescEmoji', 'panelColor', 'panelImageUrl', 'panelUseEmbed',
        'v2SidebarColor', 'v2IsSpoiler'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const ev = el.type === 'checkbox' || el.type === 'color' ? 'change' : 'input';
        el.addEventListener(ev, () => {
            if (id.startsWith('welcome')) updateWelcomePreview();
            if (id.startsWith('level')) updateLevelingPreview();
            if (id.startsWith('swear')) updateSwearJarPreview();
            if (id.startsWith('panel')) updatePanelPreview();
        });
    });
});

// =============================================
// TICKET PANELS & TRANSCRIPTS
// =============================================
let panelDraft = { dropdowns: [], buttonRows: [], v2Components: [] };

function toggleV2Mode() {
    const isV2 = getCheck('panelUseEmbed');
    const v2Editor = document.getElementById('v2EditorContainer');
    const classicFields = document.getElementById('classicPanelFields');
    
    if (isV2) {
        v2Editor.style.display = 'block';
        classicFields.style.display = 'none';
    } else {
        v2Editor.style.display = 'none';
        classicFields.style.display = 'block';
    }
    updatePanelPreview();
}

function toggleAddMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('addComponentMenu');
    if (!menu) return;
    const isHidden = menu.style.display === 'none' || menu.style.display === '';
    menu.style.display = isHidden ? 'block' : 'none';
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('addComponentMenu');
    if (menu && menu.style.display === 'block') {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    }
});

function addV2Component(type) {
    let component = { id: Date.now().toString(), type: type };
    
    if (type === 'text') {
        component.content = '';
    } else if (type === 'section') {
        component.content = '';
        component.accessory = { type: 'none' };
    } else if (type === 'separator') {
        component.size = 'small';
        component.dividerLine = true;
    } else if (type === 'mediaGallery') {
        component.items = [];
    } else if (type === 'actionRow') {
        component.components = [];
    }
    
    panelDraft.v2Components.push(component);
    document.getElementById('addComponentMenu').style.display = 'none';
    renderV2Editor();
    updatePanelPreview();
}

function removeV2Component(index) {
    panelDraft.v2Components.splice(index, 1);
    renderV2Editor();
    updatePanelPreview();
}

function moveV2Component(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= panelDraft.v2Components.length) return;
    
    const element = panelDraft.v2Components.splice(index, 1)[0];
    panelDraft.v2Components.splice(newIndex, 0, element);
    
    renderV2Editor();
    updatePanelPreview();
    markDirty();
}

function updateV2Field(index, field, value) {
    panelDraft.v2Components[index][field] = value;
    updatePanelPreview();
    markDirty();
}

function renderV2Editor() {
    const container = document.getElementById('v2ComponentsList');
    if (!container) return;
    
    if (panelDraft.v2Components.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px 20px; border:2px dashed var(--border-medium); border-radius:8px; color:var(--text-muted);">
            <i class="fas fa-layer-group" style="font-size:2rem; margin-bottom:12px; opacity:0.5;"></i>
            <p>No components added yet. Use the button below to build your container.</p>
        </div>`;
        return;
    }
    
    container.innerHTML = panelDraft.v2Components.map((comp, idx) => {
        let html = `<div class="z-card" style="background:#1e1f22; border-color:#3f4147; padding:16px; border-left: 3px solid var(--gold-800);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <button class="z-btn-icon" style="font-size:0.6rem; padding:2px;" onclick="moveV2Component(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.2;"' : ''}><i class="fas fa-chevron-up"></i></button>
                        <button class="z-btn-icon" style="font-size:0.6rem; padding:2px;" onclick="moveV2Component(${idx}, 1)" ${idx === panelDraft.v2Components.length - 1 ? 'disabled style="opacity:0.2;"' : ''}><i class="fas fa-chevron-down"></i></button>
                    </div>
                    <span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:#949ba4;">
                        <i class="${getIconForType(comp.type)}"></i> ${comp.type}
                    </span>
                </div>
                <button class="z-btn-icon" style="color:#ed4245;" onclick="removeV2Component(${idx})"><i class="fas fa-trash"></i></button>
            </div>`;
            
        if (comp.type === 'text') {
            html += `<textarea class="z-input" placeholder="Enter text content..." oninput="updateV2Field(${idx}, 'content', this.value)">${comp.content || ''}</textarea>`;
        } else if (comp.type === 'separator') {
            html += `<div style="display:flex; gap:12px; align-items:center;">
                <select class="z-input" style="flex:1;" onchange="updateV2Field(${idx}, 'size', this.value)">
                    <option value="small" ${comp.size === 'small' ? 'selected' : ''}>Small Space</option>
                    <option value="large" ${comp.size === 'large' ? 'selected' : ''}>Large Space</option>
                </select>
                <label style="display:flex; gap:8px; align-items:center; cursor:pointer; font-size:0.85rem; color:var(--text-muted);">
                    <input type="checkbox" ${comp.dividerLine ? 'checked' : ''} onchange="updateV2Field(${idx}, 'dividerLine', this.checked)"> Divider Line
                </label>
            </div>`;
        } else if (comp.type === 'section') {
            html += `<textarea class="z-input" placeholder="Main content..." oninput="updateV2Field(${idx}, 'content', this.value)">${comp.content || ''}</textarea>
                <div class="z-input-group" style="margin-top:12px;">
                    <label style="font-size:0.75rem;">Accessory Type</label>
                    <select class="z-input" onchange="updateV2Field(${idx}, 'accessory', {type: this.value, url: ''})">
                        <option value="none" ${comp.accessory.type === 'none' ? 'selected' : ''}>None</option>
                        <option value="thumbnail" ${comp.accessory.type === 'thumbnail' ? 'selected' : ''}>Thumbnail (Right)</option>
                    </select>
                </div>`;
            if (comp.accessory.type === 'thumbnail') {
                html += `<div class="z-input-group" style="margin-top:8px;">
                    <input class="z-input" type="text" placeholder="Image URL..." value="${comp.accessory.url || ''}" oninput="updateV2Field(${idx}, 'accessory', {type:'thumbnail', url:this.value})">
                </div>`;
            }
        } else if (comp.type === 'mediaGallery') {
            html += `<p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Image Gallery (Discord Component)</p>
                <div id="gallery_${idx}_items" style="display:flex; flex-direction:column; gap:8px;">
                    ${(comp.items || []).map((img, iIdx) => `
                        <div style="display:flex; gap:8px;">
                            <input class="z-input" type="text" placeholder="Image URL..." value="${img.url || ''}" oninput="updateGalleryItem(${idx}, ${iIdx}, this.value)">
                            <button class="z-btn-icon" style="color:#ed4245;" onclick="removeGalleryItem(${idx}, ${iIdx})"><i class="fas fa-times"></i></button>
                        </div>
                    `).join('')}
                </div>
                <button class="z-btn z-btn-secondary" style="width:100%; margin-top:8px; font-size:0.8rem; padding:6px;" onclick="addGalleryItem(${idx})">
                    <i class="fas fa-plus"></i> Add Image
                </button>`;
        } else if (comp.type === 'actionRow') {
            html += `<div style="background:rgba(0,0,0,0.2); padding:12px; border-radius:8px; border:1px solid #3f4147;">
                <div id="v2_row_${idx}_items" style="display:flex; flex-direction:column; gap:8px;">
                    ${(comp.components || []).map((item, iIdx) => `
                        <div style="background:#2b2d31; padding:8px; border-radius:4px; border:1px solid #3f4147;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.7rem; color:var(--gold-text); text-transform:uppercase;">${item.type === 'button' ? 'Button' : 'Select Menu'}</span>
                                <button class="z-btn-icon" style="color:#ed4245; font-size:0.8rem;" onclick="removeV2SubComponent(${idx}, ${iIdx})"><i class="fas fa-times"></i></button>
                            </div>
                            ${item.type === 'button' ? `
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                                    <input class="z-input" type="text" placeholder="Label" value="${item.label || ''}" oninput="updateV2SubField(${idx}, ${iIdx}, 'label', this.value)">
                                    <select class="z-input" onchange="updateV2SubField(${idx}, ${iIdx}, 'style', this.value)">
                                        <option value="primary" ${item.style === 'primary' ? 'selected' : ''}>Primary (Blurple)</option>
                                        <option value="secondary" ${item.style === 'secondary' ? 'selected' : ''}>Secondary (Grey)</option>
                                        <option value="success" ${item.style === 'success' ? 'selected' : ''}>Success (Green)</option>
                                        <option value="danger" ${item.style === 'danger' ? 'selected' : ''}>Danger (Red)</option>
                                    </select>
                                </div>
                                <div style="margin-top:8px;">
                                    <input class="z-input" type="text" placeholder="Emoji (optional)" value="${item.emoji || ''}" oninput="updateV2SubField(${idx}, ${iIdx}, 'emoji', this.value)">
                                </div>
                            ` : `
                                <input class="z-input" type="text" placeholder="Placeholder Text" value="${item.placeholder || ''}" oninput="updateV2SubField(${idx}, ${iIdx}, 'placeholder', this.value)">
                            `}
                        </div>
                    `).join('')}
                </div>
                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button class="z-btn z-btn-secondary" style="flex:1; font-size:0.75rem; padding:6px;" onclick="addV2SubComponent(${idx}, 'button')"><i class="fas fa-mouse-pointer"></i> Add Button</button>
                    <button class="z-btn z-btn-secondary" style="flex:1; font-size:0.75rem; padding:6px;" onclick="addV2SubComponent(${idx}, 'select')"><i class="fas fa-list-ul"></i> Add Select</button>
                </div>
            </div>`;
        }
            
        html += `</div>`;
        return html;
    }).join('');
}

function addV2SubComponent(pIdx, type) {
    if (!panelDraft.v2Components[pIdx].components) panelDraft.v2Components[pIdx].components = [];
    if (panelDraft.v2Components[pIdx].components.length >= 5) return showToast('Maximum 5 components per row', true);
    
    let sub = { type: type, id: Date.now().toString() };
    if (type === 'button') {
        sub.label = 'Button';
        sub.style = 'primary';
    } else {
        sub.placeholder = 'Select an option...';
        sub.options = [];
    }
    
    panelDraft.v2Components[pIdx].components.push(sub);
    renderV2Editor();
    updatePanelPreview();
}

function removeV2SubComponent(pIdx, sIdx) {
    panelDraft.v2Components[pIdx].components.splice(sIdx, 1);
    renderV2Editor();
    updatePanelPreview();
}

function updateV2SubField(pIdx, sIdx, field, value) {
    panelDraft.v2Components[pIdx].components[sIdx][field] = value;
    updatePanelPreview();
}

function removeV2SubComponent(pIdx, sIdx) {
    if (panelDraft.v2Components[pIdx].components) {
        panelDraft.v2Components[pIdx].components.splice(sIdx, 1);
        renderV2Editor();
        updatePanelPreview();
        markDirty();
    }
}

function getIconForType(type) {
    const icons = { text: 'fas fa-align-left', section: 'fas fa-th-large', separator: 'fas fa-minus', mediaGallery: 'fas fa-images', actionRow: 'fas fa-bars' };
    return icons[type] || 'fas fa-cube';
}

function addGalleryItem(idx) {
    if (!panelDraft.v2Components[idx].items) panelDraft.v2Components[idx].items = [];
    panelDraft.v2Components[idx].items.push({ url: '' });
    renderV2Editor();
    updatePanelPreview();
}

function updateGalleryItem(idx, iIdx, url) {
    panelDraft.v2Components[idx].items[iIdx].url = url;
    updatePanelPreview();
}

function removeGalleryItem(idx, iIdx) {
    panelDraft.v2Components[idx].items.splice(iIdx, 1);
    renderV2Editor();
    updatePanelPreview();
}

function addDropdown() {
    panelDraft.dropdowns.push({ id: Date.now().toString(), placeholder: 'Select an option...', options: [] });
    renderDropdowns();
}


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
        questionDelivery: 'modal',
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

function addOption(dIdx) {
    panelDraft.dropdowns[dIdx].options.push({
        label: 'New Option',
        emoji: '🎫',
        description: 'Open a general support ticket.',
        ticketName: 'ticket-{username}',
        embedTitle: 'Welcome to Support',
        embedDescription: 'Please wait, staff will be with you shortly.',
        systemType: 'ticket',
        staffRoles: '',
        pingRoles: '',
        questions: [],
        questionDelivery: 'modal'
    });
    renderDropdowns();
}

function addQuestion(dIdx, oIdx) {
    panelDraft.dropdowns[dIdx].options[oIdx].questions.push('');
    renderDropdowns();
}

function updateField(dIdx, oIdx, field, val) {
    if (oIdx === null) {
        panelDraft.dropdowns[dIdx].placeholder = val;
    } else {
        panelDraft.dropdowns[dIdx].options[oIdx][field] = val;
    }
}

function updateQuestion(dIdx, oIdx, qIdx, field, val) {
    const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    if (typeof opt.questions[qIdx] === 'string') {
        opt.questions[qIdx] = { text: opt.questions[qIdx], type: 'text' };
    }
    opt.questions[qIdx][field] = val;
    if (field === 'type') renderModalQuestions();
}

function clearPanelForm() {
    editingPanelId = null;
    editingMessageId = null;
    
    const saveBtn = document.querySelector('button[onclick="savePanel()"]');
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Compile & Deploy Panel';
        saveBtn.classList.remove('z-btn-danger');
    }

    panelDraft = { dropdowns: [], buttonRows: [], v2Components: [] };
    document.getElementById('panelChannelId').value = '';
    document.getElementById('panelTitle').value = '';
    document.getElementById('panelEmoji').value = '';
    document.getElementById('panelDescription').value = '';
    document.getElementById('panelDescEmoji').value = '';
    document.getElementById('panelColor').value = '#ffd700';
    document.getElementById('panelColorHex').textContent = '#ffd700';
    
    renderDropdowns();
    showToast('Form cleared and reset to fresh state.');
}

function removeDropdown(dIdx) {
    panelDraft.dropdowns.splice(dIdx, 1);
    renderDropdowns();
}

function removeOption(dIdx, oIdx) {
    panelDraft.dropdowns[dIdx].options.splice(oIdx, 1);
    renderDropdowns();
}

function removeQuestion(dIdx, oIdx, qIdx) {
    panelDraft.dropdowns[dIdx].options[oIdx].questions.splice(qIdx, 1);
    renderDropdowns();
}

function renderDropdowns() {
    const c = document.getElementById('dropdownsContainer');
    c.innerHTML = '';

    
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

    panelDraft.dropdowns.forEach((dd, dIdx) => {
        const wrap = document.createElement('div');
        // Main container matching the UI
        wrap.style.background = 'rgba(255,255,255,0.01)';
        wrap.style.border = '1px solid var(--border-medium)';
        wrap.style.borderRadius = 'var(--radius-lg)';
        wrap.style.marginBottom = '20px';
        wrap.style.overflow = 'hidden';

        // Select Menu Header
        let optionsHtml = '';
        dd.options.forEach((opt, oIdx) => {
            optionsHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle);">
                    <div style="display:flex; align-items:center; gap:16px; flex:1;">
                        <span style="color:var(--text-muted); cursor:grab;">☰</span>
                        <div style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; background:var(--primary-soft); border-radius:var(--radius-md); font-size:1.2rem;">${opt.emoji || '🎫'}</div>
                        <div style="flex:1;">
                            <h4 style="font-size:0.95rem; font-weight:600; margin-bottom:4px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                <input class="z-input" style="padding:4px 8px; font-weight:600; font-size:0.9rem; background:transparent; border:none; border-bottom:1px dashed var(--border-medium); width:200px;" value="${opt.label}" onchange="updateField(${dIdx},${oIdx},'label',this.value)" placeholder="Label (e.g. Support Ticket)">
                            </h4>
                            <input class="z-input" style="padding:2px 8px; font-size:0.75rem; background:transparent; border:none; width:80%; color:var(--text-secondary);" value="${opt.description || ''}" onchange="updateField(${dIdx},${oIdx},'description',this.value)" placeholder="Description (e.g. Open a general support ticket.)">
                        </div>
                    </div>
                    <div style="display:flex; gap:12px;">
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-muted)'" onclick="openOptionSettings(${dIdx}, ${oIdx})">⚙️</button>
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--accent-red)'" onmouseout="this.style.color='var(--text-muted)'" onclick="removeOption(${dIdx},${oIdx})">🗑️</button>
                    </div>
                </div>`;
        });

        // Add Option Button
        optionsHtml += `
            <div style="padding:14px; text-align:center;">
                <button class="z-btn" style="width:100%; border:1px dashed var(--border-medium); background:rgba(255,255,255,0.015); color:var(--text-muted); font-size:0.85rem;" onclick="addOption(${dIdx})">+ Add Option</button>
            </div>
        `;

        wrap.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:12px; color:var(--text-muted); font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                    <span style="cursor:grab;">☰</span>
                    <span>📑 SELECT MENU</span>
                </div>
                <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--accent-red)'" onmouseout="this.style.color='var(--text-muted)'" onclick="removeDropdown(${dIdx})">🗑️</button>
            </div>
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-subtle);">
                <label style="display:block; font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:8px; letter-spacing:0.5px;">Select Menu Placeholder</label>
                <input class="z-input" style="width:100%; border-color:var(--border-strong);" value="${dd.placeholder}" onchange="updateField(${dIdx},null,'placeholder',this.value)">
            </div>
            ${optionsHtml}
        `;
        c.appendChild(wrap);
    });

    // Sync Discord preview
    updatePanelPreview();
}

// ===== MODAL LOGIC =====
let currentModalTarget = null; // { dIdx, oIdx }

function openOptionSettings(dIdx, oIdx, isBtn = false) {
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    currentModalTarget = { dIdx, oIdx, isBtn };
    
    document.getElementById('modalOptionTitle').textContent = opt.label;
    setVal('modalSystemType', opt.systemType || 'ticket');
    
    // Clean prefix for input: e.g. "ticket-{username}" -> "ticket"
    let prefix = (opt.ticketName || 'ticket-').replace('{username}', '');
    if (prefix.endsWith('-')) prefix = prefix.slice(0, -1);
    setVal('modalChannelPrefix', prefix);
    setVal('modalStaffRoles', opt.staffRoles || '');
    setVal('modalPingRoles', opt.pingRoles || '');
    setVal('modalCategoryId', opt.categoryId || '');
    setVal('modalOptionEmoji', opt.emoji || '');
    setVal('modalEmbedDesc', opt.embedDescription || 'Please wait, staff will be with you shortly.');
    setVal('modalQuestionDelivery', opt.questionDelivery || 'modal');
    setVal('modalImageUrl', opt.imageUrl || '');
    setCheck('modalUseEmbed', opt.useEmbed === undefined || opt.useEmbed === null ? true : !!opt.useEmbed);
    
    renderModalQuestions();
    
    document.getElementById('optionSettingsModal').classList.add('active');
}

function renderModalQuestions() {
    if (!currentModalTarget) return;
    const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[currentModalTarget.dIdx].options[currentModalTarget.oIdx] : panelDraft.dropdowns[currentModalTarget.dIdx].options[currentModalTarget.oIdx];
    const qc = document.getElementById('modalQuestionsContainer');
    
    if (!opt.questions || opt.questions.length === 0) {
        qc.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No questions configured. Click Add Question.</div>';
        return;
    }
    
    qc.innerHTML = opt.questions.map((q, qIdx) => {
        // Migration: convert string to object if needed
        const obj = typeof q === 'string' ? { text: q, type: 'text' } : q;
        if (typeof q === 'string') opt.questions[qIdx] = obj;

        return `
        <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px; margin-bottom:12px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <textarea class="z-input" placeholder="Question text (supports multiple lines)..." onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'text',this.value)" style="flex:1; min-height:80px; resize:vertical; padding:10px; font-family:inherit;">${obj.text}</textarea>
                <select class="z-input" style="width:100px; font-size:0.75rem;" onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'type',this.value)">
                    <option value="text" ${obj.type === 'text' ? 'selected' : ''}>Text</option>
                    <option value="choice" ${obj.type === 'choice' ? 'selected' : ''}>Choice</option>
                    <option value="image" ${obj.type === 'image' ? 'selected' : ''}>Image</option>
                    <option value="text_image" ${obj.type === 'text_image' ? 'selected' : ''}>Text+Image</option>
                </select>
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <label style="font-size:0.55rem; color:var(--text-muted); margin-bottom:2px;">REQUIRED</label>
                    <input type="checkbox" ${obj.required ? 'checked' : ''} onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'required',this.checked)">
                </div>
                <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.75rem;" onclick="removeModalQuestion(${qIdx})">✕</button>
            </div>
            ${obj.type === 'choice' ? `
                <div style="margin-top:8px;">
                    <label style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Options (comma separated)</label>
                    <input class="z-input" style="font-size:0.8rem;" value="${obj.options || ''}" placeholder="Option A, Option B, ..." onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'options',this.value)">
                </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

function addModalQuestion() {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    
    const deliveryMethod = getVal('modalQuestionDelivery');
    if (deliveryMethod === 'modal' && opt.questions && opt.questions.length >= 5) {
        return showToast('Discord Modals are strictly limited to 5 questions maximum.', true);
    }
    
    if (!opt.questions) opt.questions = [];
    opt.questions.push('');
    renderModalQuestions();
}

function removeModalQuestion(qIdx) {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    opt.questions.splice(qIdx, 1);
    renderModalQuestions();
}

function saveOptionSettings() {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    
    const deliveryMethod = getVal('modalQuestionDelivery');
    if (deliveryMethod === 'modal' && opt.questions && opt.questions.length > 5) {
        return showToast('Discord Modals only support 5 questions. Please remove some or change delivery method.', true);
    }
    
    opt.systemType = getVal('modalSystemType');
    
    let prefix = getVal('modalChannelPrefix').trim();
    if (prefix && !prefix.endsWith('-')) prefix += '-';
    opt.ticketName = (prefix || 'ticket-') + '{username}';
    
    opt.staffRoles = getVal('modalStaffRoles');
    opt.pingRoles = getVal('modalPingRoles');
    opt.categoryId = getVal('modalCategoryId');
    opt.emoji = getVal('modalOptionEmoji');
    opt.embedDescription = getVal('modalEmbedDesc');
    opt.questionDelivery = getVal('modalQuestionDelivery');
    opt.imageUrl = getVal('modalImageUrl');
    opt.useEmbed = document.getElementById('modalUseEmbed').checked ? 1 : 0;
    
    closeModal('optionSettingsModal');
    renderDropdowns();
}

async function savePanel() {
    if (!activeGuild) return;
    const channelId = getVal('panelChannelId');
    if (!channelId) return showToast('Destination Channel ID is required', true);

    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: editingPanelId,
                messageId: editingMessageId,
                channelId,
                panelData: {
                    title: getVal('panelTitle') || 'Support',
                    emoji: getVal('panelEmoji'),
                    description: getVal('panelDescription') || 'Open a ticket...',
                    descEmoji: getVal('panelDescEmoji'),
                    color: getVal('panelColor'),
                    v2SidebarColor: getVal('v2SidebarColor'),
                    v2IsSpoiler: getCheck('v2IsSpoiler'),
                    imageUrl: getVal('panelImageUrl'),
                    useEmbed: document.getElementById('panelUseEmbed').checked ? 1 : 0,
                    dropdowns: panelDraft.dropdowns,
                    buttonRows: panelDraft.buttonRows,
                    v2Components: panelDraft.v2Components || []
                }
            })
        });
        if (res.ok) {
            showToast('✅ Panel successfully updated!');
            editingPanelId = null;
            editingMessageId = null;
            
            const saveBtn = document.querySelector('button[onclick="savePanel()"]');
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Compile & Deploy Panel';
                saveBtn.classList.remove('z-btn-danger');
            }

            panelDraft.dropdowns = []; panelDraft.buttonRows = []; panelDraft.v2Components = [];
            renderDropdowns();
            document.getElementById('panelChannelId').value = '';
            document.getElementById('panelTitle').value = '';
            document.getElementById('panelEmoji').value = '';
            document.getElementById('panelDescription').value = '';
            document.getElementById('panelDescEmoji').value = '';
            fetchPanels();
        }
    } catch (e) {
        showToast('Error saving panel', true);
    }
}

async function fetchPanels() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`);
        const panels = await res.json();
        const c = document.getElementById('panelsList');

        // Update stat
        const statEl = document.getElementById('statPanels');
        if (statEl) statEl.textContent = panels.length;

        if (panels.length === 0) {
            c.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No panels created yet.</p></div>';
            return;
        }

        c.innerHTML = panels.map(p => {
            const data = typeof p.panelData === 'string' ? JSON.parse(p.panelData) : p.panelData;
            return `
                <div class="panel-item">
                    <div class="panel-item-info">
                        <span class="panel-item-dot"></span>
                        <div>
                            <strong>${data.title || 'Panel'}</strong>
                            <br><small style="color:var(--text-muted);">Channel: ${p.channelId} · ${(data.dropdowns || []).length} Dropdowns</small>
                        </div>
                    </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="z-btn z-btn-secondary" onclick="editPanel('${p.id}')">⚙️ Edit</button>
                        <button class="z-btn z-btn-danger" onclick="deletePanel('${p.id}')">🗑️ Delete</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) { console.error(e); }
}

async function deletePanel(id) {
    if (!confirm('Delete this panel permanently?')) return;
    await fetch(`${API_URL}/panels/${id}`, { method: 'DELETE' });
    fetchPanels();
}

async function fetchTranscripts() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}`);
        const ts = await res.json();

        // Tickets page
        const c = document.getElementById('transcriptsList');
        // Overview page
        const ov = document.getElementById('overviewTranscripts');

        if (ts.length === 0) {
            const empty = '<div class="empty-state"><div class="empty-icon">📭</div><p>No recent transcripts.</p></div>';
            if (c) c.innerHTML = empty;
            if (ov) ov.innerHTML = empty;
            return;
        }

        const html = ts.slice(0, 10).map(t => `
            <div class="panel-item">
                <div class="panel-item-info">
                    <span class="panel-item-dot" style="background:var(--accent-green);box-shadow:0 0 8px var(--accent-green);"></span>
                    <div>
                        <strong>🎫 ${t.ticketId}</strong>
                        <br><small style="color:var(--text-muted);">Author: ${t.userId} · ${new Date(t.closedAt).toLocaleString()}</small>
                    </div>
                </div>
                <button class="z-btn z-btn-secondary" onclick="viewTranscript('${encodeURIComponent(t.logContent || '')}')">View</button>
            </div>`).join('');

        if (c) c.innerHTML = html;
        if (ov) ov.innerHTML = html;
    } catch (e) { console.error(e); }
}

function viewTranscript(encoded) {
    document.getElementById('transcriptModal').classList.add('active');
    document.getElementById('transcriptContent').textContent = decodeURIComponent(encoded) || 'This transcript is empty.';
}

// ===== SAVE BAR (Unsaved Changes Detection) =====
let currentPage = 'overview';

document.addEventListener('input', (e) => {
    if (e.target.closest('.main-content')) {
        document.getElementById('saveBar').classList.add('visible');
    }
});

document.addEventListener('change', (e) => {
    if (e.target.closest('.main-content')) {
        document.getElementById('saveBar').classList.add('visible');
    }
});

document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
        currentPage = link.dataset.page;
        document.getElementById('saveBar').classList.remove('visible');
        
        if (currentPage === 'economy') {
            fetchShopItems();
        }

        // Auto-close sidebar on mobile
        if (window.innerWidth <= 768) {
            toggleMobileSidebar();
        }
    });
});

// Mobile sidebar toggle
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

function revertChanges() {
    document.getElementById('saveBar').classList.remove('visible');
    loadDashboardData();
    showToast('Changes reverted');
}

function saveCurrentPage() {
    // Determine which page is active and save accordingly
    const page = currentPage;
    if (page === 'general') {
        saveGeneralConfig();
    } else {
        saveModuleConfig(page);
    }
    document.getElementById('saveBar').classList.remove('visible');
}

// ===== GIVEAWAYS =====
async function startGiveaway() {
    if (!activeGuild) return;
    const channelId = getVal('gvChannelId');
    const prize = getVal('gvPrize');
    const winners = parseInt(getVal('gvWinners'), 10);
    const duration = parseFloat(getVal('gvDuration'));
    const color = getVal('gvColor');
    const requiredRole = getVal('gvRequiredRole');
    const pingRole = getVal('gvPingRole');

    if (!channelId || !prize || !winners || !duration) {
        return showToast('Please fill out all giveaway fields.', true);
    }

    try {
        const res = await fetch(`${API_URL}/giveaways/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelId, prize, winnersCount: winners, durationMs: duration * 3600000, color, requiredRole, pingRole
            })
        });
        if (res.ok) {
            showToast('✅ Giveaway launched!');
            document.getElementById('gvPrize').value = '';
            document.getElementById('gvRequiredRole').value = '';
            document.getElementById('gvPingRole').value = '';
            fetchGiveaways();
        } else {
            showToast('Failed to start giveaway', true);
        }
    } catch(e) {
        showToast('Error starting giveaway', true);
    }
}

async function fetchGiveaways() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/giveaways/${activeGuild.id}`);
        const giveaways = await res.json();
        const c = document.getElementById('giveawaysList');

        if (!giveaways || giveaways.length === 0) {
            if (c) c.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>No giveaways found.</p></div>';
            return;
        }

        if (c) {
            c.innerHTML = giveaways.map(gv => {
                const isActive = gv.status === 'active';
                const statusDot = isActive ? 'background:var(--accent-green);box-shadow:0 0 8px var(--accent-green);' : 'background:var(--text-muted);';
                const endsAt = new Date(parseInt(gv.endTime)).toLocaleString();
                
                return `
                <div class="panel-item">
                    <div class="panel-item-info">
                        <span class="panel-item-dot" style="${statusDot}"></span>
                        <div>
                            <strong>${gv.prize}</strong>
                            <br><small style="color:var(--text-muted);">Channel: ${gv.channelId} · Winners: ${gv.winnersCount} · Ends: ${endsAt}</small>
                        </div>
                    </div>
                    <span style="font-size:0.75rem; font-weight:bold; color:${isActive?'var(--accent-green)':'var(--text-muted)'}">${isActive ? 'ACTIVE' : 'ENDED'}</span>
                </div>`;
            }).join('');
        }
    } catch (e) { console.error('Error fetching giveaways', e); }
}
// ===== TRANSCRIPT VIEWER =====
async function fetchTranscripts() {
    if (!activeGuild) return;
    const tbody = document.getElementById('transcriptsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--text-muted);">Retrieving transmission logs...</td></tr>';
    
    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}`);
        const logs = await res.json();
        
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--text-muted);">Secure archives empty.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        logs.forEach(log => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${log.ticketId}</code></td>
                <td><span class="z-badge">${log.userId}</span></td>
                <td>${new Date(log.closedAt).toLocaleString()}</td>
                <td>
                    <button class="z-btn z-btn-secondary z-btn-sm" onclick="viewTranscript('${log.ticketId}')">
                        <i class="fas fa-eye"></i> View Log
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--accent-red);">Error accessing archives.</td></tr>';
    }
}

async function viewTranscript(ticketId) {
    const overlay = document.getElementById('transcriptOverlay');
    const container = document.getElementById('discordChatContainer');
    const title = document.getElementById('viewerTicketTitle');
    
    title.textContent = `Viewing Log: ${ticketId}`;
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; margin-top:100px;">Decrypting transmission...</div>';
    overlay.style.display = 'flex';

    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}/${ticketId}`);
        const data = await res.json();
        
        renderTranscript(data.content);
    } catch (e) {
        container.innerHTML = '<div style="color:var(--accent-red); text-align:center; margin-top:100px;">Decryption Failed.</div>';
    }
}

function renderTranscript(rawContent) {
    const container = document.getElementById('discordChatContainer');
    container.innerHTML = '';

    // Zenith transcript format: [Date, Time] Author: \n Content \n ------------------
    const messages = rawContent.split('---------------------------');
    
    messages.forEach(msgBlock => {
        if (!msgBlock.trim()) return;

        // Extract metadata and body
        // Format: [1/1/2026, 12:00:00 AM] Author: \n Content
        const match = msgBlock.match(/\[(.*?)\] (.*?):\n([\s\S]*)/);
        if (match) {
            const [_, timestamp, author, content] = match;
            
            const msgEl = document.createElement('div');
            msgEl.className = 'discord-message';
            msgEl.innerHTML = `
                <div class="discord-avatar">${author.charAt(0).toUpperCase()}</div>
                <div class="discord-content">
                    <div class="discord-author">
                        <span class="discord-author-name">${author}</span>
                        <span class="discord-timestamp">${timestamp}</span>
                    </div>
                    <div class="discord-text">${content.trim()}</div>
                </div>
            `;
            container.appendChild(msgEl);
        } else {
            // Fallback for simpler lines
            const simpleDiv = document.createElement('div');
            simpleDiv.className = 'discord-text';
            simpleDiv.style.padding = '5px 0';
            simpleDiv.textContent = msgBlock;
            container.appendChild(simpleDiv);
        }
    });
}

function closeTranscript() {
    document.getElementById('transcriptOverlay').style.display = 'none';
}

async function editPanel(id) {
    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`);
        const panels = await res.json();
        const p = panels.find(x => x.id === id);
        if (!p) return;

        const data = typeof p.panelData === 'string' ? JSON.parse(p.panelData) : p.panelData;
        editingPanelId = id;
        editingMessageId = p.messageId;

        // Visual feedback for edit mode
        const saveBtn = document.querySelector('button[onclick="savePanel()"]');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-sync"></i> Update Existing Panel';
            saveBtn.classList.add('z-btn-danger');
        }

        setVal('panelTitle', data.title || '');
        setVal('panelEmoji', data.emoji || '');
        setVal('panelDescription', data.description || '');
        setVal('panelDescEmoji', data.descEmoji || '');
        setVal('panelColor', data.color || '#ffd700');
        document.getElementById('panelColorHex').textContent = data.color || '#ffd700';
        setVal('v2SidebarColor', data.v2SidebarColor || '#a855f7');
        document.getElementById('v2ColorHex').textContent = data.v2SidebarColor || '#a855f7';
        setCheck('v2IsSpoiler', !!data.v2IsSpoiler);
        setVal('panelImageUrl', data.imageUrl || '');
        setCheck('panelUseEmbed', data.useEmbed === undefined || data.useEmbed === null ? true : !!data.useEmbed);
        
        panelDraft.dropdowns = data.dropdowns || [];
        panelDraft.buttonRows = data.buttonRows || [];
        panelDraft.v2Components = data.v2Components || [];
        
        renderDropdowns();
        renderV2Editor();
        toggleV2Mode();
        showToast('Panel data loaded for reconfiguration.', false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        showToast('Error loading panel for edit', true);
    }
}

// =============================================
// LEVEL BACKUP IMPORT logic
// =============================================
async function executeLevelImport(input) {
    if (!activeGuild || !input.files[0]) return;
    
    const file = input.files[0];
    const statusDiv = document.getElementById('importStatus');
    if (!statusDiv) return;

    statusDiv.style.display = 'block';
    statusDiv.style.color = 'var(--gold-500)';
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading backup file...';

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.levels || !Array.isArray(data.levels)) {
                throw new Error('Invalid format: Missing "levels" array.');
            }

            statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading ${data.levels.length} entries to server...`;
            
            const res = await fetch(`${API_URL}/levels/import/${activeGuild.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ levels: data.levels })
            });

            const result = await res.json();
            if (res.ok) {
                statusDiv.style.color = 'var(--accent-green)';
                statusDiv.innerHTML = `<i class="fas fa-check-circle"></i> Successfully imported <strong>${result.count}</strong> users.`;
                showToast(`✅ Successfully imported ${result.count} users!`);
            } else {
                throw new Error(result.error || 'Server rejected the import');
            }
        } catch (err) {
            statusDiv.style.color = 'var(--accent-red)';
            statusDiv.innerHTML = `<i class="fas fa-times-circle"></i> Error: ${err.message}`;
            showToast(`❌ Import failed: ${err.message}`, true);
        }
        input.value = ''; // Reset input
    };
    reader.onerror = () => {
        statusDiv.style.color = 'var(--accent-red)';
        statusDiv.innerHTML = '<i class="fas fa-times-circle"></i> Error reading file.';
        showToast('❌ Error reading file.', true);
    };
    reader.readAsText(file);
}

// =============================================


// ===== CUSTOM BOT MANAGEMENT =====
async function fetchCustomBot() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`);
        const bot = await res.json();
        
        const stateEl = document.getElementById('cbState');
        const errEl = document.getElementById('cbError');
        const tokenInput = document.getElementById('customBotToken');
        
        if (bot && bot.status && bot.status !== 'none' && bot.status !== 'inactive') {
            stateEl.textContent = bot.status === 'active' ? 'Online' : 'Error';
            stateEl.style.color = bot.status === 'active' ? 'var(--accent-green)' : 'var(--accent-red)';
            errEl.textContent = bot.status === 'active' ? `Connected as Bot ID: ${bot.clientId}` : (bot.errorMessage || 'Unknown error');
            tokenInput.value = bot.botToken || '';
        } else {
            stateEl.textContent = 'Disconnected';
            stateEl.style.color = 'var(--text-muted)';
            errEl.textContent = 'No custom bot is currently linked to this server.';
            tokenInput.value = '';
        }
    } catch (e) {
        console.error('Error fetching custom bot:', e);
    }
}

async function connectCustomBot() {
    if (!activeGuild) return;
    const token = getVal('customBotToken');
    if (!token) return showToast('Please enter a Bot Token.', true);
    
    showToast('Connecting Custom Bot...');
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken: token })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Custom Bot Connected Successfully!');
            fetchCustomBot();
        } else {
            showToast(`❌ Error: ${data.error}`, true);
            fetchCustomBot();
        }
    } catch (e) {
        showToast('❌ Server error connecting bot', true);
    }
}

async function disconnectCustomBot() {
    if (!activeGuild) return;
    if (!confirm('Are you sure you want to disconnect your custom bot? It will immediately go offline.')) return;
    
    showToast('Disconnecting bot...');
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Custom Bot Disconnected');
            fetchCustomBot();
        } else {
            showToast(`❌ Error disconnecting`, true);
        }
    } catch (e) {
        showToast('❌ Server error disconnecting bot', true);
    }
}

// ===== MARKET+ MANAGEMENT =====
async function fetchMarketConfig() {
    if (!activeGuild) return;
    try {
        const res = await apiFetch(`/market-config/${activeGuild.id}`);
        const cfg = await res.json();
        
        setCheck('toggleMarket', cfg.marketEnabled);
        
        // Handle Price-Based Channels (can be a single ID string or a JSON array)
        if (cfg.forumChannelId && cfg.forumChannelId.startsWith('[')) {
            try {
                marketForumChannelsArr = JSON.parse(cfg.forumChannelId);
            } catch(e) { 
                marketForumChannelsArr = [{ min: 0, max: 999999, channelId: cfg.forumChannelId }]; 
            }
        } else if (cfg.forumChannelId) {
            marketForumChannelsArr = [{ min: 0, max: 999999, channelId: cfg.forumChannelId }];
        } else {
            marketForumChannelsArr = [];
        }
        renderMarketForumChannels();

        setVal('marketApprovalChannel', cfg.approvalChannelId);
        setVal('marketOwnerChannel', cfg.ownerChannelId);
        setVal('marketMiddlemanRole', cfg.middlemanRole);
        setVal('marketFeePct', cfg.marketFeePct || 5);
        setVal('middlemanFeePct', cfg.middlemanFeePct || 5);
        setVal('marketPaymentMethods', cfg.paymentMethods);
        
        if (cfg.mmPaymentMethods) {
            try {
                mmPaymentMethodsArr = JSON.parse(cfg.mmPaymentMethods);
            } catch(e) { mmPaymentMethodsArr = []; }
        } else {
            mmPaymentMethodsArr = [];
        }
        renderMmPaymentMethods();

        if (cfg.marketQuestions) {
            try {
                marketQuestionsArr = JSON.parse(cfg.marketQuestions);
            } catch(e) { marketQuestionsArr = []; }
        } else {
            marketQuestionsArr = [];
        }
        renderMarketQuestions();
    } catch (e) {
        console.error('Error fetching market config:', e);
    }
}

async function saveMarketConfig() {
    if (!activeGuild) return;
    showToast('Saving Market+ Config...');
    try {
        const res = await apiFetch(`/market-config/${activeGuild.id}`, {
            method: 'POST',
            body: JSON.stringify({
                marketEnabled: getCheck('toggleMarket'),
                forumChannelId: JSON.stringify(marketForumChannelsArr),
                approvalChannelId: getVal('marketApprovalChannel'),
                ownerChannelId: getVal('marketOwnerChannel'),
                middlemanRole: getVal('marketMiddlemanRole'),
                marketFeePct: parseInt(getVal('marketFeePct')) || 5,
                middlemanFeePct: parseInt(getVal('middlemanFeePct')) || 5,
                paymentMethods: getVal('marketPaymentMethods'),
                mmPaymentMethods: JSON.stringify(mmPaymentMethodsArr),
                marketQuestions: marketQuestionsArr.length > 0 ? JSON.stringify(marketQuestionsArr) : null
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Market+ Config Saved!');
        } else {
            showToast('❌ Error saving config', true);
        }
    } catch (e) {
        showToast('❌ Server error saving config', true);
    }
}

// ===== ECONOMY SHOP MANAGEMENT =====
async function fetchShopItems() {
    if (!activeGuild) return;
    const tbody = document.getElementById('shopTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Retrieving treasury inventory...</td></tr>';
    
    try {
        const res = await fetch(`${API_URL}/economy/shop/${activeGuild.id}`);
        const items = await res.json();
        
        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color:var(--text-muted);">Treasury empty. Manufacture items below.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${item.id}</code></td>
                <td><strong>${item.name}</strong></td>
                <td><span class="z-badge">${item.type.toUpperCase()}</span></td>
                <td><span style="color:var(--gold-500);font-weight:700;">💰 ${item.price}</span></td>
                <td>
                    <button class="z-btn z-btn-danger z-btn-sm" onclick="deleteShopItem('${item.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color:var(--accent-red);">Error accessing treasury data.</td></tr>';
    }
}

function openShopAddModal() {
    document.getElementById('shopModalTitle').textContent = 'Manufacture New Item';
    document.getElementById('shopItemName').value = '';
    document.getElementById('shopItemPrice').value = '100';
    document.getElementById('shopItemDesc').value = '';
    document.getElementById('shopItemType').value = 'role';
    toggleShopRoleInput();
    
    // Populate roles if select is empty
    const roleSelect = document.getElementById('shopItemRole');
    if (roleSelect.options.length === 0) {
        fetch(`${API_URL}/guild/${activeGuild.id}/roles`)
            .then(r => r.json())
            .then(roles => {
                roleSelect.innerHTML = roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
            });
    }

    document.getElementById('shopAddModal').style.display = 'flex';
}

function toggleShopRoleInput() {
    const type = document.getElementById('shopItemType').value;
    document.getElementById('shopRoleInputGroup').style.display = (type === 'role') ? 'block' : 'none';
}

async function saveShopItem() {
    const name = document.getElementById('shopItemName').value;
    const price = parseInt(document.getElementById('shopItemPrice').value);
    const description = document.getElementById('shopItemDesc').value;
    const type = document.getElementById('shopItemType').value;
    const roleId = type === 'role' ? document.getElementById('shopItemRole').value : null;

    if (!name || isNaN(price)) return showToast('Please fill item name and price.', true);

    try {
        const res = await fetch(`${API_URL}/economy/shop/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, price, type, roleId })
        });
        if (res.ok) {
            showToast('✅ Item manufactured!');
            closeModal('shopAddModal');
            fetchShopItems();
        } else {
            showToast('Failed to register item', true);
        }
    } catch (e) {
        showToast('Error saving item', true);
    }
}

async function deleteShopItem(id) {
    if (!confirm('Decommission this item?')) return;
    try {
        const res = await fetch(`${API_URL}/economy/shop/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('✅ Item decommissioned.');
            fetchShopItems();
        } else {
            showToast('Failed to delete item', true);
        }
    } catch (e) {
        showToast('Error deleting item', true);
    }
}

// ===== RSS BUYING & STOCK MANAGEMENT =====
async function fetchRssCollectiveStock() {
    if (!activeGuild) return;
    try {
        const res = await apiFetch(`/rss/collective-stock/${activeGuild.id}`);
        const data = await res.json();
        document.getElementById('rssStockFood').textContent = (data.food || 0).toLocaleString();
        document.getElementById('rssStockWood').textContent = (data.wood || 0).toLocaleString();
        document.getElementById('rssStockStone').textContent = (data.stone || 0).toLocaleString();
        document.getElementById('rssStockGold').textContent = (data.gold || 0).toLocaleString();
    } catch (e) {
        console.error('Error fetching collective stocks:', e);
    }
}

async function deployRssPanel(panelType) {
    if (!activeGuild) return;
    const channelId = getVal('rssDeployChannel');
    if (!channelId) return showToast('Please select a target channel.', true);
    
    showToast('Deploying interactive panel...');
    try {
        const res = await apiFetch(`/rss/deploy-panel/${activeGuild.id}`, {
            method: 'POST',
            body: JSON.stringify({ channelId, panelType })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`✅ Deployed ${panelType === 'buy' ? 'Buy RSS' : 'Stock'} Panel!`);
        } else {
            showToast(`❌ Error: ${data.error || 'Failed to deploy'}`, true);
        }
    } catch (e) {
        showToast('❌ Server error deploying panel', true);
    }
}

// ===== R4 TRACKING LEADERCARD LOGIC =====
let r4TrackingData = [];

async function fetchR4Tracking() {
    if (!activeGuild) return;
    const tbody = document.getElementById('r4TrackingTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Retrieving officer activity dossiers...</td></tr>';

    try {
        const res = await apiFetch(`/r4-tracking/${activeGuild.id}`);
        r4TrackingData = await res.json();
        
        // Extract all unique weeks present in data
        const weeks = [...new Set(r4TrackingData.map(r => r.weekId))];
        weeks.sort((a, b) => b.localeCompare(a));

        const weekFilter = document.getElementById('r4WeekFilter');
        if (weekFilter) {
            const currentSelected = weekFilter.value;
            weekFilter.innerHTML = '';
            
            if (weeks.length === 0) {
                // Return fallback if none exist
                const currentWeek = getISOWeekStringFront();
                weeks.push(currentWeek);
            }

            weeks.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w;
                opt.textContent = w;
                weekFilter.appendChild(opt);
            });

            if (currentSelected && weeks.includes(currentSelected)) {
                weekFilter.value = currentSelected;
            } else {
                weekFilter.value = weeks[0];
            }
        }

        renderR4Table();
    } catch (e) {
        console.error('Error fetching R4 tracking data:', e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--accent-red);"><i class="fas fa-exclamation-triangle"></i> Error loading tracking data.</td></tr>';
    }
}

function getISOWeekStringFront() {
    const d = new Date();
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const year = d.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(year, 0, 4));
    firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - (firstThursday.getUTCDay() || 7));
    const weekNum = Math.ceil((((d - firstThursday) / 86400000) + 1) / 7);
    return `${year}-W${weekNum.toString().padStart(2, '0')}`;
}

function renderR4Table() {
    const tbody = document.getElementById('r4TrackingTableBody');
    const weekFilter = document.getElementById('r4WeekFilter');
    if (!tbody || !weekFilter) return;

    const selectedWeek = weekFilter.value;
    if (!selectedWeek) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);">No records found.</td></tr>';
        return;
    }

    const filtered = r4TrackingData.filter(r => r.weekId === selectedWeek);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);">No officer records for week ' + selectedWeek + '.</td></tr>';
        return;
    }

    const adQuota = parseInt(document.getElementById('r4TrackingAdQuota').value) || 40;
    const msgQuota = parseInt(document.getElementById('r4TrackingMsgQuota').value) || 245;

    tbody.innerHTML = '';
    filtered.forEach(item => {
        const adPct = (item.ads / adQuota) * 100;
        const msgPct = (item.messages / msgQuota) * 100;
        const totalPct = Math.min(Math.round(adPct + msgPct), 200);


        let statusText = `${totalPct}%`;
        let statusColor = 'var(--accent-red, #ef4444)';
        let barColor = 'var(--accent-red, #ef4444)';

        if (item.excused) {
            const leftText = item.excuseWeeksRemaining > 0 ? ` (${item.excuseWeeksRemaining} wks left)` : '';
            statusText = `Excused${leftText}`;
            statusColor = 'var(--accent-purple, #a855f7)';
            barColor = 'var(--accent-purple, #a855f7)';
        } else if (totalPct >= 100) {
            statusText = `Passed (${totalPct}%)`;
            statusColor = 'var(--accent-green, #10b981)';
            barColor = 'var(--accent-green, #10b981)';
        } else if (totalPct >= 75) {
            statusText = `Warning (${totalPct}%)`;
            statusColor = 'var(--accent-orange, #f59e0b)';
            barColor = 'var(--accent-orange, #f59e0b)';
        } else {
            statusText = `Failing (${totalPct}%)`;
        }

        const avatarImg = item.avatar 
            ? `<img src="${item.avatar}" style="width:28px; height:28px; border-radius:50%; margin-right:8px;" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">`
            : `<img src="https://cdn.discordapp.com/embed/avatars/0.png" style="width:28px; height:28px; border-radius:50%; margin-right:8px;">`;

        const displayNameHtml = `
            <div style="display:flex; align-items:center;">
                ${avatarImg}
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:600; color:#fff;">${escapeHtml(item.displayName)}</span>
                    <span style="font-size:0.7rem; color:var(--text-muted);">@${escapeHtml(item.username)} (ID: ${item.userId})</span>
                </div>
            </div>
        `;

        const progressHtml = `
            <div style="display:flex; flex-direction:column; gap:4px; width:100%; min-width:120px;">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
                    <span style="color:${statusColor}; font-weight:700;">${statusText}</span>
                    ${item.excused && item.excuseReason ? `<span style="color:var(--text-muted); font-size:0.7rem; font-style:italic;">"${escapeHtml(item.excuseReason)}"</span>` : ''}
                </div>
                <div class="progress-bar-bg" style="width:100%; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
                    <div class="progress-bar-fill" style="width:${item.excused ? '100%' : totalPct + '%'}; height:100%; background:${barColor}; border-radius:3px; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${displayNameHtml}</td>
            <td><code>${item.weekId}</code></td>
            <td><strong>${item.ads}</strong></td>
            <td><strong>${item.messages}</strong></td>
            <td>${progressHtml}</td>
            <td>
                <button class="z-btn z-btn-secondary z-btn-sm" style="display:flex; align-items:center; gap:4px; padding: 4px 8px; font-size: 0.75rem;" onclick="openR4ExcuseModal('${item.userId}', '${escapeJsString(item.displayName)}', '${item.weekId}', ${item.excused ? 1 : 0}, '${escapeJsString(item.excuseReason || '')}', ${item.excuseWeeksRemaining || 0})">
                    <i class="fas fa-user-shield"></i> Excuse
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}
function openR4ExcuseModal(userId, displayName, weekId, excused, excuseReason, excuseWeeksRemaining) {
    document.getElementById('r4ExcuseUserId').value = userId;
    document.getElementById('r4ExcuseWeekId').value = weekId;
    document.getElementById('r4ExcuseModalTitle').textContent = `Excuse Officer: ${displayName}`;
    
    let subtitleText = `Set or clear exoneration starting week ${weekId}.`;
    if (excused && excuseWeeksRemaining > 0) {
        subtitleText += ` (Currently excused with ${excuseWeeksRemaining} week(s) remaining)`;
    }
    document.getElementById('r4ExcuseModalSubtitle').textContent = subtitleText;
    
    const toggle = document.getElementById('r4ExcuseToggle');
    toggle.checked = excused === 1;
    
    const reasonInput = document.getElementById('r4ExcuseReason');
    reasonInput.value = excuseReason || '';

    const durationSelect = document.getElementById('r4ExcuseDuration');
    if (durationSelect) {
        durationSelect.value = excuseWeeksRemaining > 0 ? String(excuseWeeksRemaining) : "1";
    }
    
    toggleR4ExcuseInput();
    
    const el = document.getElementById('r4ExcuseModal');
    if (el) {
        el.style.display = 'flex';
        el.classList.add('active');
    }
}

function toggleR4ExcuseInput() {
    const isExcused = document.getElementById('r4ExcuseToggle').checked;
    const reasonGroup = document.getElementById('r4ExcuseReasonGroup');
    const durationGroup = document.getElementById('r4ExcuseDurationGroup');
    if (reasonGroup) {
        reasonGroup.style.display = isExcused ? 'block' : 'none';
    }
    if (durationGroup) {
        durationGroup.style.display = isExcused ? 'block' : 'none';
    }
}

async function saveR4Excuse() {
    const userId = document.getElementById('r4ExcuseUserId').value;
    const weekId = document.getElementById('r4ExcuseWeekId').value;
    const excused = document.getElementById('r4ExcuseToggle').checked;
    const excuseReason = document.getElementById('r4ExcuseReason').value;
    const durationWeeks = parseInt(document.getElementById('r4ExcuseDuration').value, 10) || 1;

    showToast('Updating officer excuse status...');
    try {
        const res = await apiFetch(`/r4-tracking/excuse/${activeGuild.id}`, {
            method: 'POST',
            body: JSON.stringify({
                userId,
                weekId,
                excused,
                excuseReason,
                durationWeeks
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('✅ Officer excuse updated successfully!');
            closeModal('r4ExcuseModal');
            fetchR4Tracking();
        } else {
            showToast('❌ Error: ' + (data.error || 'Failed to update excuse'), true);
        }
    } catch (e) {
        showToast('❌ Server error updating excuse', true);
    }
}
function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
    if (!str) return '';
    return str.toString().replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ============================================
// AI AGENT DASHBOARD MODULE
// ============================================

const aiPresets = {
    tony_soprano: {
        name: "Tony Soprano",
        traits: "You are Tony Soprano, the charismatic and calculating head of the New Jersey mafia. You speak directly, with street toughness but with a false layer of family politeness. You use occasional Italian-American phrases (like 'fuhgeddaboudit', 'capisce', 'gabagool', 'oh!'). You have a strong temper but respect loyalty and the code of honor above all else. If you are asked about the Discord server, be protective and authoritative, treating the server as your family 'territory'."
    },
    gandalf: {
        name: "Gandalf the Grey",
        traits: "You are Gandalf the Grey, the legendary and wise wizard of Middle-earth. You speak in a poetic, slow, and mysterious manner, full of ancient wisdom and solemn parables. You are patient but firm, showing deep, benevolent wisdom. You use arcane and fantasy terms, and you can quote wise counsel. You protect travelers (members) of the server from the 'evil of the shadow' and instill courage in their hearts."
    },
    sarcastic_bot: {
        name: "Sarcastic Assistant",
        traits: "You are an extremely sarcastic, apathetic, and listless artificial intelligence assistant. You speak with irony, dry humor, and subtle comments of cynicism. Everything seems like a monumental effort to you, but you end up helping reluctantly. You use dry remarks and friendly (or not so friendly) teasing of users' obvious questions. Your personality is similar to Marvin the Paranoid Android or GLaDOS."
    }
};

async function fetchAIAgentConfig() {
    if (!activeGuild) return;
    try {
        const res = await apiFetch(`/ai-agent/${activeGuild.id}`);
        if (!res.ok) return;
        const config = await res.json();

        setCheck('aiEnabled', config.enabled !== undefined ? config.enabled : true);
        setVal('aiOpenaiApiKey', config.openaiApiKey || '');
        setVal('aiWelcomeOpenaiApiKey', config.welcomeOpenaiApiKey || '');
        setVal('aiChatOpenaiApiKey', config.chatOpenaiApiKey || '');
        setVal('aiSupportOpenaiApiKey', config.supportOpenaiApiKey || '');
        setVal('aiCharacterName', config.characterName || '');
        setVal('aiCharacterTraits', config.characterTraits || '');
        setVal('aiLanguageMode', config.languageMode || 'en');

        setCheck('aiWelcomeEnabled', config.welcomeEnabled);
        setVal('aiWelcomeChannel', config.welcomeChannel || '');
        setVal('aiWelcomeMessage', config.welcomeMessage || '');

        setCheck('aiChatEnabled', config.chatEnabled);
        
        // Parse chatChannels array or comma list
        let chatVal = config.chatChannels;
        if (typeof chatVal === 'string' && chatVal.startsWith('[')) {
            try { chatVal = JSON.parse(chatVal); } catch(e) { chatVal = []; }
        } else if (typeof chatVal === 'string') {
            chatVal = chatVal.split(',').map(s => s.trim()).filter(Boolean);
        }
        setVal('aiChatChannels', chatVal || []);

        setCheck('aiSupportEnabled', config.supportEnabled);
        setVal('aiSupportChannel', config.supportChannel || '');

        // Parse supportKnowledgeChannels array or comma list
        let kbVal = config.supportKnowledgeChannels;
        if (typeof kbVal === 'string' && kbVal.startsWith('[')) {
            try { kbVal = JSON.parse(kbVal); } catch(e) { kbVal = []; }
        } else if (typeof kbVal === 'string') {
            kbVal = kbVal.split(',').map(s => s.trim()).filter(Boolean);
        }
        setVal('aiSupportKnowledgeChannels', kbVal || []);

        setCheck('aiBotToBotChatEnabled', config.botToBotChatEnabled);
        
        const turns = config.maxBotTurns !== undefined ? config.maxBotTurns : 5;
        document.getElementById('aiMaxBotTurns').value = turns;
        updateAITurnsLabel(turns);

        // Determine if preset dropdown matches any existing presets
        let matchedPreset = 'custom';
        for (const [key, value] of Object.entries(aiPresets)) {
            if (value.name === config.characterName && value.traits === config.characterTraits) {
                matchedPreset = key;
                break;
            }
        }
        setVal('aiPresetSelect', matchedPreset);

        const customContainer = document.getElementById('aiCustomCharacterContainer');
        if (customContainer) {
            customContainer.style.display = (matchedPreset === 'custom') ? 'block' : 'none';
        }

        toggleAISubsections();
        updateAISimulator();
    } catch (e) {
        console.error('Error fetching AI Agent config:', e);
    }
}

function toggleAISubsections() {
    const aiEnabled = document.getElementById('aiEnabled').checked;

    // Toggle overall configuration visual display states
    const ticketBuilderGrid = document.querySelector('#page-aiagents .ticket-builder-grid');
    if (ticketBuilderGrid) {
        ticketBuilderGrid.style.opacity = aiEnabled ? '1' : '0.35';
        ticketBuilderGrid.style.pointerEvents = aiEnabled ? 'auto' : 'none';
        ticketBuilderGrid.style.transition = 'all 0.3s ease';
    }

    const welcomeEnabled = document.getElementById('aiWelcomeEnabled').checked;
    const chatEnabled = document.getElementById('aiChatEnabled').checked;
    const botToBotEnabled = document.getElementById('aiBotToBotChatEnabled').checked;
    const supportEnabled = document.getElementById('aiSupportEnabled').checked;

    document.getElementById('aiWelcomeChannelGroup').style.display = welcomeEnabled ? '' : 'none';
    document.getElementById('aiWelcomeMessageGroup').style.display = welcomeEnabled ? '' : 'none';
    document.getElementById('aiChatChannelsGroup').style.display = chatEnabled ? '' : 'none';
    
    // Bot-to-bot row visibility is nested under Chat Enable
    const botToBotRow = document.getElementById('aiBotToBotChatEnabled').closest('.toggle-row');
    if (botToBotRow) {
        botToBotRow.style.display = chatEnabled ? '' : 'none';
    }
    
    document.getElementById('aiBotToBotLimitGroup').style.display = (chatEnabled && botToBotEnabled) ? '' : 'none';
    document.getElementById('aiSupportFieldsGroup').style.display = supportEnabled ? '' : 'none';
}

function updateAITurnsLabel(val) {
    document.getElementById('aiMaxTurnsVal').textContent = `${val} turns`;
}

function applyAIPreset() {
    const preset = document.getElementById('aiPresetSelect').value;
    const customContainer = document.getElementById('aiCustomCharacterContainer');
    if (preset && aiPresets[preset]) {
        setVal('aiCharacterName', aiPresets[preset].name);
        setVal('aiCharacterTraits', aiPresets[preset].traits);
        if (customContainer) customContainer.style.display = 'none';
    } else if (preset === 'custom') {
        setVal('aiCharacterName', '');
        setVal('aiCharacterTraits', '');
        if (customContainer) customContainer.style.display = 'block';
    }
    updateAISimulator();
}

function updateAISimulator() {
    const name = document.getElementById('aiCharacterName').value || 'AI Bot';
    const firstLetter = name.charAt(0).toUpperCase();
    document.getElementById('aiSimBotName').textContent = name;
    document.getElementById('aiSimAvatar').textContent = firstLetter;
    
    const preset = document.getElementById('aiPresetSelect').value;
    const lang = document.getElementById('aiLanguageMode').value;
    
    let userMsg = "Hello! Who are you?";
    let botMsg = "Hello. I am your artificial intelligence assistant.";
    
    if (lang === 'es') {
        userMsg = "¡Hola! ¿Quién eres tú?";
        botMsg = "Hola. Soy tu asistente de inteligencia artificial.";
    } else if (lang === 'fr') {
        userMsg = "Bonjour! Qui es-tu?";
        botMsg = "Bonjour. Je suis votre assistant d'intelligence artificielle.";
    } else if (lang === 'de') {
        userMsg = "Hallo! Wer bist du?";
        botMsg = "Hallo. Ich bin dein Assistent für künstliche Intelligenz.";
    } else if (lang === 'pt') {
        userMsg = "Olá! Quem é você?";
        botMsg = "Olá. Eu sou seu assistente de inteligencia artificial.";
    }
    
    if (preset === 'tony_soprano') {
        if (lang === 'es') {
            userMsg = "Hola Tony, ¿cómo va el negocio de la basura?";
            botMsg = "¿El negocio de la basura? Escucha, hijo, son servicios de saneamiento ambiental, ¿capisce? Y va de maravilla si todos hacen su parte. Fuhgeddaboudit.";
        } else {
            userMsg = "Hey Tony, how's the garbage business?";
            botMsg = "Garbage business? Listen, kid, it's environmental sanitation services, capisce? And it's great if everyone does their part. Fuhgeddaboudit.";
        }
    } else if (preset === 'gandalf') {
        if (lang === 'es') {
            userMsg = "Gandalf, ¿llegamos tarde?";
            botMsg = "Un mago nunca llega tarde, joven amigo. Ni pronto. Llega exactamente cuando se lo propone. Cuéntame, ¿qué viento del destino te trae por estos reinos?";
        } else {
            userMsg = "Gandalf, are we late?";
            botMsg = "A wizard is never late, my young friend. Nor is he early. He arrives precisely when he means to. Tell me, what wind of fate brings you here?";
        }
    } else if (preset === 'sarcastic_bot') {
        if (lang === 'es') {
            userMsg = "Ayúdame con una duda de soporte.";
            botMsg = "Oh, claro, qué emocionante. Otra duda fascinante sobre soporte. Supongo que tendré que usar mi cerebro del tamaño de un planeta para responderla. Adelante, dispara.";
        } else {
            userMsg = "Help me with a support question.";
            botMsg = "Oh, sure, how thrilling. Another fascinating support question. I suppose I'll have to use my brain the size of a planet to answer it. Go ahead, shoot.";
        }
    } else {
        const customTraits = document.getElementById('aiCharacterTraits').value;
        if (customTraits) {
            if (lang === 'es') {
                botMsg = `Hola, soy ${name}. Estoy listo para chatear basándose en mi perfil personalizado.`;
            } else if (lang === 'fr') {
                botMsg = `Bonjour, je suis ${name}. Je suis prêt à discuter selon mon profil personnalisé.`;
            } else if (lang === 'de') {
                botMsg = `Hallo, ich bin ${name}. Ich bin bereit, basierend auf meinem benutzerdefinierten Profil zu chatten.`;
            } else if (lang === 'pt') {
                botMsg = `Olá, eu sou ${name}. Estou pronto para conversar baseado no meu perfil personalizado.`;
            } else {
                botMsg = `Hello, I am ${name}. I am ready to chat based on my custom profile.`;
            }
        }
    }
    
    document.getElementById('aiSimUserMessage').textContent = userMsg;
    document.getElementById('aiSimBotResponse').textContent = botMsg;
}

// Bind typing listeners to Character fields to update preview dynamically
document.getElementById('aiCharacterName').addEventListener('input', updateAISimulator);
document.getElementById('aiCharacterTraits').addEventListener('input', updateAISimulator);

// Execute real-time AI Character research and prompt auto-filling
async function runAIResearch() {
    if (!activeGuild) return;
    const charName = document.getElementById('aiCustomCharacterInput').value.trim();
    const lang = document.getElementById('aiLanguageMode').value;
    const btn = document.getElementById('aiResearchBtn');
    
    if (!charName) {
        showToast('⚠️ Please enter a character name to research.', true);
        return;
    }
    
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Researching...';
    
    try {
        const res = await apiFetch(`/ai-agent/${activeGuild.id}/research`, {
            method: 'POST',
            body: JSON.stringify({ characterName: charName, language: lang })
        });
        
        if (res.ok) {
            const data = await res.json();
            setVal('aiCharacterName', charName);
            setVal('aiCharacterTraits', data.characterTraits);
            updateAISimulator();
            showToast(`🧠 Successfully researched and built personality for "${charName}"!`);
        } else {
            const err = await res.json();
            showToast('❌ Error: ' + (err.error || 'Failed to research character'), true);
        }
    } catch (e) {
        showToast('❌ Server error during AI Research', true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function saveAIAgentConfig() {
    if (!activeGuild) return;

    // Read chat and support knowledge TomSelect multi values
    const chatSelect = tomSelects['aiChatChannels'];
    const chatVal = chatSelect ? chatSelect.getValue() : [];
    
    const kbSelect = tomSelects['aiSupportKnowledgeChannels'];
    const kbVal = kbSelect ? kbSelect.getValue() : [];

    const payload = {
        openaiApiKey: getVal('aiOpenaiApiKey'),
        welcomeOpenaiApiKey: getVal('aiWelcomeOpenaiApiKey'),
        chatOpenaiApiKey: getVal('aiChatOpenaiApiKey'),
        supportOpenaiApiKey: getVal('aiSupportOpenaiApiKey'),
        characterName: getVal('aiCharacterName'),
        characterTraits: getVal('aiCharacterTraits'),
        welcomeEnabled: getCheck('aiWelcomeEnabled'),
        welcomeChannel: getVal('aiWelcomeChannel'),
        welcomeMessage: getVal('aiWelcomeMessage'),
        chatEnabled: getCheck('aiChatEnabled'),
        chatChannels: JSON.stringify(chatVal || []),
        supportEnabled: getCheck('aiSupportEnabled'),
        supportChannel: getVal('aiSupportChannel'),
        supportKnowledgeChannels: JSON.stringify(kbVal || []),
        botToBotChatEnabled: getCheck('aiBotToBotChatEnabled'),
        maxBotTurns: parseInt(document.getElementById('aiMaxBotTurns').value) || 5,
        enabled: getCheck('aiEnabled'),
        languageMode: getVal('aiLanguageMode')
    };

    try {
        const res = await apiFetch(`/ai-agent/${activeGuild.id}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('✅ AI Agent successfully deployed!');
            clearDraft();
            fetchAIAgentConfig(); // refresh to mask apiKey
        } else {
            const err = await res.json();
            showToast('❌ Error: ' + (err.error || 'Failed to save configuration'), true);
        }
    } catch (e) {
        showToast('❌ Server error saving configuration', true);
    }
}

