console.log("Loading tests...");
import('./tests/inventory-rpg.test.ts').then(() => {
  console.log("Loaded!");
}).catch(e => console.error(e));
