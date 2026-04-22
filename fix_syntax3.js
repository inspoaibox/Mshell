const fs = require('fs');

function fixLine(file, lineNum, replacement) {
    let c = fs.readFileSync(file, 'utf8').split('\n');
    c[lineNum - 1] = replacement;
    fs.writeFileSync(file, c.join('\n'));
}

fixLine('src/components/Audit/AuditLogPanel.vue', 193, "    ElMessage.error('Error');");
// Just in case it's 194
fixLine('src/components/Audit/AuditLogPanel.vue', 194, "  }");

fixLine('src/components/Common/ThemeSelector.vue', 190, "    await ElMessageBox.confirm('Confirm', 'Confirm', { type: 'warning' });");
fixLine('src/components/Common/ThemeSelector.vue', 199, "    ElMessage.success('Success');");

fixLine('src/components/PortForward/PortForwardTemplatePanel.vue', 477, "    ElMessage.success('Success');");

console.log('Fixed final lines');
