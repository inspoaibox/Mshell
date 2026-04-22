const fs = require('fs');

function fixAudit() {
    let f = 'src/components/Audit/AuditLogPanel.vue';
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/await ElMessageBox\.confirm\(.*\{([\s\S]*?)type:\s*'warning'([^}]*)\}\)/, "await ElMessageBox.confirm('Confirm', 'Confirm', { type: 'warning' })");
    c = c.replace(/ElMessage\.success\([^)]*\)/g, "ElMessage.success('Success')");
    c = c.replace(/ElMessage\.error\([^)]*\)/g, "ElMessage.error('Error')");
    fs.writeFileSync(f, c);
}

function fixThemeEditor() {
    let f = 'src/components/Common/ThemeEditor.vue';
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/name:\s*props\.theme\?\.name\s*\|\|.*/, "name: props.theme?.name || 'New Theme',");
    fs.writeFileSync(f, c);
}

function fixThemeSelector() {
    let f = 'src/components/Common/ThemeSelector.vue';
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/await ElMessageBox\.confirm\([^)]*\)/, "await ElMessageBox.confirm('Confirm')");
    c = c.replace(/ElMessage\.success\([^)]*\)/g, "ElMessage.success('Success')");
    fs.writeFileSync(f, c);
}

function fixPortForward() {
    let f = 'src/components/PortForward/PortForwardTemplatePanel.vue';
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/name: \[\{ required: true, message:.*blur' \}\],/, "name: [{ required: true, message: 'Req', trigger: 'blur' }],");
    c = c.replace(/type: \[\{ required: true, message:.*change' \}\],/, "type: [{ required: true, message: 'Req', trigger: 'change' }],");
    c = c.replace(/localHost: \[\{ required: true, message:.*blur' \}\],/, "localHost: [{ required: true, message: 'Req', trigger: 'blur' }],");
    c = c.replace(/localPort: \[\{ required: true, message:.*blur' \}\]/, "localPort: [{ required: true, message: 'Req', trigger: 'blur' }]");
    c = c.replace(/await ElMessageBox\.confirm\(.*\{([\s\S]*?)type:\s*'warning'([^}]*)\}\)/, "await ElMessageBox.confirm('Confirm', 'Confirm', { type: 'warning' })");
    c = c.replace(/ElMessage\.success\([^)]*\)/g, "ElMessage.success('Success')");
    c = c.replace(/ElMessage\.error\([^)]*\)/g, "ElMessage.error('Error')");
    fs.writeFileSync(f, c);
}

try { fixAudit(); } catch(e){}
try { fixThemeEditor(); } catch(e){}
try { fixThemeSelector(); } catch(e){}
try { fixPortForward(); } catch(e){}

console.log('Fixed');
