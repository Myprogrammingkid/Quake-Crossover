#!/usr/bin/env node
// Crossover Quake dedicated server. No dependencies: Node 16 or newer.
//
//   node server.js [--port 27960] [--map test] [--game dm|coop] [--skill 1] [--frag 20] [--time 10] [--mode q2] [--max 16]
//
// It hosts one deathmatch that players join from the game's Multiplayer menu (Online: Dedicated), and it serves the game itself, so the
// easiest way in is to open the address it prints (http://<this machine>:27960) in a browser. The server keeps the match — players,
// frags, item pickups, frag and time limits, restarts — and relays what players report to each other. --map is a built-in map
// (test, kappa, …) or a path like maps/q2dm1.bsp that every player has loaded from their own pak files.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const NetCore = require('./netcore.js');

const args = {}; for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const k = a.slice(2), v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true'; args[k] = v; } }
if (args.help) { console.log('node server.js [--port 27960] [--map test] [--game dm|coop] [--skill 0-2] [--frag 20] [--time 10] [--mode builtin|q2|q3] [--max 16]'); process.exit(0); }
const PORT = +args.port || NetCore.PORT, MAP = String(args.map || 'test'), MODE = ['builtin', 'q2', 'q3'].includes(args.mode) ? args.mode : 'q2';
const GAME = args.game === 'coop' ? 'coop' : 'dm', RULES = { frag: args.frag === undefined ? 20 : +args.frag | 0, time: args.time === undefined ? 10 : +args.time | 0, mode: GAME, skill: args.skill === undefined ? 1 : +args.skill | 0 }, MAX = Math.max(2, Math.min(32, +args.max || 16));
const PAGE = path.join(__dirname, 'index.html');

const clients = new Map(); let nextId = 1;
const auth = NetCore.createAuthority({
  send: (to, m) => { const s = JSON.stringify({ t: 'a', m }); if (to) { const c = clients.get(to); if (c) sendText(c, s); } else for (const c of clients.values()) sendText(c, s); },
  now: () => Date.now(), map: MAP, wset: MODE, rules: RULES, max: MAX,
});
setInterval(() => auth.tick(), 500);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(PAGE, (err, data) => {
      if (err) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('index.html is missing next to server.js'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(data);
    });
    return;
  }
  if (url === '/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ game: GAME, map: auth.map, mode: MODE, rules: RULES, players: auth.roster().map(p => ({ name: p.name, frags: p.frags })) })); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  if (clients.size >= MAX) { sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: 'p' + nextId++, sock, buf: Buffer.alloc(0), frag: [], budget: 120, alive: true };
  clients.set(c.id, c);
  console.log(`+ ${c.id} from ${req.socket.remoteAddress} (${clients.size} connected)`);
  sendText(c, JSON.stringify({ t: 'id', id: c.id }));
  sock.on('data', d => { c.buf = Buffer.concat([c.buf, d]); if (c.buf.length > 1 << 20) { drop(c); return; } readFrames(c); });
  sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
});
setInterval(() => { for (const c of clients.values()) { c.budget = 120; if (!c.alive) { drop(c); continue; } c.alive = false; sendFrame(c, 0x9, Buffer.alloc(0)); } }, 1000);

function drop(c) {
  if (!clients.has(c.id)) return; clients.delete(c.id);
  try { c.sock.destroy(); } catch (e) {}
  auth.leave(c.id); console.log(`- ${c.id} (${clients.size} connected)`);
}
function readFrames(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, o = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
    else if (len === 127) { if (b.length < 10) return; const hi = b.readUInt32BE(2); if (hi) { drop(c); return; } len = b.readUInt32BE(6); o = 10; }
    if (!masked || len > 65536) { drop(c); return; }
    if (b.length < o + 4 + len) return;
    const mask = b.slice(o, o + 4), data = Buffer.from(b.slice(o + 4, o + 4 + len)); for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = b.slice(o + 4 + len);
    if (op === 0x8) { drop(c); return; }
    if (op === 0x9) { sendFrame(c, 0xA, data); continue; }
    if (op === 0xA) { c.alive = true; continue; }
    if (op === 0x1 || op === 0x0) { c.frag.push(data); if (fin) { const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; c.alive = true; onMessage(c, msg); } }
  }
}
function onMessage(c, text) {
  if (--c.budget < 0) return; // flood guard: about 120 messages a second
  let x; try { x = JSON.parse(text); } catch (e) { return; }
  if (!x || typeof x !== 'object' || !x.m || typeof x.m !== 'object') return;
  if (x.t === 'r') { auth.onMsg(c.id, x.m); return; }
  if (x.t === 'c' && NetCore.CLIENT_KINDS.has(x.m.k)) {
    const s = JSON.stringify({ t: 'c', f: c.id, m: x.m });
    if (x.m.k === 'hit' || x.m.k === 'mhit') { const to = clients.get(x.m.to); if (to) sendText(to, s); return; }
    for (const o of clients.values()) if (o !== c) sendText(o, s);
  }
}
function sendText(c, s) { sendFrame(c, 0x1, Buffer.from(s, 'utf8')); }
function sendFrame(c, op, data) {
  const n = data.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(n, 6); return h; })();
  try { c.sock.write(Buffer.concat([head, data])); } catch (e) { drop(c); }
}

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(GAME === 'coop' ? `Crossover Quake dedicated server — co-op on ${MAP}, ${MODE} rules, skill ${RULES.skill}, up to ${MAX} players (the first player in runs the monsters)` : `Crossover Quake dedicated server — deathmatch on ${MAP}, ${MODE} rules, frag limit ${RULES.frag || 'none'}, time limit ${RULES.time ? RULES.time + ' min' : 'none'}, up to ${MAX} players`);
  for (const ip of ips.length ? ips : ['localhost']) console.log(`  play:   http://${ip}:${PORT}    (Multiplayer → Online: Dedicated → Connect)`);
  console.log(`  status: http://localhost:${PORT}/status`);
});
