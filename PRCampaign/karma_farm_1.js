import { execSync } from 'child_process';

const karmaText = "Nothing breaks immersion faster for me than a character constantly talking to themselves to give the player hints before I even have a chance to figure out the puzzle. Just give me 5 minutes to think!";

console.log("Saving top-tier organic Reddit comment to clipboard...");
execSync(`printf "%s" "${karmaText}" | pbcopy`);

const url = "https://www.reddit.com/r/gaming/rising/";
console.log("Opening r/gaming (Rising threads)...");
console.log("INSTRUCTION: Find a thread about game mechanics, modern gaming trends, or things that annoy you in games, and just paste (Cmd+V) the comment!");

execSync(`open -a "Google Chrome" "${url}"`);
