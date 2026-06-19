const fs = require('fs');
const path = 'dashboard/dashboard.html';
let html = fs.readFileSync(path, 'utf8');

const selectIds = [
    'welcomeChannelCfg', 'ticketCategoryId', 'panelChannelId',
    'marketApprovalChannel', 'marketMiddlemanRole', 'automodLogChannel',
    'loggingChannel', 'autoRoleInput', 'countingChannel',
    'statsCategoryId', 'r4TrackingRole', 'swearJarChannel', 'modalCategoryId'
];

const multiIds = [
    'modalStaffRoles', 'modalPingRoles'
];

selectIds.forEach(id => {
    const regex = new RegExp('<input[^>]*id="' + id + '"[^>]*>', 'g');
    html = html.replace(regex, '<select class="z-input" id="' + id + '"></select>');
});

multiIds.forEach(id => {
    const regex = new RegExp('<input[^>]*id="' + id + '"[^>]*>', 'g');
    html = html.replace(regex, '<select class="z-input" id="' + id + '" multiple size="3"></select>');
});

// autoroleIds is a textarea
html = html.replace(/<textarea[^>]*id="autoroleIds"[^>]*>.*?<\/textarea>/g, '<select class="z-input" id="autoroleIds" multiple size="4"></select>');

fs.writeFileSync(path, html);
console.log('Replaced successfully.');
