const fs = require('fs');
let code = fs.readFileSync('tests/game_test.cpp', 'utf8');
code = code.replace(/nav::bake_coarse\(([^,]+),\s*([^,)]+)\)/g, 'nav::bake_coarse($1, giga::GravityRegime::Normal, $2)');
code = code.replace(/nav::bake_fine\(([^,]+),\s*([^,)]+)\)/g, 'nav::bake_fine($1, giga::GravityRegime::Normal, $2)');
fs.writeFileSync('tests/game_test.cpp', code, 'utf8');
