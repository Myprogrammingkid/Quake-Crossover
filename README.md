# Quake-Crossover

**Crossover Quake** — a browser FPS that runs Quake II and Quake III content side by side (load your own `pak0.pak` / `pak0.pk3`).

Open `index.html` in a modern browser (WebGL2). Source: `core.js` (pmove, BSP, collision), `game.js` (renderer, entities, bots, UI), `shell.html` (template). Rebuild with `node build.js`.

Features: Q2 and Q3 physics/weapons/sounds/items, ragdolls, monsters, bots with A* pathing, hearing and squad tactics (deathmatch and co-op), save/load, powerup effects.

Quake III shaders: every `.shader` keyword is parsed. Maps draw each shader as its real list of stages (`map`, `clampmap`, `animmap`, `$lightmap`, `$whiteimage`), with `tcMod` (scroll, scale, rotate, stretch, transform, turb), `tcGen` (base, lightmap, environment, vector), `rgbGen`, `alphaGen`, `blendFunc`, `alphaFunc`, `depthFunc`, `depthWrite`, `cull` (parsed), `sort`, `polygonOffset`, `deformVertexes` (wave, normal, bulge, move, autosprite, autosprite2), cloud-layer skies and `fogparms` volumes. Model shaders draw all their stages too. Not supported: portals and mirrors, `videoMap`, `deformVertexes text`, `projectionShadow`, fog on surfaces seen from outside a volume.

Press **U** (or type `unstuck`) to get out of geometry or step back along your path.
