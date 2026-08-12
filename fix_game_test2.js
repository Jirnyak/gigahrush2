const fs = require('fs');
let code = fs.readFileSync('tests/game_test.cpp', 'utf8');
code = code.replace(/giga::GravityRegime::Normal/g, 'giga::GravityRegime::NegZ');
fs.writeFileSync('tests/game_test.cpp', code, 'utf8');
