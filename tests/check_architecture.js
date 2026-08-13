const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
    const declCmd = `rg --no-filename "void\\s+([a-zA-Z0-9_]+_(?:step|tick))\\s*\\(" src/ -o --replace "$1"`;
    let out = execSync(declCmd, { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    const funcs = [...new Set(out.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0))];
    
    let failed = false;
    for (const fn of funcs) {
        try {
            const callCmd = `rg "\\b${fn}\\s*\\(" src/`;
            const lines = execSync(callCmd, { encoding: 'utf8', cwd: path.join(__dirname, '..') }).split('\n').filter(l => l.trim().length > 0);
            
            let hasCall = false;
            for (const line of lines) {
                // Ignore the definition line (contains 'void' followed by function name).
                // Ignore inline/constexpr modifiers as well.
                if (!line.match(/(?:void|inline|constexpr)\s+[a-zA-Z0-9_:]*\b\w+_(?:step|tick)\b/i)) {
                    hasCall = true;
                    break;
                }
            }
            if (!hasCall) {
                console.error(`ERROR: Architecture Gate D: Function '${fn}' is defined but NEVER CALLED in src/`);
                failed = true;
            }
        } catch (e) {
            console.error(`ERROR: Architecture Gate D: Function '${fn}' not found anywhere (this shouldn't happen)`);
            failed = true;
        }
    }
    
    if (failed) {
        process.exit(1);
    }
    console.log(`Architecture Gate D passed: ${funcs.length} step/tick functions verified.`);
    process.exit(0);
} catch (e) {
    console.error("Script failed:", e.message);
    process.exit(1);
}
