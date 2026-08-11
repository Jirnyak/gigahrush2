const fs = require('fs');
const content = fs.readFileSync('src/game/quest.h', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; ++i) {
    if (lines[i].includes('kQuestLogWire')) {
        console.log(`${i+1}: ${lines[i]}`);
    }
}
