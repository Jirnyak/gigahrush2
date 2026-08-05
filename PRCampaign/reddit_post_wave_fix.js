import { execSync } from 'child_process';

const title = `You know that "Gigahrushchevka" internet meme? I made a browser survival horror game inside it.`;

const bodyPlayMyGame = `**Game Title:** GIGAH|RUSH
**Playable Link:** https://gigahrush.bileter.workers.dev
**Platform:** Browser (PC/Mobile)
**Description:** A lot of people online know the "Gigahrushchevka" concept — the terrifying idea of an endless, infinite brutalist Soviet apartment block that goes on forever, like the Backrooms. I loved the concept so much that I built a free browser survival-horror game out of it. You start in a safe living area, pack your backpack with food, ammo, and medicine, and take the elevator into procedurally generated hostile floors. The world keeps living without you: NPCs trade, fight, and hide from Samosbor — a catastrophic event that seals doors, fills the corridors with purple fog, and wakes up monsters. The entire game runs directly in your browser without requiring any installation or heavy engines, just pure WebGL and canvas APIs. I'd love to hear your feedback on the horror atmosphere and whether the first expedition feels fair or too punishing!
**Free to Play Status:**
- [x] Free to play
- [ ] Demo/Key available
- [ ] Paid (Allowed only on Tuesdays with [TT] in the title)
**Involvement:** Solo Developer / Creator`;

const url = `https://www.reddit.com/r/playmygame/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(bodyPlayMyGame)}`;
console.log(`Opening r/playmygame with the corrected template...`);
execSync(`open -a "Google Chrome" "${url}"`);
console.log("Tab opened.");
