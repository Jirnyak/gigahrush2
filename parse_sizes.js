const fs = require('fs');
const content = fs.readFileSync('src/game/save.h', 'utf8');
const lines = content.split('\n');
for (const line of lines) {
    if (line.includes('inline constexpr std::size_t k')) {
        console.log(line);
    }
}
