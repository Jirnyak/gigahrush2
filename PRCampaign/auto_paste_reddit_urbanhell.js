import { execSync } from 'child_process';

const title = `"Gigahrushchevka" - The Endless Concrete Block [OC]`;

const firstComment = `I've always been fascinated by the sheer brutalist scale of Soviet housing projects and the "Gigahrushchevka" liminal concept — the idea of a terrifyingly empty, infinite concrete apartment block. I wanted to capture that exact feeling of isolation and endless corridors, so I built an interactive web experiment/game based on it called GIGAH|RUSH. There's something deeply unsettling about wandering through these procedurally generated, identical hallways where the only sounds are the hum of old fluorescent lights and your own footsteps.`;

const url = `https://www.reddit.com/r/UrbanHell/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(firstComment)}`;

console.log("Opening URL in Google Chrome: ", url);

execSync(`open -a "Google Chrome" "${url}"`);
