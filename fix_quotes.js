const fs = require('fs');

function fixQuotes(file) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, "utf8");
    let lines = content.split(/\r?\n/);
    let dirty = false;
    for(let i=0; i<lines.length; i++) {
        let line = lines[i];
        let quoteCount = (line.match(/'/g) || []).length;
        if(quoteCount % 2 !== 0) {
            // Find common patterns of unclosed string literals
            if (line.includes("??, '")) {
                line = line.replace("??, '", "??', '");
            } else if (line.includes("??, {")) {
                line = line.replace("??, {", "??', {");
            } else if (line.match(/\?\?,$/)) {
                line = line.replace(/\?\?,$/, "??',");
            } else if (line.match(/\?\?\)$/)) {
                line = line.replace(/\?\?\)$/, "??')");
            } else if (line.match(/\?\?$/)) {
                line = line.replace(/\?\?$/, "??'");
            } else {
                line = line + "'";
            }
            lines[i] = line;
            dirty = true;
        }
        
        let backtickCount = (line.match(/`/g) || []).length;
        if(backtickCount % 2 !== 0) {
            line = line + "`";
            lines[i] = line;
            dirty = true;
        }
    }
    if (dirty) {
        fs.writeFileSync(file, lines.join("\n"));
        console.log("Fixed", file);
    }
}

['src/components/Audit/AuditLogPanel.vue',
 'src/components/Common/ThemeEditor.vue',
 'src/components/Common/ThemeSelector.vue',
 'src/components/PortForward/PortForwardTemplatePanel.vue'].forEach(fixQuotes);
