const fs = require('fs');
const path = require('path');
const dir = 'tests';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.inl') || f.endsWith('.cpp'));
for (const file of files) {
    const p = path.join(dir, file);
    let code = fs.readFileSync(p, 'utf8');
    code = code.replace(/(?:nav::)?bake_coarse\(([^,]+),\s*([^,)]+)\)/g, 'giga::nav::bake_coarse($1, giga::GravityRegime::NegZ, $2)');
    code = code.replace(/(?:nav::)?bake_fine\(([^,]+),\s*([^,)]+)\)/g, 'giga::nav::bake_fine($1, giga::GravityRegime::NegZ, $2)');
    fs.writeFileSync(p, code, 'utf8');
}
