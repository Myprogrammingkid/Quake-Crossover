# Quake-Crossover

**Crossover Quake** — a browser FPS that runs Quake II and Quake III content side by side (load your own `pak0.pak` / `pak0.pk3`).

Open `index.html` in a modern browser (WebGL2). Source: `core.js` (pmove, BSP, collision), `game.js` (renderer, entities, bots, UI), `shell.html` (template). Rebuild with `node build.js`.

Features: Q2 and Q3 physics/weapons/sounds/items, ragdolls, monsters, bots with A* pathing, hearing and squad tactics (deathmatch and co-op), save/load, powerup effects.
