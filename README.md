# Quake-Crossover

**Crossover Quake** — a browser FPS that runs Quake II and Quake III content side by side (load your own `pak0.pak` / `pak0.pk3`).

Open `index.html` in a modern browser (WebGL2). Source: `core.js` (pmove, BSP, collision), `game.js` (renderer, entities, bots, UI), `shell.html` (template). Rebuild with `node build.js`.

Features: Q2 and Q3 physics/weapons/sounds/items, ragdolls, monsters, bots with A* pathing, hearing and squad tactics (deathmatch and co-op), save/load, powerup effects.

Quake III shaders: every `.shader` keyword is parsed. Maps draw each shader as its real list of stages (`map`, `clampmap`, `animmap`, `$lightmap`, `$whiteimage`), with `tcMod` (scroll, scale, rotate, stretch, transform, turb), `tcGen` (base, lightmap, environment, vector), `rgbGen`, `alphaGen`, `blendFunc`, `alphaFunc`, `depthFunc`, `depthWrite`, `cull` (parsed), `sort`, `polygonOffset`, `deformVertexes` (wave, normal, bulge, move, autosprite, autosprite2), cloud-layer skies and `fogparms` volumes. Model shaders draw all their stages too. Not supported: portals and mirrors, `videoMap`, `deformVertexes text`, `projectionShadow`, fog on surfaces seen from outside a volume.

Press **U** (or type `unstuck`) to get out of geometry or step back along your path.

## Online multiplayer

Play → Multiplayer → **Online**:

- **Cloud** — host or join from the game page on claude.ai. Open games are listed for everyone who has the page open (it must be shared with them); you can also join by code. No server needed.
- **LAN** — browsers on the same network connect directly (WebRTC). The host clicks *Host online game*, then *Make invite* for each player and sends them the code; the player pastes it, clicks *Make reply* and sends the reply back. No internet needed.
- **Dedicated** — run a server and connect to it:

  ```
  node server.js --map test --frag 20 --time 10 --mode q2
  ```

  It needs Node 16+ and no packages. It serves the game too: open the address it prints (`http://<server>:27960`) on every machine, choose *Dedicated* and *Connect*. `--map` is a built-in map (`test`, `kappa`, …) or a path such as `maps/q2dm1.bsp` that each player has loaded from their own pak. `/status` shows the players.
- **Off** — matches against bots on your own device, as before.

Online games are deathmatch. Everyone runs their own movement and shooting; the shooter decides hits and the player hit takes the damage. `netcore.js` keeps the match (frags, item pickups, frag and time limits, the next round) in the host's browser or the server.
