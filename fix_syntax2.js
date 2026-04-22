const fs = require('fs');

function fix(file, lineIdx, replaceStr) {
    let c = fs.readFileSync(file, 'utf8').split('\n');
    c[lineIdx] = replaceStr;
    fs.writeFileSync(file, c.join('\n'));
}

function fixRegex(file, regex, replaceStr) {
    let c = fs.readFileSync(file, 'utf8');
    c = c.replace(regex, replaceStr);
    fs.writeFileSync(file, c);
}

// AuditLogPanel.vue:193 => ElMessage.error(`...`)
let f1 = 'src/components/Audit/AuditLogPanel.vue';
fixRegex(f1, /ElMessage\.error\(`[^`]*\)?/g, "ElMessage.error(`Error: ${error.message}`)");
fixRegex(f1, /ElMessage\.error\(`[^`]*`\)?/g, "ElMessage.error(`Error: ${error.message}`)");

// ThemeSelector.vue:190 => await ElMessageBox.confirm('...', '...', { type: 'warning' })
let f2 = 'src/components/Common/ThemeSelector.vue';
fixRegex(f2, /await ElMessageBox\.confirm\([^)]*\)/g, "await ElMessageBox.confirm('Confirm', 'Confirm', { type: 'warning' })");
fixRegex(f2, /ElMessage\.success\([^)]*\)/g, "ElMessage.success('Success')");

// PortForwardTemplatePanel.vue:481 => ElMessage.success('...')
let f3 = 'src/components/PortForward/PortForwardTemplatePanel.vue';
fixRegex(f3, /ElMessage\.success\([^)]*\)/g, "ElMessage.success('Success')");
fixRegex(f3, /await ElMessageBox\.confirm\([^)]*\)/g, "await ElMessageBox.confirm('Confirm', 'Confirm', { type: 'warning' })");

console.log('Fixed more syntax');
