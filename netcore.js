// Crossover Quake — shared online match logic. The same code runs inside the hosting browser (Cloud and LAN games) and in the
// dedicated server (server.js). Players run their own movement and shooting and tell the others; the authority keeps what everyone must
// agree on: who is playing, frags, which items are taken, the frag and time limits, and the restart after a match ends.
(function (root) {
  'use strict';
  const clean = (s, n = 24) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, n);
  const num = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);
  const SETS = new Set(['builtin', 'q2', 'q3']);
  // what may travel between players: anything else is dropped before it reaches the game
  const CLIENT_KINDS = new Set(['st', 'fire', 'hit', 'chat', 'mst', 'mfire', 'mhit', 'mdie', 'mgib', 'mspawn', 'act', 'edie']); // player → everyone (the m* ones come from the player running the monsters in co-op)
  const REQ_KINDS = new Set(['hello', 'pickup', 'died', 'map']); // player → authority
  const AUTH_KINDS = new Set(['welcome', 'roster', 'item', 'frag', 'over', 'restart', 'bye', 'full', 'master']); // authority → players

  function createAuthority(o) { // o: { send(to|null, msg), now(), map, wset, rules: { frag, time }, max }
    const A = { players: new Map(), items: new Map(), map: o.map, wset: o.wset, rules: { frag: num(o.rules && o.rules.frag) | 0, time: num(o.rules && o.rules.time) | 0, mode: o.rules && o.rules.mode === 'coop' ? 'coop' : 'dm', skill: Math.max(0, Math.min(2, num(o.rules && o.rules.skill, 1) | 0)) }, start: o.now(), over: false, overT: 0, hue: 0, max: o.max || 16, master: null };
    const coop = () => A.rules.mode === 'coop';
    const roster = () => [...A.players].map(([id, p]) => ({ id, name: p.name, frags: p.frags, deaths: p.deaths, set: p.set, model: p.model, skin: p.skin, hue: p.hue }));
    const bc = m => o.send(null, m);
    const sendRoster = () => bc({ k: 'roster', list: roster() });
    function end(text) { A.over = true; A.overT = o.now(); bc({ k: 'over', text }); }
    function check() {
      if (A.over || !A.players.size || coop()) return;
      const r = roster().sort((a, b) => b.frags - a.frags), best = r[0], now = o.now();
      if (A.rules.frag && best.frags >= A.rules.frag) end(`Frag limit — ${best.name} wins with ${best.frags} frags.`);
      else if (A.rules.time && now - A.start >= A.rules.time * 60000) end(r.length > 1 && r[1].frags === best.frags ? `Time limit — tied at ${best.frags} frags.` : `Time limit — ${best.name} wins with ${best.frags} frags.`);
    }
    A.onMsg = (from, m) => {
      if (!m || typeof m !== 'object' || !REQ_KINDS.has(m.k)) return;
      const now = o.now();
      if (m.k === 'hello') {
        let p = A.players.get(from);
        if (!p) { if (A.players.size >= A.max) { o.send(from, { k: 'full' }); return; } p = { frags: 0, deaths: 0, hue: A.hue++ }; A.players.set(from, p); }
        if (!A.master || !A.players.has(A.master)) A.master = from; // co-op: the first player in runs the monsters
        p.name = clean(m.name) || 'Player'; p.set = SETS.has(m.set) ? m.set : 'builtin'; p.model = clean(m.model, 32) || null; p.skin = clean(m.skin, 32) || null;
        const items = []; for (const [i, until] of A.items) if (until > now) items.push([i, Math.min(1e9, until - now)]);
        o.send(from, { k: 'welcome', you: from, map: A.map, spot: A.spot || '', wset: A.wset, rules: A.rules, elapsed: now - A.start, items, over: A.over, master: A.master, list: roster() });
        sendRoster(); return;
      }
      const p = A.players.get(from); if (!p) return;
      if (m.k === 'pickup') {
        const i = num(m.i, -1) | 0, r = Math.max(1000, Math.min(180000, num(m.r, 25000) | 0)); if (i < 0 || i > 100000) return;
        if ((A.items.get(i) || 0) > now) return; A.items.set(i, now + (coop() ? 1e12 : r)); bc({ k: 'item', i, r, by: from }); return;
      }
      if (m.k === 'died') {
        if (coop()) { p.deaths++; bc({ k: 'frag', v: from, by: null }); sendRoster(); return; }
        if (A.over) return; p.deaths++;
        const kid = typeof m.by === 'string' && m.by !== from && A.players.has(m.by) ? m.by : null;
        if (kid) A.players.get(kid).frags++; else p.frags--;
        bc({ k: 'frag', v: from, by: kid }); sendRoster(); check();
      }
      if (m.k === 'map' && from === A.master && typeof m.map === 'string' && /^[A-Za-z0-9_./-]{1,80}$/.test(m.map)) { A.map = m.map; A.spot = clean(m.spot, 40); A.items.clear(); }
    };
    A.leave = id => { if (!A.players.delete(id)) return; bc({ k: 'bye', id }); if (A.master === id) { A.master = A.players.keys().next().value || null; bc({ k: 'master', id: A.master }); } sendRoster(); };
    A.tick = () => {
      const now = o.now();
      if (!A.over) { check(); return; }
      if (now - A.overT > 10000) { A.over = false; A.start = now; A.items.clear(); for (const p of A.players.values()) p.frags = p.deaths = 0; bc({ k: 'restart' }); sendRoster(); }
    };
    A.roster = roster;
    return A;
  }
  const NetCore = { createAuthority, clean, num, CLIENT_KINDS, REQ_KINDS, AUTH_KINDS, PORT: 27960 };
  if (typeof module !== 'undefined' && module.exports) module.exports = NetCore; else root.NetCore = NetCore;
})(typeof self !== 'undefined' ? self : this);
