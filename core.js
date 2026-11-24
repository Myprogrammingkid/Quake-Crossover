// ===== Crossover Quake core: archives, Q2 BSP, collision (CM_BoxTrace port), pmove port =====
(function (G) {
'use strict';
const CONTENTS_SOLID = 1, CONTENTS_WINDOW = 2, CONTENTS_LAVA = 8, CONTENTS_SLIME = 16, CONTENTS_WATER = 32,
  CONTENTS_PLAYERCLIP = 0x10000, CONTENTS_MONSTER = 0x2000000, CONTENTS_DEADMONSTER = 0x4000000, CONTENTS_LADDER = 0x20000000;
const MASK_PLAYERSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP | CONTENTS_WINDOW | CONTENTS_MONSTER;
const MASK_SOLID = CONTENTS_SOLID | CONTENTS_WINDOW;
const MASK_SHOT = CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_WINDOW | CONTENTS_DEADMONSTER;
const MASK_WATER = CONTENTS_WATER | CONTENTS_LAVA | CONTENTS_SLIME;
const MASK_MONSTERSOLID = CONTENTS_SOLID | 0x20000 | CONTENTS_WINDOW | CONTENTS_MONSTER;
const MASK_OPAQUE = CONTENTS_SOLID | CONTENTS_SLIME | CONTENTS_LAVA;
const SURF_SLICK = 2, SURF_SKY = 4, SURF_WARP = 8, SURF_TRANS33 = 0x10, SURF_TRANS66 = 0x20, SURF_NODRAW = 0x80;
const PMF_DUCKED = 1, PMF_JUMP_HELD = 2, PMF_ON_GROUND = 4, PMF_TIME_WATERJUMP = 8, PMF_TIME_LAND = 16, PMF_TIME_TELEPORT = 32;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v) { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); if (l) { v[0] /= l; v[1] /= l; v[2] /= l; } return l; }
function angleVectors(a, f, r, u) {
  const y = a[1] * Math.PI / 180, p = a[0] * Math.PI / 180, rl = a[2] * Math.PI / 180;
  const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p), sr = Math.sin(rl), cr = Math.cos(rl);
  if (f) { f[0] = cp * cy; f[1] = cp * sy; f[2] = -sp; }
  if (r) { r[0] = -sr * sp * cy + cr * sy; r[1] = -sr * sp * sy - cr * cy; r[2] = -sr * cp; }
  if (u) { u[0] = cr * sp * cy + sr * sy; u[1] = cr * sp * sy - sr * cy; u[2] = cr * cp; }
}

// ---------------- archives ----------------
function readPak(buf, put) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== 0x4b434150) return -1; // "PACK"
  const ofs = dv.getInt32(4, true), len = dv.getInt32(8, true), n = (len / 64) | 0, u8 = new Uint8Array(buf);
  for (let i = 0; i < n; i++) {
    const o = ofs + i * 64; let s = '';
    for (let j = 0; j < 56; j++) { const c = u8[o + j]; if (!c) break; s += String.fromCharCode(c); }
    const p = dv.getInt32(o + 56, true), l = dv.getInt32(o + 60, true);
    const sub = u8.subarray(p, p + l);
    put(s, () => sub);
  }
  return n;
}
async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function stripBase(name) {
  const l = name.replace(/\\/g, '/');
  const m = l.toLowerCase().match(/(?:^|\/)((?:maps|textures|pics|sound|env|models|sprites|players|music)\/.*)$/);
  return m ? l.slice(l.length - m[1].length) : l;
}
async function readZip(buf, put) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf); let e = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) return -1;
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true), n = 0;
  const dec = new TextDecoder(), nested = [];
  for (let i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true),
      xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(ds, ds + csize); let cache = null;
    const get = async () => { if (cache) return cache; cache = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null; return cache; };
    if (/\.pak$/i.test(name)) nested.push(get); else { put(stripBase(name), get); n++; }
  }
  for (const g of nested) { const d = await g(); if (d) { const r = readPak(d.slice().buffer, put); if (r > 0) n += r; } }
  return n;
}

// ---------------- BSP (IBSP v38 and QBSP extended) ----------------
function cstr(u8, o, n) { let s = ''; for (let i = 0; i < n; i++) { const c = u8[o + i]; if (!c) break; s += String.fromCharCode(c); } return s; }
function parseBSP(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'IBSP' && magic !== 'QBSP') {
    if (dv.getInt32(0, true) === 29) throw new Error('That is a Quake 1 map (BSP29) — this needs Quake II maps.');
    if (magic === 'IBSP' || magic === 'VBSP') throw new Error('Unsupported BSP flavour.');
    throw new Error('Not a Quake II BSP file.');
  }
  const X = magic === 'QBSP', ver = dv.getInt32(4, true);
  if (ver !== 38) throw new Error(ver === 46 || ver === 47 ? 'That is a Quake III map — this needs Quake II maps.' : 'Unsupported BSP version ' + ver);
  const L = []; for (let i = 0; i < 19; i++) L.push({ o: dv.getInt32(8 + i * 8, true), l: dv.getInt32(12 + i * 8, true) });
  const f32 = o => dv.getFloat32(o, true), i32 = o => dv.getInt32(o, true), u16 = o => dv.getUint16(o, true), i16 = o => dv.getInt16(o, true), u32 = o => dv.getUint32(o, true);
  const b = { extended: X };
  b.entities = cstr(u8, L[0].o, L[0].l);
  let n = L[1].l / 20 | 0; b.pn = new Float32Array(n * 3); b.pd = new Float32Array(n); b.pt = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const o = L[1].o + i * 20; b.pn[i * 3] = f32(o); b.pn[i * 3 + 1] = f32(o + 4); b.pn[i * 3 + 2] = f32(o + 8); b.pd[i] = f32(o + 12); b.pt[i] = i32(o + 16); }
  n = L[2].l / 12 | 0; b.verts = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) b.verts[i] = f32(L[2].o + i * 4);
  let s = X ? 44 : 28; n = L[4].l / s | 0; b.nodePlane = new Int32Array(n); b.nodeC0 = new Int32Array(n); b.nodeC1 = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[4].o + i * s; b.nodePlane[i] = i32(o); b.nodeC0[i] = i32(o + 4); b.nodeC1[i] = i32(o + 8); }
  n = L[5].l / 76 | 0; b.texinfo = [];
  for (let i = 0; i < n; i++) { const o = L[5].o + i * 76; const v = []; for (let k = 0; k < 8; k++) v.push(f32(o + k * 4)); b.texinfo.push({ vecs: v, flags: i32(o + 32), value: i32(o + 36), name: cstr(u8, o + 40, 32).toLowerCase(), next: i32(o + 72) }); }
  s = X ? 28 : 20; n = L[6].l / s | 0;
  b.fFirstEdge = new Int32Array(n); b.fNumEdges = new Int32Array(n); b.fTex = new Int32Array(n); b.fLightOfs = new Int32Array(n); b.fStyle0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = L[6].o + i * s;
    if (X) { b.fFirstEdge[i] = i32(o + 8); b.fNumEdges[i] = i32(o + 12); b.fTex[i] = i32(o + 16); b.fStyle0[i] = u8[o + 20]; b.fLightOfs[i] = i32(o + 24); }
    else { b.fFirstEdge[i] = i32(o + 4); b.fNumEdges[i] = i16(o + 8); b.fTex[i] = i16(o + 10); b.fStyle0[i] = u8[o + 12]; b.fLightOfs[i] = i32(o + 16); }
  }
  b.light = u8.subarray(L[7].o, L[7].o + L[7].l);
  s = X ? 52 : 28; n = L[8].l / s | 0; b.leafContents = new Int32Array(n); b.leafFirstBrush = new Int32Array(n); b.leafNumBrush = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[8].o + i * s; b.leafContents[i] = i32(o); if (X) { b.leafFirstBrush[i] = u32(o + 44); b.leafNumBrush[i] = u32(o + 48); } else { b.leafFirstBrush[i] = u16(o + 24); b.leafNumBrush[i] = u16(o + 26); } }
  s = X ? 4 : 2; n = L[10].l / s | 0; b.leafBrushes = new Int32Array(n); for (let i = 0; i < n; i++) b.leafBrushes[i] = X ? u32(L[10].o + i * 4) : u16(L[10].o + i * 2);
  s = X ? 8 : 4; n = L[11].l / s | 0; b.edges = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) { const o = L[11].o + i * s; if (X) { b.edges[i * 2] = u32(o); b.edges[i * 2 + 1] = u32(o + 4); } else { b.edges[i * 2] = u16(o); b.edges[i * 2 + 1] = u16(o + 2); } }
  n = L[12].l / 4 | 0; b.surfedges = new Int32Array(n); for (let i = 0; i < n; i++) b.surfedges[i] = i32(L[12].o + i * 4);
  n = L[13].l / 48 | 0; b.models = [];
  for (let i = 0; i < n; i++) { const o = L[13].o + i * 48; b.models.push({ mins: [f32(o), f32(o + 4), f32(o + 8)], maxs: [f32(o + 12), f32(o + 16), f32(o + 20)], headnode: i32(o + 36), firstface: i32(o + 40), numfaces: i32(o + 44) }); }
  n = L[14].l / 12 | 0; b.brushFirstSide = new Int32Array(n); b.brushNumSides = new Int32Array(n); b.brushContents = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[14].o + i * 12; b.brushFirstSide[i] = i32(o); b.brushNumSides[i] = i32(o + 4); b.brushContents[i] = i32(o + 8); }
  s = X ? 8 : 4; n = L[15].l / s | 0; b.sidePlane = new Int32Array(n); b.sideTex = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[15].o + i * s; if (X) { b.sidePlane[i] = u32(o); b.sideTex[i] = i32(o + 4); } else { b.sidePlane[i] = u16(o); b.sideTex[i] = i16(o + 2); } }
  return b;
}
function parseEntities(str) {
  const out = []; const re = /"([^"]*)"|[{}]/g; let cur = null, key = null, m;
  while ((m = re.exec(str))) {
    const t = m[0];
    if (t === '{') { cur = {}; key = null; } else if (t === '}') { if (cur) out.push(cur); cur = null; }
    else if (cur) { if (key === null) key = m[1]; else { cur[key] = m[1]; key = null; } }
  }
  return out;
}
const vecOf = s => (s || '0 0 0').trim().split(/\s+/).map(Number);


// ---------------- Quake III BSP (IBSP v46/47) ----------------
function parseQ3BSP(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), ver = dv.getInt32(4, true);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'IBSP' || (ver !== 46 && ver !== 47)) throw new Error('Not a Quake III BSP');
  const L = []; for (let i = 0; i < 17; i++) L.push({ o: dv.getInt32(8 + i * 8, true), l: dv.getInt32(12 + i * 8, true) });
  const f32 = o => dv.getFloat32(o, true), i32 = o => dv.getInt32(o, true), b = { q3: true };
  b.entities = cstr(u8, L[0].o, L[0].l);
  let n = L[1].l / 72 | 0; b.shaders = [];
  for (let i = 0; i < n; i++) { const o = L[1].o + i * 72; b.shaders.push({ name: cstr(u8, o, 64).toLowerCase(), surf: i32(o + 64), cont: i32(o + 68) }); }
  n = L[2].l / 16 | 0; b.pn = new Float32Array(n * 3); b.pd = new Float32Array(n); b.pt = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const o = L[2].o + i * 16; const x = f32(o), y = f32(o + 4), z = f32(o + 8); b.pn[i * 3] = x; b.pn[i * 3 + 1] = y; b.pn[i * 3 + 2] = z; b.pd[i] = f32(o + 12); b.pt[i] = x === 1 ? 0 : y === 1 ? 1 : z === 1 ? 2 : 3; }
  n = L[3].l / 36 | 0; b.nodePlane = new Int32Array(n); b.nodeC0 = new Int32Array(n); b.nodeC1 = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[3].o + i * 36; b.nodePlane[i] = i32(o); b.nodeC0[i] = i32(o + 4); b.nodeC1[i] = i32(o + 8); }
  n = L[4].l / 48 | 0; b.leafFirstBrush = new Int32Array(n); b.leafNumBrush = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[4].o + i * 48; b.leafFirstBrush[i] = i32(o + 40); b.leafNumBrush[i] = i32(o + 44); }
  n = L[6].l / 4 | 0; b.leafBrushes = new Int32Array(n); for (let i = 0; i < n; i++) b.leafBrushes[i] = i32(L[6].o + i * 4);
  n = L[7].l / 40 | 0; b.models = [];
  for (let i = 0; i < n; i++) { const o = L[7].o + i * 40; b.models.push({ mins: [f32(o), f32(o + 4), f32(o + 8)], maxs: [f32(o + 12), f32(o + 16), f32(o + 20)], firstface: i32(o + 24), numfaces: i32(o + 28), firstbrush: i32(o + 32), numbrushes: i32(o + 36), headnode: i === 0 ? 0 : -1 }); }
  n = L[8].l / 12 | 0; b.brushFirstSide = new Int32Array(n); b.brushNumSides = new Int32Array(n); b.brushShader = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[8].o + i * 12; b.brushFirstSide[i] = i32(o); b.brushNumSides[i] = i32(o + 4); b.brushShader[i] = i32(o + 8); }
  n = L[9].l / 8 | 0; b.sidePlane = new Int32Array(n); b.sideShader = new Int32Array(n);
  for (let i = 0; i < n; i++) { const o = L[9].o + i * 8; b.sidePlane[i] = i32(o); b.sideShader[i] = i32(o + 4); }
  n = L[10].l / 44 | 0; b.vpos = new Float32Array(n * 3); b.vst = new Float32Array(n * 2); b.vlm = new Float32Array(n * 2); b.vnrm = new Float32Array(n * 3); b.vcol = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const o = L[10].o + i * 44; for (let k = 0; k < 3; k++) { b.vpos[i * 3 + k] = f32(o + k * 4); b.vnrm[i * 3 + k] = f32(o + 28 + k * 4); } b.vst[i * 2] = f32(o + 12); b.vst[i * 2 + 1] = f32(o + 16); b.vlm[i * 2] = f32(o + 20); b.vlm[i * 2 + 1] = f32(o + 24); for (let k = 0; k < 4; k++) b.vcol[i * 4 + k] = u8[o + 40 + k]; }
  n = L[11].l / 4 | 0; b.meshverts = new Int32Array(n); for (let i = 0; i < n; i++) b.meshverts[i] = i32(L[11].o + i * 4);
  n = L[13].l / 104 | 0; b.faces = [];
  for (let i = 0; i < n; i++) { const o = L[13].o + i * 104; b.faces.push({ shader: i32(o), type: i32(o + 8), vertex: i32(o + 12), nverts: i32(o + 16), meshvert: i32(o + 20), nmesh: i32(o + 24), lm: i32(o + 28), size: [i32(o + 96), i32(o + 100)] }); }
  b.lightmaps = u8.subarray(L[14].o, L[14].o + L[14].l); b.numLightmaps = L[14].l / (128 * 128 * 3) | 0;
  return b;
}
// biquadratic Bezier patch tessellation: returns grid of interpolated vertex attribute arrays
function tessPatch(ctrl, w, h, level, comps) { // ctrl: function(i)->array of floats per control point index (row-major w x h)
  const sx = (w - 1) / 2, sy = (h - 1) / 2, gw = sx * level + 1, gh = sy * level + 1, out = [];
  const q = (a, b, c, t) => { const u = 1 - t; return a.map((v, i) => u * u * v + 2 * u * t * b[i] + t * t * c[i]); };
  for (let py = 0; py < sy; py++) for (let px = 0; px < sx; px++) {
    const C = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) C.push(ctrl((py * 2 + j) * w + px * 2 + i));
    for (let y = 0; y <= level; y++) for (let x = 0; x <= level; x++) {
      const gx = px * level + x, gy = py * level + y, tx = x / level, ty = y / level;
      const r0 = q(C[0], C[1], C[2], tx), r1 = q(C[3], C[4], C[5], tx), r2 = q(C[6], C[7], C[8], tx);
      out[gy * gw + gx] = q(r0, r1, r2, ty);
    }
  }
  const idx = [];
  for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) { const a = y * gw + x, b2 = a + 1, c = a + gw, d = c + 1; idx.push(a, c, b2, b2, c, d); }
  return { verts: out, idx, gw, gh };
}
function cmFromQ3(b) {
  const nb = b.brushFirstSide.length, contents = new Int32Array(nb);
  for (let i = 0; i < nb; i++) { const sh = b.shaders[b.brushShader[i]]; contents[i] = sh ? sh.cont : 1; }
  const sideFlags = new Int32Array(b.sidePlane.length); for (let i = 0; i < sideFlags.length; i++) { const sh = b.shaders[b.sideShader[i]]; sideFlags[i] = sh ? sh.surf : 0; }
  // planes / brushes / sides are extended with patch facet brushes
  const pn = Array.from(b.pn), pd = Array.from(b.pd), pt = Array.from(b.pt), bfs = Array.from(b.brushFirstSide), bns = Array.from(b.brushNumSides), bc = Array.from(contents), sp = Array.from(b.sidePlane), sf = Array.from(sideFlags);
  const nLeaf = b.leafFirstBrush.length, lists = [];
  for (let l = 0; l < nLeaf; l++) { const a = []; for (let k = 0; k < b.leafNumBrush[l]; k++) a.push(b.leafBrushes[b.leafFirstBrush[l] + k]); lists.push(a); }
  const addPlane = (n, d) => { pn.push(n[0], n[1], n[2]); pd.push(d); pt.push(n[0] === 1 ? 0 : n[1] === 1 ? 1 : n[2] === 1 ? 2 : 3); return pd.length - 1; };
  const tmpCM = { pn: b.pn, pd: b.pd, pt: b.pt, nodePlane: b.nodePlane, nodeC0: b.nodeC0, nodeC1: b.nodeC1 };
  const patchBrush = (tri, cont, vn) => {
    let [A, B, C] = tri; let n = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
    if (normalize(n) < 1e-3) return;
    if (dot(n, vn) < 0) { n = [-n[0], -n[1], -n[2]]; }
    const d = dot(n, A), planes = [[n, d], [[-n[0], -n[1], -n[2]], -(d - 2)]];
    for (const [p, q2, r] of [[A, B, C], [B, C, A], [C, A, B]]) {
      const e = [q2[0] - p[0], q2[1] - p[1], q2[2] - p[2]]; let en = cross(e, n); if (normalize(en) < 1e-6) return;
      if (dot(en, [r[0] - p[0], r[1] - p[1], r[2] - p[2]]) > 0) en = [-en[0], -en[1], -en[2]];
      planes.push([en, dot(en, p)]);
    }
    const pts = [A, B, C, ...[A, B, C].map(v => [v[0] - n[0] * 2, v[1] - n[1] * 2, v[2] - n[2] * 2])], mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const v of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
    for (let k = 0; k < 3; k++) { const ax = [0, 0, 0]; ax[k] = 1; planes.push([ax, mx[k]]); const nx = [0, 0, 0]; nx[k] = -1; planes.push([nx, -mn[k]]); }
    const bi = bc.length; bfs.push(sp.length); bns.push(planes.length); bc.push(cont);
    for (const [pnv, pdv] of planes) { sp.push(addPlane(pnv, pdv)); sf.push(0); }
    const leafs = []; CM = tmpCM; boxLeafnums([mn[0] - 1, mn[1] - 1, mn[2] - 1], [mx[0] + 1, mx[1] + 1, mx[2] + 1], 0, leafs);
    for (const l of leafs) if (lists[l]) lists[l].push(bi);
  };
  const prevCM = CM;
  for (const f of b.faces) {
    if (f.type !== 2) continue; const sh = b.shaders[f.shader]; if (!sh || !(sh.cont & (CONTENTS_SOLID | CONTENTS_PLAYERCLIP))) continue;
    const t = tessPatch(i => { const v = f.vertex + i; return [b.vpos[v * 3], b.vpos[v * 3 + 1], b.vpos[v * 3 + 2], b.vnrm[v * 3], b.vnrm[v * 3 + 1], b.vnrm[v * 3 + 2]]; }, f.size[0], f.size[1], 4);
    for (let k = 0; k < t.idx.length; k += 3) { const a = t.verts[t.idx[k]], bb = t.verts[t.idx[k + 1]], c = t.verts[t.idx[k + 2]]; patchBrush([a.slice(0, 3), bb.slice(0, 3), c.slice(0, 3)], sh.cont, [a[3] + bb[3] + c[3], a[4] + bb[4] + c[4], a[5] + bb[5] + c[5]]); }
  }
  // submodels get their own leaf holding their brushes
  const modelHeads = [0];
  for (let i = 1; i < b.models.length; i++) { const m = b.models[i], a = []; for (let k = 0; k < m.numbrushes; k++) a.push(m.firstbrush + k); lists.push(a); modelHeads.push(-lists.length); }
  CM = prevCM;
  const leafFirstBrush = new Int32Array(lists.length), leafNumBrush = new Int32Array(lists.length), leafContents = new Int32Array(lists.length), flat = [];
  lists.forEach((a, l) => { leafFirstBrush[l] = flat.length; leafNumBrush[l] = a.length; let c = 0; for (const bi of a) { flat.push(bi); c |= bc[bi]; } leafContents[l] = c; });
  return {
    demo: false, q3: true, pn: Float32Array.from(pn), pd: Float32Array.from(pd), pt: Uint8Array.from(pt), nodePlane: b.nodePlane, nodeC0: b.nodeC0, nodeC1: b.nodeC1,
    leafContents, leafFirstBrush, leafNumBrush, leafBrushes: Int32Array.from(flat), brushFirstSide: Int32Array.from(bfs), brushNumSides: Int32Array.from(bns), brushContents: Int32Array.from(bc),
    sidePlane: Int32Array.from(sp), sideFlags: Int32Array.from(sf), checkcount: new Int32Array(bc.length), worldHead: 0, solids: [], boxes: [], modelHeads
  };
}

// ---------------- collision model ----------------
let CM = null;
function cmFromBSP(b) {
  const sideFlags = new Int32Array(b.sidePlane.length);
  for (let i = 0; i < sideFlags.length; i++) { const t = b.texinfo[b.sideTex[i]]; sideFlags[i] = t ? t.flags : 0; }
  return {
    demo: false, pn: b.pn, pd: b.pd, pt: b.pt, nodePlane: b.nodePlane, nodeC0: b.nodeC0, nodeC1: b.nodeC1,
    leafContents: b.leafContents, leafFirstBrush: b.leafFirstBrush, leafNumBrush: b.leafNumBrush, leafBrushes: b.leafBrushes,
    brushFirstSide: b.brushFirstSide, brushNumSides: b.brushNumSides, brushContents: b.brushContents,
    sidePlane: b.sidePlane, sideFlags, checkcount: new Int32Array(b.brushContents.length),
    worldHead: b.models[0].headnode, solids: [], boxes: []
  };
}
function cmFromBrushes(brushes) {
  let np = 0; for (const br of brushes) np += br.planes.length;
  const pn = new Float32Array(np * 3), pd = new Float32Array(np), pt = new Uint8Array(np);
  const nb = brushes.length, bfs = new Int32Array(nb), bns = new Int32Array(nb), bc = new Int32Array(nb), sp = new Int32Array(np);
  let k = 0, all = 0;
  brushes.forEach((br, i) => {
    bfs[i] = k; bns[i] = br.planes.length; bc[i] = br.contents; all |= br.contents;
    for (const p of br.planes) {
      pn[k * 3] = p.n[0]; pn[k * 3 + 1] = p.n[1]; pn[k * 3 + 2] = p.n[2]; pd[k] = p.d;
      pt[k] = Math.abs(p.n[0]) === 1 ? 0 : Math.abs(p.n[1]) === 1 ? 1 : Math.abs(p.n[2]) === 1 ? 2 : 3;
      sp[k] = k; k++;
    }
  });
  const lb = new Int32Array(nb); for (let i = 0; i < nb; i++) lb[i] = i;
  return {
    demo: true, pn, pd, pt, nodePlane: new Int32Array(0), nodeC0: new Int32Array(0), nodeC1: new Int32Array(0),
    leafContents: Int32Array.of(all), leafFirstBrush: Int32Array.of(0), leafNumBrush: Int32Array.of(nb), leafBrushes: lb,
    brushFirstSide: bfs, brushNumSides: bns, brushContents: bc, sidePlane: sp, sideFlags: new Int32Array(np),
    checkcount: new Int32Array(nb), worldHead: -1, solids: [], boxes: []
  };
}

const DIST_EPSILON = 0.03125;
const tS = [0, 0, 0], tE = [0, 0, 0], tMin = [0, 0, 0], tMax = [0, 0, 0], tExt = [0, 0, 0];
let tPoint = false, tMask = 0, tCount = 0, TR = null;
function newTrace() { return { fraction: 1, allsolid: false, startsolid: false, normal: [0, 0, 0], dist: 0, contents: 0, surf: 0, endpos: [0, 0, 0] }; }

function clipBoxToBrush(b) {
  const cm = CM, ns = cm.brushNumSides[b]; if (!ns) return;
  const fs = cm.brushFirstSide[b];
  let enterfrac = -1, leavefrac = 1, clip = -1, lead = -1, getout = false, startout = false;
  for (let i = 0; i < ns; i++) {
    const side = fs + i, pl = cm.sidePlane[side], nx = cm.pn[pl * 3], ny = cm.pn[pl * 3 + 1], nz = cm.pn[pl * 3 + 2];
    let dist;
    if (!tPoint) {
      const ox = nx < 0 ? tMax[0] : tMin[0], oy = ny < 0 ? tMax[1] : tMin[1], oz = nz < 0 ? tMax[2] : tMin[2];
      dist = cm.pd[pl] - (ox * nx + oy * ny + oz * nz);
    } else dist = cm.pd[pl];
    const d1 = tS[0] * nx + tS[1] * ny + tS[2] * nz - dist, d2 = tE[0] * nx + tE[1] * ny + tE[2] * nz - dist;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    if (d1 > 0 && d2 >= d1) return;
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) { const f = (d1 - DIST_EPSILON) / (d1 - d2); if (f > enterfrac) { enterfrac = f; clip = pl; lead = side; } }
    else { const f = (d1 + DIST_EPSILON) / (d1 - d2); if (f < leavefrac) leavefrac = f; }
  }
  if (!startout) { TR.startsolid = true; if (!getout) TR.allsolid = true; return; }
  if (enterfrac < leavefrac && enterfrac > -1 && enterfrac < TR.fraction) {
    if (enterfrac < 0) enterfrac = 0;
    TR.fraction = enterfrac;
    TR.normal = [cm.pn[clip * 3], cm.pn[clip * 3 + 1], cm.pn[clip * 3 + 2]]; TR.dist = cm.pd[clip];
    TR.surf = cm.sideFlags[lead]; TR.contents = cm.brushContents[b];
  }
}
function testBoxInBrush(b) {
  const cm = CM, ns = cm.brushNumSides[b]; if (!ns) return;
  const fs = cm.brushFirstSide[b];
  for (let i = 0; i < ns; i++) {
    const pl = cm.sidePlane[fs + i], nx = cm.pn[pl * 3], ny = cm.pn[pl * 3 + 1], nz = cm.pn[pl * 3 + 2];
    const ox = nx < 0 ? tMax[0] : tMin[0], oy = ny < 0 ? tMax[1] : tMin[1], oz = nz < 0 ? tMax[2] : tMin[2];
    const dist = cm.pd[pl] - (ox * nx + oy * ny + oz * nz);
    if (tS[0] * nx + tS[1] * ny + tS[2] * nz - dist > 0) return;
  }
  TR.startsolid = TR.allsolid = true; TR.fraction = 0; TR.contents = cm.brushContents[b];
}
function leafBrushLoop(leaf, fn, stopAllSolid) {
  const cm = CM; if (!(cm.leafContents[leaf] & tMask)) return;
  const f = cm.leafFirstBrush[leaf], n = cm.leafNumBrush[leaf];
  for (let k = 0; k < n; k++) {
    const b = cm.leafBrushes[f + k];
    if (cm.checkcount[b] === tCount) continue; cm.checkcount[b] = tCount;
    if (!(cm.brushContents[b] & tMask)) continue;
    fn(b);
    if (stopAllSolid ? TR.allsolid : !TR.fraction) return;
  }
}
function rhc(num, p1f, p2f, ax, ay, az, bx, by, bz) {
  if (TR.fraction <= p1f) return;
  if (num < 0) { leafBrushLoop(-1 - num, clipBoxToBrush, false); return; }
  const cm = CM, pl = cm.nodePlane[num], type = cm.pt[pl], d = cm.pd[pl];
  let t1, t2, offset;
  if (type < 3) {
    t1 = (type === 0 ? ax : type === 1 ? ay : az) - d; t2 = (type === 0 ? bx : type === 1 ? by : bz) - d; offset = tExt[type];
  } else {
    const nx = cm.pn[pl * 3], ny = cm.pn[pl * 3 + 1], nz = cm.pn[pl * 3 + 2];
    t1 = nx * ax + ny * ay + nz * az - d; t2 = nx * bx + ny * by + nz * bz - d;
    offset = tPoint ? 0 : Math.abs(tExt[0] * nx) + Math.abs(tExt[1] * ny) + Math.abs(tExt[2] * nz);
  }
  if (t1 >= offset && t2 >= offset) { rhc(cm.nodeC0[num], p1f, p2f, ax, ay, az, bx, by, bz); return; }
  if (t1 < -offset && t2 < -offset) { rhc(cm.nodeC1[num], p1f, p2f, ax, ay, az, bx, by, bz); return; }
  let side, frac, frac2;
  if (t1 < t2) { const id = 1 / (t1 - t2); side = 1; frac2 = (t1 + offset + DIST_EPSILON) * id; frac = (t1 - offset + DIST_EPSILON) * id; }
  else if (t1 > t2) { const id = 1 / (t1 - t2); side = 0; frac2 = (t1 - offset - DIST_EPSILON) * id; frac = (t1 + offset + DIST_EPSILON) * id; }
  else { side = 0; frac = 1; frac2 = 0; }
  if (frac < 0) frac = 0; if (frac > 1) frac = 1;
  let midf = p1f + (p2f - p1f) * frac;
  rhc(side ? cm.nodeC1[num] : cm.nodeC0[num], p1f, midf, ax, ay, az, ax + frac * (bx - ax), ay + frac * (by - ay), az + frac * (bz - az));
  if (frac2 < 0) frac2 = 0; if (frac2 > 1) frac2 = 1;
  midf = p1f + (p2f - p1f) * frac2;
  rhc(side ? cm.nodeC0[num] : cm.nodeC1[num], midf, p2f, ax + frac2 * (bx - ax), ay + frac2 * (by - ay), az + frac2 * (bz - az), bx, by, bz);
}
function boxOnPlaneSide(mins, maxs, pl) {
  const cm = CM; let d1 = 0, d2 = 0;
  for (let i = 0; i < 3; i++) { const n = cm.pn[pl * 3 + i]; if (n >= 0) { d1 += n * maxs[i]; d2 += n * mins[i]; } else { d1 += n * mins[i]; d2 += n * maxs[i]; } }
  let s = 0; if (d1 >= cm.pd[pl]) s = 1; if (d2 < cm.pd[pl]) s |= 2; return s;
}
function boxLeafnums(mins, maxs, node, list) {
  const cm = CM;
  for (;;) {
    if (node < 0) { list.push(-1 - node); return; }
    const s = boxOnPlaneSide(mins, maxs, cm.nodePlane[node]);
    if (s === 1) node = cm.nodeC0[node]; else if (s === 2) node = cm.nodeC1[node];
    else { boxLeafnums(mins, maxs, cm.nodeC0[node], list); node = cm.nodeC1[node]; }
  }
}
function boxTrace(start, end, mins, maxs, mask, head) {
  TR = newTrace(); tCount++; tMask = mask;
  for (let i = 0; i < 3; i++) { tS[i] = start[i]; tE[i] = end[i]; tMin[i] = mins[i]; tMax[i] = maxs[i]; tExt[i] = Math.max(-mins[i], maxs[i]); }
  tPoint = !(mins[0] || mins[1] || mins[2] || maxs[0] || maxs[1] || maxs[2]);
  if (start[0] === end[0] && start[1] === end[1] && start[2] === end[2]) {
    const list = [];
    boxLeafnums([start[0] + mins[0] - 1, start[1] + mins[1] - 1, start[2] + mins[2] - 1], [start[0] + maxs[0] + 1, start[1] + maxs[1] + 1, start[2] + maxs[2] + 1], head, list);
    for (const l of list) { leafBrushLoop(l, testBoxInBrush, true); if (TR.allsolid) break; }
    TR.endpos = [start[0], start[1], start[2]];
    return TR;
  }
  rhc(head, 0, 1, start[0], start[1], start[2], end[0], end[1], end[2]);
  if (TR.fraction === 1) TR.endpos = [end[0], end[1], end[2]];
  else { const f = TR.fraction; TR.endpos = [start[0] + f * (end[0] - start[0]), start[1] + f * (end[1] - start[1]), start[2] + f * (end[2] - start[2])]; }
  return TR;
}
// SV_Trace: world first, then solid brush entities (translated by their current origin)
function trace(start, mins, maxs, end, mask, noBoxes) {
  if (mask === undefined) mask = MASK_PLAYERSOLID;
  let t = boxTrace(start, end, mins, maxs, mask, CM.worldHead); t.ent = -1; t.hit = null;
  if (t.fraction !== 0) {
    const sol = CM.solids;
    const lo = [0, 1, 2].map(i => Math.min(start[i], end[i]) + mins[i] - 1), hi = [0, 1, 2].map(i => Math.max(start[i], end[i]) + maxs[i] + 1);
    for (let i = 0; i < sol.length; i++) {
      const s = sol[i]; if (!s.active) continue;
      const o = s.o;
      if (lo[0] > s.maxs[0] + o[0] || hi[0] < s.mins[0] + o[0] || lo[1] > s.maxs[1] + o[1] || hi[1] < s.mins[1] + o[1] || lo[2] > s.maxs[2] + o[2] || hi[2] < s.mins[2] + o[2]) continue;
      const t2 = boxTrace([start[0] - o[0], start[1] - o[1], start[2] - o[2]], [end[0] - o[0], end[1] - o[1], end[2] - o[2]], mins, maxs, mask, s.head);
      t2.ent = i; t2.hit = s.ent;
      if (t2.allsolid || t2.startsolid || t2.fraction < t.fraction) { if (t.startsolid) { t = t2; t.startsolid = true; } else t = t2; }
      else if (t2.startsolid) t.startsolid = true;
    }
    const bx = noBoxes ? [] : (CM.boxes || []);
    for (let i = 0; i < bx.length; i++) {
      const b = bx[i]; if (!b.active || !(mask & (b.dead ? CONTENTS_DEADMONSTER : CONTENTS_SOLID | CONTENTS_MONSTER))) continue;
      if (lo[0] > b.maxs[0] || hi[0] < b.mins[0] || lo[1] > b.maxs[1] || hi[1] < b.mins[1] || lo[2] > b.maxs[2] || hi[2] < b.mins[2]) continue;
      const r = clipAABB(start, end, mins, maxs, b.mins, b.maxs); if (!r) continue;
      const t2 = newTrace(); t2.fraction = r.f; t2.normal = r.n; t2.startsolid = r.ss; t2.allsolid = r.as; t2.contents = CONTENTS_SOLID; t2.ent = -3; t2.hit = b.ent;
      if (t2.allsolid || t2.startsolid || t2.fraction < t.fraction) { if (t.startsolid) { t = t2; t.startsolid = true; } else t = t2; }
      else if (t2.startsolid) t.startsolid = true;
    }
  }
  const f = t.fraction;
  t.endpos = f === 1 ? [end[0], end[1], end[2]] : [start[0] + f * (end[0] - start[0]), start[1] + f * (end[1] - start[1]), start[2] + f * (end[2] - start[2])];
  return t;
}
// axis-aligned box entity (barrels): same enter/leave logic as CM_ClipBoxToBrush with 6 axial planes
function clipAABB(st, en, mins, maxs, bmin, bmax) {
  let enter = -1, leave = 1, n = -1, getout = false, startout = false;
  for (let i = 0; i < 3; i++) for (let sg = 1; sg >= -1; sg -= 2) {
    const dist = sg > 0 ? bmax[i] - mins[i] : -bmin[i] + maxs[i];
    const d1 = sg * st[i] - dist, d2 = sg * en[i] - dist;
    if (d2 > 0) getout = true; if (d1 > 0) startout = true;
    if (d1 > 0 && d2 >= d1) return null;
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) { const f = (d1 - DIST_EPSILON) / (d1 - d2); if (f > enter) { enter = f; n = i * 2 + (sg > 0 ? 0 : 1); } }
    else { const f = (d1 + DIST_EPSILON) / (d1 - d2); if (f < leave) leave = f; }
  }
  if (!startout) return { f: 1, n: [0, 0, 0], ss: true, as: !getout };
  if (enter < leave && enter > -1) { const nn = [0, 0, 0]; nn[n >> 1] = (n & 1) ? -1 : 1; return { f: Math.max(0, enter), n: nn, ss: false, as: false }; }
  return null;
}
function testSolid(i, p, mins, maxs) {
  const s = CM.solids[i], q = [p[0] - s.o[0], p[1] - s.o[1], p[2] - s.o[2]];
  const t = boxTrace(q, q, mins, maxs, MASK_PLAYERSOLID, s.head);
  return t.allsolid || t.startsolid;
}
function pointContents(p) {
  const cm = CM; if (!cm) return 0;
  if (cm.demo) {
    let c = 0;
    for (let b = 0; b < cm.brushContents.length; b++) {
      const fs = cm.brushFirstSide[b], ns = cm.brushNumSides[b]; let inside = true;
      for (let i = 0; i < ns; i++) { const pl = cm.sidePlane[fs + i]; if (p[0] * cm.pn[pl * 3] + p[1] * cm.pn[pl * 3 + 1] + p[2] * cm.pn[pl * 3 + 2] - cm.pd[pl] > 0) { inside = false; break; } }
      if (inside) c |= cm.brushContents[b];
    }
    return c;
  }
  let num = cm.worldHead;
  if (cm.q3) {
    while (num >= 0) { const pl = cm.nodePlane[num], t = cm.pt[pl]; const d = (t < 3 ? p[t] : p[0] * cm.pn[pl * 3] + p[1] * cm.pn[pl * 3 + 1] + p[2] * cm.pn[pl * 3 + 2]) - cm.pd[pl]; num = d < 0 ? cm.nodeC1[num] : cm.nodeC0[num]; }
    const leaf = -1 - num, f = cm.leafFirstBrush[leaf], n = cm.leafNumBrush[leaf]; let c = 0;
    for (let k = 0; k < n; k++) {
      const bi = cm.leafBrushes[f + k], fs = cm.brushFirstSide[bi], ns = cm.brushNumSides[bi]; let inside = true;
      for (let i = 0; i < ns; i++) { const pl = cm.sidePlane[fs + i]; if (p[0] * cm.pn[pl * 3] + p[1] * cm.pn[pl * 3 + 1] + p[2] * cm.pn[pl * 3 + 2] - cm.pd[pl] > 0) { inside = false; break; } }
      if (inside) c |= cm.brushContents[bi];
    }
    return c;
  }
  while (num >= 0) {
    const pl = cm.nodePlane[num], t = cm.pt[pl];
    const d = (t < 3 ? p[t] : p[0] * cm.pn[pl * 3] + p[1] * cm.pn[pl * 3 + 1] + p[2] * cm.pn[pl * 3 + 2]) - cm.pd[pl];
    num = d < 0 ? cm.nodeC1[num] : cm.nodeC0[num];
  }
  return cm.leafContents[-1 - num];
}

// ---------------- pmove (port of qcommon/pmove.c) ----------------
const pm_stopspeed = 100, pm_maxspeed = 300, pm_duckspeed = 100, pm_accelerate = 10, pm_wateraccelerate = 10, pm_friction = 6, pm_waterfriction = 1;
const STEPSIZE = 18, MIN_STEP_NORMAL = 0.7, STOP_EPSILON = 0.1;
const ps = { origin: [0, 0, 0], velocity: [0, 0, 0], flags: 0, time: 0, gravity: 800, noclip: false };
const pm = { cmd: { msec: 8, forwardmove: 0, sidemove: 0, upmove: 0 }, viewangles: [0, 0, 0], angles: [0, 0, 0], mins: [-16, -16, -24], maxs: [16, 16, 32], viewheight: 22, ground: false, waterlevel: 0, watertype: 0 };
const pml = { origin: [0, 0, 0], velocity: [0, 0, 0], forward: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], frametime: 0, groundSurf: 0, ladder: false, prev: [0, 0, 0] };
const ptrace = (s, e) => trace(s, pm.mins, pm.maxs, e);

function clipVelocity(inv, n, out, overbounce) {
  const backoff = dot(inv, n) * overbounce;
  for (let i = 0; i < 3; i++) { const c = inv[i] - n[i] * backoff; out[i] = (c > -STOP_EPSILON && c < STOP_EPSILON) ? 0 : c; }
}
function stepSlideMove_() {
  const planes = [], primal = pml.velocity.slice(), end = [0, 0, 0]; let time_left = pml.frametime;
  for (let bump = 0; bump < 4; bump++) {
    for (let i = 0; i < 3; i++) end[i] = pml.origin[i] + time_left * pml.velocity[i];
    const t = ptrace(pml.origin, end);
    if (t.allsolid) { pml.velocity[2] = 0; return; }
    if (t.fraction > 0) { pml.origin = t.endpos.slice(); planes.length = 0; }
    if (t.fraction === 1) break;
    time_left -= time_left * t.fraction;
    if (planes.length >= 5) { pml.velocity = [0, 0, 0]; break; }
    planes.push(t.normal.slice());
    let i;
    for (i = 0; i < planes.length; i++) {
      clipVelocity(pml.velocity, planes[i], pml.velocity, 1.01);
      let j; for (j = 0; j < planes.length; j++) if (j !== i && dot(pml.velocity, planes[j]) < 0) break;
      if (j === planes.length) break;
    }
    if (i === planes.length) {
      if (planes.length !== 2) { pml.velocity = [0, 0, 0]; break; }
      const dir = cross(planes[0], planes[1]), d = dot(dir, pml.velocity);
      pml.velocity = [dir[0] * d, dir[1] * d, dir[2] * d];
    }
    if (dot(pml.velocity, primal) <= 0) { pml.velocity = [0, 0, 0]; break; }
  }
  if (ps.time) pml.velocity = primal;
}
function stepSlideMove() {
  const start_o = pml.origin.slice(), start_v = pml.velocity.slice();
  stepSlideMove_();
  const down_o = pml.origin.slice(), down_v = pml.velocity.slice();
  const up = start_o.slice(); up[2] += STEPSIZE;
  let t = ptrace(up, up);
  if (t.allsolid) return;
  pml.origin = up; pml.velocity = start_v.slice();
  stepSlideMove_();
  const down = pml.origin.slice(); down[2] -= STEPSIZE;
  t = ptrace(pml.origin, down);
  if (!t.allsolid) pml.origin = t.endpos.slice();
  const upo = pml.origin;
  const down_dist = (down_o[0] - start_o[0]) ** 2 + (down_o[1] - start_o[1]) ** 2;
  const up_dist = (upo[0] - start_o[0]) ** 2 + (upo[1] - start_o[1]) ** 2;
  if (down_dist > up_dist || t.normal[2] < MIN_STEP_NORMAL) { pml.origin = down_o; pml.velocity = down_v; return; }
  pml.velocity[2] = down_v[2];
}
function friction() {
  const vel = pml.velocity, speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
  if (speed < 1) { vel[0] = 0; vel[1] = 0; return; }
  let drop = 0;
  if ((pm.ground && !(pml.groundSurf & SURF_SLICK)) || pml.ladder) {
    const control = speed < pm_stopspeed ? pm_stopspeed : speed;
    drop += control * pm_friction * pml.frametime;
  }
  if (pm.waterlevel && !pml.ladder) drop += speed * pm_waterfriction * pm.waterlevel * pml.frametime;
  let ns = speed - drop; if (ns < 0) ns = 0; ns /= speed;
  vel[0] *= ns; vel[1] *= ns; vel[2] *= ns;
}
function accelerate(wishdir, wishspeed, accel) {
  const add = wishspeed - dot(pml.velocity, wishdir); if (add <= 0) return;
  let as = accel * pml.frametime * wishspeed; if (as > add) as = add;
  for (let i = 0; i < 3; i++) pml.velocity[i] += as * wishdir[i];
}
function addCurrents(w) {
  if (pml.ladder && Math.abs(pml.velocity[2]) <= 200) {
    const c = pm.cmd, p = pm.viewangles[0];
    if (p <= -15 && c.forwardmove > 0) w[2] = 200;
    else if (p >= 15 && c.forwardmove > 0) w[2] = -200;
    else if (c.upmove > 0) w[2] = 200;
    else if (c.upmove < 0) w[2] = -200;
    else w[2] = 0;
    for (let i = 0; i < 2; i++) { if (w[i] < -25) w[i] = -25; else if (w[i] > 25) w[i] = 25; }
  }
}
function waterMove() {
  const c = pm.cmd, w = [0, 0, 0];
  for (let i = 0; i < 3; i++) w[i] = pml.forward[i] * c.forwardmove + pml.right[i] * c.sidemove;
  if (!c.forwardmove && !c.sidemove && !c.upmove) w[2] -= 60; else w[2] += c.upmove;
  addCurrents(w);
  const wishdir = w.slice(); let wishspeed = normalize(wishdir);
  if (wishspeed > pm_maxspeed) wishspeed = pm_maxspeed;
  wishspeed *= 0.5;
  accelerate(wishdir, wishspeed, pm_wateraccelerate);
  stepSlideMove();
}
function airMove() {
  const fm = pm.cmd.forwardmove, sm = pm.cmd.sidemove;
  const w = [pml.forward[0] * fm + pml.right[0] * sm, pml.forward[1] * fm + pml.right[1] * sm, 0];
  addCurrents(w);
  const wishdir = w.slice(); let wishspeed = normalize(wishdir);
  const maxspeed = (ps.flags & PMF_DUCKED) ? pm_duckspeed : pm_maxspeed;
  if (wishspeed > maxspeed) { const s = maxspeed / wishspeed; w[0] *= s; w[1] *= s; w[2] *= s; wishspeed = maxspeed; }
  if (pml.ladder) {
    accelerate(wishdir, wishspeed, pm_accelerate);
    if (!w[2]) {
      if (pml.velocity[2] > 0) { pml.velocity[2] -= ps.gravity * pml.frametime; if (pml.velocity[2] < 0) pml.velocity[2] = 0; }
      else { pml.velocity[2] += ps.gravity * pml.frametime; if (pml.velocity[2] > 0) pml.velocity[2] = 0; }
    }
    stepSlideMove();
  } else if (pm.ground) {
    pml.velocity[2] = 0;
    accelerate(wishdir, wishspeed, pm_accelerate);
    if (ps.gravity > 0) pml.velocity[2] = 0; else pml.velocity[2] -= ps.gravity * pml.frametime;
    if (!pml.velocity[0] && !pml.velocity[1]) return;
    stepSlideMove();
  } else {
    accelerate(wishdir, wishspeed, 1); // pm_airaccelerate 0 -> PM_Accelerate(.., 1)
    pml.velocity[2] -= ps.gravity * pml.frametime;
    stepSlideMove();
  }
}
function categorizePosition() {
  const point = [pml.origin[0], pml.origin[1], pml.origin[2] - 0.25];
  pm.groundEnt = -2;
  if (pml.velocity[2] > 180) { ps.flags &= ~PMF_ON_GROUND; pm.ground = false; }
  else {
    const t = ptrace(pml.origin, point);
    pml.groundSurf = t.surf;
    if (t.normal[2] < 0.7 && !t.startsolid) { pm.ground = false; ps.flags &= ~PMF_ON_GROUND; }
    else {
      pm.ground = true; pm.groundEnt = t.ent;
      if (ps.flags & PMF_TIME_WATERJUMP) { ps.flags &= ~PMF_TIME_WATERJUMP; ps.time = 0; }
      if (!(ps.flags & PMF_ON_GROUND)) {
        ps.flags |= PMF_ON_GROUND;
        if (pml.velocity[2] < -200) { ps.flags |= PMF_TIME_LAND; ps.time = pml.velocity[2] < -400 ? 25 : 18; }
      }
    }
  }
  pm.waterlevel = 0; pm.watertype = 0;
  const sample2 = pm.viewheight - pm.mins[2], sample1 = sample2 / 2;
  point[2] = pml.origin[2] + pm.mins[2] + 1;
  let cont = pointContents(point);
  if (cont & MASK_WATER) {
    pm.watertype = cont; pm.waterlevel = 1;
    point[2] = pml.origin[2] + pm.mins[2] + sample1; cont = pointContents(point);
    if (cont & MASK_WATER) {
      pm.waterlevel = 2; point[2] = pml.origin[2] + pm.mins[2] + sample2; cont = pointContents(point);
      if (cont & MASK_WATER) pm.waterlevel = 3;
    }
  }
}
function checkJump() {
  if (ps.flags & PMF_TIME_LAND) return;
  if (pm.cmd.upmove < 10) { ps.flags &= ~PMF_JUMP_HELD; return; }
  if (ps.flags & PMF_JUMP_HELD) return;
  if (pm.waterlevel >= 2) {
    pm.ground = false;
    if (pml.velocity[2] <= -300) return;
    pml.velocity[2] = pm.watertype === CONTENTS_WATER ? 100 : pm.watertype === CONTENTS_SLIME ? 80 : 50;
    return;
  }
  if (!pm.ground) return;
  ps.flags |= PMF_JUMP_HELD; pm.ground = false;
  pml.velocity[2] += 270; if (pml.velocity[2] < 270) pml.velocity[2] = 270;
  pm.jumped = true;
}
function checkSpecialMovement() {
  if (ps.time) return;
  pml.ladder = false;
  const flat = [pml.forward[0], pml.forward[1], 0]; normalize(flat);
  const spot = [pml.origin[0] + flat[0], pml.origin[1] + flat[1], pml.origin[2]];
  const t = ptrace(pml.origin, spot);
  if (t.fraction < 1 && (t.contents & CONTENTS_LADDER)) pml.ladder = true;
  // check for water jump: standing at chest depth against a ledge, with open air above it, kicks you out of the water
  if (pm.waterlevel !== 2) return;
  const sp = [pml.origin[0] + 30 * flat[0], pml.origin[1] + 30 * flat[1], pml.origin[2] + 4];
  if (!(pointContents(sp) & CONTENTS_SOLID)) return;
  sp[2] += 16;
  if (pointContents(sp)) return;
  pml.velocity[0] = flat[0] * 50; pml.velocity[1] = flat[1] * 50; pml.velocity[2] = 350;
  ps.flags |= PMF_TIME_WATERJUMP; ps.time = 255;
}
function flyMove() {
  pm.viewheight = 22;
  const v = pml.velocity, speed = Math.hypot(v[0], v[1], v[2]);
  if (speed < 1) { v[0] = v[1] = v[2] = 0; }
  else { let ns = speed - Math.max(speed, pm_stopspeed) * pm_friction * 1.5 * pml.frametime; if (ns < 0) ns = 0; ns /= speed; v[0] *= ns; v[1] *= ns; v[2] *= ns; }
  const f = pml.forward.slice(), r = pml.right.slice(); normalize(f); normalize(r);
  const c = pm.cmd, w = [0, 0, 0];
  for (let i = 0; i < 3; i++) w[i] = f[i] * c.forwardmove * 1.5 + r[i] * c.sidemove * 1.5;
  w[2] += c.upmove * 1.5;
  const wishdir = w.slice(), wishspeed = normalize(wishdir);
  const add = wishspeed - dot(v, wishdir);
  if (add > 0) { let as = pm_accelerate * pml.frametime * wishspeed; if (as > add) as = add; for (let i = 0; i < 3; i++) v[i] += as * wishdir[i]; }
  for (let i = 0; i < 3; i++) pml.origin[i] += pml.frametime * v[i];
}
function checkDuck() {
  pm.mins[0] = -16; pm.mins[1] = -16; pm.maxs[0] = 16; pm.maxs[1] = 16; pm.mins[2] = -24;
  if (pm.cmd.upmove < 0 && (ps.flags & PMF_ON_GROUND)) ps.flags |= PMF_DUCKED;
  else if (ps.flags & PMF_DUCKED) {
    pm.maxs[2] = 32;
    const t = ptrace(pml.origin, pml.origin);
    if (!t.allsolid) ps.flags &= ~PMF_DUCKED;
  }
  if (ps.flags & PMF_DUCKED) { pm.maxs[2] = 4; pm.viewheight = -2; } else { pm.maxs[2] = 32; pm.viewheight = 22; }
}
function goodPosition() {
  if (ps.noclip) return true;
  const o = [ps.origin[0] * 0.125, ps.origin[1] * 0.125, ps.origin[2] * 0.125];
  return !ptrace(o, o).allsolid;
}
const jitterbits = [0, 4, 1, 2, 3, 5, 6, 7];
const clampShort = v => v > 32767 ? 32767 : v < -32768 ? -32768 : v;
function snapPosition() {
  for (let i = 0; i < 3; i++) ps.velocity[i] = clampShort(Math.trunc(pml.velocity[i] * 8));
  const sign = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    sign[i] = pml.origin[i] >= 0 ? 1 : -1;
    ps.origin[i] = clampShort(Math.trunc(pml.origin[i] * 8));
    if (ps.origin[i] * 0.125 === pml.origin[i]) sign[i] = 0;
  }
  const base = ps.origin.slice();
  for (let j = 0; j < 8; j++) {
    const bits = jitterbits[j];
    for (let i = 0; i < 3; i++) ps.origin[i] = base[i] + ((bits & (1 << i)) ? sign[i] : 0);
    if (goodPosition()) return;
  }
  ps.origin = pml.prev.slice();
}
function initialSnapPosition() {
  const off = [0, -1, 1], base = ps.origin.slice();
  for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    ps.origin = [base[0] + off[x], base[1] + off[y], base[2] + off[z]];
    if (goodPosition()) return true;
  }
  ps.origin = base; return false;
}
function angle2short(a) { return ((Math.trunc(a * 65536 / 360) & 65535) << 16) >> 16; }
function clampAngles() {
  for (let i = 0; i < 3; i++) pm.viewangles[i] = angle2short(pm.angles[i]) * (360 / 65536);
  if (pm.viewangles[0] > 89 && pm.viewangles[0] < 180) pm.viewangles[0] = 89;
  else if (pm.viewangles[0] < 271 && pm.viewangles[0] >= 180) pm.viewangles[0] = 271;
  angleVectors(pm.viewangles, pml.forward, pml.right, pml.up);
}

// ---------------- Quake III pmove (port of game/bg_pmove.c + bg_slidemove.c) ----------------
// Selected with pm.q3. Same playerstate (origin/velocity in 1/8 units, flags, time in 8 ms units) so the game code is shared,
// but the origin is kept as floats and the velocity is snapped to whole units every frame, as Q3 does (SnapVector).
const q3 = { speed: 320, stopspeed: 100, duckScale: .25, swimScale: .5, accelerate: 10, airaccelerate: 1, wateraccelerate: 4, friction: 6, waterfriction: 1, jump: 270, overclip: 1.001 };
const q3l = { walking: false, groundPlane: false, gnormal: [0, 0, 1], gsurf: 0, impactSpeed: 0, prevVz: 0 };
function q3Clip(inv, n, out, ob) { let b = dot(inv, n); b = b < 0 ? b * ob : b / ob; for (let i = 0; i < 3; i++) out[i] = inv[i] - n[i] * b; }
function q3CmdScale() { // cmd values are Q2-style (+-400 run, +-200 walk); Q3 uses +-127
  const f = pm.cmd.forwardmove * 127 / 400, s = pm.cmd.sidemove * 127 / 400, u = pm.cmd.upmove * 127 / 400;
  let max = Math.abs(f); if (Math.abs(s) > max) max = Math.abs(s); if (Math.abs(u) > max) max = Math.abs(u); if (!max) return 0;
  return q3.speed * max / (127 * Math.sqrt(f * f + s * s + u * u)) * (127 / 400);
}
function q3Friction() {
  const v = pml.velocity, vec = v.slice(); if (q3l.walking) vec[2] = 0;
  const speed = Math.hypot(vec[0], vec[1], vec[2]); if (speed < 1) { v[0] = 0; v[1] = 0; return; }
  let drop = 0;
  if (pm.waterlevel <= 1 && q3l.walking && !(q3l.gsurf & SURF_SLICK)) drop += Math.max(speed, q3.stopspeed) * q3.friction * pml.frametime;
  if (pm.waterlevel && !pml.ladder) drop += speed * q3.waterfriction * pm.waterlevel * pml.frametime;
  if (pml.ladder) drop += Math.max(speed, q3.stopspeed) * q3.friction * pml.frametime;
  let ns = speed - drop; if (ns < 0) ns = 0; ns /= speed; v[0] *= ns; v[1] *= ns; v[2] *= ns;
}
function q3SlideMove(gravity) {
  const v = pml.velocity, primal = v.slice(), planes = []; let endV = null;
  if (gravity) { endV = v.slice(); endV[2] -= ps.gravity * pml.frametime; v[2] = (v[2] + endV[2]) * .5; primal[2] = endV[2]; if (q3l.groundPlane) q3Clip(v, q3l.gnormal, v, q3.overclip); }
  let time_left = pml.frametime, bump;
  if (q3l.groundPlane) planes.push(q3l.gnormal.slice());
  { const n = v.slice(); normalize(n); planes.push(n); } // never turn against the original velocity
  const end = [0, 0, 0];
  for (bump = 0; bump < 4; bump++) {
    for (let i = 0; i < 3; i++) end[i] = pml.origin[i] + time_left * v[i];
    const t = ptrace(pml.origin, end);
    if (t.allsolid) { v[2] = 0; return true; }
    if (t.fraction > 0) pml.origin = t.endpos.slice();
    if (t.fraction === 1) break;
    time_left -= time_left * t.fraction;
    if (planes.length >= 5) { v[0] = v[1] = v[2] = 0; return true; }
    let i; for (i = 0; i < planes.length; i++) if (dot(t.normal, planes[i]) > 0.99) { for (let k = 0; k < 3; k++) v[k] += t.normal[k]; break; }
    if (i < planes.length) continue;
    planes.push(t.normal.slice());
    for (i = 0; i < planes.length; i++) {
      if (dot(v, planes[i]) >= 0.1) continue;
      const cv = [0, 0, 0], ce = [0, 0, 0]; q3Clip(v, planes[i], cv, q3.overclip); if (endV) q3Clip(endV, planes[i], ce, q3.overclip);
      let stop = false;
      for (let j = 0; j < planes.length; j++) {
        if (j === i || dot(cv, planes[j]) >= 0.1) continue;
        q3Clip(cv, planes[j], cv, q3.overclip); if (endV) q3Clip(ce, planes[j], ce, q3.overclip);
        if (dot(cv, planes[i]) >= 0) continue;
        const dir = cross(planes[i], planes[j]); normalize(dir);
        let d = dot(dir, v); for (let k = 0; k < 3; k++) cv[k] = dir[k] * d;
        if (endV) { d = dot(dir, endV); for (let k = 0; k < 3; k++) ce[k] = dir[k] * d; }
        for (let k = 0; k < planes.length; k++) { if (k === i || k === j || dot(cv, planes[k]) >= 0.1) continue; v[0] = v[1] = v[2] = 0; return true; }
        stop = false;
      }
      if (stop) break;
      for (let k = 0; k < 3; k++) v[k] = cv[k]; if (endV) for (let k = 0; k < 3; k++) endV[k] = ce[k];
      break;
    }
  }
  if (gravity) for (let k = 0; k < 3; k++) v[k] = endV[k];
  if (ps.time && (ps.flags & PMF_TIME_TELEPORT)) for (let k = 0; k < 3; k++) v[k] = primal[k];
  return bump !== 0;
}
function q3StepSlideMove(gravity) {
  const start_o = pml.origin.slice(), start_v = pml.velocity.slice();
  if (!q3SlideMove(gravity)) return;
  let down = start_o.slice(); down[2] -= STEPSIZE; let t = ptrace(start_o, down);
  if (pml.velocity[2] > 0 && (t.fraction === 1 || t.normal[2] < 0.7)) return; // never step up with upward velocity
  const up = start_o.slice(); up[2] += STEPSIZE; t = ptrace(start_o, up); if (t.allsolid) return;
  const stepSize = t.endpos[2] - start_o[2];
  pml.origin = t.endpos.slice(); pml.velocity = start_v.slice();
  q3SlideMove(gravity);
  down = pml.origin.slice(); down[2] -= stepSize; t = ptrace(pml.origin, down);
  if (!t.allsolid) pml.origin = t.endpos.slice();
  if (t.fraction < 1) q3Clip(pml.velocity, t.normal, pml.velocity, q3.overclip);
}
function q3CheckJump() {
  if (pm.cmd.upmove < 10) return false;
  if (ps.flags & PMF_JUMP_HELD) return false;
  q3l.groundPlane = false; q3l.walking = false; ps.flags |= PMF_JUMP_HELD; ps.flags &= ~PMF_ON_GROUND; pm.ground = false;
  pml.velocity[2] = q3.jump; pm.jumped = true; return true;
}
function q3CheckWaterJump() {
  if (ps.time) return false; if (pm.waterlevel !== 2) return false;
  const flat = [pml.forward[0], pml.forward[1], 0]; normalize(flat);
  const sp = [pml.origin[0] + 30 * flat[0], pml.origin[1] + 30 * flat[1], pml.origin[2] + 4];
  if (!(pointContents(sp) & CONTENTS_SOLID)) return false; sp[2] += 16; if (pointContents(sp)) return false;
  pml.velocity[0] = pml.forward[0] * 200; pml.velocity[1] = pml.forward[1] * 200; pml.velocity[2] = 350;
  ps.flags |= PMF_TIME_WATERJUMP; ps.time = 250; return true;
}
function q3Accel(wishdir, wishspeed, accel) { accelerate(wishdir, wishspeed, accel); }
function q3WaterMove() {
  if (q3CheckWaterJump()) { q3StepSlideMove(true); return; }
  q3Friction();
  const scale = q3CmdScale(), c = pm.cmd, w = [0, 0, 0];
  if (!scale) w[2] = -60; else { for (let i = 0; i < 3; i++) w[i] = scale * pml.forward[i] * c.forwardmove + scale * pml.right[i] * c.sidemove; w[2] += scale * c.upmove; }
  const wishdir = w.slice(); let wishspeed = normalize(wishdir); if (wishspeed > q3.speed * q3.swimScale) wishspeed = q3.speed * q3.swimScale;
  q3Accel(wishdir, wishspeed, q3.wateraccelerate);
  if (q3l.groundPlane && dot(pml.velocity, q3l.gnormal) < 0) { const l = Math.hypot(...pml.velocity); q3Clip(pml.velocity, q3l.gnormal, pml.velocity, q3.overclip); normalize(pml.velocity); for (let i = 0; i < 3; i++) pml.velocity[i] *= l; }
  q3SlideMove(false);
}
function q3AirMove() {
  q3Friction();
  const scale = q3CmdScale(), f = pml.forward.slice(), r = pml.right.slice(); f[2] = 0; r[2] = 0; normalize(f); normalize(r);
  const c = pm.cmd, w = [f[0] * c.forwardmove + r[0] * c.sidemove, f[1] * c.forwardmove + r[1] * c.sidemove, 0];
  const wishdir = w.slice(); let wishspeed = normalize(wishdir) * scale;
  q3Accel(wishdir, wishspeed, q3.airaccelerate);
  if (q3l.groundPlane) q3Clip(pml.velocity, q3l.gnormal, pml.velocity, q3.overclip);
  q3StepSlideMove(true);
}
function q3WalkMove() {
  if (pm.waterlevel > 2 && dot(pml.forward, q3l.gnormal) > 0) { q3WaterMove(); return; }
  if (q3CheckJump()) { if (pm.waterlevel > 1) q3WaterMove(); else q3AirMove(); return; }
  q3Friction();
  const scale = q3CmdScale(), f = pml.forward.slice(), r = pml.right.slice(); f[2] = 0; r[2] = 0;
  q3Clip(f, q3l.gnormal, f, q3.overclip); q3Clip(r, q3l.gnormal, r, q3.overclip); normalize(f); normalize(r);
  const c = pm.cmd, w = [0, 1, 2].map(i => f[i] * c.forwardmove + r[i] * c.sidemove);
  const wishdir = w.slice(); let wishspeed = normalize(wishdir) * scale;
  if ((ps.flags & PMF_DUCKED) && wishspeed > q3.speed * q3.duckScale) wishspeed = q3.speed * q3.duckScale;
  if (pm.waterlevel) { const ws = 1 - (1 - q3.swimScale) * pm.waterlevel / 3; if (wishspeed > q3.speed * ws) wishspeed = q3.speed * ws; }
  const slick = q3l.gsurf & SURF_SLICK;
  q3Accel(wishdir, wishspeed, slick ? q3.airaccelerate : q3.accelerate);
  if (slick) pml.velocity[2] -= ps.gravity * pml.frametime;
  const vl = Math.hypot(...pml.velocity);
  q3Clip(pml.velocity, q3l.gnormal, pml.velocity, q3.overclip); normalize(pml.velocity); for (let i = 0; i < 3; i++) pml.velocity[i] *= vl; // slopes don't slow you down
  if (!pml.velocity[0] && !pml.velocity[1]) return;
  q3StepSlideMove(false);
}
function q3LadderMove() { // Team Arena-style ladders, for Q2 maps played with Q3 rules
  q3Friction();
  const scale = q3CmdScale(), c = pm.cmd, w = [0, 0, 0];
  if (scale) { for (let i = 0; i < 3; i++) w[i] = scale * pml.forward[i] * c.forwardmove + scale * pml.right[i] * c.sidemove; w[2] += scale * c.upmove; } 
  const wishdir = w.slice(); let wishspeed = normalize(wishdir); if (wishspeed > q3.speed * .5) wishspeed = q3.speed * .5;
  q3Accel(wishdir, wishspeed, q3.accelerate);
  if (q3l.groundPlane && dot(pml.velocity, q3l.gnormal) < 0) { const l = Math.hypot(...pml.velocity); q3Clip(pml.velocity, q3l.gnormal, pml.velocity, q3.overclip); normalize(pml.velocity); for (let i = 0; i < 3; i++) pml.velocity[i] *= l; }
  q3SlideMove(false);
}
function q3GroundTrace() {
  const point = [pml.origin[0], pml.origin[1], pml.origin[2] - 0.25], t = ptrace(pml.origin, point);
  const wasGround = !!(ps.flags & PMF_ON_GROUND);
  pm.groundEnt = -2;
  if (t.fraction === 1 && !t.allsolid) { q3l.groundPlane = q3l.walking = false; ps.flags &= ~PMF_ON_GROUND; pm.ground = false; return; }
  if (pml.velocity[2] > 0 && dot(pml.velocity, t.normal) > 10) { q3l.groundPlane = q3l.walking = false; ps.flags &= ~PMF_ON_GROUND; pm.ground = false; return; } // kicked off
  q3l.gnormal = t.allsolid ? [0, 0, 1] : t.normal.slice(); q3l.gsurf = t.surf; pml.groundSurf = t.surf;
  if (q3l.gnormal[2] < 0.7) { q3l.groundPlane = true; q3l.walking = false; ps.flags &= ~PMF_ON_GROUND; pm.ground = false; return; }
  q3l.groundPlane = q3l.walking = true; pm.ground = true; pm.groundEnt = t.ent;
  if (!wasGround) {
    if (pml.velocity[2] < 0) q3Clip(pml.velocity, q3l.gnormal, pml.velocity, q3.overclip); // the landing frame stops the fall into the floor
    if (ps.flags & PMF_TIME_WATERJUMP) { ps.flags &= ~PMF_TIME_WATERJUMP; ps.time = 0; }
    if (q3l.prevVz < -200) { ps.flags |= PMF_TIME_LAND; ps.time = 250 >> 3; } // only the landing animation; Q3 lets you jump again at once
  }
  ps.flags |= PMF_ON_GROUND;
}
function q3WaterLevel() {
  pm.waterlevel = 0; pm.watertype = 0;
  const point = [pml.origin[0], pml.origin[1], pml.origin[2] + pm.mins[2] + 1]; let cont = pointContents(point);
  const sample2 = pm.viewheight - pm.mins[2], sample1 = sample2 / 2;
  if (cont & MASK_WATER) {
    pm.watertype = cont; pm.waterlevel = 1; point[2] = pml.origin[2] + pm.mins[2] + sample1; cont = pointContents(point);
    if (cont & MASK_WATER) { pm.waterlevel = 2; point[2] = pml.origin[2] + pm.mins[2] + sample2; if (pointContents(point) & MASK_WATER) pm.waterlevel = 3; }
  }
}
function q3CheckDuck() {
  pm.mins[0] = -15; pm.mins[1] = -15; pm.maxs[0] = 15; pm.maxs[1] = 15; pm.mins[2] = -24;
  if (pm.cmd.upmove < 0) ps.flags |= PMF_DUCKED;
  else if (ps.flags & PMF_DUCKED) { pm.maxs[2] = 32; if (!ptrace(pml.origin, pml.origin).allsolid) ps.flags &= ~PMF_DUCKED; }
  if (ps.flags & PMF_DUCKED) { pm.maxs[2] = 16; pm.viewheight = 12; } else { pm.maxs[2] = 32; pm.viewheight = 26; }
}
function q3Ladder() {
  const flat = [pml.forward[0], pml.forward[1], 0]; normalize(flat);
  const t = ptrace(pml.origin, [pml.origin[0] + flat[0], pml.origin[1] + flat[1], pml.origin[2]]);
  return t.fraction < 1 && !!(t.contents & CONTENTS_LADDER);
}
function pmoveQ3() {
  pm.ground = !!(ps.flags & PMF_ON_GROUND); pm.jumped = false;
  pml.origin = [ps.origin[0] * 0.125, ps.origin[1] * 0.125, ps.origin[2] * 0.125];
  pml.velocity = [ps.velocity[0] * 0.125, ps.velocity[1] * 0.125, ps.velocity[2] * 0.125];
  pml.prev = ps.origin.slice(); pml.frametime = pm.cmd.msec * 0.001; pml.ladder = false; pml.groundSurf = 0;
  clampAngles();
  if (ps.noclip) { flyMove(); for (let i = 0; i < 3; i++) { ps.origin[i] = pml.origin[i] * 8; ps.velocity[i] = Math.round(pml.velocity[i]) * 8; } return; }
  if (pm.cmd.upmove < 10) ps.flags &= ~PMF_JUMP_HELD;
  q3l.prevVz = pml.velocity[2];
  q3WaterLevel();
  q3CheckDuck();
  q3GroundTrace();
  if (ps.time) { // PM_DropTimers
    let msec = pm.cmd.msec >> 3; if (!msec) msec = 1;
    if (msec >= ps.time) { ps.flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT); ps.time = 0; } else ps.time -= msec;
  }
  pml.ladder = q3Ladder();
  if (ps.flags & PMF_TIME_TELEPORT) { /* hold still for the teleport pause */ }
  else if (ps.flags & PMF_TIME_WATERJUMP) { q3StepSlideMove(true); pml.velocity[2] -= ps.gravity * pml.frametime; if (pml.velocity[2] < 0) { ps.flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT); ps.time = 0; } }
  else if (pml.ladder) q3LadderMove();
  else if (pm.waterlevel > 1) q3WaterMove();
  else if (q3l.walking) q3WalkMove();
  else q3AirMove();
  q3GroundTrace();
  q3WaterLevel();
  for (let i = 0; i < 3; i++) { ps.origin[i] = pml.origin[i] * 8; ps.velocity[i] = clampShort(Math.round(pml.velocity[i]) * 8); } // SnapVector(velocity)
  if (!goodPosition()) ps.origin = pml.prev.slice();
}
function pmove() {
  if (pm.q3) { pmoveQ3(); return; }
  pm.ground = false; pm.watertype = 0; pm.waterlevel = 0; pm.jumped = false;
  pml.origin = [ps.origin[0] * 0.125, ps.origin[1] * 0.125, ps.origin[2] * 0.125];
  pml.velocity = [ps.velocity[0] * 0.125, ps.velocity[1] * 0.125, ps.velocity[2] * 0.125];
  pml.prev = ps.origin.slice(); pml.frametime = pm.cmd.msec * 0.001; pml.ladder = false; pml.groundSurf = 0;
  clampAngles();
  if (ps.noclip) { flyMove(); snapPosition(); return; }
  checkDuck();
  categorizePosition();
  checkSpecialMovement();
  if (ps.time) {
    let msec = pm.cmd.msec >> 3; if (!msec) msec = 1;
    if (msec >= ps.time) { ps.flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT); ps.time = 0; }
    else ps.time -= msec;
  }
  if (ps.flags & PMF_TIME_TELEPORT) { /* teleport pause stays exactly in place */ }
  else if (ps.flags & PMF_TIME_WATERJUMP) { // a water jump has no control, but falls; it ends as soon as you start dropping
    pml.velocity[2] -= ps.gravity * pml.frametime;
    if (pml.velocity[2] < 0) { ps.flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT); ps.time = 0; }
    stepSlideMove();
  } else {
    checkJump();
    friction();
    if (pm.waterlevel >= 2) waterMove();
    else {
      angleVectors([pm.viewangles[0] / 3, pm.viewangles[1], pm.viewangles[2]], pml.forward, pml.right, pml.up);
      airMove();
    }
  }
  categorizePosition();
  snapPosition();
}

// ---------------- brush geometry helpers (for the built-in map) ----------------
function baseWinding(n, d) {
  let x = 0, max = -1; for (let i = 0; i < 3; i++) { const v = Math.abs(n[i]); if (v > max) { max = v; x = i; } }
  const vup = x === 2 ? [1, 0, 0] : [0, 0, 1];
  const v = dot(vup, n); for (let i = 0; i < 3; i++) vup[i] -= n[i] * v; normalize(vup);
  const vr = cross(vup, n), org = [n[0] * d, n[1] * d, n[2] * d], S = 65536;
  const P = (a, b) => [org[0] + vr[0] * a * S + vup[0] * b * S, org[1] + vr[1] * a * S + vup[1] * b * S, org[2] + vr[2] * a * S + vup[2] * b * S];
  return [P(-1, 1), P(1, 1), P(1, -1), P(-1, -1)];
}
function clipWinding(w, n, d) {
  const out = [], eps = 0.01;
  for (let i = 0; i < w.length; i++) {
    const p = w[i], q = w[(i + 1) % w.length], dp = dot(p, n) - d, dq = dot(q, n) - d;
    if (dp <= eps) out.push(p);
    if ((dp < -eps && dq > eps) || (dp > eps && dq < -eps)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]); }
  }
  return out.length >= 3 ? out : null;
}
function brushFaces(planes) {
  const out = [];
  for (let i = 0; i < planes.length; i++) {
    let w = baseWinding(planes[i].n, planes[i].d);
    for (let j = 0; j < planes.length && w; j++) if (j !== i) w = clipWinding(w, planes[j].n, planes[j].d);
    if (!w) continue;
    let area = 0; for (let k = 2; k < w.length; k++) { const a = [0, 1, 2].map(c => w[k - 1][c] - w[0][c]), b = [0, 1, 2].map(c => w[k][c] - w[0][c]); area += Math.hypot(...cross(a, b)) / 2; }
    if (area > 0.5) out.push({ w, n: planes[i].n });
  }
  return out;
}
function demoMap() {
  const B = [], P = (n, d) => ({ n, d });
  function box(x0, y0, z0, x1, y1, z1, mat, contents) {
    B.push({ planes: [P([-1, 0, 0], -x0), P([1, 0, 0], x1), P([0, -1, 0], -y0), P([0, 1, 0], y1), P([0, 0, -1], -z0), P([0, 0, 1], z1)], mat, contents: contents || CONTENTS_SOLID });
    return B[B.length - 1];
  }
  function wedge(x0, y0, z0, x1, y1, axis, hStart, hEnd, mat) {
    const b = box(x0, y0, z0, x1, y1, Math.max(hStart, hEnd), mat);
    const a0 = axis === 0 ? x0 : y0, a1 = axis === 0 ? x1 : y1, na = -(hEnd - hStart), nz = a1 - a0, l = Math.hypot(na, nz);
    const n = [0, 0, nz / l]; n[axis] = na / l;
    b.planes.push(P(n, n[axis] * a0 + n[2] * hStart));
  }
  // floor with a pool cut out
  box(-1536, -1024, -256, 900, 1024, 0, 'floor'); box(1300, -1024, -256, 1536, 1024, 0, 'floor');
  box(900, -500, -256, 1300, 1024, 0, 'floor'); box(900, -1024, -256, 1300, -900, 0, 'floor');
  box(900, -900, -288, 1300, -500, -256, 'tile');
  wedge(1150, -900, -256, 1300, -500, 1, -256, 0, 'tile');
  box(900, -900, -256, 1300, -500, -6, 'water', CONTENTS_WATER);
  const H = 640;
  box(-1568, -1056, -256, -1536, 1056, H, 'wall'); box(1536, -1056, -256, 1568, 1056, H, 'wall');
  box(-1536, -1056, -256, 1536, -1024, H, 'wall'); box(-1536, 1024, -256, 1536, 1056, H, 'wall');
  // stairs + balcony
  for (let i = 0; i < 10; i++) box(-1200, 500 + 32 * i, 0, -1056, 532 + 32 * i, 16 * (i + 1), 'metal');
  box(-1536, 820, 128, 600, 1024, 160, 'metal');
  // strafe-jump gap course
  wedge(-1100, -400, 0, -900, -200, 0, 0, 64, 'ramp'); box(-900, -400, 0, -700, -200, 64, 'plat');
  let x = -700; for (const g of [128, 160, 192, 224, 256, 288]) { x += g; box(x, -400, 0, x + 96, -200, 64, 'plat'); x += 96; }
  // rocket-jump tower with ladder
  box(200, 200, 0, 456, 456, 256, 'tower');
  box(192, 296, 0, 200, 360, 256, 'ladder', CONTENTS_SOLID | CONTENTS_LADDER);
  // jump pad + floating platform
  box(-300, 500, 0, -236, 564, 4, 'pad'); box(-230, 470, 400, -30, 600, 432, 'plat');
  // walkable ramp, plateau, too-steep slide
  wedge(600, 200, 0, 1000, 600, 0, 0, 192, 'ramp'); box(1000, 200, 0, 1200, 600, 192, 'tower'); wedge(1200, 200, 0, 1350, 600, 0, 192, 0, 'ramp');
  // pillars and crates
  box(-640, 260, 0, -576, 324, 192, 'tower'); box(-48, -760, 0, 48, -664, 96, 'crate'); box(-460, -740, 0, -396, -676, 64, 'crate'); box(460, -760, 0, 556, -664, 128, 'crate');
  const pd = [0.25, 0, 1]; normalize(pd);
  return {
    brushes: B,
    triggers: [{ type: 'push', mins: [-300, 500, 4], maxs: [-236, 564, 40], vel: pd.map(v => v * 950) }],
    monsters: [['monster_soldier_light', 700, 760, 24, 180], ['monster_soldier_light', 860, 820, 24, 180], ['monster_soldier', 1300, 760, 24, 200], ['monster_gunner', 1100, 450, 216, 180], ['monster_infantry', 300, -800, 24, 90], ['monster_flyer', 0, 600, 260, 270], ['monster_berserk', 1300, -200, 24, 180]],
    items: [['item_health', -1250, 300, 16], ['item_armor_jacket', -1250, 380, 16], ['item_health_large', 330, 330, 272], ['item_quad', -130, 535, 448], ['item_armor_shard', -1200, -300, 16], ['item_armor_shard', -1170, -300, 16], ['item_health_mega', 1100, 500, 208]],
    barrels: [[-1150, 160, 0], [-1150, 200, 0], [-1110, 180, 0], [-420, -600, 0], [-380, -560, 0], [-60, -620, 0], [380, 160, 0], [420, 120, 0], [1180, 640, 0], [-200, 380, 0]],
    spawns: [{ o: [-1350, 0, 24], yaw: 0 }, { o: [-1300, -300, 24], yaw: 0 }, { o: [328, 328, 280], yaw: 180 }, { o: [-130, 535, 456], yaw: 270 }]
  };
}

G.Q2 = {
  MASK_MONSTERSOLID, MASK_OPAQUE, CONTENTS_SOLID, CONTENTS_WATER, CONTENTS_LAVA, CONTENTS_SLIME, CONTENTS_LADDER, MASK_PLAYERSOLID, MASK_SOLID, MASK_SHOT, MASK_WATER,
  SURF_SKY, SURF_WARP, SURF_TRANS33, SURF_TRANS66, SURF_NODRAW, PMF_DUCKED, PMF_JUMP_HELD, PMF_ON_GROUND, PMF_TIME_TELEPORT, STEPSIZE,
  angleVectors, normalize, dot, cross, readPak, readZip, stripBase, parseBSP, parseEntities, vecOf,
  cmFromBSP, cmFromBrushes, parseQ3BSP, cmFromQ3, tessPatch, setCM: c => { CM = c; }, getCM: () => CM, trace, testSolid, pointContents, cstr,
  ps, pm, pml, pmove, initialSnapPosition, goodPosition, brushFaces, demoMap
};
})(typeof window !== 'undefined' ? window : globalThis);
