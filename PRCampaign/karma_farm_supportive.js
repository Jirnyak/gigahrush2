import { execSync } from 'child_process';

const url = "https://www.reddit.com/r/IndieGaming/new/";
console.log("Opening r/IndieGaming (New threads)...");
console.log("INSTRUCTION: Find a new indie dev showing off their game with 0 comments. Tell them it looks great and ask a simple question to support them!");

execSync(`open -a "Google Chrome" "${url}"`);
