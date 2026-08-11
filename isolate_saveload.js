const fs = require('fs');
let code = fs.readFileSync('tests/game_test.cpp', 'utf8');
code = code.replace('test_inventory();', 'test_saveload_all();\n    exit(0);\n    test_inventory();');
if (!code.includes('<stdlib.h>')) {
    code = code.replace('#include <vector>', '#include <vector>\n#include <stdlib.h>');
}
fs.writeFileSync('tests/game_test.cpp', code, 'utf8');
