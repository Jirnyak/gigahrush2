import { execSync } from 'child_process';

const title = `You know that "Gigahrushchevka" internet meme? I made a browser survival horror game inside it.`;

const body = `**Game Title:** GIGAH|RUSH
**Playable Link:** https://gigahrush.bileter.workers.dev
**Platform:** Browser (PC/Mobile)
**Description:** A lot of people online know the "Gigahrushchevka" concept — the terrifying idea of an endless, infinite brutalist Soviet apartment block that goes on forever, like the Backrooms. I loved the concept so much that I built a free browser survival-horror game out of it. You start in a safe living area, pack your backpack with food, ammo, and medicine, and take the elevator into procedurally generated hostile floors. The world keeps living without you: NPCs trade, fight, and hide from Samosbor — a catastrophic event that seals doors, fills the corridors with purple fog, and wakes up monsters. The entire game runs directly in your browser without requiring any installation or heavy engines, just pure WebGL and canvas APIs. I'd love to hear your feedback on the horror atmosphere and whether the first expedition feels fair or too punishing!
**Free to Play Status:**
- [x] Free to play
- [ ] Demo/Key available
**Involvement:** Solo Developer`;

const url = `https://www.reddit.com/r/indiegames/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(body)}`;

console.log("Opening URL in Google Chrome: ", url);

execSync(`open -a "Google Chrome" "${url}"`);
