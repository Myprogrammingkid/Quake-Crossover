# Quake-Crossover

**Crossover Quake** — a browser FPS that runs Quake II and Quake III content side by side (load your own `pak0.pak` / `pak0.pk3`).

Open `index.html` in a modern browser (WebGL2). Source: `core.js` (pmove, BSP, collision), `game.js` (renderer, entities, bots, UI), `shell.html` (template). Rebuild with `node build.js`.

Features: Q2 and Q3 physics/weapons/sounds/items, ragdolls, monsters, bots with A* pathing, hearing and squad tactics (deathmatch and co-op), save/load, powerup effects.

Quake III shaders: every `.shader` keyword is parsed. Maps draw each shader as its real list of stages (`map`, `clampmap`, `animmap`, `$lightmap`, `$whiteimage`), with `tcMod` (scroll, scale, rotate, stretch, transform, turb), `tcGen` (base, lightmap, environment, vector), `rgbGen`, `alphaGen`, `blendFunc`, `alphaFunc`, `depthFunc`, `depthWrite`, `cull` (parsed), `sort`, `polygonOffset`, `deformVertexes` (wave, normal, bulge, move, autosprite, autosprite2), cloud-layer skies and `fogparms` volumes. Model shaders draw all their stages too. Not supported: portals and mirrors, `videoMap`, `deformVertexes text`, `projectionShadow`, fog on surfaces seen from outside a volume.

Built-in campaign (no paks needed): **Unit 1: Outpost Kappa** → **Unit 2: Foundry Sigma** (lava foundry, flooded pumping hall, crane yard) → **Unit 3: Citadel Omega** (storm courtyard, jump pads to the battlements, the command arena). Each exit carries your weapons, health and co-op squad on to the next unit; reached units unlock on the main menu. All three are in the co-op unit list.

Remembered files: `.pak`, `.pk3`, `.zip` and `.pkz` files you load are kept in this browser (IndexedDB) and mount again on the next visit. Loose files (`.bsp`, textures, music) are not kept. Untick *Remember my .pak / .pk3 / .zip files* or press *Forget* to clear them.

Press **U** (or type `unstuck`) to get out of geometry or step back along your path.

## Online multiplayer

Play → Multiplayer → **Online**:

- **Cloud** — works from anywhere the game runs (GitHub Pages, a downloaded `index.html`, `node server.js`, or claude.ai). The host's browser is the server: no hosting needed. Games are listed, and players introduce themselves, through a few public MQTT relays at once (so one being down changes nothing); play then goes browser to browser over WebRTC with public STUN servers, and falls back to running through the relay when no direct path can be made. Set *Relay* to your own (`node server.js` has one at `ws://<server>:27960/mqtt`) to avoid public relays. On claude.ai the page's own room is used as well. **Run a server in this tab** turns a Chrome tab into a cloud server: it hosts the match with the map, gamemode and limits you set, does not play itself, runs the monsters in co-op, stays listed while players come and go, and keeps going in a background tab. Anything sent through public relays can be read by others on them; it's game traffic only.
- **LAN** — browsers on the same network connect directly (WebRTC). The host clicks *Host online game*, then *Make invite* for each player and sends them the code; the player pastes it, clicks *Make reply* and sends the reply back. No internet needed.
- **Dedicated** — run a server and connect to it:

  ```
  node server.js --map test --frag 20 --time 10 --mode q2
  ```

  It needs Node 16+ and no packages. It serves the game too: open the address it prints (`http://<server>:27960`) on every machine, choose *Dedicated* and *Connect*. `--map` is a built-in map (`test`, `kappa`, …) or a path such as `maps/q2dm1.bsp` that each player has loaded from their own pak. `/status` shows the players.
- **Off** — matches against bots on your own device, as before.

Online games are deathmatch or co-op (pick *Gamemode* before hosting; for a dedicated server add `--game coop --skill 1`). In co-op one player — the host, or the first player on a dedicated server — runs the monsters; everyone else sees them move, fight and die, and their hits go to that player. Triggers, buttons, doors, shootable things, item pickups and level changes are shared, and if the player running the monsters leaves, the next one takes over. Everyone runs their own movement and shooting; the shooter decides hits and the player hit takes the damage. `netcore.js` keeps the match (frags, item pickups, frag and time limits, the next round) in the host's browser or the server.

## Quake II campaign and mission packs

Load `baseq2/pak0.pak` and, for the mission packs, `xatrix/pak0.pak` (*The Reckoning*) and/or `rogue/pak0.pak` (*Ground Zero*). The Maps screen then offers **Start campaign**, **The Reckoning** and **Ground Zero**.

- Campaign entities: `trigger_hurt`, `target_laser`, `target_crosslevel_trigger` / `target_crosslevel_target` (flags kept between the maps of a unit, cleared at a new unit), `trigger_gravity`, `target_earthquake`, `target_spawner`, `target_blaster`, `target_splash`, `target_temp_entity`, `target_killplayers`, decorative `misc_*` models; brush entities with no special rules stay solid.
- The Reckoning: gekk, fixbot, heat-seeking chick, Phalanx gladiator, hyperblaster / laser / ripper soldiers, boss5; `func_door_secret2`, `target_mal_laser`, `func_object_repair`.
- Ground Zero: stalker, turret, carrier, Black Widow (both forms), Daedalus, medic commander, kamikaze flyer; `func_plat2`, `func_force_wall`.
- Mission-pack weapons are picked up as the nearest Quake II gun (Ion Ripper → HyperBlaster, Phalanx → Rocket Launcher, ETF Rifle → Chaingun, Prox Launcher → Grenade Launcher, Plasma Beam → HyperBlaster, Disruptor → Railgun, Chainfist → Shotgun) and their ammo fills that gun's. DualFire and Double Damage act as Quad Damage; spheres, goggles and the doppleganger are collected but do nothing special.
