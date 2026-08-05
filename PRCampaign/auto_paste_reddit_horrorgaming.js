import { execSync } from 'child_process';

const title = `I'm building a survival horror game set inside an infinite "Gigahrushchevka" (endless Soviet apartment block). It runs completely in the browser.`;

const body = `**Game:** GIGAH|RUSH
**Playable Link:** https://gigahrush.bileter.workers.dev
**Pitch:** I've always been terrified by the sheer brutalist scale of Soviet housing projects. I wanted to capture that feeling, so I built an endless, procedurally generated concrete megastructure. You start in a safe living area, pack your backpack with food, ammo, and medicine, and take the elevator into hostile floors. The world keeps living without you: NPCs trade, fight, and hide from Samosbor — a catastrophic event that seals doors, fills the corridors with purple fog, and wakes up monsters. 
The entire game runs directly in your browser without requiring any installation or heavy engines, just pure WebGL and canvas APIs.
Would love to hear feedback from horror fans on the atmosphere!`;

const url = `https://www.reddit.com/r/HorrorGaming/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}`;

console.log("Opening URL in Google Chrome: ", url);

execSync(`open -a "Google Chrome" "${url}"`);
