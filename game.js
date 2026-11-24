// ===== Crossover Quake: renderer, loader, entities, characters, UI =====
(function () {
'use strict';
const Q = window.Q2, $ = id => document.getElementById(id);
const { ps, pm } = Q;

// ---------- settings ----------
const S = { sens: 3, fov: 90, bright: 2, tick: 8, run: true, autohop: false, invert: false, vol: 0.7, music: 0.5, model: 'male', skin: 'grunt', third: false, skill: 1, hurt: 'monsters', testEnemies: true, wset: 'q2', pset: 'q2', model3: 'sarge', skin3: 'default', ragdoll: true, allWeapons: false, viewmodel: true, infAmmo: false };
let MAPCAT = null;
const BOT = { mode: 'dm', fragLimit: 0, timeLimit: 0, over: false, startT: 0, roster: [], on: false, pending: 0, bots: [], frags: 0, deaths: 0, count: 3, lastShooter: null, shooterT: 0, log: [], plan: null, planT: 0 };
const AMMO = { bullets: 0, shells: 0, grenades: 0, rockets: 0, cells: 0, slugs: 0, lightning: 0, bfgam: 0, nails: 0, mines: 0, belt: 0 };
const MAXAM = { bullets: 200, shells: 100, grenades: 50, rockets: 50, cells: 200, slugs: 50, lightning: 200, bfgam: 50, nails: 200, mines: 50, belt: 200 };
try { Object.assign(S, JSON.parse(localStorage.getItem('strafelab') || '{}')); } catch (e) {}
const saveS = () => { try { localStorage.setItem('strafelab', JSON.stringify(S)); } catch (e) {} };

// ---------- virtual file system ----------
const VFS = new Map();
const vfsPut = (name, get) => VFS.set(name.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, ''), get);
async function vfsGet(name) { const g = VFS.get(String(name).toLowerCase().replace(/\\/g, '/')); if (!g) return null; try { return await g(); } catch (e) { return null; } }
let vfsVersion = 0;

// ---------- GL helpers ----------
const cv = $('c');
const gl = cv.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) $('status').textContent = 'WebGL2 is not available in this browser.';
function prog(g, vs, fs, attrs) {
  const mk = (t, s) => { const sh = g.createShader(t); g.shaderSource(sh, s); g.compileShader(sh); if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh)); return sh; };
  const p = g.createProgram(); g.attachShader(p, mk(g.VERTEX_SHADER, vs)); g.attachShader(p, mk(g.FRAGMENT_SHADER, fs));
  attrs.forEach((a, i) => g.bindAttribLocation(p, i, a)); g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
  const u = {}; const n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = g.getActiveUniform(p, i); u[info.name] = g.getUniformLocation(p, info.name); }
  return { p, u };
}
function bleedTransparent(src, w, h) { // copy neighbouring colour under invisible texels so filtering doesn't pull in black
  let hole = false; for (let i = 3; i < src.length; i += 4) if (src[i] < 8) { hole = true; break; } if (!hole) return src;
  const out = new Uint8Array(src), known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = src[i * 4 + 3] >= 8 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (known[i]) continue; let r = 0, g2 = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = ((y + dy + h) % h) * w + ((x + dx + w) % w); if (known[j]) { r += out[j * 4]; g2 += out[j * 4 + 1]; b += out[j * 4 + 2]; n++; } }
      if (n) { out[i * 4] = r / n; out[i * 4 + 1] = g2 / n; out[i * 4 + 2] = b / n; add.push(i); }
    }
    if (!add.length) break; for (const i of add) known[i] = 1;
  }
  return out;
}
function makeTex(g, src, w, h, opts = {}) {
  if (opts.cutout && src instanceof Uint8Array) src = bleedTransparent(src, w, h);
  const t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
  if (src instanceof Uint8Array) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, src);
  else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  if (opts.lightmap) {
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  } else {
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
    const an = g.getExtension('EXT_texture_filter_anisotropic'); if (an) g.texParameterf(g.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }
  return t;
}
const H = '#version 300 es\nprecision highp float;\nprecision highp sampler2DArray;\n';
const worldP = gl && prog(gl, H + `in vec3 aPos;in vec2 aUV;in vec2 aLM;in float aL;uniform mat4 uMVP;uniform vec3 uOff;out vec2 vUV;out vec2 vLM;out float vL;out vec3 vW;
void main(){vW=aPos+uOff;gl_Position=uMVP*vec4(vW,1.);vUV=aUV;vLM=aLM;vL=aL;}`,
  H + `in vec2 vUV;in vec2 vLM;in float vL;in vec3 vW;uniform vec4 uDL[8];uniform vec3 uDLC[8];uniform int uNDL;vec3 dyn(vec3 w){vec3 s=vec3(0.);for(int i=0;i<8;i++){if(i>=uNDL)break;float d=distance(w,uDL[i].xyz);s+=uDLC[i]*max(0.,1.-d/uDL[i].w);}return s;}uniform sampler2D uTex;uniform sampler2D uLMap;uniform float uBright;uniform float uAlpha;uniform float uTime;uniform int uWarp;uniform int uLiquid;uniform float uAlphaTest;uniform int uTexAlpha;uniform vec2 uScroll;uniform vec3 uEye;out vec4 o;
void main(){vec2 uv=vUV+uScroll*uTime;vec3 l;
if(uWarp==1){uv+=0.125*vec2(sin(vUV.y*8.+uTime),sin(vUV.x*8.+uTime));l=vec3(vL*uBright);}else{l=texture(uLMap,vLM).rgb*uBright*vL;}
vec4 tx=texture(uTex,uv);if(uAlphaTest>0.){vec2 ts=vec2(textureSize(uTex,0));vec2 dd=max(abs(dFdx(uv*ts)),abs(dFdy(uv*ts)));tx.a*=1.+max(0.,log2(max(max(dd.x,dd.y),1e-4)))*.25;if(tx.a<uAlphaTest)discard;}
vec3 c=tx.rgb*(l+dyn(vW));float al=uAlpha*(uTexAlpha==1?tx.a:1.);
if(uLiquid==3){c=tx.rgb*(1.25+.15*sin(uTime*2.+vW.x*.02+vW.y*.015));al=1.;}
else if(uLiquid>0){vec3 V=normalize(uEye-vW);vec2 q=vW.xy*.035;float t=uTime;
 vec3 N=normalize(vec3(sin(q.x*3.1+t*1.3)*.07+sin(q.y*5.3-t*.9)*.05+sin((q.x+q.y)*8.+t*2.1)*.03,cos(q.y*3.7+t*1.1)*.07+cos(q.x*4.3-t*1.7)*.05+cos((q.x-q.y)*7.+t*1.9)*.03,1.));
 if(V.z<0.)N.z=-N.z;float fr=pow(1.-abs(dot(V,N)),4.);
 vec3 sky=uLiquid==2?vec3(.3,.45,.2):vec3(.38,.46,.56);vec3 hv=normalize(normalize(vec3(.45,.25,.8))+V);float sp=pow(max(dot(N,hv),0.),140.)*1.6;
 c=mix(c*.85,sky,fr*.65)+sp;al=clamp(al+fr*.45,0.,.96);}
o=vec4(min(c,vec3(1.)),al);}`, ['aPos', 'aUV', 'aLM', 'aL']);
const skyP = gl && prog(gl, H + `in vec3 aPos;uniform mat4 uMVP;uniform vec3 uEye;uniform float uScale;uniform vec3 uOff;out vec3 vDir;
void main(){vec3 p=aPos*uScale+uOff;vDir=p-uEye;gl_Position=uMVP*vec4(p,1.);}`,
  H + `in vec3 vDir;uniform float uTime;uniform int uHasSky;uniform sampler2DArray uSky;uniform sampler2D uCloud;out vec4 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}
void main(){vec3 d=normalize(vDir);
if(uHasSky==2){float z=max(d.z,.02);vec2 cu=d.xy/(z+.3)*.6+vec2(uTime*.01,uTime*.006);vec3 cl=texture(uCloud,cu).rgb;o=vec4(mix(vec3(.22,.24,.3),cl,smoothstep(-.05,.25,d.z)),1.);return;}
if(uHasSky==1){vec3 a=abs(d);float s,t,L;
 if(a.x>=a.y&&a.x>=a.z){if(d.x>0.){L=0.;s=-d.y/a.x;t=d.z/a.x;}else{L=1.;s=d.y/a.x;t=d.z/a.x;}}
 else if(a.y>=a.z){if(d.y>0.){L=2.;s=d.x/a.y;t=d.z/a.y;}else{L=3.;s=-d.x/a.y;t=d.z/a.y;}}
 else{if(d.z>0.){L=4.;t=-d.x/a.z;s=-d.y/a.z;}else{L=5.;t=d.x/a.z;s=-d.y/a.z;}}
 o=vec4(texture(uSky,vec3((s+1.)*.5,(1.-t)*.5,L)).rgb,1.);return;}
float z=d.z;vec3 top=vec3(.13,.15,.2),hor=vec3(.52,.38,.27),bot=vec3(.07,.06,.05);
vec3 c=z>0.?mix(hor,top,pow(z,.55)):mix(hor,bot,pow(-z,.4));
if(z>0.){vec2 uv=d.xy/(z+.18)*1.4+vec2(uTime*.015,uTime*.006);float k=fbm(uv);c=mix(c,vec3(.72,.6,.5),smoothstep(.48,.85,k)*smoothstep(0.,.35,z)*.65);}
vec3 sd=normalize(vec3(.45,.25,.32));float s=max(dot(d,sd),0.);c+=vec3(1.,.8,.55)*pow(s,300.)*2.+vec3(1.,.55,.3)*pow(s,6.)*.18;o=vec4(c,1.);}`, ['aPos']);
const solidP = gl && prog(gl, H + `in vec3 aPos;in vec3 aNorm;uniform mat4 uMVP;uniform mat4 uM;out vec3 vN;out vec3 vW;void main(){vN=mat3(uM)*aNorm;vW=(uM*vec4(aPos,1.)).xyz;gl_Position=uMVP*vec4(aPos,1.);}`,
  H + `in vec3 vN;in vec3 vW;uniform vec4 uColor;uniform float uLit;uniform vec3 uEye;uniform vec4 uDL[8];uniform vec3 uDLC[8];uniform int uNDL;out vec4 o;
void main(){vec3 n=normalize(vN),L=normalize(vec3(.3,.6,.75)),V=normalize(uEye-vW);vec3 s=vec3(0.);for(int i=0;i<8;i++){if(i>=uNDL)break;float d=distance(vW,uDL[i].xyz);s+=uDLC[i]*max(0.,1.-d/uDL[i].w);}
vec3 hemi=mix(vec3(.26,.25,.25),vec3(.52,.56,.64),n.z*.5+.5);float dif=max(dot(n,L),0.)*.62;float sp=pow(max(dot(reflect(-L,n),V),0.),20.)*.22;float rim=pow(1.-max(dot(n,V),0.),3.)*.22;
vec3 c=uColor.rgb*(hemi+dif+s+rim)+vec3(sp);o=vec4(mix(uColor.rgb,c,uLit),uColor.a);}`, ['aPos', 'aNorm']);
const MD2VS = H + `in vec3 aPos;in vec3 aNorm;in vec2 aUV;uniform mat4 uMVP;uniform mat4 uM;out vec2 vUV;out vec3 vN;out vec3 vW;void main(){gl_Position=uMVP*vec4(aPos,1.);vN=mat3(uM)*aNorm;vUV=aUV;vW=(uM*vec4(aPos,1.)).xyz;}`;
const MD2FS = H + `in vec2 vUV;in vec3 vN;in vec3 vW;uniform vec4 uPow;uniform float uPowT;uniform vec4 uDL[8];uniform vec3 uDLC[8];uniform int uNDL;vec3 dyn(vec3 w){vec3 s=vec3(0.);for(int i=0;i<8;i++){if(i>=uNDL)break;float d=distance(w,uDL[i].xyz);s+=uDLC[i]*max(0.,1.-d/uDL[i].w);}return s;}uniform sampler2D uTex;uniform float uAmb;uniform float uShade;uniform vec3 uLDir;uniform int uEnv;uniform vec3 uEyeM;uniform float uCut;out vec4 o;
void m1(){vec3 n=normalize(vN);float l=uAmb+(1.-uAmb)*max(dot(n,uLDir),0.);vec2 uv=vUV;if(uEnv==1){vec3 r=reflect(normalize(vW-uEyeM),n);uv=vec2(.5+.5*r.y,.5-.5*r.z);}vec4 tx=texture(uTex,uv);if(uCut>0.&&tx.a<uCut)discard;vec3 t=tx.rgb;if(uEnv==1){o=vec4(t*(.3+.7*l)*uShade*.8,1.);return;}o=vec4(min(t*l*uShade+t*dyn(vW),vec3(1.)),1.);}
void main(){m1();if(uPow.a>0.){float w=.5+.5*sin(uPowT*7.+vW.z*.12+vW.x*.07+vW.y*.05);float rim=1.-abs(dot(normalize(vN),vec3(.4,.3,.866)));o.rgb=mix(o.rgb,o.rgb*(vec3(1.)+uPow.rgb*.9)+uPow.rgb*.2,uPow.a);o.rgb+=uPow.rgb*uPow.a*(.15+.55*w*(.4+rim));o.rgb=min(o.rgb,vec3(1.5));}}`;
const partP = gl && prog(gl, H + `in vec2 aC;in vec4 aPS;in vec4 aCol;in vec2 aKS;uniform mat4 uVP;uniform vec3 uR;uniform vec3 uU;uniform vec3 uEye;out vec2 vUV;out vec4 vCol;out vec2 vKS;out float vF;
void main(){float an=aKS.y*6.2831;vec2 c=vec2(cos(an)*aC.x-sin(an)*aC.y,sin(an)*aC.x+cos(an)*aC.y);vec3 te=uEye-aPS.xyz;float de=length(te);bool fl=aKS.x>3.5&&aKS.x<5.5;vec3 ctr=fl?aPS.xyz:aPS.xyz+te/max(de,1.)*min(aPS.w*.6,de*.5);vec3 p=ctr+(fl?vec3(c.x,c.y,0.):uR*c.x+uU*c.y)*aPS.w;gl_Position=uVP*vec4(p,1.);vUV=aC;vCol=aCol;vKS=aKS;vF=fl?1.:clamp((de-aPS.w*.5)/(aPS.w*1.5+1.),0.,1.);}`,
  H + `in vec2 vUV;in vec4 vCol;in vec2 vKS;in float vF;out vec4 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){float d=length(vUV);if(d>1.)discard;float a;
if(vKS.x<.5)a=pow(1.-d,2.);
else if(vKS.x<1.5){vec2 q=vUV*1.7+vKS.y*37.;float k=n(q)*.55+n(q*2.3+3.1)*.3+n(q*5.1)*.15;a=clamp((1.-d)*1.7-(1.-k)*1.05,0.,1.);}
else if(vKS.x<2.5)a=1.-smoothstep(.25,1.,d);
else if(vKS.x>3.5&&vKS.x<4.5)a=smoothstep(.6,.8,d)*(1.-smoothstep(.84,1.,d))*1.8;
else if(vKS.x>4.5&&vKS.x<5.5){vec2 q=vUV*3.+vKS.y*11.;a=clamp((1.-d)*1.4-(1.-n(q)*.6-n(q*2.7)*.4)*.9,0.,1.);}
else if(vKS.x>5.5){a=smoothstep(.5,.85,d)*(1.-smoothstep(.85,1.,d))*1.4+(1.-d)*.1+smoothstep(.35,0.,length(vUV-vec2(-.35,.35)))*.8;}
else{vec2 q=vUV*1.5+vKS.y*41.;float k=n(q)*.5+n(q*2.1+1.7)*.3+n(q*4.7)*.2;a=clamp((1.-d)*1.9-(1.-k)*1.2,0.,1.);o=vec4(vCol.rgb*(.45+1.1*k),vCol.a*a*vF);return;}
o=vec4(vCol.rgb,vCol.a*a*vF);}`, ['aC', 'aPS', 'aCol', 'aKS']);
const decalP = gl && prog(gl, H + `in vec3 aPos;in vec3 aUK;uniform mat4 uVP;out vec3 vUK;void main(){gl_Position=uVP*vec4(aPos,1.);vUK=aUK;}`,
  H + `in vec3 vUK;out vec4 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){vec2 uv=vUK.xy;float d=length(uv);if(d>1.)discard;float k=vUK.z;
if(k<.5){float a=smoothstep(.6,.2,d);float rim=smoothstep(1.,.45,d)*.3;o=vec4(vec3(.03),max(a,rim)*.85);}
else{float nn=n(uv*3.+k*13.)*.55+n(uv*7.+k*5.)*.3+n(uv*15.)*.15;float a=clamp((1.-d)*1.5+(nn-.55)*1.2,0.,1.);o=vec4(vec3(.035,.028,.02),a*.8);}}`, ['aPos', 'aUK']);
const MD2A = ['aPos', 'aNorm', 'aUV'];

function meshPN(data) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null); return { vao, n: data.length / 6 };
}
function cubeData() {
  const d = [], F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, a, b] of F) {
    const c = (s, t) => [n[0] + a[0] * s + b[0] * t, n[1] + a[1] * s + b[1] * t, n[2] + a[2] * s + b[2] * t];
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) d.push(...c(s, t), ...n);
  }
  return d;
}
function sphereData(seg = 12, ring = 8) {
  const d = [], P = (i, j) => { const th = i / seg * Math.PI * 2, ph = j / ring * Math.PI; return [Math.cos(th) * Math.sin(ph), Math.sin(th) * Math.sin(ph), Math.cos(ph)]; };
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), e = P(i, j + 1); for (const p of [a, b, c, a, c, e]) d.push(...p, ...p); }
  return d;
}
const cube = gl && meshPN(cubeData()), sphere = gl && meshPN(sphereData());
// ---------- built-in figures ----------
// Without model files every character is drawn from rounded parts: a soldier in plates and pads with a glowing visor, or, for the
// non-humanoid monsters, a hovering drone or a heavy walker. Bones come from the same 16-point skeleton the ragdolls use.
function rboxData(e = .28, seg = 10) { // a superellipsoid: a box with rounded edges, in [-.5, .5]
  const d = [], sp = (c, p) => Math.sign(c) * Math.pow(Math.abs(c), p);
  const P = (i, j) => { const th = i / seg * Math.PI * 2 - Math.PI, ph = j / seg * Math.PI - Math.PI / 2, ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sn = Math.sin(ph);
    const p = [sp(cp, e) * sp(ct, e) * .5, sp(cp, e) * sp(st, e) * .5, sp(sn, e) * .5], n = [sp(cp, 2 - e) * sp(ct, 2 - e), sp(cp, 2 - e) * sp(st, 2 - e), sp(sn, 2 - e)], l = Math.hypot(...n) || 1; return [p, n.map(v => v / l)]; };
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), f = P(i, j + 1); for (const [p, n] of [a, b, c, a, c, f]) d.push(...p, ...n); }
  return d;
}
function cylData(seg = 12) { // a capped cylinder along x in [-.5, .5], radius .5
  const d = [], ring = i => { const a = i / seg * Math.PI * 2; return [Math.cos(a) * .5, Math.sin(a) * .5]; };
  for (let i = 0; i < seg; i++) { const [y0, z0] = ring(i), [y1, z1] = ring(i + 1), n0 = [0, y0 * 2, z0 * 2], n1 = [0, y1 * 2, z1 * 2];
    d.push(-.5, y0, z0, ...n0, .5, y0, z0, ...n0, .5, y1, z1, ...n1, -.5, y0, z0, ...n0, .5, y1, z1, ...n1, -.5, y1, z1, ...n1);
    d.push(.5, 0, 0, 1, 0, 0, .5, y0, z0, 1, 0, 0, .5, y1, z1, 1, 0, 0, -.5, 0, 0, -1, 0, 0, -.5, y1, z1, -1, 0, 0, -.5, y0, z0, -1, 0, 0); }
  return d;
}
const rbox = gl && meshPN(rboxData()), cyl = gl && meshPN(cylData());
const FIG = { // looks for the built-in characters; monsters are keyed by their model folder
  player: { body: [.36, .4, .3], limb: [.24, .27, .22], plate: [.52, .56, .44], boot: [.13, .12, .11], visor: [.35, .9, 1], gun: 'rifle' },
  soldier: { body: [.55, .48, .32], limb: [.38, .34, .24], plate: [.66, .6, .42], boot: [.16, .13, .1], visor: [1, .35, .2], gun: 'rifle' },
  infantry: { body: [.28, .36, .26], limb: [.2, .25, .19], plate: [.42, .5, .36], boot: [.12, .12, .1], visor: [1, .6, .15], gun: 'cannon', bulk: 1.15 },
  gunner: { body: [.38, .38, .42], limb: [.27, .27, .3], plate: [.55, .55, .6], boot: [.14, .14, .16], visor: [1, .25, .2], gun: 'cannon', bulk: 1.25 },
  berserk: { body: [.45, .3, .22], limb: [.6, .45, .36], plate: [.35, .3, .28], boot: [.15, .1, .08], visor: [1, .2, .1], gun: 'blade', bulk: 1.35 },
  gladiatr: { body: [.5, .5, .55], limb: [.35, .35, .4], plate: [.7, .7, .78], boot: [.2, .2, .22], visor: [.5, 1, .4], gun: 'rail', bulk: 1.3 },
  tank: { body: [.36, .4, .24], limb: [.27, .3, .18], plate: [.5, .54, .34], boot: [.16, .16, .12], visor: [1, .3, .15], gun: 'cannon', bulk: 1.5 },
  default: { body: [.5, .2, .16], limb: [.38, .15, .12], plate: [.62, .28, .22], boot: [.16, .1, .08], visor: [1, .7, .2], gun: 'rifle' }
};
const BOT_HUES = [[.6, .16, .14], [.15, .35, .6], [.2, .5, .22], [.55, .4, .12], [.4, .2, .55]];
function botFig(hue) { const c = BOT_HUES[(hue || 0) % 5]; return { body: c, limb: c.map(v => v * .7), plate: c.map(v => Math.min(1, v * 1.35 + .08)), boot: [.12, .11, .1], visor: [.4, .95, 1], gun: 'rifle' }; }
const c4 = (c, k = 1) => [c[0] * k, c[1] * k, c[2] * k, 1];
function drawFigure(vp, P, style, sc = 1, gunOn = true) {
  const st = style || FIG.player, b = (st.bulk || 1) * sc;
  const F = ragFrame(P); if (![...F.u, ...F.l, ...F.f].every(Number.isFinite)) return;
  const at = (o, x, y, z, f = F) => [0, 1, 2].map(c => o[c] + f.f[c] * x + f.l[c] * y + f.u[c] * z);
  const blk = (o, sx, sy, sz, col, frame = F, lit = 1) => drawSolid(vp, rbox, mul(basis(o, frame.f, frame.l, frame.u), trs(0, 0, 0, sx, sy, sz)), col, lit);
  const seg = (a, c, r, col) => { const d = sub3(c, a), l = Math.hypot(...d); if (l < .1) return; const x = d.map(v => v / l), up = Math.abs(Q.dot(x, F.u)) < .95 ? F.u : F.f, y = nrm(Q.cross(up, x)), z = Q.cross(x, y);
    drawSolid(vp, cyl, mul(basis(a.map((v, i) => v + d[i] / 2), x, y, z), trs(0, 0, 0, l, r * 2, r * 2)), col); };
  const ball = (o, r, col) => drawSolid(vp, sphere, trs(o[0], o[1], o[2], r, r, r), col);
  const body = c4(st.body), limb = c4(st.limb), plate = c4(st.plate), boot = c4(st.boot), dark = c4(st.limb, .55);
  // torso: chest, belly, belt, chest plate, backpack, shoulder pads
  const chest = P[1].map((v, i) => (v * .6 + P[2][i] * .4)), belly = P[2].map((v, i) => (v + P[3][i]) / 2), spine = Math.hypot(...sub3(P[1], P[3]));
  const TF = { f: F.f, l: F.l, u: nrm(sub3(P[1], P[2])) }; if (!TF.u.every(Number.isFinite)) TF.u = F.u;
  blk(chest, 9 * b, 15 * b, spine * .55, body, TF); blk(at(chest, 3.6 * b, 0, .5), 3.2 * b, 12 * b, spine * .42, plate, TF);
  blk(belly, 7.5 * b, 11.5 * b, spine * .42, limb); blk(at(P[3], 0, 0, 1.5), 8.5 * b, 13 * b, 4 * b, dark); blk(at(P[3], 4.2 * b, 0, 1.5), 1.4, 3, 2.6, plate);
  blk(at(chest, -5.8 * b, 0, .5), 4.5 * b, 10 * b, spine * .45, dark, TF); for (const s of [-1, 1]) blk(at(chest, -6.6 * b, s * 3.2 * b, -spine * .12), 2, 2.2, 2.2, c4(st.visor, .6), TF, 0);
  for (const s of [4, 7]) { blk(at(P[s], 0, (s === 4 ? 1.2 : -1.2) * b, 1.6 * b), 7.5 * b, 6.5 * b, 4.2 * b, plate); }
  // arms with gloves, legs with knee pads and boots
  seg(P[4], P[5], 2.5 * b, limb); seg(P[5], P[6], 2.2 * b, limb); seg(P[7], P[8], 2.5 * b, limb); seg(P[8], P[9], 2.2 * b, limb);
  for (const i of [5, 8]) ball(P[i], 2.5 * b, limb); for (const i of [6, 9]) ball(P[i], 2.7 * b, dark);
  seg(P[10], P[11], 3.1 * b, body); seg(P[11], P[12], 2.7 * b, limb); seg(P[13], P[14], 3.1 * b, body); seg(P[14], P[15], 2.7 * b, limb);
  for (const i of [11, 14]) { ball(P[i], 3 * b, limb); blk(at(P[i], 2.4 * b, 0, 0), 2.2 * b, 4.4 * b, 4.6 * b, plate); }
  for (const i of [10, 13]) ball(P[i], 3.2 * b, body);
  const FF = { f: nrm([F.f[0], F.f[1], 0]), l: nrm([F.l[0], F.l[1], 0]), u: [0, 0, 1] }; if (!FF.f.every(Number.isFinite) || !FF.l.every(Number.isFinite)) { FF.f = F.f; FF.l = F.l; FF.u = F.u; }
  for (const i of [12, 15]) blk(at(P[i], 2.4 * b, 0, -.4, FF), 10 * b, 5.4 * b, 4.6 * b, boot, FF);
  // neck, helmet, visor
  seg(P[1], P[0], 2.2 * b, dark);
  const HF = { f: F.f, l: F.l, u: nrm(sub3(P[0], P[1])) }; if (!HF.u.every(Number.isFinite)) HF.u = F.u;
  const head = at(P[0], 0, 0, 1);
  blk(head, 9.5 * b, 9 * b, 9.5 * b, plate, HF); blk(at(head, .3, 0, 3.4 * b, HF), 8 * b, 7.6 * b, 3.2 * b, body, HF);
  blk(at(head, 4.2 * b, 0, .2, HF), 1.6, 7.4 * b, 2.6 * b, c4(st.visor, 1.25), HF, 0);
  if (!gunOn || st.gun === 'none') return;
  if (st.gunShape) { // a specific weapon (the player's current one, a bot's)
    const h = P[9], ax = nrm(sub3(P[9], P[8])), gx = nrm([F.f[0] * .7 + ax[0] * .3, F.f[1] * .7 + ax[1] * .3, F.f[2] * .7 + ax[2] * .3]), gy = nrm(Q.cross(F.u, gx)), gz = Q.cross(gx, gy), GF = { f: gx, l: gy, u: gz }, k = .7 * b;
    if (!gx.every(Number.isFinite) || !gy.every(Number.isFinite)) return;
    drawGunShape(st.gunShape, (fw, lf, up, sf, sl, su, col, mesh = rbox, lit = 1) => drawSolid(vp, mesh, mul(basis(at(h, (fw - 1.5) * k, lf * k, (up + 1.2) * k, GF), GF.f, GF.l, GF.u), trs(0, 0, 0, sf * k, sl * k, su * k)), col, lit), st.gunCol, { spin: realTime / 1000 * 3, time: realTime / 1000, firing: false });
    return;
  }
  // the weapon in the right hand, pointing forward
  const h = P[9], ax = nrm(sub3(P[9], P[8])), gx = nrm([F.f[0] * .7 + ax[0] * .3, F.f[1] * .7 + ax[1] * .3, F.f[2] * .7 + ax[2] * .3]), gy = nrm(Q.cross(F.u, gx)), gz = Q.cross(gx, gy), GF = { f: gx, l: gy, u: gz };
  if (!gx.every(Number.isFinite) || !gy.every(Number.isFinite)) return;
  const g = (x, y, z, sx, sy, sz, col, lit = 1) => blk(at(h, x, y, z, GF), sx, sy, sz, col, GF, lit), gm = [.18, .19, .2, 1], gl2 = [.32, .33, .35, 1];
  if (st.gun === 'blade') { g(5 * b, 0, 1, 14 * b, 1, 4 * b, [.75, .78, .82, 1]); g(0, 0, 0, 4, 3, 3, gm); return; }
  if (st.gun === 'cannon') { g(3, 0, 1.5, 13 * b, 5 * b, 5 * b, gm); seg(at(h, 8 * b, 0, 1.5, GF), at(h, 16 * b, 0, 1.5, GF), 1.8 * b, gl2); g(10 * b, 0, 1.5, 1, 3, 3, c4(st.visor), 0); return; }
  if (st.gun === 'rail') { g(4, 0, 1.5, 16 * b, 3, 3.6, gm); g(4, 0, 3.2, 14 * b, 1.4, 1, c4([.4, 1, .5]), 0); return; }
  g(3, 0, 1.6, 12, 2.6, 3.4, gm); g(-2.5, 0, 0, 4, 2.2, 4.4, gl2); g(10, 0, 2, 5, 1.4, 1.4, gm); g(3, 0, -1.4, 2.4, 1.8, 3.6, gl2);
}
// ---------- built-in gun shapes ----------
// Every weapon has its own silhouette. A shape is drawn through G(fw, lf, up, sizeF, sizeL, sizeU, colour, mesh, lit): fw runs forward
// from the hand, lf to the left, up upward. The same shapes are used for the first-person gun and the gun in a figure's hand.
const GUN_OF = { Blaster: 'blaster', Shotgun: 'shotgun', 'Super Shotgun': 'ssg', Machinegun: 'mg', Chaingun: 'cg', 'Grenade Launcher': 'gl', 'Rocket Launcher': 'rl', HyperBlaster: 'hb', Railgun: 'rail', BFG10K: 'bfg',
  Gauntlet: 'gaunt', 'Lightning Gun': 'lg', 'Plasma Gun': 'pg', Nailgun: 'ng', 'Prox Launcher': 'prox' };
const GUN_SHAPES = {
  blaster(G, k) { G(6, 0, 0, 12, 2.8, 3.4, k.body); G(6, 0, 1.9, 10, 2, .8, k.dark); G(12.6, 0, 0, 1.6, 2.6, 2.6, k.glow, cyl, 0); G(7, 1.5, .2, 6, .3, 1, k.glow, rbox, 0); G(1.6, 0, -3.4, 2.4, 2.2, 5, k.grip); },
  shotgun(G, k) { G(5, 0, 0, 9, 3, 3.8, k.gm); G(17, 0, .6, 18, 1.7, 1.7, k.gm, cyl); G(13, 0, -.9, 7, 2.6, 2.4, k.wood); G(-3.5, 0, -.8, 8, 2.4, 4.2, k.wood); G(1.2, 0, -3.4, 2.2, 2, 4.4, k.wood); G(26, 0, 1.8, .8, .6, 1, k.dark); },
  ssg(G, k) { G(3.5, 0, 0, 8, 4.6, 4, k.gm); for (const s of [-1, 1]) G(15, s * 1.1, .6, 16, 2, 2, k.gm, cyl); G(15, 0, -.8, 13, 3.4, 1.6, k.wood); G(-4, 0, -.8, 8, 3, 4.6, k.wood); G(.8, 0, -3.6, 2.4, 2.2, 4.6, k.wood); },
  mg(G, k, t) { G(6, 0, 0, 13, 3, 4.4, k.body); G(17, 0, .4, 10, 1.3, 1.3, k.gm, cyl); G(14.5, 0, .4, 6, 2.6, 2.6, k.dark, cyl); G(6, 0, -4.4, 2.6, 1.8, 6, k.dark); G(7, 0, 3, 7, 1, 1.4, k.dark); G(1.6, 0, -3.4, 2.4, 2.2, 5, k.grip); G(-1.5, 0, -.5, 4, 2.4, 3.4, k.dark); },
  cg(G, k, t) { G(5, 0, 0, 12, 6.4, 6.4, k.body); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + t.spin; G(16, Math.cos(a) * 1.9, Math.sin(a) * 1.9, 14, 1.1, 1.1, k.gm, cyl); }
    for (const f of [12, 21.5]) G(f, 0, 0, 1, 5.6, 5.6, k.dark, cyl); G(5, 3.8, -1, 8, 2, 4.4, [.55, .45, .2, 1]); G(4, 0, 3.8, 6, 2.4, 1.4, k.dark); },
  gl(G, k) { G(5, 0, 0, 7, 6.4, 6.4, k.dark, cyl); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; G(8.6, Math.cos(a) * 2, Math.sin(a) * 2, .4, 1.3, 1.3, k.gm, cyl); }
    G(14, 0, .5, 12, 3.6, 3.6, k.body, cyl); G(20, 0, .5, 1.2, 4.4, 4.4, k.dark, cyl); G(.5, 0, -3.4, 2.4, 2.2, 5, k.grip); G(-2.5, 0, 0, 5, 2.4, 3.6, k.body); },
  rl(G, k) { G(11, 0, .8, 26, 5.6, 5.6, k.body, cyl); G(-2.4, 0, .8, 2.4, 6.8, 6.8, k.dark, cyl); G(24.4, 0, .8, 1.4, 6.4, 6.4, k.dark, cyl); G(24.9, 0, .8, .4, 4.2, 4.2, [.05, .05, .05, 1], cyl, 0);
    G(9, 0, 4.4, 6, 1.6, 2, k.dark); G(9, 0, 5.6, 1.6, 1.4, 1.4, k.glow, rbox, 0); G(3, 0, -3.4, 2.4, 2.2, 5, k.grip); G(9, 0, -2.8, 3, 1.6, 2.6, k.dark); },
  hb(G, k, t) { G(6, 0, 0, 14, 4.4, 4.4, k.body); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + t.spin * .6; G(17, Math.cos(a) * 1.3, Math.sin(a) * 1.3, 10, .9, .9, k.gm, cyl); }
    for (const f of [9, 12, 15]) G(f, 0, 0, 1, 5, 5, k.glow, cyl, 0); G(1.6, 0, -3.4, 2.4, 2.2, 5, k.grip); G(6, 0, 3, 8, 1.4, 1.2, k.dark); },
  rail(G, k) { G(8, 0, 0, 18, 2.6, 3.2, k.body); for (const s of [-1, 1]) G(19, 0, s * 1.9, 16, 1.4, .9, k.gm); G(18, 0, 0, 14, .8, .8, k.glow, cyl, 0); for (const f of [12, 16, 20, 24]) G(f, 0, 0, .9, 3.4, 4.6, k.dark, cyl);
    G(1.2, 0, -3.4, 2.4, 2.2, 5, k.grip); G(-3.5, 0, -.6, 7, 2, 3.4, k.dark); G(8, 0, 2.7, 6, 1, 1.4, k.dark); },
  bfg(G, k, t) { G(6, 0, 0, 15, 8.4, 8.4, k.body); G(15, 0, 0, 4, 9.4, 9.4, k.dark, cyl); const p = 1 + .08 * Math.sin(t.time * 9); G(18.5, 0, 0, 6 * p, 6 * p, 6 * p, k.glow, sphere, 0);
    for (const s of [-1, 1]) G(8, s * 5, 0, 10, 1.2, 6, k.dark); G(6, 0, 5, 9, 2.4, 1.6, k.dark); G(2, 0, -4.4, 2.6, 2.4, 5, k.grip); },
  gaunt(G, k, t) { G(2, 0, 0, 7, 5.4, 4.6, k.body); G(6.4, 0, 0, 2.4, 3, 3, k.dark, cyl); const W = t.firing ? t.spin * 2 : 0; G(9.6, 0, 0, .6, 8, 8, k.metal, cyl);
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + W; G(9.6, Math.cos(a) * 3.6, Math.sin(a) * 3.6, .7, 1.4, 1.4, k.dark); } G(-1.5, 0, -3, 3, 4.4, 3, k.grip); },
  lg(G, k, t) { G(5, 0, 0, 11, 4.4, 4.8, k.body); G(12, 0, 0, 7, 3, 3, k.gm, cyl); for (const f of [10, 12.4, 14.8]) G(f, 0, 0, 1, 4.4, 4.4, k.glow, cyl, 0);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + .5; G(17.5, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 4, .7, .7, k.metal); } G(19.6, 0, 0, 1.4, 1.4, 1.4, k.glow, sphere, 0); G(1.2, 0, -3.4, 2.4, 2.2, 5, k.grip); G(5, 0, 3.4, 7, 2.2, 1.4, k.dark); },
  pg(G, k) { G(5, 0, 0, 12, 5.4, 5.4, k.body); G(5, 0, 3.6, 9, 2.6, 2.6, k.glow, cyl, 0); G(13, 0, 0, 5, 3, 3, k.gm, cyl); G(15.8, 0, 0, 1, 4, 4, k.dark, cyl); G(1.4, 0, -3.6, 2.4, 2.2, 5, k.grip); },
  ng(G, k, t) { G(5, 0, 0, 12, 5.4, 5, k.body); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + t.spin * .4; G(15, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 9, .9, .9, k.gm, cyl); } G(18.5, 0, 0, 1, 4.6, 4.6, k.dark, cyl); G(5, 3.2, -1, 6, 1.4, 3.4, k.glow, rbox, 0); G(1.4, 0, -3.6, 2.4, 2.2, 5, k.grip); },
  prox(G, k) { G(5, 0, 0, 9, 5.6, 5.6, k.body, cyl); G(13, 0, .5, 9, 4.2, 4.2, k.gm, cyl); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; G(17.4, Math.cos(a) * 2.2, .5 + Math.sin(a) * 2.2, 2.4, .6, .6, k.glow, rbox, 0); } G(1, 0, -3.6, 2.4, 2.2, 5, k.grip); },
  rifle(G, k) { GUN_SHAPES.mg(G, k, { spin: 0 }); }
};
function gunKit(col) { // the colours a gun is drawn in, from the weapon's own colour
  const c = col || [.45, .45, .5];
  return { body: [c[0] * .55 + .1, c[1] * .55 + .1, c[2] * .55 + .1, 1], dark: [c[0] * .35 + .05, c[1] * .35 + .05, c[2] * .35 + .06, 1], gm: [.2, .21, .23, 1], metal: [.62, .64, .68, 1],
    grip: [.15, .13, .12, 1], wood: [.4, .26, .14, 1], glow: [...c.map(v => Math.min(1, v * 1.5 + .2)), 1] };
}
const GUN_GLOW = { blaster: [1, .7, .25], hb: [1, .75, .3], rail: [.4, 1, .5], bfg: [.4, 1, .4], lg: [.6, .8, 1], pg: [.4, .6, 1], ng: [1, .6, .2], prox: [1, .3, .2], rl: [1, .3, .2], gaunt: [.8, .8, .9] };
function drawGunShape(name, G, col, t) { const kit = gunKit(col); if (GUN_GLOW[name]) kit.glow = [...GUN_GLOW[name], 1]; (GUN_SHAPES[name] || GUN_SHAPES.mg)(G, kit, t); }
// ---------- the lightning gun's beam ----------
// Quake III draws the bolt as four textured ribbons crossed around the line of fire, 8 units wide, the texture repeating every 128 units
// and scrolling toward the target. "lightning3new" is 1.32's bolt (two scrolling layers that flicker), "lightning3" the original one.
// Without the pk3 the built-in bolt texture stands in; "particles" is the old particle arc.
const beamP = gl && prog(gl, H + `in vec3 aPos;in vec2 aUV;uniform mat4 uVP;out vec2 vUV;void main(){vUV=aUV;gl_Position=uVP*vec4(aPos,1.);}`,
  H + `in vec2 vUV;uniform sampler2D uTex;uniform vec4 uCol;uniform vec3 uST;out vec4 o;void main(){vec3 c=texture(uTex,vec2(vUV.x*uST.x+uST.y,vUV.y)).rgb;o=vec4(c*uCol.rgb*uCol.a,1.);}`, ['aPos', 'aUV']);
const beamVAO = gl && gl.createVertexArray(), beamVBO = gl && gl.createBuffer();
if (gl) { gl.bindVertexArray(beamVAO); gl.bindBuffer(gl.ARRAY_BUFFER, beamVBO); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12); gl.bindVertexArray(null); }
const LG_TEX = {}; // style -> { tex, src }
function boltTexture() { // a jagged white-blue bolt on black, for when the pk3's picture isn't there
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 32);
  for (const [w, col] of [[7, 'rgba(60,90,255,.35)'], [3.5, 'rgba(140,170,255,.8)'], [1.4, '#fff']]) for (let pass = 0; pass < 2; pass++) {
    let seed = 7 + pass * 31; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647; g.strokeStyle = col; g.lineWidth = w * (pass ? .6 : 1); g.beginPath(); g.moveTo(0, 16);
    for (let x = 8; x <= 256; x += 8) g.lineTo(x, x === 256 ? 16 : 16 + (r() - .5) * (pass ? 22 : 16)); g.stroke(); }
  return makeTex(gl, c);
}
function lgTex(style) {
  if (LG_TEX[style]) return LG_TEX[style];
  const e = LG_TEX[style] = { tex: null, src: 'built-in' }; if (!LG_TEX.builtin) LG_TEX.builtin = { tex: boltTexture(), src: 'built-in' };
  e.tex = LG_TEX.builtin.tex;
  if (style === 'new' || style === 'old') loadImg(style === 'new' ? 'gfx/misc/lightning3new.tga' : 'gfx/misc/lightning3.tga').then(r => {
    if (!r) return; e.tex = r.bitmap ? makeTex(gl, r.bitmap) : makeTex(gl, r.rgba, r.w, r.h); e.src = 'pk3';
  }).catch(() => {});
  return e;
}
function resetLgTex() { for (const k of Object.keys(LG_TEX)) if (k !== 'builtin') delete LG_TEX[k]; } // new paks loaded: look for the pictures again
function lgBeamSeg() { // where the bolt runs this frame: from the gun's barrel to whatever the shot hits
  if (S.wset !== 'q3' || PL.dead || !W3.lgOn || !attackHeld() || W3.state !== 'ready' || (Q3W[W3.cur] || {}).name !== 'Lightning Gun') return null;
  const { f, r, u } = aimVectors(), o = ps.origin.map(v => v / 8), eye = [o[0], o[1], o[2] + pm.viewheight];
  const t = Q.trace(q3Muzzle(), Z3, Z3, eye.map((v, i) => v + f[i] * 768), Q.MASK_SHOT);
  const s = S.third ? eye.map((v, i) => v + f[i] * 18 + r[i] * 8 - u[i] * 12) : eye.map((v, i) => v + f[i] * 20 + r[i] * 5.5 - u[i] * 5);
  return { a: s, b: t.endpos };
}
function drawLgBeam(vp) {
  const style = S.lgBeam || 'new'; if (style === 'particles' || style === 'off') return;
  const seg = lgBeamSeg(); if (!seg) return;
  const { a, b } = seg, d = sub3(b, a), len = Math.hypot(...d); if (len < 2) return;
  const f = d.map(x => x / len), up0 = Math.abs(f[2]) < .9 ? [0, 0, 1] : [1, 0, 0], R0 = nrm(Q.cross(f, up0)), U0 = Q.cross(f, R0), v = [], hw = 4, s1 = len / 256;
  for (let i = 0; i < 4; i++) { // four ribbons, 45 degrees apart
    const an = i * Math.PI / 4, R = [0, 1, 2].map(k => (R0[k] * Math.cos(an) + U0[k] * Math.sin(an)) * hw);
    const p = (q, sg) => [q[0] + R[0] * sg, q[1] + R[1] * sg, q[2] + R[2] * sg];
    const A0 = p(a, -1), A1 = p(a, 1), B0 = p(b, -1), B1 = p(b, 1);
    v.push(...A0, 0, 0, ...B0, s1, 0, ...B1, s1, 1, ...A0, 0, 0, ...B1, s1, 1, ...A1, 0, 1);
  }
  const T = lgTex(style).tex, now = realTime / 1000;
  gl.useProgram(beamP.p); gl.bindVertexArray(beamVAO); gl.bindBuffer(gl.ARRAY_BUFFER, beamVBO); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STREAM_DRAW);
  gl.uniformMatrix4fv(beamP.u.uVP, false, vp); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T); gl.uniform1i(beamP.u.uTex, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  const wave = (base, amp, freq, ph = 0) => Math.max(0, Math.min(1, base + amp * Math.sin((now * freq + ph) * Math.PI * 2)));
  if (style === 'new') { // lightningBoltNew: two layers, scrolling at different speeds, flickering
    gl.uniform3f(beamP.u.uST, 2, -5 * now % 1, 0); gl.uniform4f(beamP.u.uCol, 1, 1, 1, wave(1, 5.1, 7.1)); gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
    gl.uniform3f(beamP.u.uST, -1, -2 * now % 1, 0); gl.uniform4f(beamP.u.uCol, 1, 1, 1, wave(1, 8.2, 9.3, .3)); gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
  } else if (style === 'old') { // lightningBolt
    gl.uniform3f(beamP.u.uST, 2, -5 * now % 1, 0); gl.uniform4f(beamP.u.uCol, 1, 1, 1, wave(1, .5, 7.1)); gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
  } else { // built-in bolt
    gl.uniform3f(beamP.u.uST, 2, -4 * now % 1, 0); gl.uniform4f(beamP.u.uCol, .85, .9, 1, wave(.8, .25, 11)); gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
    gl.uniform3f(beamP.u.uST, -1.3, -1.7 * now % 1, 0); gl.uniform4f(beamP.u.uCol, .6, .7, 1, wave(.6, .4, 13, .4)); gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
  }
  glows.push({ p: b.slice(), s: 10 + Math.random() * 6, c: [.6, .75, 1, .9] }); // where it hits
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(null);
}
// drones (flyer, floater, hover...) and other non-humanoids: drawn in a frame M at a size
function drawDrone(vp, M, s, style, t) {
  const st = style || { body: [.45, .42, .5], plate: [.65, .6, .7], visor: [1, .4, .2] }, B = (x, y, z, sx, sy, sz, col, lit = 1, m = rbox) => drawSolid(vp, m, mul(M, trs(x * s, y * s, z * s, sx * s, sy * s, sz * s)), col, lit);
  const flap = Math.sin((t || 0) * 18) * .35;
  B(0, 0, 0, 1, .85, .7, c4(st.body), 1, sphere); B(-.1, 0, .32, .8, .7, .3, c4(st.plate));
  B(.58, 0, .05, .22, .5, .22, c4(st.visor, 1.3), 0); B(.5, 0, -.35, .45, .18, .18, [.2, .2, .22, 1]);
  for (const sgn of [-1, 1]) { const W = mul(M, mul(trs(0, sgn * .55 * s, .1 * s, 1, 1, 1), new Float32Array([1, 0, 0, 0, 0, Math.cos(flap * sgn), Math.sin(flap * sgn), 0, 0, -Math.sin(flap * sgn), Math.cos(flap * sgn), 0, 0, 0, 0, 1])));
    drawSolid(vp, rbox, mul(W, trs(-.1 * s, sgn * .55 * s, 0, .7 * s, 1.1 * s, .08 * s)), c4(st.plate, .85)); }
  B(-.75, 0, 0, .35, .25, .25, c4(st.body, .7));
  glows.push({ p: [M[12] + M[0] * .7 * s, M[13] + M[1] * .7 * s, M[14] + M[2] * .7 * s + .05 * s], s: 3 + s * .06, c: [...st.visor, .7] });
}
const DRONE = { flyer: { body: [.42, .45, .52], plate: [.62, .66, .74], visor: [1, .45, .2] }, float: { body: [.45, .4, .32], plate: [.65, .58, .45], visor: [.4, 1, .5] }, hover: { body: [.5, .32, .3], plate: [.7, .48, .42], visor: [1, .9, .3] }, flipper: { body: [.3, .45, .5], plate: [.5, .65, .7], visor: [1, .3, .3] } };
let missingTex = null;
function getMissing() {
  if (missingTex) return missingTex;
  const d = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const c = ((x >> 3) ^ (y >> 3)) & 1 ? 92 : 64, i = (y * 64 + x) * 4; d[i] = c; d[i + 1] = c - 6; d[i + 2] = c - 14; d[i + 3] = 255; }
  return (missingTex = { tex: makeTex(gl, d, 64, 64), w: 64, h: 64 });
}

// ---------- palette & image decoders (PCX / TGA / PNG) ----------
let palette = null;
async function loadPalette() {
  const d = await vfsGet('pics/colormap.pcx'); const p = new Uint8Array(768);
  if (d && d.length > 900) p.set(d.subarray(d.length - 768)); else for (let i = 0; i < 256; i++) p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = i;
  palette = p;
}
function decodePCX(d, transparent255) {
  if (!d || d.length < 128 + 769 || d[0] !== 10 || d[3] !== 8 || d[65] !== 1) return null;
  const u16 = o => d[o] | d[o + 1] << 8, w = u16(8) - u16(4) + 1, h = u16(10) - u16(6) + 1, bpl = u16(66);
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096 || bpl < w) return null;
  const pal = d[d.length - 769] === 12 ? d.subarray(d.length - 768) : palette;
  const total = bpl * h, idx = new Uint8Array(total); let o = 0, p = 128;
  while (o < total && p < d.length) { const b = d[p++]; if ((b & 0xC0) === 0xC0) { const n = b & 0x3F, v = d[p++]; for (let k = 0; k < n && o < total; k++) idx[o++] = v; } else idx[o++] = b; }
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = idx[y * bpl + x], i = (y * w + x) * 4; rgba[i] = pal[c * 3]; rgba[i + 1] = pal[c * 3 + 1]; rgba[i + 2] = pal[c * 3 + 2]; rgba[i + 3] = transparent255 && c === 255 ? 0 : 255; }
  return { w, h, rgba };
}
function decodeTGA(d) { // all the usual flavours: colour-mapped / true-colour / grey, raw or RLE, 8-32 bit, any origin
  if (!d || d.length < 18) return null;
  const idl = d[0], cmt = d[1], type = d[2], cmFirst = d[3] | d[4] << 8, cmLen = d[5] | d[6] << 8, cmBits = d[7], w = d[12] | d[13] << 8, h = d[14] | d[15] << 8, bits = d[16], desc = d[17];
  const rle = type >= 9, base = type & 7; if (![1, 2, 3].includes(base) || !w || !h || w > 8192 || h > 8192) return null;
  const bp = Math.ceil(bits / 8); if (base === 1 ? ![8, 16].includes(bits) : base === 3 ? ![8, 16].includes(bits) : ![15, 16, 24, 32].includes(bits)) return null;
  let p = 18 + idl, pal = null;
  if (cmt === 1 || base === 1) {
    const cb = Math.ceil(cmBits / 8); pal = new Uint8Array((cmFirst + cmLen) * 4);
    for (let i = 0; i < cmLen; i++, p += cb) { const o = (cmFirst + i) * 4; if (cb >= 3) { pal[o] = d[p + 2]; pal[o + 1] = d[p + 1]; pal[o + 2] = d[p]; pal[o + 3] = cb === 4 ? d[p + 3] : 255; } else { const v = d[p] | d[p + 1] << 8; pal[o] = (v >> 10 & 31) * 255 / 31; pal[o + 1] = (v >> 5 & 31) * 255 / 31; pal[o + 2] = (v & 31) * 255 / 31; pal[o + 3] = 255; } }
  } else if (cmt === 1) p += 0;
  const n = w * h, px = new Uint8Array(n * 4);
  const read = o => {
    if (base === 1) { const c = bits === 8 ? d[p] : d[p] | d[p + 1] << 8, q = c * 4; px[o] = pal[q] || 0; px[o + 1] = pal[q + 1] || 0; px[o + 2] = pal[q + 2] || 0; px[o + 3] = pal[q + 3] === undefined ? 255 : pal[q + 3]; }
    else if (base === 3) { px[o] = px[o + 1] = px[o + 2] = d[p]; px[o + 3] = bits === 16 ? d[p + 1] : 255; }
    else if (bits === 24 || bits === 32) { px[o] = d[p + 2]; px[o + 1] = d[p + 1]; px[o + 2] = d[p]; px[o + 3] = bits === 32 ? d[p + 3] : 255; }
    else { const v = d[p] | d[p + 1] << 8; px[o] = (v >> 10 & 31) * 255 / 31; px[o + 1] = (v >> 5 & 31) * 255 / 31; px[o + 2] = (v & 31) * 255 / 31; px[o + 3] = bits === 16 && !(v & 0x8000) && (desc & 15) ? 0 : 255; }
    p += bp;
  };
  let i = 0;
  if (!rle) { for (; i < n && p + bp <= d.length; i++) read(i * 4); }
  else while (i < n && p < d.length) {
    const hd = d[p++], cnt = (hd & 0x7f) + 1;
    if (hd & 0x80) { const o0 = i * 4; read(o0); i++; for (let k = 1; k < cnt && i < n; k++, i++) px.copyWithin(i * 4, o0, o0 + 4); }
    else for (let k = 0; k < cnt && i < n; k++, i++) read(i * 4);
  }
  if (i < n * .5) return null; // truncated beyond use
  // 32-bit files without a real alpha channel (all zero) are opaque
  if (bits === 32 && !(desc & 15)) { let any = 0; for (let k = 3; k < px.length; k += 4) if (px[k]) { any = 1; break; } if (!any) for (let k = 3; k < px.length; k += 4) px[k] = 255; }
  const flipX = desc & 0x10, flipY = !(desc & 0x20);
  if (flipX) for (let y = 0; y < h; y++) for (let x = 0; x < w >> 1; x++) { const a = (y * w + x) * 4, b = (y * w + w - 1 - x) * 4; for (let c = 0; c < 4; c++) { const t = px[a + c]; px[a + c] = px[b + c]; px[b + c] = t; } }
  if (flipY) { const row = w * 4, tmp = new Uint8Array(row); for (let y = 0; y < h >> 1; y++) { const a = y * row, b = (h - 1 - y) * row; tmp.set(px.subarray(a, a + row)); px.copyWithin(a, b, b + row); px.set(tmp, b); } }
  return { w, h, rgba: px };
}
async function loadImg(path, transp) {
  if (!path) return null;
  const m = path.match(/^(.*)\.([a-z0-9]+)$/i), base = m ? m[1] : path, first = m ? m[2].toLowerCase() : 'pcx';
  if (!palette) await loadPalette();
  for (const ext of [...new Set([first, 'pcx', 'tga', 'png', 'jpg'])]) {
    const d = await vfsGet(base + '.' + ext); if (!d) continue;
    if (ext === 'pcx') { const r = decodePCX(d, transp); if (r) return r; }
    else if (ext === 'tga') { const r = decodeTGA(d); if (r) return r; }
    else { try { const bmp = await createImageBitmap(new Blob([d])); return { w: bmp.width, h: bmp.height, bitmap: bmp }; } catch (e) {} }
  }
  return null;
}

// ---------- MD2 models ----------
function parseMD2(d) {
  if (!d || d.length < 68) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (dv.getUint32(0, true) !== 0x32504449 || dv.getInt32(4, true) !== 8) return null;
  const I = o => dv.getInt32(o, true), F = o => dv.getFloat32(o, true);
  const sw = I(8), sh = I(12), fsize = I(16), nsk = I(20), nxyz = I(24), ntri = I(32), nfr = I(40), osk = I(44), ost = I(48), otri = I(52), ofr = I(56);
  if (nxyz <= 0 || ntri <= 0 || nfr <= 0 || ofr + nfr * fsize > d.length) return null;
  const skins = []; for (let i = 0; i < nsk; i++) skins.push(Q.cstr(d, osk + i * 64, 64));
  const corners = new Uint32Array(ntri * 3), uv = new Float32Array(ntri * 6);
  for (let i = 0; i < ntri; i++) for (let k = 0; k < 3; k++) {
    const xi = dv.getUint16(otri + i * 12 + k * 2, true), si = dv.getUint16(otri + i * 12 + 6 + k * 2, true);
    corners[i * 3 + k] = xi < nxyz ? xi : 0;
    uv[(i * 3 + k) * 2] = (dv.getInt16(ost + si * 4, true) + 0.5) / sw; uv[(i * 3 + k) * 2 + 1] = (dv.getInt16(ost + si * 4 + 2, true) + 0.5) / sh;
  }
  const frames = [], anims = {}; let flip = 0;
  for (let f = 0; f < nfr; f++) {
    const o = ofr + f * fsize, sc = [F(o), F(o + 4), F(o + 8)], tr = [F(o + 12), F(o + 16), F(o + 20)], name = Q.cstr(d, o + 24, 16).toLowerCase();
    const xyz = new Float32Array(nxyz * 3), nrm = new Float32Array(nxyz * 3);
    for (let v = 0; v < nxyz; v++) for (let k = 0; k < 3; k++) xyz[v * 3 + k] = d[o + 40 + v * 4 + k] * sc[k] + tr[k];
    for (let i = 0; i < ntri; i++) {
      const a = corners[i * 3] * 3, b = corners[i * 3 + 1] * 3, c = corners[i * 3 + 2] * 3;
      const e1 = [xyz[b] - xyz[a], xyz[b + 1] - xyz[a + 1], xyz[b + 2] - xyz[a + 2]], e2 = [xyz[c] - xyz[a], xyz[c + 1] - xyz[a + 1], xyz[c + 2] - xyz[a + 2]], n = Q.cross(e1, e2);
      for (const v of [a, b, c]) { nrm[v] += n[0]; nrm[v + 1] += n[1]; nrm[v + 2] += n[2]; }
    }
    for (let v = 0; v < nxyz; v++) { const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1; nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l; }
    if (f === 0) { const c = [0, 0, 0]; for (let v = 0; v < nxyz; v++) for (let k = 0; k < 3; k++) c[k] += xyz[v * 3 + k] / nxyz; for (let v = 0; v < nxyz; v++) for (let k = 0; k < 3; k++) flip += nrm[v * 3 + k] * (xyz[v * 3 + k] - c[k]); }
    frames.push({ xyz, nrm, name });
    const mm = name.match(/^(.*?)(\d+)$/), an = (mm ? (mm[2].length >= 3 ? name.slice(0, -2) : mm[1]) : name) || 'frame'; (anims[an] = anims[an] || []).push(f);
  }
  if (flip < 0) for (const fr of frames) for (let i = 0; i < fr.nrm.length; i++) fr.nrm[i] = -fr.nrm[i];
  return { skins, corners, uv, frames, anims, n: ntri * 3 };
}
function makeCtx(g) { return { g, P: prog(g, MD2VS, MD2FS, MD2A), tex: new Map(), inst: new Map(), grey: null }; }
function md2Inst(ctx, model) {
  const g = ctx.g, vao = g.createVertexArray(); g.bindVertexArray(vao);
  const dyn = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, dyn); g.bufferData(g.ARRAY_BUFFER, model.n * 24, g.DYNAMIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, 24, 0);
  g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 3, g.FLOAT, false, 24, 12);
  const ub = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, ub); g.bufferData(g.ARRAY_BUFFER, model.uv, g.STATIC_DRAW);
  g.enableVertexAttribArray(2); g.vertexAttribPointer(2, 2, g.FLOAT, false, 8, 0);
  g.bindVertexArray(null);
  return { vao, dyn, buf: new Float32Array(model.n * 6), model };
}
// ---------- powerup effects ----------
// While Quad Damage / Invulnerability is running the viewmodel, your own body and every bot holding one pulse with a coloured glow in the model shader
// (uPow = colour + strength). The last five seconds flicker, and picking one up pops a screen flash.
const POW0 = [0, 0, 0, 0]; let POWV = POW0;
function powVec(q, i) {
  const aq = q > simTime, ai = i > simTime; if (!aq && !ai) return POW0;
  const left = Math.min(aq ? q - simTime : 1e9, ai ? i - simTime : 1e9); let a = .6;
  if (left < 5000) a *= Math.sin(realTime / 1000 * (9 + (5000 - left) / 350)) > 0 ? 1 : .2;
  const c = aq && ai ? [.8, .65, 1] : aq ? [.3, .5, 1] : [1, .78, .22]; return [c[0], c[1], c[2], a];
}
function powPop(kind) { const pf = $('powfx'); if (!pf) return; pf.dataset.k = kind; pf.classList.remove('pop'); void pf.offsetWidth; pf.classList.add('pop'); addLight(ps.origin.map(v => v / 8), 300, kind === 'quad' ? [.3, .5, 1] : [1, .8, .25], .6); }
function md2Draw(ctx, inst, tex, fa, fb, t, vp, M, shade = 1, amb = 0.5) {
  const g = ctx.g, m = inst.model, nf = m.frames.length;
  const A = m.frames[Math.min(fa, nf - 1)], B = m.frames[Math.min(fb, nf - 1)], out = inst.buf, c = m.corners;
  for (let i = 0; i < m.n; i++) {
    const v = c[i] * 3, o = i * 6;
    out[o] = A.xyz[v] + (B.xyz[v] - A.xyz[v]) * t; out[o + 1] = A.xyz[v + 1] + (B.xyz[v + 1] - A.xyz[v + 1]) * t; out[o + 2] = A.xyz[v + 2] + (B.xyz[v + 2] - A.xyz[v + 2]) * t;
    out[o + 3] = A.nrm[v] + (B.nrm[v] - A.nrm[v]) * t; out[o + 4] = A.nrm[v + 1] + (B.nrm[v + 1] - A.nrm[v + 1]) * t; out[o + 5] = A.nrm[v + 2] + (B.nrm[v + 2] - A.nrm[v + 2]) * t;
  }
  g.bindBuffer(g.ARRAY_BUFFER, inst.dyn); g.bufferSubData(g.ARRAY_BUFFER, 0, out);
  const P = ctx.P; g.useProgram(P.p);
  g.uniformMatrix4fv(P.u.uMVP, false, mul(vp, M)); g.uniformMatrix4fv(P.u.uM, false, M);
  g.uniform1f(P.u.uAmb, amb); g.uniform1f(P.u.uShade, shade); g.uniform4fv(P.u.uPow, POWV); g.uniform1f(P.u.uPowT, realTime / 1000);
  if (ctx === mainCtx) { g.uniform4fv(P.u['uDL[0]'], DLP); g.uniform3fv(P.u['uDLC[0]'], DLC); g.uniform1i(P.u.uNDL, nDL); } else g.uniform1i(P.u.uNDL, 0); g.uniform3fv(P.u.uLDir, [0.4, 0.3, 0.866]); g.uniform1i(P.u.uTex, 0);
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex || greyTex(ctx));
  g.bindVertexArray(inst.vao); g.drawArrays(g.TRIANGLES, 0, m.n);
}
function greyTex(ctx) { return ctx.grey || (ctx.grey = makeTex(ctx.g, new Uint8Array([150, 150, 150, 255]), 1, 1)); }
function animFrames(model, name, time, loop) {
  const fr = model.anims[name] || model.anims.stand || [0];
  const pos = Math.max(0, time) * 10; let i = Math.floor(pos); const t = pos - i;
  if (loop) { i %= fr.length; return [fr[i], fr[(i + 1) % fr.length], t]; }
  if (i >= fr.length - 1) return [fr[fr.length - 1], fr[fr.length - 1], 0];
  return [fr[i], fr[i + 1], t];
}
const md2Cache = new Map();
async function getMD2(path) { if (!md2Cache.has(path)) md2Cache.set(path, parseMD2(await vfsGet(path))); return md2Cache.get(path); }
async function getSkin(ctx, path) {
  if (!path) return null; path = path.toLowerCase();
  if (ctx.tex.has(path)) return ctx.tex.get(path);
  const img = await loadImg(path); const t = img ? makeTex(ctx.g, img.bitmap || img.rgba, img.w, img.h) : null;
  ctx.tex.set(path, t); return t;
}
function getInst(ctx, path, m) { if (!ctx.inst.has(path)) ctx.inst.set(path, md2Inst(ctx, m)); return ctx.inst.get(path); }
async function loadSimple(ctx, path) {
  const m = await getMD2(path); if (!m) return null;
  const tex = (await getSkin(ctx, m.skins[0])) || (await getSkin(ctx, path.replace(/[^/]+$/, 'skin.pcx')));
  return { m, inst: getInst(ctx, path, m), tex };
}
async function loadCharacter(ctx, model, skin) {
  const base = 'players/' + model + '/', m = await getMD2(base + 'tris.md2'); if (!m) return null;
  const tex = (await getSkin(ctx, base + skin + '.pcx')) || (await getSkin(ctx, m.skins[0]));
  const weps = [];
  for (const d of WEAPONS) {
    let wp = base + d.w + '.md2'; if (!VFS.has(wp)) wp = base + 'weapon.md2';
    const wm = VFS.has(wp) ? await getMD2(wp) : null;
    weps.push(wm ? { inst: getInst(ctx, wp, wm), tex: (await getSkin(ctx, wm.skins[0])) || (await getSkin(ctx, base + 'weapon.pcx')) } : null);
  }
  return { m, inst: getInst(ctx, base + 'tris.md2', m), tex, weps };
}
function listPlayerModels() { const s = new Set(); for (const k of VFS.keys()) { const m = k.match(/^players\/([^/]+)\/tris\.md2$/); if (m) s.add(m[1]); } return [...s].sort(); }
function listSkins(model) {
  const pre = 'players/' + model + '/', s = new Set();
  for (const k of VFS.keys()) { if (!k.startsWith(pre)) continue; const m = k.slice(pre.length).match(/^([^/]+)\.(pcx|tga|png)$/); if (m && !/_i$/.test(m[1]) && !/^(weapon|w_)/.test(m[1])) s.add(m[1]); }
  return [...s].sort();
}

// ---------- world mesh building ----------
function grp(G, key, props) { let g = G.get(key); if (!g) { g = Object.assign({ v: [], i: [] }, props); G.set(key, g); } return g; }
function addPoly(g, pts) { const base = g.v.length / 8; for (const p of pts) g.v.push(...p); for (let k = 2; k < pts.length; k++) g.i.push(base, base + k - 1, base + k); }
function uploadWorld(G, lmTex) {
  let nv = 0, ni = 0; for (const g of G.values()) { nv += g.v.length; ni += g.i.length; }
  const vb = new Float32Array(nv), ib = new Uint32Array(ni); let vo = 0, io = 0; const batches = [];
  for (const g of G.values()) {
    vb.set(g.v, vo); const base = vo / 8; for (let k = 0; k < g.i.length; k++) ib[io + k] = g.i[k] + base;
    batches.push({ anim: g.anim, animFps: g.animFps, tex: g.tex, kind: g.kind, alpha: g.alpha, warp: g.warp, liquid: g.liquid || 0, alphaTest: g.alphaTest, texAlpha: g.texAlpha, scroll: g.scroll, model: g.model || 0, polyOff: !!g.polyOff, start: io, count: g.i.length });
    vo += g.v.length; io += g.i.length;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, vb, gl.STATIC_DRAW);
  [3, 2, 2, 1].reduce((off, s, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, s, gl.FLOAT, false, 32, off); return off + s * 4; }, 0);
  const e = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const kinds = { opaque: [], sky: [], trans: [], add: [] }; for (const bt of batches) kinds[bt.kind].push(bt);
  return { vao, lmTex, bufs: [b, e], ...kinds, tris: ni / 3, mstate: {} };
}
function freeWorld(w) {
  if (!w) return; gl.deleteVertexArray(w.vao); w.bufs.forEach(b => gl.deleteBuffer(b));
  if (w.lmTex) gl.deleteTexture(w.lmTex); if (w.skyTex) gl.deleteTexture(w.skyTex);
  (w.textures || []).forEach(t => (!missingTex || t !== missingTex.tex) && gl.deleteTexture(t));
}
function Atlas(size) { this.size = size; this.x = 0; this.y = 0; this.row = 0; this.data = new Uint8Array(size * size * 4); }
Atlas.prototype.alloc = function (w, h) {
  if (this.x + w > this.size) { this.x = 0; this.y += this.row; this.row = 0; }
  if (this.y + h > this.size) return null;
  const r = { x: this.x, y: this.y }; this.x += w; this.row = Math.max(this.row, h); return r;
};

// ---------- built-in test map ----------
function procTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  let seed = kind.length * 977; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fill = col => { g.fillStyle = col; g.fillRect(0, 0, 128, 128); };
  const speck = (n, a, light) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${a * rnd()})`; g.fillRect(rnd() * 128 | 0, rnd() * 128 | 0, 1 + (rnd() * 2 | 0), 1 + (rnd() * 2 | 0)); } };
  const grid = (step, dark, light) => { for (let p = 0; p < 128; p += step) { g.fillStyle = dark; g.fillRect(p, 0, 2, 128); g.fillRect(0, p, 128, 2); g.fillStyle = light; g.fillRect(p + 2, 0, 1, 128); g.fillRect(0, p + 2, 128, 1); } };
  switch (kind) {
    case 'floor': fill('#43443e'); speck(900, .25); speck(400, .08, 1); grid(64, '#26271f', '#5a5b52'); break;
    case 'tile': fill('#8fb0b8'); speck(300, .12); grid(32, '#5f7d86', '#b5d0d6'); break;
    case 'water': fill('#1d5874'); for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(160,220,240,${.1 + rnd() * .2})`; g.lineWidth = 2; g.beginPath(); const y = rnd() * 128; g.moveTo(0, y); for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x / 20 + i) * 4); g.stroke(); } break;
    case 'wall': fill('#6a4630'); speck(1500, .3); speck(300, .1, 1); for (let x = 0; x < 128; x += 64) { g.fillStyle = '#3b2518'; g.fillRect(x, 0, 3, 128); g.fillStyle = '#86603f'; g.fillRect(x + 3, 0, 1, 128); }
      g.fillStyle = '#2d1c12'; g.fillRect(0, 60, 128, 8); g.fillStyle = '#8a6a48'; for (let x = 8; x < 128; x += 16) { g.beginPath(); g.arc(x, 20, 2, 0, 7); g.arc(x, 108, 2, 0, 7); g.fill(); } break;
    case 'metal': fill('#56616a'); for (let y = 0; y < 128; y += 8) for (let x = (y / 8 % 2) * 8; x < 128; x += 16) { g.fillStyle = '#6f7c86'; g.fillRect(x, y + 2, 6, 2); g.fillStyle = '#3c454c'; g.fillRect(x, y + 4, 6, 1); } speck(500, .15); grid(128, '#2c3238', '#7b8892'); break;
    case 'plat': fill('#7b6a3e'); speck(800, .2); g.fillStyle = '#1b1a14'; g.fillRect(0, 0, 128, 14); for (let x = -14; x < 140; x += 20) { g.fillStyle = '#e0b02a'; g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 10, 14); g.lineTo(x + 20, 0); g.lineTo(x + 10, 0); g.fill(); } grid(64, '#4b4026', '#97855a'); break;
    case 'tower': fill('#4c5845'); speck(1400, .25); speck(300, .08, 1); for (let y = 0; y < 128; y += 32) { g.fillStyle = '#2f382b'; g.fillRect(0, y, 128, 2); for (let x = (y / 32 % 2) * 32; x < 128; x += 64) g.fillRect(x, y, 2, 32); } break;
    case 'ladder': fill('#242424'); for (let y = 4; y < 128; y += 16) { g.fillStyle = '#b8892f'; g.fillRect(0, y, 128, 5); g.fillStyle = '#e9c46a'; g.fillRect(0, y, 128, 1); } break;
    case 'pad': fill('#08240f'); for (let y = -8; y < 140; y += 32) { g.strokeStyle = '#4dff7a'; g.lineWidth = 7; g.beginPath(); g.moveTo(20, y + 24); g.lineTo(64, y); g.lineTo(108, y + 24); g.stroke(); } break;
    case 'ramp': fill('#5b4d45'); speck(900, .2); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; for (let x = -128; x < 256; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 128, 128); g.stroke(); } break;
    case 'crate': fill('#7d5a2e'); speck(600, .2); g.strokeStyle = '#4a3216'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118); g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.moveTo(118, 10); g.lineTo(10, 118); g.stroke(); break;
    case 'grate': fill('#3a3f42'); for (let y = 0; y < 128; y += 8) { g.fillStyle = '#1c1f21'; g.fillRect(0, y + 5, 128, 3); g.fillStyle = '#5a6266'; g.fillRect(0, y, 128, 1); } for (let x = 0; x < 128; x += 32) { g.fillStyle = '#25292b'; g.fillRect(x, 0, 3, 128); g.fillStyle = '#687075'; g.fillRect(x + 3, 0, 1, 128); } speck(400, .2); break;
    case 'panel': fill('#5d646b'); speck(500, .12); for (const [x, y, w, h] of [[0, 0, 64, 64], [64, 0, 64, 32], [64, 32, 64, 32], [0, 64, 128, 40], [0, 104, 64, 24], [64, 104, 64, 24]]) { g.fillStyle = '#3d4348'; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h); g.fillStyle = '#7c858c'; g.fillRect(x + 2, y + 2, w - 3, 1); g.fillRect(x + 2, y + 2, 1, h - 3); g.fillStyle = '#4a5156'; for (const [px, py] of [[x + 6, y + 6], [x + w - 8, y + 6], [x + 6, y + h - 8], [x + w - 8, y + h - 8]]) g.fillRect(px, py, 2, 2); }
      g.fillStyle = '#2b3034'; g.fillRect(8, 74, 112, 20); g.fillStyle = '#d6a72a'; for (let x = 12; x < 116; x += 12) g.fillRect(x, 80, 6, 8); break;
    case 'concrete': fill('#6b6862'); speck(2200, .18); speck(900, .07, 1); g.strokeStyle = 'rgba(40,38,34,.5)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126); g.beginPath(); g.moveTo(20, 30); g.lineTo(44, 52); g.lineTo(40, 70); g.stroke(); break;
    case 'hazard': fill('#1b1a16'); for (let x = -128; x < 256; x += 32) { g.fillStyle = '#e1b120'; g.beginPath(); g.moveTo(x, 128); g.lineTo(x + 16, 128); g.lineTo(x + 144, 0); g.lineTo(x + 128, 0); g.fill(); } speck(600, .25); break;
    case 'lamp': fill('#fff6dc'); g.fillStyle = '#ffffff'; g.fillRect(16, 16, 96, 96); g.fillStyle = 'rgba(200,180,140,.5)'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 3, 128); break;
    case 'pipe': fill('#4f5a52'); for (let y = 0; y < 128; y++) { const k = .55 + .45 * Math.sin(y / 128 * Math.PI * 4); g.fillStyle = `rgba(${150 * k | 0},${165 * k | 0},${150 * k | 0},.55)`; g.fillRect(0, y, 128, 1); } g.fillStyle = '#2c312d'; for (let x = 0; x < 128; x += 64) g.fillRect(x, 0, 6, 128); speck(300, .2); break;
    case 'reactor': fill('#10203a'); for (let y = 0; y < 128; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, '#2b6dff'); gr.addColorStop(.5, '#9fd0ff'); gr.addColorStop(1, '#1a3d8f'); g.fillStyle = gr; g.fillRect(8, y + 3, 112, 10); } g.fillStyle = '#0a1426'; g.fillRect(0, 0, 8, 128); g.fillRect(120, 0, 8, 128); break;
    case 'sky': { const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, '#0b1430'); gr.addColorStop(1, '#16224a'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${.25 + rnd() * .75})`; const s = rnd() < .15 ? 2 : 1; g.fillRect(rnd() * 128 | 0, rnd() * 128 | 0, s, s); } break; }
    case 'slime': fill('#2f6a1c'); for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${120 + rnd() * 80 | 0},${200 + rnd() * 55 | 0},60,${.15 + rnd() * .3})`; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 2 + rnd() * 9, 0, 7); g.fill(); } break;
    case 'exitpad': fill('#062a16'); g.strokeStyle = '#4dff9a'; g.lineWidth = 5; for (let r = 12; r < 70; r += 16) { g.beginPath(); g.arc(64, 64, r, 0, 7); g.stroke(); } break;
    default: fill('#777');
  }
  return c;
}
let demoCache = null;
function buildDemoWorld() { return buildBrushWorld(Q.demoMap(), 'Test map', 'test'); }
function buildBrushWorld(d, name, id) {
  const G = new Map(), texCache = {}, cm = Q.cmFromBrushes(d.brushes), baked = !!(d.lights && d.lights.length);
  const W = 2 / 64, L = [0.45, 0.3, 0.8]; Q.normalize(L);
  const LIQ = { water: 1, slime: 2, lava: 3 }, FULL = { lamp: 1.8, sky: 1, exitpad: 1.5, reactor: 1.35 };
  const faces = [];
  for (const br of d.brushes) { const liq = LIQ[br.mat]; for (const f of Q.brushFaces(br.planes)) { if (liq && f.n[2] < 0.9) continue; faces.push({ br, w: f.w, n: f.n, d: Q.dot(f.n, f.w[0]), full: FULL[br.mat] || 0, liq }); } }
  let lm = null; if (baked) lm = bakeBrushLight(d, cm, faces.filter(f => !f.liq));
  for (const f of faces) {
    const mat = f.br.mat; if (!texCache[mat]) texCache[mat] = makeTex(gl, procTex(mat));
    const liq = f.liq, g = grp(G, mat, { tex: texCache[mat], kind: liq ? 'trans' : 'opaque', alpha: liq === 2 ? .8 : liq ? 0.45 : 1, warp: !!liq, liquid: liq || 0 });
    const n = f.n, ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const shade = mat === 'pad' ? 1 : (0.42 + 0.45 * Math.max(0, Q.dot(n, L)) + 0.13 * Math.max(0, n[2])) * (n[2] < -0.5 ? 0.6 : 1);
    addPoly(g, f.w.map(p => {
      let u, v; if (az >= ax && az >= ay) { u = p[0]; v = -p[1]; } else if (ax >= ay) { u = p[1]; v = -p[2]; } else { u = p[0]; v = -p[2]; }
      if (liq) return [p[0], p[1], p[2], u / 128, v / 128, W, W, liq === 2 ? .8 : 0.55];
      if (f.lmUV) { const t = f.lmUV(p); return [p[0], p[1], p[2], u / 128, v / 128, t[0], t[1], 1]; }
      return [p[0], p[1], p[2], u / 128, v / 128, W, W, shade * 0.5];
    }));
  }
  let lmTex; if (lm) lmTex = makeTex(gl, lm.data, lm.size, lm.size, { lightmap: true }); else { const atlas = new Atlas(64); atlas.data.fill(255); lmTex = makeTex(gl, atlas.data, 64, 64, { lightmap: true }); }
  const w = uploadWorld(G, lmTex);
  w.textures = []; w.cm = cm; w.staticTriggers = d.triggers.map(t => ({ ...t }));
  w.ents = d.barrels.map(b => ({ classname: 'misc_explobox', origin: b.join(' ') }));
  w.spawns = d.spawns.map(s => ({ ...s, name: '' })); w.name = name; w.demo = true; w.builtin = id;
  return w;
}
// ---------- built-in campaign: Outpost Kappa ----------
// A complete single-player level built from brushes, with baked light: a landing bay, a night courtyard, a warehouse with a mezzanine,
// a slime pit crossed on a bridge and a reactor hall guarded by a tank, ending at an exit teleporter.
function kappaMap() {
  const C = Q, B = [], P = (n, d) => ({ n, d }), lights = [], SOLID = C.CONTENTS_SOLID;
  const box = (x0, y0, z0, x1, y1, z1, mat, contents) => { if (x1 - x0 < .5 || y1 - y0 < .5 || z1 - z0 < .5) return null; const b = { planes: [P([-1, 0, 0], -x0), P([1, 0, 0], x1), P([0, -1, 0], -y0), P([0, 1, 0], y1), P([0, 0, -1], -z0), P([0, 0, 1], z1)], mat, contents: contents ?? SOLID }; B.push(b); return b; };
  const wedge = (x0, y0, z0, x1, y1, axis, hStart, hEnd, mat) => { const b = box(x0, y0, z0, x1, y1, Math.max(hStart, hEnd), mat), a0 = axis === 0 ? x0 : y0, a1 = axis === 0 ? x1 : y1, na = -(hEnd - hStart), nz = a1 - a0, l = Math.hypot(na, nz), n = [0, 0, nz / l]; n[axis] = na / l; b.planes.push(P(n, n[axis] * a0 + n[2] * hStart)); };
  const prism = (cx, cy, r, z0, z1, sides, mat) => { const pl = [P([0, 0, -1], -z0), P([0, 0, 1], z1)]; for (let i = 0; i < sides; i++) { const a = (i + .5) / sides * Math.PI * 2, n = [Math.cos(a), Math.sin(a), 0]; pl.push(P(n, n[0] * cx + n[1] * cy + r)); } B.push({ planes: pl, mat, contents: SOLID }); };
  const light = (x, y, z, r, col, fix = 'ceil') => { lights.push({ o: [x, y, z], r, c: col }); if (fix === 'ceil') box(x - 20, y - 20, z + 6, x + 20, y + 20, z + 14, 'lamp', 0); else if (fix === 'wall') box(x - 6, y - 6, z - 12, x + 6, y + 6, z + 12, 'lamp', 0); }; // lamp fittings are decoration: no collision, no shadow
  // a room is the air inside; walls, floor and ceiling are 32-unit slabs outside it, with openings cut where holes say
  const room = (x0, y0, x1, y1, z0, z1, m, holes = []) => {
    box(x0 - 32, y0 - 32, z0 - 32, x1 + 32, y1 + 32, z0, m.floor); if (m.ceil) box(x0 - 32, y0 - 32, z1, x1 + 32, y1 + 32, z1 + 32, m.ceil);
    const wall = (side, a0, a1, mk) => { // a0..a1 along the wall; mk(a, b, za, zb) builds a slab piece
      const hs = holes.filter(h => h.s === side).sort((p, q) => p.a0 - q.a0); let a = a0;
      for (const h of hs) { mk(a, h.a0, z0, z1); if (h.z1 < z1) mk(h.a0, h.a1, h.z1, z1); if (h.z0 > z0) mk(h.a0, h.a1, z0, h.z0); a = h.a1; }
      mk(a, a1, z0, z1);
    };
    wall('w', y0 - 32, y1 + 32, (a, b, za, zb) => box(x0 - 32, a, za, x0, b, zb, m.wall));
    wall('e', y0 - 32, y1 + 32, (a, b, za, zb) => box(x1, a, za, x1 + 32, b, zb, m.wall));
    wall('s', x0, x1, (a, b, za, zb) => box(a, y0 - 32, za, b, y0, zb, m.wall));
    wall('n', x0, x1, (a, b, za, zb) => box(a, y1, za, b, y1 + 32, zb, m.wall));
  };
  const trim = (x0, y0, x1, y1, z) => { box(x0, y0, z, x0 + 8, y1, z + 12, 'hazard'); box(x1 - 8, y0, z, x1, y1, z + 12, 'hazard'); box(x0 + 8, y0, z, x1 - 8, y0 + 8, z + 12, 'hazard'); box(x0 + 8, y1 - 8, z, x1 - 8, y1, z + 12, 'hazard'); };
  const W = [1, .88, .7], COOL = [.7, .85, 1], RED = [1, .35, .25], GREEN = [.45, 1, .4], BLUE = [.35, .6, 1];
  // A. landing bay
  room(-2304, -320, -1792, 320, 0, 288, { floor: 'grate', wall: 'panel', ceil: 'metal' }, [{ s: 'e', a0: -80, a1: 80, z0: 0, z1: 128 }]);
  box(-2304, -320, 0, -2176, 320, 48, 'metal'); box(-2304, -320, 48, -2240, 320, 160, 'pipe'); // machinery along the back wall
  box(-2048, -320, 0, -1984, -256, 96, 'crate'); box(-2048, 256, 0, -1984, 320, 64, 'crate'); box(-2112, 256, 0, -2048, 320, 128, 'crate');
  trim(-2112, -96, -1920, 96, 0);
  light(-2048, 0, 272, 420, W); light(-1888, -240, 272, 300, COOL); light(-1888, 240, 272, 300, COOL);
  // corridor 1
  room(-1760, -80, -1376, 80, 0, 128, { floor: 'floor', wall: 'panel', ceil: 'metal' }, [{ s: 'w', a0: -80, a1: 80, z0: 0, z1: 128 }, { s: 'e', a0: -80, a1: 80, z0: 0, z1: 128 }]);
  light(-1568, 0, 112, 260, W);
  // B. courtyard under a night sky
  room(-1344, -768, -320, 768, 0, 544, { floor: 'concrete', wall: 'wall', ceil: 'sky' }, [{ s: 'w', a0: -80, a1: 80, z0: 0, z1: 128 }, { s: 'e', a0: -80, a1: 80, z0: 0, z1: 128 }]);
  box(-1344, 576, 0, -320, 768, 128, 'tower'); // north walkway, with a railing that opens at the top of the stairs
  for (let i = 0; i < 8; i++) box(-736, 320 + 32 * i, 0, -608, 576, 16 * (i + 1), 'metal');
  box(-1344, 568, 128, -736, 576, 160, 'metal'); box(-608, 568, 128, -320, 576, 160, 'metal');
  for (const [x, y] of [[-1088, -512], [-576, -512], [-1088, 192], [-576, 192]]) { box(x - 24, y - 24, 0, x + 24, y + 24, 544, 'tower'); light(x + 32, y, 360, 360, x < -800 ? W : RED, 'wall'); }
  box(-960, -224, 0, -896, -160, 64, 'crate'); box(-896, -224, 0, -832, -160, 64, 'crate'); box(-928, -224, 64, -864, -160, 128, 'crate');
  box(-544, 32, 0, -480, 96, 64, 'crate'); box(-1248, -704, 0, -1120, -640, 64, 'crate'); box(-480, -704, 0, -416, -640, 96, 'crate');
  box(-832, -32, 0, -768, 32, 24, 'hazard'); // a drain grate in the middle of the yard
  light(-832, 0, 520, 900, [.45, .55, .8], 'none'); light(-832, 672, 300, 420, W, 'wall'); light(-1200, 672, 300, 380, COOL, 'wall');
  // corridor 2
  room(-288, -80, 96, 80, 0, 128, { floor: 'floor', wall: 'panel', ceil: 'metal' }, [{ s: 'w', a0: -80, a1: 80, z0: 0, z1: 128 }, { s: 'e', a0: -80, a1: 80, z0: 0, z1: 128 }]);
  light(-96, 0, 112, 260, RED);
  // C. warehouse with a mezzanine
  room(128, -576, 1152, 576, 0, 416, { floor: 'grate', wall: 'tower', ceil: 'metal' }, [{ s: 'w', a0: -80, a1: 80, z0: 0, z1: 128 }, { s: 'n', a0: 704, a1: 960, z0: 0, z1: 144 }]);
  box(128, -576, 160, 768, -352, 176, 'grate'); box(128, -360, 176, 768, -352, 208, 'metal'); // mezzanine deck + railing
  for (const x of [256, 512, 736]) box(x - 12, -364, 0, x + 12, -340, 160, 'pipe');
  wedge(768, -576, 0, 1088, -448, 0, 176, 0, 'ramp');
  const stack = (x, y, n) => { for (let k = 0; k < n; k++) box(x, y, k * 64, x + 64, y + 64, k * 64 + 64, 'crate'); };
  stack(320, 64, 2); stack(384, 64, 1); stack(320, 128, 1); stack(704, 256, 3); stack(768, 256, 1); stack(960, -192, 2); stack(1024, -192, 1); stack(560, -160, 1); stack(1024, 384, 2);
  light(320, -464, 400, 560, W); light(640, 0, 400, 640, W); light(960, 320, 400, 560, COOL); light(320, 400, 400, 480, RED); light(960, -320, 400, 520, W); light(640, 448, 400, 480, W); light(448, -464, 150, 300, W, 'none');
  // corridor 3 north
  room(704, 608, 960, 1024, 0, 144, { floor: 'floor', wall: 'panel', ceil: 'metal' }, [{ s: 's', a0: 704, a1: 960, z0: 0, z1: 144 }, { s: 'n', a0: 704, a1: 960, z0: 0, z1: 144 }]);
  light(832, 816, 128, 280, GREEN);
  // D. slime pit, crossed on a bridge
  room(384, 1056, 1280, 1824, -160, 384, { floor: 'concrete', wall: 'wall', ceil: 'metal' }, [{ s: 's', a0: 704, a1: 960, z0: 0, z1: 144 }, { s: 'n', a0: 704, a1: 960, z0: 0, z1: 144 }]);
  box(384, 1056, -160, 1280, 1184, 0, 'concrete'); box(384, 1696, -160, 1280, 1824, 0, 'concrete');
  trim(384, 1176, 1280, 1184, 0); trim(384, 1696, 1280, 1704, 0);
  box(784, 1184, -16, 880, 1696, 0, 'grate'); box(784, 1184, 0, 792, 1696, 24, 'metal'); box(872, 1184, 0, 880, 1696, 24, 'metal');
  for (const y of [1312, 1440, 1568]) box(808, y - 12, -160, 856, y + 12, -16, 'pipe'); // bridge supports
  box(600, 1420, -160, 664, 1484, 0, 'tower'); // a pillar you can jump to from the bridge
  for (let i = 0; i < 4; i++) box(1184, 1184, -160, 1280, 1376 - 32 * i, -48 + 16 * i, 'metal'); // steps out of the slime
  box(384, 1184, -160, 1280, 1696, -64, 'slime', C.CONTENTS_SLIME);
  light(832, 1440, 120, 700, GREEN, 'none'); light(560, 1120, 200, 380, W, 'wall'); light(1100, 1760, 200, 380, W, 'wall'); light(832, 1440, 368, 480, COOL);
  // corridor 4
  room(704, 1856, 960, 2208, 0, 144, { floor: 'floor', wall: 'panel', ceil: 'metal' }, [{ s: 's', a0: 704, a1: 960, z0: 0, z1: 144 }, { s: 'n', a0: 704, a1: 960, z0: 0, z1: 144 }]);
  light(832, 2032, 128, 280, RED);
  // E. reactor hall
  room(256, 2240, 1408, 3200, 0, 640, { floor: 'grate', wall: 'panel', ceil: 'metal' }, [{ s: 's', a0: 704, a1: 960, z0: 0, z1: 144 }]);
  prism(832, 2720, 120, 0, 640, 8, 'reactor'); prism(832, 2720, 168, 0, 48, 8, 'metal');
  for (const [x, y] of [[448, 2432], [1216, 2432], [448, 3008], [1216, 3008]]) prism(x, y, 32, 0, 640, 6, 'tower');
  box(256, 2560, 0, 448, 2880, 96, 'metal'); wedge(448, 2560, 0, 640, 2688, 0, 96, 0, 'ramp'); trim(256, 2560, 448, 2880, 96); // west platform
  box(1216, 2560, 0, 1408, 2880, 96, 'metal'); wedge(1024, 2752, 0, 1216, 2880, 0, 0, 96, 'ramp'); trim(1216, 2560, 1408, 2880, 96); // east platform
  box(768, 3072, 0, 896, 3168, 8, 'exitpad'); box(752, 3056, 0, 768, 3184, 160, 'hazard'); box(896, 3056, 0, 912, 3184, 160, 'hazard'); box(752, 3056, 160, 912, 3184, 176, 'hazard');
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; light(832 + Math.cos(a) * 200, 2720 + Math.sin(a) * 200, 200, 620, BLUE, 'none'); } light(832, 2720, 600, 700, BLUE, 'none'); light(832, 3120, 140, 320, GREEN, 'none'); light(352, 2720, 300, 420, W, 'wall'); light(1312, 2720, 300, 420, W, 'wall'); light(832, 2320, 300, 420, RED, 'wall');
  for (const [x, y] of [[448, 2432], [1216, 2432], [448, 3008], [1216, 3008]]) light(x, y, 620, 380, COOL);
  const sl = [.25, .9, .25];
  return {
    brushes: B, lights, ambient: .2,
    triggers: [
      { type: 'msg', mins: [-2304, -320, 0], maxs: [-1792, 320, 288], deb: 0, once: true, text: 'Outpost Kappa: the reactor crew has gone silent. Fight through to the reactor hall and take the exit teleporter.' },
      { type: 'msg', mins: [384, 1056, 0], maxs: [1280, 1184, 160], deb: 0, once: true, text: 'Slime pit — stay on the bridge.' },
      { type: 'hurt', mins: [384, 1184, -160], maxs: [1280, 1696, -64], dmg: 4, every: 250 },
      { type: 'exit', mins: [768, 3072, 8], maxs: [896, 3168, 80], area: [256, 2240, -1, 1408, 3200, 640], deb: 0 }
    ],
    monsters: [
      ['monster_soldier_light', -900, -300, 24, 180], ['monster_soldier_light', -620, 380, 24, 200], ['monster_soldier', -480, -520, 24, 160], ['monster_soldier', -1000, 680, 152, 270], ['monster_soldier_ss', -450, 660, 152, 200],
      ['monster_infantry', 520, 220, 24, 180], ['monster_infantry', 900, -100, 24, 150], ['monster_gunner', 420, -470, 200, 0], ['monster_berserk', 1000, 470, 24, 200], ['monster_soldier', 1060, 120, 24, 180],
      ['monster_flyer', 600, 1360, 180, 270], ['monster_flyer', 1040, 1520, 200, 250], ['monster_flyer', 700, 1640, 160, 270], ['monster_soldier_ss', 832, 1770, 24, 270],
      ['monster_soldier_ss', 520, 2480, 24, 90], ['monster_soldier_ss', 1150, 2480, 24, 90], ['monster_infantry', 352, 2720, 120, 0], ['monster_gunner', 1312, 2720, 120, 180], ['monster_tank', 832, 2980, 40, 270]
    ],
    items: [
      ['weapon_shotgun', -2000, 0, 16], ['ammo_shells', -1960, 120, 16], ['item_armor_shard', -1900, -200, 16], ['item_armor_shard', -1870, -200, 16],
      ['item_health', -1200, -600, 16], ['item_health', -400, 300, 16], ['ammo_shells', -1100, 0, 16], ['weapon_machinegun', -700, 690, 144], ['ammo_bullets', -1250, 690, 144], ['item_armor_jacket', -928, -192, 144],
      ['weapon_grenadelauncher', 250, -460, 184], ['ammo_grenades', 330, -460, 184], ['item_health_large', 1080, -100, 16], ['ammo_bullets', 600, 400, 16], ['item_health_large', 352, 96, 144], ['ammo_shells', 1000, 520, 16],
      ['item_health_mega', 632, 1452, 16], ['weapon_rocketlauncher', 832, 1760, 16], ['ammo_rockets', 760, 1760, 16], ['item_health', 832, 1120, 16],
      ['item_quad', 352, 2720, 112], ['item_armor_combat', 1312, 2620, 112], ['item_health_large', 1312, 2820, 112], ['ammo_rockets', 600, 2300, 16], ['ammo_shells', 1060, 2300, 16], ['item_health', 832, 2300, 16]
    ],
    barrels: [[-1280, -400, 0], [-1280, -360, 0], [-400, 500, 0], [-700, -700, 0], [200, 480, 0], [240, 520, 0], [1100, -520, 0], [460, 2300, 0], [1200, 2300, 0], [600, 3100, 0]],
    spawns: [{ o: [-2200, 0, 24], yaw: 0 }, { o: [-900, 0, 24], yaw: 0 }, { o: [640, 0, 24], yaw: 90 }, { o: [832, 1760, 24], yaw: 270 }, { o: [832, 2400, 24], yaw: 90 }, { o: [-1000, 680, 152], yaw: 270 }]
  };
}
// Baked light for brush maps: every face gets a lightmap (one luxel per 32 units), lit by the map's lamps with traced shadows.
function bakeBrushLight(d, cm, faces) {
  const L = 32, prevCM = Q.getCM(); Q.setCM(cm); const lit = d.lights || [], amb = d.ambient ?? .15;
  let area = 0; const recs = [];
  for (const f of faces) {
    const n = f.n, ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]), mj = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1, uA = mj === 0 ? 1 : 0, vA = mj === 2 ? 1 : 2;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of f.w) { u0 = Math.min(u0, p[uA]); u1 = Math.max(u1, p[uA]); v0 = Math.min(v0, p[vA]); v1 = Math.max(v1, p[vA]); }
    let step = L; while ((u1 - u0) / step > 120 || (v1 - v0) / step > 120) step *= 2;
    const lw = Math.ceil((u1 - u0) / step) + 1, lh = Math.ceil((v1 - v0) / step) + 1;
    recs.push({ f, mj, uA, vA, u0, v0, step, lw, lh }); area += (lw + 2) * (lh + 2);
  }
  let size = 256; while (size * size < area * 1.3) size *= 2;
  let atlas; for (;;) { atlas = new Atlas(size); let ok = true; for (const r of recs) { const a = atlas.alloc(r.lw + 2, r.lh + 2); if (!a) { ok = false; break; } r.ax = a.x; r.ay = a.y; } if (ok) break; size *= 2; }
  const A = atlas.data;
  for (const r of recs) {
    const n = r.f.n, pl = r.f.d, full = r.f.full;
    const buf = new Float32Array(r.lw * r.lh * 3);
    for (let j = 0; j < r.lh; j++) for (let i = 0; i < r.lw; i++) {
      const p = [0, 0, 0]; p[r.uA] = r.u0 + i * r.step; p[r.vA] = r.v0 + j * r.step;
      const rest = pl - n[r.uA] * p[r.uA] - n[r.vA] * p[r.vA]; p[r.mj] = rest / n[r.mj];
      const q = [p[0] + n[0] * 2, p[1] + n[1] * 2, p[2] + n[2] * 2];
      let c = full ? [full, full, full] : [amb * (.8 + .2 * n[2]), amb * (.82 + .2 * n[2]), amb * (.9 + .2 * n[2])];
      if (!full) for (const l of lit) {
        const dx = l.o[0] - q[0], dy = l.o[1] - q[1], dz = l.o[2] - q[2], dist = Math.hypot(dx, dy, dz); if (dist > l.r) continue;
        const ndl = (n[0] * dx + n[1] * dy + n[2] * dz) / (dist || 1); if (ndl <= 0) continue;
        if (Q.trace(q, Z3, Z3, l.o, Q.MASK_SOLID, true).fraction < .995) continue;
        const k = (1 - dist / l.r) * (.35 + .65 * ndl) * 1.15; for (let ch = 0; ch < 3; ch++) c[ch] += l.c[ch] * k;
      }
      buf.set(c, (j * r.lw + i) * 3);
    }
    for (let y = -1; y <= r.lh; y++) for (let x = -1; x <= r.lw; x++) {
      const sx = Math.min(r.lw - 1, Math.max(0, x)), sy = Math.min(r.lh - 1, Math.max(0, y)), si = (sy * r.lw + sx) * 3, di = ((r.ay + 1 + y) * size + r.ax + 1 + x) * 4;
      for (let ch = 0; ch < 3; ch++) A[di + ch] = Math.min(255, buf[si + ch] * 127.5); A[di + 3] = 255;
    }
    r.f.lmUV = p => [(r.ax + 1.5 + (p[r.uA] - r.u0) / r.step) / size, (r.ay + 1.5 + (p[r.vA] - r.v0) / r.step) / size];
  }
  Q.setCM(prevCM);
  return { data: A, size };
}

// built-in maps: the test map and the campaign level. ents() lists the entities for a fresh start.
const BUILTIN_MAPS = {
  test: { name: 'Test map', data: () => Q.demoMap(), ents: () => demoEnts(), campaign: false },
  kappa: { name: 'Outpost Kappa', data: () => kappaMap(), campaign: true, ents() { const d = kappaMap(); return [...d.barrels.map(b => ({ classname: 'misc_explobox', origin: b.join(' ') })), ...d.monsters.map(([c, x, y, z, a]) => ({ classname: c, origin: `${x} ${y} ${z}`, angle: String(a) })), ...d.items.map(([c, x, y, z]) => ({ classname: c, origin: `${x} ${y} ${z}` }))]; } }
};
const builtinCache = {};
function builtinWorld(id) {
  const B = BUILTIN_MAPS[id] || BUILTIN_MAPS.test; id = BUILTIN_MAPS[id] ? id : 'test';
  if (id === 'test') { if (!demoCache) demoCache = buildDemoWorld(); builtinCache.test = demoCache; }
  const w = builtinCache[id] || (builtinCache[id] = buildBrushWorld(B.data(), B.name, id));
  w.ents = B.ents(); w.staticTriggers = B.data().triggers.map(t => ({ ...t })); return w;
}
function startBuiltin(id, campaign) { // play a built-in map from the start
  if (!gl) return; const w = builtinWorld(id); resetPlayer(); campaignMode = !!campaign; resetInventory(!campaign); setWorld(w); loaded = true; lastMapPath = null; startGame();
}
let exitT = 0;
function levelExit(t) { // the exit teleporter of a built-in campaign level
  if (simTime < (t.deb || 0)) return; t.deb = simTime + 1500;
  const a = t.area, left = a ? E.monsters.filter(m => !m.bot && !m.dead && !m.hidden && !m.gibbed && m.o[0] > a[0] && m.o[1] > a[1] && m.o[0] < a[3] && m.o[1] < a[4]).length : 0;
  if (left) { toast(`The exit is sealed — ${left} hostile${left > 1 ? 's' : ''} still in the reactor hall.`, 2500); play('noammo', .6); return; }
  if (exitT) return; exitT = simTime; play('tele', .9); addLight(ps.origin.map(v => v / 8), 400, [.4, 1, .6], .8);
  const secs = Math.round(simTime / 1000), msg = `${world.name} complete — kills ${PL.kills}/${PL.total} · time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  toast(msg, 6000); setStatus(msg);
  later(2500, () => { exitT = 0; if (!running) return; pauseGame(); showScreen('sp'); });
}
// ---------- textures from paks ----------
async function loadTexture(name) {
  const d = await vfsGet('textures/' + name + '.wal');
  if (d && d.length > 100) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const w = dv.getUint32(32, true), h = dv.getUint32(36, true), o = dv.getUint32(40, true);
    if (w > 0 && h > 0 && w <= 4096 && h <= 4096 && o + w * h <= d.length) {
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { const c = d[o + i]; rgba[i * 4] = palette[c * 3]; rgba[i * 4 + 1] = palette[c * 3 + 1]; rgba[i * 4 + 2] = palette[c * 3 + 2]; rgba[i * 4 + 3] = 255; }
      return { tex: makeTex(gl, rgba, w, h), w, h };
    }
  }
  for (const ext of ['png', 'tga', 'jpg']) {
    const p = await vfsGet('textures/' + name + '.' + ext); if (!p) continue;
    if (ext === 'tga') { const r = decodeTGA(p); if (r) return { tex: makeTex(gl, r.rgba, r.w, r.h), w: r.w, h: r.h }; continue; }
    try { const bmp = await createImageBitmap(new Blob([p])); return { tex: makeTex(gl, bmp), w: bmp.width, h: bmp.height }; } catch (e) {}
  }
  return null;
}
async function loadSky(name) {
  const imgs = [], fn = typeof name === 'function' ? name : s => 'env/' + name + s + '.tga';
  for (const s of ['rt', 'lf', 'bk', 'ft', 'up', 'dn']) { const im = await loadImg(fn(s)); if (!im) return null; imgs.push(im); }
  const w = imgs[0].w, h = imgs[0].h; if (imgs.some(i => i.w !== w || i.h !== h)) return null;
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, w, h, 6, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  imgs.forEach((im, i) => { if (im.bitmap) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, im.bitmap); else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, im.rgba); });
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
  return t;
}
const GHOST = /^func_door_(rotating|secret)$/;
async function buildBSPWorld(path, progress) {
  const u8 = await vfsGet(path); if (!u8) throw new Error('Could not read ' + path);
  const b = Q.parseBSP(u8), ents = Q.parseEntities(b.entities);
  if (!palette) await loadPalette();
  const modelEnt = {};
  for (const e of ents) if (e.model && e.model[0] === '*') modelEnt[+e.model.slice(1)] = e;
  const names = new Set();
  b.texinfo.forEach(t => { if (!(t.flags & (Q.SURF_NODRAW | Q.SURF_SKY))) names.add(t.name); });
  const texMap = new Map(); let k = 0;
  for (const n of names) { texMap.set(n, (await loadTexture(n)) || getMissing()); if (++k % 8 === 0) { progress(`textures ${k}/${names.size}`); await new Promise(r => setTimeout(r)); } }
  progress('building geometry…');
  const faces = []; let lmArea = 0;
  b.models.forEach((m, mi) => {
    const e = modelEnt[mi], cls = mi === 0 ? 'worldspawn' : (e ? e.classname : '');
    if (/^trigger_/.test(cls) || (mi > 0 && !e)) return;
    for (let f = m.firstface; f < m.firstface + m.numfaces; f++) {
      const ti = b.texinfo[b.fTex[f]]; if (!ti || (ti.flags & Q.SURF_NODRAW)) continue;
      const pts = [];
      for (let i = 0; i < b.fNumEdges[f]; i++) { const se = b.surfedges[b.fFirstEdge[f] + i], v = se >= 0 ? b.edges[se * 2] : b.edges[-se * 2 + 1]; pts.push([b.verts[v * 3], b.verts[v * 3 + 1], b.verts[v * 3 + 2]]); }
      if (pts.length < 3) continue;
      const rec = { f, ti, pts, mi, ghost: GHOST.test(cls) };
      if (!(ti.flags & (Q.SURF_SKY | Q.SURF_WARP)) && b.fLightOfs[f] >= 0) {
        const V = ti.vecs, mn = [1e9, 1e9], mx = [-1e9, -1e9];
        for (const p of pts) for (let j = 0; j < 2; j++) { const s = Math.fround(p[0] * V[j * 4] + p[1] * V[j * 4 + 1] + p[2] * V[j * 4 + 2] + V[j * 4 + 3]); if (s < mn[j]) mn[j] = s; if (s > mx[j]) mx[j] = s; }
        const bmin = [Math.floor(mn[0] / 16), Math.floor(mn[1] / 16)], bmax = [Math.ceil(mx[0] / 16), Math.ceil(mx[1] / 16)];
        const lw = bmax[0] - bmin[0] + 1, lh = bmax[1] - bmin[1] + 1;
        if (lw > 0 && lh > 0 && lw <= 256 && lh <= 256 && b.fLightOfs[f] + lw * lh * 3 <= b.light.length) { rec.lm = { bmin, lw, lh, ofs: b.fLightOfs[f] }; lmArea += (lw + 2) * (lh + 2); }
      }
      faces.push(rec);
    }
  });
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let size = 256; while (size * size < (lmArea + 64) * 1.25 && size < maxSize) size *= 2;
  let atlas;
  for (;;) {
    atlas = new Atlas(size); const wb = atlas.alloc(4, 4); let ok = true;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) atlas.data.fill(255, ((wb.y + y) * size + wb.x + x) * 4, ((wb.y + y) * size + wb.x + x) * 4 + 4);
    for (const r of faces) if (r.lm) { const a = atlas.alloc(r.lm.lw + 2, r.lm.lh + 2); if (!a) { ok = false; break; } r.lm.ax = a.x; r.lm.ay = a.y; }
    if (ok || size >= maxSize) break; size *= 2;
  }
  const L = b.light, A = atlas.data;
  for (const r of faces) {
    const l = r.lm; if (!l || l.ax === undefined) { r.lm = null; continue; }
    for (let y = -1; y <= l.lh; y++) for (let x = -1; x <= l.lw; x++) {
      const sx = Math.min(l.lw - 1, Math.max(0, x)), sy = Math.min(l.lh - 1, Math.max(0, y));
      const si = l.ofs + (sy * l.lw + sx) * 3, di = ((l.ay + 1 + y) * size + l.ax + 1 + x) * 4;
      A[di] = L[si]; A[di + 1] = L[si + 1]; A[di + 2] = L[si + 2]; A[di + 3] = 255;
    }
  }
  const G = new Map(), W = 2 / size;
  for (const r of faces) {
    const fl = r.ti.flags;
    if (fl & Q.SURF_SKY) { addPoly(grp(G, 'sky' + r.mi, { kind: 'sky', model: r.mi }), r.pts.map(p => [p[0], p[1], p[2], 0, 0, 0, 0, 0])); continue; }
    const T = texMap.get(r.ti.name) || getMissing(), warp = !!(fl & Q.SURF_WARP);
    const alpha = fl & Q.SURF_TRANS33 ? 0.33 : fl & Q.SURF_TRANS66 ? 0.66 : r.ghost ? 0.4 : 1;
    let anim = null; // Quake II texture animation: texinfo.next chains frames, advancing twice a second
    if (r.ti.next >= 0 && r.ti.next < b.texinfo.length) { const names = [r.ti.name]; let n = r.ti.next, guard = 0; while (n >= 0 && n < b.texinfo.length && b.texinfo[n].name !== r.ti.name && guard++ < 32) { names.push(b.texinfo[n].name); n = b.texinfo[n].next; } if (names.length > 1) anim = names.map(nm => (texMap.get(nm) || T).tex); }
    const g = grp(G, `${r.mi}|${alpha < 1 ? 't' : 'o'}|${r.ti.name}|${warp}|${alpha}`, { anim, animFps: 2, tex: T.tex, kind: alpha < 1 ? 'trans' : 'opaque', alpha, warp, liquid: warp ? (/lava/.test(r.ti.name) ? 3 : /slime|sludge/.test(r.ti.name) ? 2 : 1) : 0, model: r.mi });
    const V = r.ti.vecs, l = r.lm;
    addPoly(g, r.pts.map(p => {
      const s = p[0] * V[0] + p[1] * V[1] + p[2] * V[2] + V[3], t = p[0] * V[4] + p[1] * V[5] + p[2] * V[6] + V[7];
      let lu = W, lv = W, lit = 0.5;
      if (l) { lu = (l.ax + 1 + s / 16 - l.bmin[0] + 0.5) / size; lv = (l.ay + 1 + t / 16 - l.bmin[1] + 0.5) / size; lit = 1; }
      return [p[0], p[1], p[2], s / T.w, t / T.h, lu, lv, lit];
    }));
  }
  const w = uploadWorld(G, makeTex(gl, A, size, size, { lightmap: true }));
  w.textures = [...new Set([...texMap.values()].map(t => t.tex))];
  w.cm = Q.cmFromBSP(b); w.models = b.models; w.ents = ents; w.staticTriggers = [];
  const ws = ents.find(e => e.classname === 'worldspawn') || {};
  w.message = ws.message ? ws.message.replace(/\\n/g, ' ') : '';
  progress('loading sky…');
  w.skyTex = await loadSky((ws.sky || 'unit1_').toLowerCase());
  // spawns
  const yawOf = e => e.angle !== undefined ? +e.angle : e.angles ? Q.vecOf(e.angles)[1] : 0;
  const spawns = [];
  const starts = ents.filter(e => e.classname === 'info_player_start');
  const main = starts.find(e => !e.targetname) || starts[0];
  if (main) spawns.push({ o: Q.vecOf(main.origin), yaw: yawOf(main), name: main.targetname || '' });
  for (const e of ents) if ((e.classname === 'info_player_start' && e !== main) || e.classname === 'info_player_deathmatch' || e.classname === 'info_player_coop') spawns.push({ o: Q.vecOf(e.origin), yaw: yawOf(e), name: e.classname === 'info_player_start' ? (e.targetname || '') : '\u0000' });
  if (!spawns.length) { const m = b.models[0]; spawns.push({ o: [0, 1, 2].map(i => (m.mins[i] + m.maxs[i]) / 2), yaw: 0, name: '' }); }
  w.spawns = spawns; w.name = path.replace(/^maps\//, '').replace(/\.bsp$/i, '');
  return w;
}

// ---------- audio: baseq2 sound/ files, positional (Q2 attenuation), ambience, music ----------
let AC = null, master = null, lowpass = null, noiseBuf = null, soundsFor = -1;
const sndCache = new Map();
// Player voices. Quake III characters use their own sound/player/<model>/ files (pain25_1, pain50_1, pain75_1, pain100_1,
// death1-3, jump1, fall1...), falling back like Q3 does to a stock voice of the same sex (sarge / major); the Quake II
// male/female voices are only used when no Quake III voice exists at all.
const q3Sex = new Map();
function q3ModelSex(m) {
  if (!q3Sex.has(m)) { q3Sex.set(m, 'm'); vfsGet(`models/players/${m}/animation.cfg`).then(d => { if (d && /^\s*sex\s+f/mi.test(new TextDecoder().decode(d))) q3Sex.set(m, 'f'); }).catch(() => {}); }
  return q3Sex.get(m);
}
function q3VoiceName(n) { // Q3 has one take of each pain level and three deaths
  let m = n.match(/^pain(\d+)_\d+\.wav$/); if (m) return [`pain${m[1]}_1.wav`];
  m = n.match(/^death(\d)\.wav$/); if (m) return [`death${1 + (+m[1] - 1) % 3}.wav`, 'death1.wav'];
  return [n];
}
function voice(n, q3model, q2model) {
  if (q3model) {
    const fb = q3ModelSex(q3model) === 'f' ? ['major', 'visor'] : ['sarge', 'major'];
    for (const m of [q3model, ...fb]) for (const f of q3VoiceName(n)) if (VFS.has('sound/player/' + m + '/' + f)) return '#sound/player/' + m + '/' + f;
  }
  const q2 = q2model || S.model; return '#players/' + (VFS.has('players/' + q2 + '/' + n) ? q2 : 'male') + '/' + n;
}
const sexed = n => voice(n, (S.pset === 'q3' || S.wset === 'q3') ? S.model3 || 'sarge' : null, S.model);
const botVoice = (m, n) => (m.set || S.pset) === 'q3' ? voice(n, m.model || 'sarge') : voice(n, null, m.model);
const SND = {
  jump: () => sexed('jump1.wav'), fall1: () => sexed('fall1.wav'), fall2: () => sexed('fall2.wav'), land: 'player/land1.wav',
  step1: 'player/step1.wav', step2: 'player/step2.wav', step3: 'player/step3.wav', step4: 'player/step4.wav',
  watrIn: 'player/watr_in.wav', watrOut: 'player/watr_out.wav', watrUn: 'player/watr_un.wav', gib: 'misc/udeath.wav', protect: 'items/protect4.wav', quadFire: 'items/damage3.wav', respawn: 'misc/tele1.wav',
  fire: 'weapons/rocklf1a.wav', boom: 'weapons/rocklx1a.wav', push: 'misc/windfly.wav', tele: 'misc/tele1.wav', talk: 'misc/talk1.wav', secret: 'misc/secret.wav',
  blaster: 'weapons/blastf1a.wav', hyper: 'weapons/hyprbf1a.wav', hyperLoop: 'weapons/hyprbl1a.wav', hyperDown: 'weapons/hyprbd1a.wav', shotgun: 'weapons/shotgf1b.wav', sshotgun: 'weapons/sshotf1b.wav',
  mg1: 'weapons/machgf1b.wav', mg2: 'weapons/machgf2b.wav', mg3: 'weapons/machgf3b.wav', mg4: 'weapons/machgf4b.wav', mg5: 'weapons/machgf5b.wav', cgUp: 'weapons/chngnu1a.wav', cgLoop: 'weapons/chngnl1a.wav', cgDown: 'weapons/chngnd1a.wav',
  gl: 'weapons/grenlf1a.wav', gbounce: 'weapons/grenlb1b.wav', gboom: 'weapons/grenlx1a.wav', hgPin: 'weapons/hgrena1b.wav', hgThrow: 'weapons/hgrent1a.wav', hgCook: 'weapons/hgrenc1b.wav', hgBounce1: 'weapons/hgrenb1a.wav', hgBounce2: 'weapons/hgrenb2a.wav',
  rail: 'weapons/railgf1a.wav', bfgCharge: 'weapons/bfg__f1y.wav', bfgBoom: 'weapons/bfg__x1b.wav', lashit: 'weapons/lashit.wav', ric1: 'world/ric1.wav', ric2: 'world/ric2.wav', ric3: 'world/ric3.wav',
  q3mg1: 'weapons/machinegun/machgf1b.wav', q3mg2: 'weapons/machinegun/machgf2b.wav', q3mg3: 'weapons/machinegun/machgf3b.wav', q3mg4: 'weapons/machinegun/machgf4b.wav', q3sg: 'weapons/shotgun/sshotf1b.wav',
  q3gl: 'weapons/grenade/grenlf1a.wav', q3gb1: 'weapons/grenade/hgrenb1a.wav', q3gb2: 'weapons/grenade/hgrenb2a.wav', q3rl: 'weapons/rocket/rocklf1a.wav', q3boom: 'weapons/rocket/rocklx1a.wav',
  q3lgHum: 'weapons/lightning/lg_hum.wav', q3lgFire: 'weapons/lightning/lg_fire.wav', q3rg: 'weapons/railgun/railgf1a.wav', q3pg: 'weapons/plasma/hyprbf1a.wav', q3pgHit: 'weapons/plasma/plasmx1a.wav', q3bfg: 'weapons/bfg/bfg_fire.wav',
  q3ngFire: 'weapons/nailgun/wnalfire.wav', q3ngHit: 'weapons/nailgun/wnalimpd.wav', q3ngHitMetal: 'weapons/nailgun/wnalimpm.wav', q3ngHitFlesh: 'weapons/nailgun/wnalimpl.wav',
  q3pxFire: 'weapons/proxmine/wstbfire.wav', q3pxStick: 'weapons/proxmine/wstbimpl.wav', q3pxStickMetal: 'weapons/proxmine/wstbimpm.wav', q3pxActv: 'weapons/proxmine/wstbactv.wav', q3pxTick: 'weapons/proxmine/wstbtick.wav',
  q3cg1: 'weapons/vulcan/vulcanf1b.wav', q3cg2: 'weapons/vulcan/vulcanf2b.wav', q3cg3: 'weapons/vulcan/vulcanf3b.wav', q3cg4: 'weapons/vulcan/vulcanf4b.wav', q3cgLoop: 'weapons/vulcan/wvulfire.wav',
  q3gaunt: 'weapons/melee/fstrun.wav', q3gauntHit: 'weapons/melee/fstatck.wav', q3change: 'weapons/change.wav', jumppad: 'world/jumppad.wav', telein: 'world/telein.wav', watrSplash: 'player/watr_in.wav',
  doorStart: 'doors/dr1_strt.wav', doorEnd: 'doors/dr1_end.wav', platStart: 'plats/pt1_strt.wav', platEnd: 'plats/pt1_end.wav', button: 'switches/butn2.wav'
};
// Quake III mode: the Q3 weapon set also brings Q3 movement (bg_pmove), Q3 sounds and Q3 items, overriding the Quake II ones
const q3Mode = () => S.wset === 'q3';
const SND_Q3 = {
  land: 'player/land1.wav', step1: 'player/footsteps/step1.wav', step2: 'player/footsteps/step2.wav', step3: 'player/footsteps/step3.wav', step4: 'player/footsteps/step4.wav',
  watrIn: 'player/watr_in.wav', watrOut: 'player/watr_out.wav', watrUn: 'player/watr_un.wav', gib: 'player/gibsplt1.wav', protect: 'items/protect3.wav', quadFire: 'items/damage3.wav',
  respawn: 'world/telein.wav', tele: 'world/telein.wav', push: 'world/jumppad.wav', talk: 'player/talk.wav', secret: 'world/telein.wav',
  ric1: 'weapons/machinegun/ric1.wav', ric2: 'weapons/machinegun/ric2.wav', ric3: 'weapons/machinegun/ric3.wav', noammo: 'weapons/noammo.wav',
  doorStart: 'movers/doors/dr1_strt.wav', doorEnd: 'movers/doors/dr1_end.wav', platStart: 'movers/plats/pt1_strt.wav', platEnd: 'movers/plats/pt1_end.wav', button: 'movers/switches/butn2.wav'
};
const keyPathQ2 = k => { const v = SND[k]; return typeof v === 'function' ? v() : v || k; };
const keyPath = k => q3Mode() && SND_Q3[k] && sndCache.get(SND_Q3[k]) !== null ? SND_Q3[k] : keyPathQ2(k);
const sndFile = p => p[0] === '#' ? p.slice(1) : 'sound/' + p;
async function loadSnd(p) {
  sndCache.set(p, 'loading');
  let d = await vfsGet(sndFile(p)); if (!d && p[0] !== '#') d = await vfsGet(p);
  let b = null; if (d && AC) { try { b = await AC.decodeAudioData(d.slice().buffer); } catch (e) {} }
  sndCache.set(p, b);
}
function getSnd(p) { const v = sndCache.get(p); if (v === undefined) { if (AC) loadSnd(p); return undefined; } return v === 'loading' ? undefined : v; } // undefined = pending, null = missing
function preload(list) { if (AC) for (const p of list) if (p && !sndCache.has(p)) loadSnd(p); }
function ensureAudio() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); lowpass = AC.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 22000;
      master.connect(lowpass); lowpass.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { AC = null; }
  }
  if (AC && AC.state === 'suspended') AC.resume().catch(() => {});
  if (master) master.gain.value = S.vol;
  if (AC && soundsFor !== vfsVersion) { soundsFor = vfsVersion; sndCache.clear(); preload([...Object.keys(SND).map(keyPathQ2), ...Object.values(SND_Q3)]); }
}
function setPos(n, p, pre) { if (n[pre + 'X']) { n[pre + 'X'].value = p[0]; n[pre + 'Y'].value = p[1]; n[pre + 'Z'].value = p[2]; } else if (pre === 'position') n.setPosition(p[0], p[1], p[2]); }
function outNode(vol, p, attn) {
  const g = AC.createGain(); g.gain.value = vol;
  if (p && attn !== 0) {
    const pn = AC.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'linear';
    pn.refDistance = 80; pn.maxDistance = 80 + 1000 / (attn || 1); pn.rolloffFactor = 1; setPos(pn, p, 'position');
    g.connect(pn); pn.connect(master);
  } else g.connect(master);
  return g;
}
function playBuf(b, vol, p, attn, loop) { const s = AC.createBufferSource(); s.buffer = b; s.loop = !!loop; s.connect(outNode(vol, p, attn)); s.start(); return s; }
let listenerPos = [0, 0, 0];
function updateListener(e, f, u) {
  listenerPos = e; if (!AC) return; const L = AC.listener;
  if (L.positionX) { L.positionX.value = e[0]; L.positionY.value = e[1]; L.positionZ.value = e[2]; L.forwardX.value = f[0]; L.forwardY.value = f[1]; L.forwardZ.value = f[2]; L.upX.value = u[0]; L.upY.value = u[1]; L.upZ.value = u[2]; }
  else { L.setPosition(e[0], e[1], e[2]); L.setOrientation(f[0], f[1], f[2], u[0], u[1], u[2]); }
}
const BUILTIN_SND = new Set(['fire', 'boom', 'gboom', 'blaster', 'hyper', 'hyperLoop', 'hyperDown', 'shotgun', 'sshotgun', 'mg1', 'mg2', 'mg3', 'mg4', 'mg5', 'cgUp', 'cgLoop', 'cgDown', 'gl', 'gbounce', 'hgPin', 'hgThrow', 'hgCook', 'hgBounce1', 'hgBounce2', 'rail', 'bfgCharge', 'bfgBoom', 'lashit', 'ric1', 'ric2', 'ric3']);
const SYNTH_ALIAS = { q3mg1: 'mg1', q3mg2: 'mg2', q3mg3: 'mg3', q3mg4: 'mg4', q3sg: 'sshotgun', q3gl: 'gl', q3gb1: 'gbounce', q3gb2: 'gbounce', q3rl: 'fire', q3boom: 'boom', q3lgFire: 'lashit', q3rg: 'rail', q3pg: 'hyper', q3pgHit: 'lashit', q3bfg: 'bfgCharge', q3gauntHit: 'land', q3ngFire: 'sshotgun', q3ngHit: 'lashit', q3ngHitMetal: 'lashit', q3ngHitFlesh: 'lashit', q3pxFire: 'gl', q3pxStick: 'gbounce', q3pxStickMetal: 'gbounce', q3pxActv: 'button', q3pxTick: 'button', q3cg1: 'mg1', q3cg2: 'mg2', q3cg3: 'mg3', q3cg4: 'mg4', q3change: 'button', jumppad: 'push', telein: 'tele', watrSplash: 'watrIn' };
function play(k, vol = 1) { if (running && E && !PL.dead) hearSound(playerCenter(), loudOf(k), 'player', k); if (!AC) return; if (S.wset === 'builtin' && BUILTIN_SND.has(k)) { synth(k, vol); return; } const b = getSnd(keyPath(k)); if (b) playBuf(b, vol); else if (b === null) synth(k, vol); }
function playAt(k, p, vol = 1, attn = 1, src = 'world', owner) {
  if (E && p && src) hearSound(p, loudOf(k), src, k, owner);
  if (!AC || !p) return; const b = S.wset === 'builtin' && BUILTIN_SND.has(k) ? null : getSnd(keyPath(k));
  if (b) playBuf(b, vol, p, attn);
  else if (b === null && SND[k]) synth(k, vol * Math.max(0, 1 - Math.hypot(p[0] - listenerPos[0], p[1] - listenerPos[1], p[2] - listenerPos[2]) / 1200));
}
// a sound file at a spot; when there's no file for it (or no path at all — bots have no monster sound set) the fallback key plays instead
function playPathAt(path, p, vol = 1, attn = 1, fallback, src = null, owner) { if (!AC) return; if (!path) { if (fallback) playAt(fallback, p, vol, attn, src, owner); return; } const b = getSnd(path); if (b) playBuf(b, vol, p, attn); else if (b === null && fallback) playAt(fallback, p, vol, attn, src, owner); }
let wasUnder = false;
function setUnderwater(on) { if (!lowpass || on === wasUnder) return; wasUnder = on; lowpass.frequency.setTargetAtTime(on ? 700 : 22000, AC.currentTime, 0.05); }
function synth(k, vol) {
  if (vol <= 0.01) return; k = SYNTH_ALIAS[k] || k;
  const g = AC.createGain(); g.gain.value = vol; g.connect(master); const t = AC.currentTime;
  const noise = (dur, f0, f1, v) => { const s = AC.createBufferSource(); s.buffer = noiseBuf; const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(f0, t); lp.frequency.exponentialRampToValueAtTime(f1, t + dur); const e = AC.createGain(); e.gain.setValueAtTime(v, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(lp).connect(e).connect(g); s.start(t); s.stop(t + dur); };
  const tone = (dur, f0, f1, v, type = 'sine') => { const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); const e = AC.createGain(); e.gain.setValueAtTime(v, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(e).connect(g); o.start(t); o.stop(t + dur); };
  if (k === 'click') { tone(.03, 1200, 500, .5, 'square'); noise(.04, 3000, 800, .25); }
  else if (k === 'boom' || k === 'gboom') { noise(1.1, 1800, 50, 0.9); tone(0.6, 90, 28, 0.6); }
  else if (k === 'bfgBoom') { noise(1.4, 1200, 40, 1); tone(1, 160, 30, .6, 'sawtooth'); }
  else if (k === 'bfgCharge') tone(.8, 120, 900, .2, 'sawtooth');
  else if (k === 'blaster' || k === 'hyper') tone(.14, 1100, 260, .12, 'square');
  else if (k === 'shotgun' || k === 'sshotgun') { noise(.4, 3500, 150, .7); tone(.12, 140, 60, .4); }
  else if (k.startsWith('mg')) { noise(.09, 4500, 500, .35); tone(.05, 160, 80, .2); }
  else if (k === 'rail') { tone(.5, 2400, 180, .18, 'sawtooth'); noise(.3, 6000, 1500, .25); }
  else if (k === 'fire') { noise(0.25, 3000, 300, 0.35); tone(0.2, 220, 80, 0.2, 'square'); }
  else if (k === 'gl' || k === 'hgThrow') noise(.16, 1400, 300, .35);
  else if (k === 'gbounce' || k.startsWith('hgBounce')) tone(.05, 1600, 900, .1, 'triangle');
  else if (k.startsWith('ric')) tone(.22, 3200, 1700, .05, 'triangle');
  else if (k === 'lashit') noise(.08, 5000, 900, .15);
  else if (k === 'cgUp' || k === 'cgDown') tone(.4, k === 'cgUp' ? 200 : 600, k === 'cgUp' ? 600 : 150, .08, 'sawtooth');
  else if (k === 'hgPin') tone(.05, 2500, 2000, .08, 'square');
  else if (k === 'jump') tone(0.12, 180, 320, 0.08);
  else if (k === 'land' || k === 'fall1' || k === 'fall2') { noise(0.12, 600, 80, 0.3); tone(0.1, 90, 50, 0.3); }
  else if (k.startsWith('step')) noise(0.06, 900, 200, 0.12);
  else if (k === 'push') noise(0.7, 400, 2500, 0.25);
  else if (k === 'tele' || k === 'respawn') tone(0.5, 200, 1200, 0.15, 'triangle');
  else if (k === 'talk') tone(0.08, 880, 880, 0.12, 'square');
  else if (k === 'secret') tone(0.6, 400, 900, 0.15, 'triangle');
  else if (k.startsWith('door') || k.startsWith('plat')) noise(0.3, 300, 120, 0.2);
  else if (k === 'button') tone(0.1, 600, 300, 0.15, 'square');
  else if (k === 'gib') { noise(.5, 900, 100, .6); }
  else if (k === 'hurt') tone(.15, 300, 150, .15, 'sawtooth');
  else if (k === 'pickup') tone(.12, 700, 1400, .1, 'triangle');
  else if (k.startsWith('watr')) noise(.35, 1500, 300, .2);
}
let loopSrc = null, loopKey = null;
function setLoop(k) {
  if (k === loopKey) return;
  if (loopSrc) { try { loopSrc.stop(); } catch (e) {} loopSrc = null; }
  loopKey = k; if (!k || !AC) return; const b = getSnd(keyPath(k)); if (!b) return;
  const s = AC.createBufferSource(); s.buffer = b; s.loop = true; s.connect(outNode(.6)); s.start(); loopSrc = s;
}
// target_speaker ambience
const speakers = [];
function speakerOn(sp) {
  sp.want = true; if (sp.src || !AC) return;
  const b = getSnd(sp.path);
  if (b === undefined) { setTimeout(() => { if (sp.want && !sp.src) speakerOn(sp); }, 400); return; }
  if (b) sp.src = playBuf(b, sp.vol, sp.p, sp.attn, true);
}
function speakerOff(sp) { sp.want = false; if (sp.src) { try { sp.src.stop(); } catch (e) {} sp.src = null; } }
function stopSpeakers() { speakers.forEach(speakerOff); speakers.length = 0; }
// CD-track music (worldspawn "sounds"): music/trackNN.ogg etc.
let musicEl = null, musicTrack = 0;
async function startMusic(track) {
  stopMusic(); musicTrack = +track || 0; if (!musicTrack) return;
  const n = musicTrack, p2 = String(n).padStart(2, '0');
  for (const c of [`music/track${p2}`, `music/Track${p2}`, `music/${p2}`, `music/track${n}`, `music/${n}`]) for (const ext of ['ogg', 'mp3', 'flac', 'wav']) {
    const d = await vfsGet(c + '.' + ext); if (!d) continue;
    if (musicTrack !== n) return;
    musicEl = new Audio(URL.createObjectURL(new Blob([d]))); musicEl.loop = true; musicEl.volume = S.music;
    if (running) musicEl.play().catch(() => {});
    return;
  }
}
async function startMusicFile(p) {
  stopMusic(); const tok = musicTrack = -Math.random(); const d = (await vfsGet(p)) || (await vfsGet(p.replace(/\.wav$/i, '.ogg'))); if (!d || musicTrack !== tok) return;
  musicEl = new Audio(URL.createObjectURL(new Blob([d]))); musicEl.loop = true; musicEl.volume = S.music; if (running) musicEl.play().catch(() => {});
}
function stopMusic() { if (musicEl) { musicEl.pause(); URL.revokeObjectURL(musicEl.src); musicEl = null; } }

// ---------- game state ----------
let world = null, running = false, loaded = false, loadingMap = false;
let prevOrigin = [0, 0, 0], yaw = 0, pitch = 0, spawnIdx = 0;
let stepAmt = 0, stepTime = -1e9, vh = 22, kick = 0, bobT = 0, stepTimer = 0, fireCd = 0, pushSndT = 0, simTime = 0, topSpeed = 0, lastFire = -1e9, airTime = 0;
const keys = new Set(); let mouseFire = false, mouseJump = false, jumpPulse = 0;
const touch = { joy: null, look: null, jx: 0, jy: 0, jump: false, duck: false, fire: false };
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const V3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s] };

// ---------- entities (doors, plats, buttons, trains, triggers, level changes) ----------
let E = null; // { list, byName, movers, damageables, triggers, timers }
function later(ms, fn) { E.timers.push({ t: simTime + ms, fn }); }
function entCenter(e) { if (e.box) return [0, 1, 2].map(i => (e.box.mins[i] + e.box.maxs[i]) / 2); const o = e.st ? e.st.o : [0, 0, 0]; return e.mins ? [0, 1, 2].map(i => o[i] + (e.mins[i] + e.maxs[i]) / 2) : e.origin; }
function movedir(kv) {
  const a = kv.angles ? Q.vecOf(kv.angles) : [0, kv.angle !== undefined ? +kv.angle : 0, 0];
  if (a[0] === 0 && a[2] === 0 && a[1] === -1) return [0, 0, 1];
  if (a[0] === 0 && a[2] === 0 && a[1] === -2) return [0, 0, -1];
  const f = [0, 0, 0]; Q.angleVectors(a, f); return f.map(v => Math.abs(v) < 1e-6 ? 0 : v);
}
function initEntities(w) {
  E = { list: [], byName: new Map(), movers: [], damageables: [], barrels: [], monsters: [], items: [], keys: new Set(), triggers: [...(w.staticTriggers || [])], timers: [] };
  PL.kills = PL.total = 0;
  const cm = w.cm, solids = cm.solids = []; cm.boxes = [];
  w.mstate = {};
  const bmodel = (e, solid) => {
    if (!e.kv.model || e.kv.model[0] !== '*') return null;
    const mi = +e.kv.model.slice(1), m = w.models[mi]; if (!m) return null;
    e.mi = mi; e.mins = m.mins; e.maxs = m.maxs;
    const st = { head: m.headnode, mins: m.mins, maxs: m.maxs, o: [0, 0, 0], active: !!solid, visible: true, ent: e, si: -1 };
    if (solid) { st.si = solids.length; solids.push(st); }
    w.mstate[mi] = st; e.st = st; return st;
  };
  const trigBox = e => { const m = w.models[+String(e.kv.model || '').slice(1)]; return m && e.kv.model[0] === '*' ? { mins: m.mins.map(v => v - 1), maxs: m.maxs.map(v => v + 1) } : null; };
  const doors = [];
  for (const kv of w.ents) {
    if (!w.demo && kv.classname !== 'worldspawn' && ((+kv.spawnflags || 0) & [256, 512, 1024][S.skill])) continue;
    const e = { kv, cls: kv.classname || '', targetname: kv.targetname, target: kv.target, killtarget: kv.killtarget, delay: +kv.delay || 0, message: kv.message ? kv.message.replace(/\\n/g, ' ') : '', spawnflags: +kv.spawnflags || 0, origin: Q.vecOf(kv.origin) };
    E.list.push(e); if (e.targetname) { if (!E.byName.has(e.targetname)) E.byName.set(e.targetname, []); E.byName.get(e.targetname).push(e); }
    const sf = e.spawnflags;
    switch (e.cls) {
      case 'func_door': {
        const st = bmodel(e, true); if (!st) break;
        const md = movedir(kv), size = [0, 1, 2].map(i => e.maxs[i] - e.mins[i]), lip = kv.lip !== undefined ? +kv.lip : 8;
        const dist = Math.abs(md[0]) * size[0] + Math.abs(md[1]) * size[1] + Math.abs(md[2]) * size[2] - lip;
        e.pos1 = [0, 0, 0]; e.pos2 = md.map(v => v * dist); e.speed = +kv.speed || (w.q3 ? 400 : 100); e.wait = kv.wait !== undefined ? +kv.wait : (w.q3 ? 2 : 3); e.state = 'bottom';
        if (sf & 1) { st.o = e.pos2.slice(); e.pos2 = e.pos1; e.pos1 = st.o.slice(); }
        e.maxHealth = e.health = +kv.health || 0; e.takedamage = e.health > 0; e.snd = +kv.sounds !== 1;
        e.use = act => doorUse(e, act); e.blocked = () => doorBlocked(e); e.die = () => { (e.teamList || [e]).forEach(d => { d.takedamage = false; d.health = d.maxHealth; }); doorUse(e.teamList ? e.teamList[0] : e, 'player'); };
        E.movers.push(e); doors.push(e); if (e.takedamage) E.damageables.push(e);
        break;
      }
      case 'func_plat': {
        const st = bmodel(e, true); if (!st) break;
        e.speed = +kv.speed || 200; const lip = +kv.lip || 8, height = +kv.height || 0;
        e.pos1 = [0, 0, 0]; e.pos2 = [0, 0, -(height || (e.maxs[2] - e.mins[2]) - lip)];
        if (e.targetname) e.state = 'top'; else { st.o = e.pos2.slice(); e.state = 'bottom'; }
        e.use = () => { if (e.moveTo || e.think) return; platGoDown(e); };
        e.blocked = () => { if (e.state === 'up') platGoDown(e); else if (e.state === 'down') platGoUp(e); };
        const tmin = [e.mins[0] + 25, e.mins[1] + 25, 0], tmax = [e.maxs[0] - 25, e.maxs[1] - 25, e.maxs[2] + 8];
        tmin[2] = tmax[2] - (e.pos1[2] - e.pos2[2] + lip); if (sf & 1) tmax[2] = tmin[2] + 8;
        for (const i of [0, 1]) if (tmax[i] - tmin[i] <= 0) { tmin[i] = (e.mins[i] + e.maxs[i]) / 2; tmax[i] = tmin[i] + 1; }
        E.triggers.push({ type: 'plat', mins: tmin, maxs: tmax, plat: e });
        E.movers.push(e); break;
      }
      case 'func_button': {
        const st = bmodel(e, true); if (!st) break;
        const md = movedir(kv), size = [0, 1, 2].map(i => e.maxs[i] - e.mins[i]), lip = kv.lip !== undefined ? +kv.lip : 4;
        const dist = Math.abs(md[0]) * size[0] + Math.abs(md[1]) * size[1] + Math.abs(md[2]) * size[2] - lip;
        e.pos1 = [0, 0, 0]; e.pos2 = md.map(v => v * dist); e.speed = +kv.speed || 40; e.wait = kv.wait !== undefined ? +kv.wait : 1; e.state = 'bottom';
        e.maxHealth = e.health = +kv.health || 0; e.takedamage = e.health > 0;
        e.use = act => buttonFire(e, act); e.die = () => { e.health = e.maxHealth; e.takedamage = false; buttonFire(e, 'player'); };
        if (e.takedamage) E.damageables.push(e);
        else if (!e.targetname) E.triggers.push({ type: 'button', mins: e.mins.map(v => v - 2), maxs: e.maxs.map(v => v + 2), btn: e });
        E.movers.push(e); break;
      }
      case 'func_train': {
        const st = bmodel(e, true); if (!st) break;
        e.speed = +kv.speed || 100; e.use = () => trainUse(e); e.blocked = () => {}; E.movers.push(e); break;
      }
      case 'func_wall': {
        const st = bmodel(e, true); if (!st) break;
        if (sf & 1 && !(sf & 4)) { st.active = st.visible = false; }
        e.use = () => { if (!st.active) { st.active = st.visible = true; } else if (sf & 2) { st.active = st.visible = false; } };
        break;
      }
      case 'func_explosive': {
        const st = bmodel(e, true); if (!st) break;
        e.maxHealth = e.health = +kv.health || 100; e.takedamage = true; E.damageables.push(e);
        if (sf & 1) { st.active = st.visible = false; e.takedamage = false; }
        e.die = () => explodeEnt(e);
        e.use = act => { if (!st.active) { st.active = st.visible = true; e.takedamage = true; } else explodeEnt(e, act); };
        break;
      }
      case 'func_object': case 'func_conveyor': case 'func_rotating': case 'func_killbox': bmodel(e, true); break;
      case 'func_water': case 'func_door_rotating': case 'func_door_secret': bmodel(e, false); break;
      case 'trigger_once': case 'trigger_multiple': {
        const box = trigBox(e); if (!box) break;
        e.wait = e.cls === 'trigger_once' ? -1 : (+kv.wait || 0.2); e.enabled = !(sf & 4); e.noPlayer = !!(sf & 2); e.waitUntil = 0;
        e.use = act => { if (!e.enabled) { e.enabled = true; return; } multiFire(e, act); };
        E.triggers.push({ type: 'multi', ...box, e }); break;
      }
      case 'trigger_relay': e.use = act => useTargets(e, act); break;
      case 'trigger_always': e.delay = Math.max(e.delay, 0.2); break;
      case 'trigger_counter': e.count = +kv.count || 2; e.use = act => { if (e.count <= 0) return; e.count--; if (e.count) { if (!(sf & 1)) { toast(`${e.count} more to go...`); play('talk', .5); } return; } if (!(sf & 1)) toast('Sequence completed!'); useTargets(e, act); }; break;
      case 'trigger_key': e.use = act => { const it = ITEMS[kv.item], nm = it ? it.n : (kv.item || 'key'); toast(E.keys.has(kv.item) ? `Used the ${nm}` : `You need the ${nm} (opened anyway)`); if (E.keys.has(kv.item)) E.keys.delete(kv.item); useTargets(e, act); }; break;
      case 'target_changelevel': e.use = () => changeLevel(kv.map); break;
      case 'target_secret': e.use = act => { play('secret', .8); toast('You found a secret area!'); useTargets(e, act); }; break;
      case 'target_goal': e.use = act => { play('secret', .8); toast('Goal completed!'); useTargets(e, act); }; break;
      case 'target_help': e.use = () => { if (kv.message) toast('Help computer: ' + kv.message.replace(/\\n/g, ' '), 4000); play('talk', .5); }; e.message = ''; break;
      case 'target_explosion': e.dmg = +kv.dmg || 0; e.use = () => later(e.delay * 1000, () => { fxExplosion(e.origin, [0, 0, 1], 'rocket'); playAt('boom', e.origin); if (e.dmg) radiusDamage(e.origin, e.dmg, e.dmg + 40, null, 'world'); }); break;
      case 'misc_explobox': {
        const o = e.origin, t = Q.trace([o[0], o[1], o[2] + 1], [-16, -16, 0], [16, 16, 40], [o[0], o[1], o[2] - 256], Q.MASK_SOLID), b = t.allsolid ? o : t.endpos;
        e.box = { mins: [b[0] - 16, b[1] - 16, b[2]], maxs: [b[0] + 16, b[1] + 16, b[2] + 40], active: true, ent: e }; cm.boxes.push(e.box);
        e.maxHealth = e.health = +kv.health || 10; e.dmg = +kv.dmg || 150; e.takedamage = true;
        e.die = () => later(200, () => barrelExplode(e)); E.damageables.push(e); E.barrels.push(e); break;
      }
      case 'func_timer': {
        e.wait = +kv.wait || 1; e.random = +kv.random || 0; e.on = false;
        const fire = () => { if (!e.on || e.dead) return; useTargets(e, 'player'); later((e.wait + (Math.random() * 2 - 1) * e.random) * 1000, fire); };
        e.use = () => { e.on = !e.on; if (e.on) later((+kv.pausetime || 0) * 1000 + e.wait * 1000, fire); };
        if (sf & 1) { e.on = true; later(1000 + (+kv.pausetime || 0) * 1000 + e.wait * 1000, fire); }
        break;
      }
      case 'trigger_push': {
        const box = trigBox(e); if (!box) break;
        if (w.q3) { const t = kv.target && w.ents.find(x => x.targetname === kv.target); if (t) E.triggers.push({ type: 'push', ...box, vel: aimAtTarget(box, Q.vecOf(t.origin)), q3: true }); break; }
        const sp = (+kv.speed || 1000) * 10; E.triggers.push({ type: 'push', ...box, vel: movedir(kv).map(v => v * sp), e });
        e.use = () => { e.dead = !e.dead; }; break;
      }
      case 'misc_teleporter': {
        if (!kv.target) break; const o = e.origin;
        E.triggers.push({ type: 'tele', mins: [o[0] - 8, o[1] - 8, o[2] + 8], maxs: [o[0] + 8, o[1] + 8, o[2] + 24], target: kv.target }); break;
      }
      case 'trigger_teleport': { const box = trigBox(e); if (box && kv.target) E.triggers.push({ type: 'tele', ...box, target: kv.target, q3: !!w.q3 }); break; }
      case 'target_speaker': setupSpeaker(e); break;
      default: if (MON[e.cls]) setupMonster(e, cm); else if ((w.q3 ? ITEMS_Q3 : ITEMS)[e.cls]) setupItem(e, cm);
    }
  }
  // door teams, auto-open fields, locked-door messages
  const teams = new Map();
  doors.forEach((d, i) => { const k = d.kv.team || '#' + i; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(d); });
  for (const team of teams.values()) {
    team.forEach(d => d.teamList = team);
    const m = team[0];
    if (!team.some(d => d.health || d.targetname)) {
      const mins = [1e9, 1e9, 1e9], maxs = [-1e9, -1e9, -1e9];
      for (const d of team) for (let i = 0; i < 3; i++) { mins[i] = Math.min(mins[i], d.mins[i] + d.st.o[i]); maxs[i] = Math.max(maxs[i], d.maxs[i] + d.st.o[i]); }
      mins[0] -= 60; mins[1] -= 60; maxs[0] += 60; maxs[1] += 60;
      E.triggers.push({ type: 'door', mins, maxs, door: m, deb: 0 });
    }
    for (const d of team) if (d.targetname && d.message) E.triggers.push({ type: 'msg', mins: d.mins.map((v, i) => v + d.st.o[i] - 4), maxs: d.maxs.map((v, i) => v + d.st.o[i] + 4), text: d.message, deb: 0 });
  }
  // trains find their first path_corner
  for (const e of E.movers) if (e.cls === 'func_train') {
    const c = e.target && pickTarget(e.target); if (!c) continue;
    e.target = c.kv.target; e.st.o = V3.sub(c.origin, e.mins);
    if (!e.targetname) e.spawnflags |= 1;
    if (e.spawnflags & 1) later(100, () => trainNext(e));
  }
  for (const m of E.monsters) { const c = m.kv.target && (E.byName.get(m.kv.target) || []).find(x => x.cls === 'path_corner'); if (c) m.path = c; }
  for (const e of E.list) if (e.cls === 'trigger_always') useTargets(e, 'player');
}
const pickTarget = n => { const l = E.byName.get(n); return l && l.length ? l[Math.floor(Math.random() * l.length)] : null; };
function useTargets(e, act) { if (e.delay) later(e.delay * 1000, () => useTargetsNow(e, act)); else useTargetsNow(e, act); }
function useTargetsNow(e, act) {
  if (e.dead && !e.allowDead && e.cls !== 'trigger_once') return;
  if (e.message && act === 'player' && !/^func_door/.test(e.cls)) { toast(e.message, 3500); play('talk', .6); }
  if (e.killtarget) for (const t of E.byName.get(e.killtarget) || []) killEnt(t);
  if (e.target) for (const t of (E.byName.get(e.target) || []).slice()) if (t !== e && !t.dead && t.use) t.use(act);
}
function killEnt(t) { t.dead = true; t.use = null; t.moveTo = null; t.think = null; t.takedamage = false; if (t.st) { t.st.active = false; t.st.visible = false; } if (t.box) t.box.active = false; }
function multiFire(e, act) {
  if (e.waitUntil > simTime || e.dead) return;
  useTargets(e, act);
  if (e.wait > 0) e.waitUntil = simTime + e.wait * 1000; else { e.dead = true; }
}
// doors
function doorUse(e, act) {
  const team = e.teamList || [e];
  if ((e.spawnflags & 32) && (e.state === 'up' || e.state === 'top')) { team.forEach(doorGoDown); return; }
  team.forEach(d => doorGoUp(d, act));
}
function doorGoUp(d, act) {
  if (d.dead || d.state === 'up') return;
  if (d.state === 'top') { if (d.wait >= 0) d.nextT = simTime + d.wait * 1000; return; }
  if (d.snd && d === (d.teamList || [d])[0]) playAt('doorStart', entCenter(d));
  d.state = 'up'; d.moveTo = d.pos2;
  d.onArrive = () => { d.state = 'top'; if (d.snd && d === d.teamList[0]) playAt('doorEnd', entCenter(d)); if (d.spawnflags & 32) return; if (d.wait >= 0) { d.nextT = simTime + d.wait * 1000; d.think = () => doorGoDown(d); } };
  useTargets(d, act);
}
function doorGoDown(d) {
  if (d.dead) return;
  if (d.snd && d === (d.teamList || [d])[0]) playAt('doorStart', entCenter(d));
  if (d.maxHealth) { d.takedamage = true; d.health = d.maxHealth; }
  d.state = 'down'; d.moveTo = d.pos1; d.think = null;
  d.onArrive = () => { d.state = 'bottom'; if (d.snd && d === d.teamList[0]) playAt('doorEnd', entCenter(d)); };
}
function doorBlocked(d) {
  if (d.spawnflags & 4 || d.wait < 0) return;
  const team = d.teamList || [d];
  if (d.state === 'down') team.forEach(x => doorGoUp(x)); else team.forEach(doorGoDown);
}
// plats
function platGoUp(e) { playAt('platStart', entCenter(e)); e.state = 'up'; e.moveTo = e.pos1; e.think = null; e.onArrive = () => { e.state = 'top'; playAt('platEnd', entCenter(e)); e.nextT = simTime + 3000; e.think = () => platGoDown(e); }; }
function platGoDown(e) { playAt('platStart', entCenter(e)); e.state = 'down'; e.moveTo = e.pos2; e.think = null; e.onArrive = () => { e.state = 'bottom'; playAt('platEnd', entCenter(e)); }; }
// buttons
function buttonFire(e, act) {
  if (e.dead || e.state === 'up' || e.state === 'top') return;
  playAt('button', entCenter(e)); e.state = 'up'; e.moveTo = e.pos2;
  e.onArrive = () => {
    e.state = 'top'; useTargets(e, act);
    if (e.wait >= 0) { e.nextT = simTime + e.wait * 1000; e.think = () => { e.state = 'down'; e.moveTo = e.pos1; e.onArrive = () => { e.state = 'bottom'; if (e.maxHealth) { e.health = e.maxHealth; e.takedamage = true; } }; }; }
  };
}
// trains
function trainNext(e) {
  if (e.dead) return;
  let first = true;
  for (let guard = 0; guard < 32; guard++) {
    const c = e.target && pickTarget(e.target); if (!c) { e.running = false; return; }
    e.target = c.kv.target;
    if (c.spawnflags & 1) { if (!first) { e.running = false; return; } first = false; e.st.o = V3.sub(c.origin, e.mins); continue; }
    e.cur = c; if (+c.kv.speed) e.speed = +c.kv.speed; e.running = true;
    e.moveTo = V3.sub(c.origin, e.mins); e.onArrive = () => trainWait(e); return;
  }
}
function trainWait(e) {
  const c = e.cur;
  if (c.kv.pathtarget) for (const t of (E.byName.get(c.kv.pathtarget) || [])) if (t.use) t.use('player');
  const wait = +c.kv.wait || 0;
  if (wait > 0) { e.nextT = simTime + wait * 1000; e.think = () => trainNext(e); }
  else if (wait < 0) { e.running = false; }
  else trainNext(e);
}
function trainUse(e) {
  if (e.running) { if (!(e.spawnflags & 2)) return; e.running = false; e.paused = e.moveTo; e.moveTo = null; e.think = null; return; }
  if (e.paused) { e.moveTo = e.paused; e.paused = null; e.running = true; } else trainNext(e);
}
function damageEnt(e, dmg, src) { if (src !== 'monster' && PL.quad > simTime) dmg *= 4; if (e.isMonster) { damageMonster(e, dmg, src); return; } if (!e.takedamage || e.dead) return; e.health -= dmg; if (e.health <= 0) { e.takedamage = false; e.die && e.die(); } }
// move a brush entity, pushing (or being blocked by) the player
function pushMove(e, n) {
  const st = e.st;
  if (!st.active || ps.noclip) { st.o = n; return true; }
  const old = st.o, d = V3.sub(n, old), o = ps.origin.map(v => v / 8);
  const rider = pm.ground && pm.groundEnt === st.si;
  st.o = n;
  const inside = Q.testSolid(st.si, o, pm.mins, pm.maxs);
  if (!rider && !inside) return true;
  const saved = ps.origin.slice();
  ps.origin = [0, 1, 2].map(i => Math.round(saved[i] + d[i] * 8));
  if (Q.goodPosition()) return true;
  ps.origin = saved;
  if (!inside) return true;
  st.o = old; return false;
}
function runEntities(msec) {
  const dt = msec / 1000;
  for (let i = 0; i < E.timers.length; i++) { const t = E.timers[i]; if (t.t <= simTime) { E.timers.splice(i--, 1); t.fn(); } }
  for (const e of E.movers) {
    if (e.dead) continue;
    if (e.think && simTime >= e.nextT) { const f = e.think; e.think = null; f(); }
    if (!e.moveTo) continue;
    const o = e.st.o, d = V3.sub(e.moveTo, o), dist = Math.hypot(d[0], d[1], d[2]), step = e.speed * dt;
    let n, arrived = false;
    if (step >= dist) { n = e.moveTo.slice(); arrived = true; } else n = [0, 1, 2].map(i => o[i] + d[i] / dist * step);
    if (!pushMove(e, n)) { e.blocked && e.blocked(); continue; }
    if (arrived) { e.moveTo = null; const cb = e.onArrive; e.onArrive = null; cb && cb(); }
  }
}
let changing = false;
async function changeLevel(str) {
  if (changing) return;
  const parts = String(str || '').replace(/^\*/, '').split('+').filter(p => p && !/\.(cin|pcx|dm2)$/i.test(p));
  if (!parts.length) { toast('Unit complete — that is the end of this campaign path.', 5000); return; }
  const [name, spot] = parts[parts.length - 1].split('$'), path = 'maps/' + name.toLowerCase() + '.bsp';
  if (!VFS.has(path)) { toast(`Next map "${name}" isn't in the loaded paks`, 4000); return; }
  changing = true; toast('Loading ' + name + '…', 8000);
  await loadMap(path, spot || '', true);
  changing = false;
}

// ---------- spawning & player ----------
// The game clock restarts at 0 on every map. Every timestamp kept outside the map's own entities is moved back by the
// same amount, so animations, cooldowns and powerups carry on smoothly instead of waiting for the clock to catch up.
function shiftClocks(d) {
  if (!d) return; const sh = v => (Number.isFinite(v) && Math.abs(v) < 1e8 ? v - d : v);
  lastFire = sh(lastFire); noiseT = sh(noiseT); stepTime = sh(stepTime); rippleT = sh(rippleT); bubbleT = sh(bubbleT); pushSndT = sh(pushSndT);
  if (W.gtime) W.gtime = sh(W.gtime);
  PL.painT = sh(PL.painT); PL.deadT = sh(PL.deadT); if (PL.quad) PL.quad = sh(PL.quad); if (PL.invul) PL.invul = sh(PL.invul);
  W3.flashT = sh(W3.flashT); W3.flashSeen = sh(W3.flashSeen); W3.landT = sh(W3.landT); W3.torso.start = sh(W3.torso.start); W3.barrel.time = sh(W3.barrel.time);
}
function setWorld(w, spot) {
  if (world && !world.builtin) freeWorld(world);
  BOT.on = false; BOT.bots = [];
  world = w; Q.setCM(w.cm); clearFx(); shiftClocks(simTime); simTime = 0; stopSpeakers();
  initEntities(w);
  preloadWorldSounds();
  if (AC && running) for (const sp of speakers) if (sp.startOn) speakerOn(sp);
  loadMonsterModels();
  const ws = (w.ents || []).find(e => e.classname === 'worldspawn'); if (w.music) startMusicFile(w.music.trim().split(/\s+/)[0]); else startMusic(ws && ws.sounds);
  let idx = 0; if (spot) { const i = w.spawns.findIndex(s => s.name === spot); if (i >= 0) idx = i; }
  spawnIdx = idx; respawn(idx);
  if (BOT.pending) { const n = BOT.pending - 1; BOT.pending = 0; beginBotMatch(n); }
  SAVE.lastAuto = 0; hideDeathMenu();
  if (SAVE.pending) { const s = SAVE.pending; SAVE.pending = null; applySnap(s); } else if (!isDM()) autosave('Level start');
}
function respawn(i) {
  const sp = world.spawns[i % world.spawns.length];
  ps.origin = [Math.round(sp.o[0] * 8), Math.round(sp.o[1] * 8), Math.round((sp.o[2] + 9) * 8)];
  ps.velocity = [0, 0, 0]; ps.flags = 0; ps.time = 0;
  pm.mins = [-16, -16, -24]; pm.maxs = [16, 16, 32]; pm.viewheight = 22; vh = 22;
  Q.initialSnapPosition(); prevOrigin = ps.origin.slice(); yaw = sp.yaw; pitch = 0; topSpeed = 0; stepAmt = 0;
}
function cmdFromInput(msec) {
  const c = pm.cmd; c.msec = msec;
  const walk = keys.has('ShiftLeft') || keys.has('ShiftRight'), sp = (S.run !== walk) ? 400 : 200;
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f++; if (keys.has('KeyS') || keys.has('ArrowDown')) f--;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s++; if (keys.has('KeyA') || keys.has('ArrowLeft')) s--;
  c.forwardmove = Math.max(-400, Math.min(400, f * sp + Math.round(-touch.jy * 400)));
  c.sidemove = Math.max(-400, Math.min(400, s * sp + Math.round(touch.jx * 400)));
  const jump = keys.has('Space') || mouseJump || touch.jump || jumpPulse > 0, duck = keys.has('KeyC') || keys.has('ControlLeft') || touch.duck;
  if (jumpPulse > 0) jumpPulse--;
  c.upmove = jump ? 200 : duck ? -200 : 0;
  if (S.autohop && jump) ps.flags &= ~Q.PMF_JUMP_HELD;
  pm.angles = [pitch, yaw, 0];
}
function overlap(amin, amax, t) { return amin[0] <= t.maxs[0] && amax[0] >= t.mins[0] && amin[1] <= t.maxs[1] && amax[1] >= t.mins[1] && amin[2] <= t.maxs[2] && amax[2] >= t.mins[2]; }
function teleport(dest, tyaw) {
  ps.origin = [Math.round(dest[0] * 8), Math.round(dest[1] * 8), Math.round((dest[2] + 10) * 8)];
  ps.velocity = [0, 0, 0]; ps.time = 160 >> 3; ps.flags |= Q.PMF_TIME_TELEPORT; yaw = tyaw; pitch = 0;
  prevOrigin = ps.origin.slice(); play('tele', 0.8);
}
function touchTriggers() {
  if (ps.noclip) return;
  const o = ps.origin.map(v => v / 8), amin = [0, 1, 2].map(i => o[i] + pm.mins[i] - 1), amax = [0, 1, 2].map(i => o[i] + pm.maxs[i] + 1);
  for (const t of E.triggers) {
    if (!overlap(amin, amax, t)) continue;
    switch (t.type) {
      case 'push': if (t.e && t.e.dead) break; ps.velocity = t.vel.map(v => Math.max(-32768, Math.min(32767, Math.trunc(v * 8)))); if (t.q3) ps.flags &= ~Q.PMF_ON_GROUND; if (simTime > pushSndT) { pushSndT = simTime + (t.q3 ? 400 : 1500); play(t.q3 ? 'jumppad' : 'push', 0.8); } break;
      case 'tele': {
        let dest = t.dest, dy = t.yaw;
        if (!dest) { const d = (E.byName.get(t.target) || []).find(x => x.cls === 'misc_teleporter_dest') || pickTarget(t.target); if (!d) break; dest = d.origin; dy = d.kv.angle !== undefined ? +d.kv.angle : d.kv.angles ? Q.vecOf(d.kv.angles)[1] : 0; }
        teleport(dest, dy);
        if (t.q3) { const f = [0, 0, 0]; Q.angleVectors([0, dy, 0], f); ps.time = 0; ps.flags &= ~Q.PMF_TIME_TELEPORT; ps.velocity = f.map(v => Math.trunc(v * 400 * 8)); play('telein', .8); }
        return;
      }
      case 'multi': { const e = t.e; if (e.dead || !e.enabled || e.noPlayer) break; multiFire(e, 'player'); break; }
      case 'door': if (simTime < t.deb || t.door.dead) break; t.deb = simTime + 1000; doorUse(t.door, 'player'); break;
      case 'plat': { const p = t.plat; if (p.dead) break; if (p.state === 'bottom') platGoUp(p); else if (p.state === 'top') p.nextT = simTime + 1000; break; }
      case 'button': buttonFire(t.btn, 'player'); break;
      case 'msg': if (simTime < t.deb) break; t.deb = t.once ? 1e15 : simTime + 5000; toast(t.text, 4500); play('talk', .6); break;
      case 'hurt': if (PL.dead || simTime < (t.next || 0)) break; t.next = simTime + (t.every || 100); damagePlayer(t.dmg || 5, null); break;
      case 'exit': levelExit(t); break;
    }
  }
}
// ---------- effects: particles, decals, dynamic lights, debris, shake ----------
const parts = [], decals = [], dlights = [], debris = [], glows = [];
let shake = 0, flashA = 0, kickP = 0, decalsDirty = true, thirdFrac = 1;
const rnd = (a, b) => a + Math.random() * (b - a), crand = () => Math.random() * 2 - 1;
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function randDir() { let x, y, z, l; do { x = crand(); y = crand(); z = crand(); l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4); l = Math.sqrt(l); return [x / l, y / l, z / l]; }
function addPart(o) { if (parts.length > 7000) { parts[0] = parts[parts.length - 1]; parts.pop(); } o.age = -(o.delay || 0); o.seed = o.seed === undefined ? Math.random() : o.seed; parts.push(o); return o; }
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function partColor(q, t) {
  switch (q.ramp) {
    case 'fire': return t < 0.08 ? [1, .88, .6, .8] : t < 0.3 ? [...mix3([1, .88, .6], [1, .45, .1], (t - .08) / .22), .75] : [...mix3([1, .45, .1], [.35, .06, .01], (t - .3) / .7), .75 * Math.max(0, 1 - (t - .3) / .7)];
    case 'smoke': { const g = q.g || .12, a = (q.a0 || .5) * Math.min(1, t / .12) * (1 - t); return [g, g * .95, g * .9, a]; }
    case 'spark': return [...mix3([1, .95, .7], [1, .45, .1], t), 1 - t * t];
    default: { const a = q.c0, b = q.c1; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }
  }
}
function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.age += dt; if (q.age < 0) continue;
    if (q.age >= q.life || (q.killBelow !== undefined && q.p[2] < q.killBelow) || (q.killAbove !== undefined && q.p[2] > q.killAbove)) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    const v = q.v; if (q.drag) { const k = Math.exp(-q.drag * dt); v[0] *= k; v[1] *= k; v[2] *= k; }
    v[2] += ((q.buoy || 0) - (q.grav || 0)) * dt;
    const np = [q.p[0] + v[0] * dt, q.p[1] + v[1] * dt, q.p[2] + v[2] * dt];
    if (q.collide) {
      const t = Q.trace(q.p, Z3, Z3, np, Q.MASK_SOLID);
      if (t.fraction < 1 && !t.startsolid) { q.p = t.endpos; const n = t.normal, d = Q.dot(v, n) * (1 + (q.bounce || .3)); for (let k = 0; k < 3; k++) v[k] = (v[k] - n[k] * d) * .7; } else q.p = np;
    } else q.p = np;
  }
  for (let i = dlights.length - 1; i >= 0; i--) { dlights[i].age += dt; if (dlights[i].age >= dlights[i].life) dlights.splice(i, 1); }
  shake *= Math.exp(-dt * 7); flashA *= Math.exp(-dt * 9); kickP *= Math.exp(-dt * 14);
}
function addDecal(p, n, size, kind) {
  const a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], t1 = nrm(Q.cross(n, a)), t2 = Q.cross(n, t1), an = Math.random() * 6.283, c = Math.cos(an), s = Math.sin(an);
  const T = [0, 1, 2].map(i => t1[i] * c + t2[i] * s), B = Q.cross(n, T), o = [p[0] + n[0] * .5, p[1] + n[1] * .5, p[2] + n[2] * .5];
  const at = (x, y, sz) => [o[0] + (T[0] * x + B[0] * y) * sz, o[1] + (T[1] * x + B[1] * y) * sz, o[2] + (T[2] * x + B[2] * y) * sz];
  const onSurface = q => { // is there wall under this spot, facing the same way, at the same depth?
    const t = Q.trace([q[0] + n[0] * 3, q[1] + n[1] * 3, q[2] + n[2] * 3], Z3, Z3, [q[0] - n[0] * 5, q[1] - n[1] * 5, q[2] - n[2] * 5], Q.MASK_SOLID, true);
    return !t.startsolid && t.fraction < 1 && Q.dot(t.normal, n) > .9 && Math.abs(t.fraction * 8 - 3.5) < 1.6;
  };
  const P = (x, y, sz) => [...at(x, y, sz), x, y, kind], tris = [];
  const cell = (x0, y0, x1, y1, sz) => tris.push(P(x0, y0, sz), P(x1, y0, sz), P(x1, y1, sz), P(x0, y0, sz), P(x1, y1, sz), P(x0, y1, sz));
  if (size <= 6) { // bullet holes: all or nothing, shrinking once if it overhangs an edge
    let sz = size; const ok = z => [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]].every(([x, y]) => onSurface(at(x, y, z)));
    if (!ok(sz)) { sz *= .5; if (!ok(sz)) return; }
    cell(-1, -1, 1, 1, sz);
  } else { // scorch marks: a 4x4 grid, keeping only the cells with surface under them
    const N = 4;
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      const x0 = -1 + 2 * gx / N, x1 = x0 + 2 / N, y0 = -1 + 2 * gy / N, y1 = y0 + 2 / N;
      if (onSurface(at((x0 + x1) / 2, (y0 + y1) / 2, size))) cell(x0, y0, x1, y1, size);
    }
    if (!tris.length) return;
  }
  decals.push(tris);
  if (decals.length > 220) decals.shift();
  decalsDirty = true;
}
function decalAt(t, size, kind) { if (t && t.fraction < 1 && t.ent === -1 && !(t.surf & Q.SURF_SKY)) addDecal(t.endpos, t.normal, size, kind); }
function addLight(p, r, c, life) { dlights.push({ p: p.slice(), r, c, life, age: 0 }); }
function nearFx(p, power) {
  const o = ps.origin.map(v => v / 8), d = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
  shake = Math.max(shake, power * 7 * Math.max(0, 1 - d / 900)); flashA = Math.max(flashA, power * .45 * Math.max(0, 1 - d / 500));
}
function fxExplosion(p, n, kind) {
  const N = n || [0, 0, 1], s = kind === 'barrel' ? 1.35 : kind === 'grenade' ? 1.1 : kind === 'small' ? .55 : 1;
  if (Q.pointContents(p) & Q.MASK_WATER) { addPart({ p, v: [0, 0, 0], life: .15, size0: 60 * s, size1: 90 * s, kind: 0, ramp: 'lin', c0: [.8, .9, 1, .7], c1: [.4, .6, 1, 0] }); fxBubbles(p, 50 * s, 18 * s); addLight(p, 300 * s, [.6, .8, 1.1], .4); const sf = surfaceAbove(p, 320); if (sf) fxSplash(sf, 1.7 * s * Math.max(.3, 1 - (sf[2] - p[2]) / 400), 1); nearFx(p, s * .8); return; }
  const at = (k, d) => [p[0] + N[0] * k + d[0], p[1] + N[1] * k + d[1], p[2] + N[2] * k + d[2]];
  addPart({ p: at(4, Z3), v: [0, 0, 0], life: .12, size0: 70 * s, size1: 130 * s, kind: 0, ramp: 'lin', c0: [1, .9, .7, .8], c1: [1, .6, .3, 0] });
  addPart({ p: at(8, Z3), v: [0, 0, 0], life: .4, size0: 55 * s, size1: 25 * s, kind: 0, ramp: 'lin', c0: [1, .65, .3, .6], c1: [1, .25, .05, 0] });
  for (let i = 0; i < 30 * s; i++) { const d = randDir(), dir = nrm([d[0] + N[0] * .8, d[1] + N[1] * .8, d[2] + N[2] * .8]), sp = rnd(70, 280) * s; addPart({ p: at(6, d.map(x => x * rnd(0, 12) * s)), v: dir.map(x => x * sp), life: rnd(.45, .9), size0: rnd(14, 28) * s, size1: rnd(36, 62) * s, kind: 3, ramp: 'fire', drag: 4.5, buoy: 70 }); }
  for (let i = 0; i < 26 * s; i++) { const d = randDir(); addPart({ p: at(12, d.map(x => x * 16 * s)), v: [d[0] * rnd(20, 90) * s + N[0] * 40, d[1] * rnd(20, 90) * s + N[1] * 40, d[2] * rnd(20, 90) * s + N[2] * 40], life: rnd(2.6, 4.5), delay: rnd(.04, .35), size0: rnd(18, 30) * s, size1: rnd(70, 120) * s, kind: 1, blend: 1, ramp: 'smoke', a0: rnd(.6, .85), g: rnd(.09, .18), drag: 1.5, buoy: rnd(22, 48) }); }
  for (let i = 0; i < 45 * s; i++) { const d = randDir(), dir = nrm([d[0] + N[0] * .5, d[1] + N[1] * .5, d[2] + N[2] * .5]), sp = rnd(220, 720); addPart({ p: at(3, Z3), v: dir.map(x => x * sp), life: rnd(.5, 1.4), size0: rnd(1.2, 2.4), size1: .5, kind: 2, ramp: 'spark', grav: 700, drag: .9, collide: true, bounce: .4 }); }
  for (let i = 0; i < 10 * s; i++) { const d = randDir(); addPart({ p: at(8, d.map(x => x * 20 * s)), v: [d[0] * 40, d[1] * 40, rnd(30, 90)], life: rnd(1.2, 2.5), size0: rnd(2, 3.5), size1: .5, kind: 0, ramp: 'lin', c0: [1, .6, .2, 1], c1: [.8, .2, .05, 0], buoy: 20, drag: 1.2 }); }
  addLight(at(18, Z3), 420 * s, [1.1, .7, .32], .75);
  nearFx(p, s);
}
function fxBFG(p) {
  addPart({ p, v: [0, 0, 0], life: .25, size0: 120, size1: 260, kind: 0, ramp: 'lin', c0: [.8, 1, .8, 1], c1: [.2, 1, .2, 0] });
  for (let i = 0; i < 160; i++) { const d = randDir(), sp = rnd(150, 650); addPart({ p: p.slice(), v: d.map(x => x * sp), life: rnd(.6, 1.4), size0: rnd(2, 5), size1: 1, kind: 0, ramp: 'lin', c0: [.6, 1, .5, 1], c1: [.1, .8, .1, 0], drag: 1.8, grav: 60 }); }
  for (let i = 0; i < 20; i++) { const d = randDir(); addPart({ p: p.map((v, k) => v + d[k] * 20), v: d.map(x => x * rnd(60, 200)), life: rnd(.5, .9), size0: 30, size1: 70, kind: 1, ramp: 'lin', c0: [.7, 1, .6, .8], c1: [0, .5, 0, 0], drag: 3 }); }
  addLight(p, 650, [.4, 1.3, .4], 1.0); nearFx(p, 1.4);
}
function fxImpact(t, kind) {
  const p = t.endpos, n = t.normal;
  const sparks = kind === 'shotgun' ? 5 : kind === 'blaster' ? 26 : kind === 'rail' ? 18 : 9;
  for (let i = 0; i < sparks; i++) {
    const d = randDir(), dir = nrm([d[0] + n[0] * 1.2, d[1] + n[1] * 1.2, d[2] + n[2] * 1.2]), sp = rnd(80, kind === 'blaster' ? 260 : 380);
    addPart({ p: p.map((v, k) => v + n[k] * 2), v: dir.map(x => x * sp), life: rnd(.25, .7), size0: kind === 'blaster' ? 1.8 : 1.3, size1: .4, kind: 2, ramp: kind === 'blaster' ? 'lin' : kind === 'rail' ? 'lin' : 'spark', c0: kind === 'rail' ? [.7, .8, 1, 1] : [1, .85, .3, 1], c1: kind === 'rail' ? [.2, .3, 1, 0] : [1, .4, 0, 0], grav: 600, collide: kind !== 'shotgun' });
  }
  if (kind !== 'blaster') addPart({ p: p.map((v, k) => v + n[k] * 4), v: n.map(x => x * 18), life: rnd(.7, 1.3), size0: 4, size1: 14, kind: 1, blend: 1, ramp: 'smoke', g: .35, a0: .45, buoy: 12, drag: 2 });
  addPart({ p: p.map((v, k) => v + n[k] * 2), v: [0, 0, 0], life: .07, size0: kind === 'blaster' ? 14 : 6, size1: 2, kind: 0, ramp: 'lin', c0: [1, .9, .6, 1], c1: [1, .6, .2, 0] });
  if (kind === 'blaster') addLight(p, 150, [1, .85, .3], .15);
  decalAt(t, kind === 'blaster' ? 5 : kind === 'rail' ? 4 : 2.2, kind === 'blaster' ? 1.3 : 0);
}
function fxTrail(pr, dist) {
  pr.acc = (pr.acc || 0) + dist;
  const step = pr.type === 'rocket' ? 9 : pr.type === 'grenade' || pr.type === 'prox' ? 14 : pr.type === 'nail' ? 18 : 7;
  while (pr.acc >= step) {
    pr.acc -= step; const p = pr.p.map(v => v + crand() * 1.5);
    if (Q.pointContents(p) & Q.MASK_WATER) { addPart({ p, v: [crand() * 8, crand() * 8, rnd(10, 30)], life: rnd(.8, 1.6), size0: rnd(.8, 1.8), size1: 1.2, kind: 6, blend: 1, ramp: 'lin', c0: [.9, .97, 1, .75], c1: [.9, .97, 1, .2], buoy: 80 }); continue; }
    if (pr.type === 'plasma') { addPart({ p, v: [0, 0, 0], life: .15, size0: 4, size1: 1, kind: 0, ramp: 'lin', c0: [.5, .6, 1, .9], c1: [.2, .3, 1, 0] }); continue; }
    if (pr.type === 'bfg3') { addPart({ p, v: randDir().map(x => x * 15), life: .35, size0: 6, size1: 1, kind: 0, ramp: 'lin', c0: [.5, 1, .4, 1], c1: [0, .6, 0, 0] }); continue; }
    if (pr.type === 'rocket') {
      addPart({ p, v: [crand() * 6, crand() * 6, rnd(4, 14)], life: rnd(1, 1.8), size0: 5, size1: rnd(18, 28), kind: 1, blend: 1, ramp: 'smoke', g: rnd(.35, .5), a0: .35, drag: 1.4, buoy: 10 });
      addPart({ p: p.slice(), v: [0, 0, 0], life: .14, size0: 7, size1: 3, kind: 0, ramp: 'lin', c0: [1, .75, .35, .9], c1: [1, .3, 0, 0] });
    } else if (pr.type === 'nail') addPart({ p, v: [0, 0, 4], life: rnd(.25, .45), size0: 1.5, size1: 5, kind: 1, blend: 1, ramp: 'smoke', g: .55, a0: .18, buoy: 4 });
    else if (pr.type === 'grenade' || pr.type === 'prox') addPart({ p, v: [0, 0, 6], life: .9, size0: 3, size1: 10, kind: 1, blend: 1, ramp: 'smoke', g: .4, a0: .25, buoy: 6 });
    else if (pr.type === 'bfg') addPart({ p, v: randDir().map(x => x * 20), life: .5, size0: 5, size1: 1, kind: 0, ramp: 'lin', c0: [.5, 1, .4, 1], c1: [0, .6, 0, 0] });
    else addPart({ p, v: [0, 0, 0], life: .22, size0: 3, size1: .5, kind: 0, ramp: 'lin', c0: [1, .9, .4, .9], c1: [1, .5, 0, 0] });
  }
}
function fxBeam(a, b, kind) { // railgun spiral (CL_RailTrail) and BFG lasers
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d); if (len < 1) return;
  const f = d.map(x => x / len), up0 = Math.abs(f[2]) < .9 ? [0, 0, 1] : [1, 0, 0], R = nrm(Q.cross(f, up0)), U = Q.cross(R, f);
  if (kind === 'rail') {
    const n1 = Math.min(len, 2400) / 2;
    for (let i = 0; i < n1; i++) { const s = i * 2, ang = s * .1, c = Math.cos(ang), sn = Math.sin(ang), dir = [0, 1, 2].map(k => R[k] * c + U[k] * sn); addPart({ p: [0, 1, 2].map(k => a[k] + f[k] * s + dir[k] * 3), v: dir.map(x => x * 6), life: rnd(.9, 1.2), size0: 1.6, size1: 1, kind: 0, ramp: 'lin', c0: [.35, .5, 1, 1], c1: [.1, .2, .9, 0] }); }
    for (let s = 0; s < Math.min(len, 2400); s += 3) addPart({ p: [0, 1, 2].map(k => a[k] + f[k] * s), v: [crand() * 3, crand() * 3, crand() * 3], life: rnd(.6, .8), size0: 1.3, size1: .6, kind: 0, ramp: 'lin', c0: [.95, .97, 1, 1], c1: [.5, .6, 1, 0] });
  } else for (let s = 0; s < len; s += 6) addPart({ p: [0, 1, 2].map(k => a[k] + f[k] * s), v: [0, 0, 0], life: .1, size0: 2.5, size1: 2, kind: 0, ramp: 'lin', c0: [.5, 1, .4, 1], c1: [.2, 1, .2, .5] });
}
function spawnDebris(p, model, speed, col) {
  const v = [100 * crand(), 100 * crand(), 100 + 100 * crand()].map(x => x * speed);
  debris.push({ p: p.slice(), v, a: [rnd(0, 360), rnd(0, 360)], av: [rnd(-600, 600), rnd(-600, 600)], life: rnd(5, 10), age: 0, model, col, size: model === 'debris1' ? 7 : model === 'debris3' ? 5 : 2.5, rest: false, smoke: Math.random() < .6 });
}
function updateDebris(msec) {
  const dt = msec / 1000;
  for (let i = debris.length - 1; i >= 0; i--) {
    const c = debris[i]; c.age += dt; if (c.age > c.life) { debris.splice(i, 1); continue; }
    if (c.rest) continue;
    c.v[2] -= 800 * dt;
    const np = c.p.map((v, k) => v + c.v[k] * dt), t = Q.trace(c.p, Z3, Z3, np, Q.MASK_SOLID);
    if (crossWater(c.p, t.fraction < 1 ? t.endpos : np, c.size > 4 ? .35 : .2)) { c.v = c.v.map(x => x * .35); c.smoke = false; }
    if (Q.pointContents(c.p) & Q.MASK_WATER) { c.v = c.v.map(x => x * Math.exp(-dt * 3)); c.v[2] += 600 * dt; }
    if (t.fraction < 1 && !t.startsolid) {
      c.p = t.endpos; const n = t.normal, b = Q.dot(c.v, n) * 1.5; for (let k = 0; k < 3; k++) c.v[k] -= n[k] * b;
      if (n[2] > .7 && c.v[2] < 60) { c.rest = true; c.v = [0, 0, 0]; }
    } else c.p = np;
    c.a[0] += c.av[0] * dt; c.a[1] += c.av[1] * dt;
    if (c.blood && c.age < 2 && Math.random() < dt * 25) addPart({ p: c.p.slice(), v: [0, 0, -20], life: .6, size0: 1.6, size1: .8, kind: 2, blend: 1, ramp: 'lin', c0: [.5, .02, .01, 1], c1: [.3, 0, 0, 0], grav: 300 });
    else if (c.smoke && !c.blood && c.age < 1.6 && Math.random() < dt * 30) addPart({ p: c.p.slice(), v: [0, 0, 8], life: .8, size0: 3, size1: 11, kind: 1, blend: 1, ramp: 'smoke', g: .18, a0: .35, buoy: 8 });
  }
}
function clearFx() { ragdolls.length = 0; PL.rag = null; parts.length = 0; decals.length = 0; dlights.length = 0; debris.length = 0; projs.length = 0; decalsDirty = true; setLoop(null); }

// ---------- damage ----------
const Z3 = [0, 0, 0];
function canDamage(src, targ) {
  if (Q.trace(src, Z3, Z3, targ, Q.MASK_SOLID).fraction === 1) return true;
  for (const [dx, dy] of [[15, 15], [15, -15], [-15, 15], [-15, -15]]) if (Q.trace(src, Z3, Z3, [targ[0] + dx, targ[1] + dy, targ[2]], Q.MASK_SOLID).fraction === 1) return true;
  return false;
}
function canDamageEnt(p, e) { const ec = entCenter(e), t = Q.trace(p, Z3, Z3, ec, Q.MASK_SOLID); return t.fraction === 1 || t.hit === e; }
function knockPlayer(from, points, scale) { // T_Damage knockback: 1600*k/mass for self ("rocket jump hack"), 500*k/mass otherwise
  const o = ps.origin.map(v => v / 8), dir = nrm([o[0] - from[0], o[1] - from[1], o[2] - from[2]]), k = (scale || 1600) * Math.trunc(points) / 200;
  for (let i = 0; i < 3; i++) ps.velocity[i] = Math.max(-32768, Math.min(32767, Math.trunc(ps.velocity[i] + dir[i] * k * 8)));
}
function radiusDamage(p, dmg, radius, ignore, attacker) { // T_RadiusDamage
  attacker = attacker || 'player'; const self = attacker === 'player';
  const o = ps.origin.map(v => v / 8), c = [0, 1, 2].map(i => o[i] + (pm.mins[i] + pm.maxs[i]) / 2), dist = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  if (ignore !== 'player' && !ps.noclip && !PL.dead && dist <= radius) { let pts = dmg - .5 * dist; if (self) pts *= .5; if (pts > 0 && canDamage(p, o)) { knockPlayer(p, pts, self ? 1600 : 500); damagePlayer(pts, p, self); } }
  for (const e of E.damageables.slice()) {
    if (e === ignore || !e.takedamage || (e.dead && !e.isMonster)) continue;
    const ec = entCenter(e), d = Math.hypot(ec[0] - p[0], ec[1] - p[1], ec[2] - p[2]); if (d > radius) continue;
    let pts = dmg - .5 * d; if (e === attacker) pts *= .5;
    if (pts > 0 && canDamageEnt(p, e)) {
      lastHitFrom = p;
      if (e.isMonster && !e.dead) { const dir = nrm([ec[0] - p[0], ec[1] - p[1], ec[2] - p[2] + 8]), k = 500 * pts / Math.max(50, e.mon.mass); for (let i = 0; i < 3; i++) e.vel[i] += dir[i] * k; if (e.vel[2] > 40) e.air = true; }
      damageEnt(e, pts, self ? 0 : 'monster');
    }
  }
  ragdollPush(p, radius * 1.3, dmg * 10);
}
const boxDist = (p, b) => Math.hypot(...[0, 1, 2].map(i => p[i] < b.mins[i] ? b.mins[i] - p[i] : p[i] > b.maxs[i] ? p[i] - b.maxs[i] : 0));
function radiusDamageQ3(p, dmg, radius, ignore) { // G_RadiusDamage: linear falloff to the bbox edge, knockback 1000*k/mass with +24 up
  if (ignore !== 'player' && !ps.noclip && !PL.dead) {
    const d0 = boxDist(p, playerBox());
    if (d0 < radius) { const pts = dmg * (1 - d0 / radius); if (pts > 0 && canDamage(p, ps.origin.map(v => v / 8))) { const c = playerCenter(), dir = nrm([c[0] - p[0], c[1] - p[1], c[2] - p[2] + 24]), k = 1000 * Math.min(200, pts) / 200; for (let i = 0; i < 3; i++) ps.velocity[i] = Math.max(-32768, Math.min(32767, Math.trunc(ps.velocity[i] + dir[i] * k * 8))); damagePlayer(pts * .5, p, true); } }
  }
  for (const e of E.damageables.slice()) {
    if (e === ignore || !e.takedamage || (e.dead && !e.isMonster)) continue;
    const bx = e.box || (e.st ? { mins: e.mins.map((v, i) => v + e.st.o[i]), maxs: e.maxs.map((v, i) => v + e.st.o[i]) } : null); if (!bx) continue;
    const d = boxDist(p, bx); if (d >= radius) continue; const pts = dmg * (1 - d / radius);
    if (pts > 0 && canDamageEnt(p, e)) { lastHitFrom = p; if (e.isMonster && !e.dead) { const ec = entCenter(e), dir = nrm([ec[0] - p[0], ec[1] - p[1], ec[2] - p[2] + 24]), k = 1000 * Math.min(200, pts) / Math.max(50, e.mon.mass); for (let i = 0; i < 3; i++) e.vel[i] += dir[i] * k; if (e.vel[2] > 40) e.air = true; } damageEnt(e, pts); }
  }
  ragdollPush(p, radius * 1.3, dmg * 10);
}
function fxPlasma(t) {
  const p = t.endpos, n = t.normal;
  addPart({ p: p.map((v, i) => v + n[i] * 3), v: [0, 0, 0], life: .25, size0: 18, size1: 6, kind: 0, ramp: 'lin', c0: [.6, .7, 1, 1], c1: [.2, .3, 1, 0] });
  for (let i = 0; i < 10; i++) { const d = randDir(); addPart({ p: p.map((v, k) => v + n[k] * 2), v: nrm([d[0] + n[0], d[1] + n[1], d[2] + n[2]]).map(x => x * rnd(60, 200)), life: rnd(.2, .5), size0: 1.4, size1: .4, kind: 2, ramp: 'lin', c0: [.7, .8, 1, 1], c1: [.2, .3, 1, 0], grav: 300 }); }
  addLight(p, 140, [.4, .5, 1.2], .2); decalAt(t, 7, 1.2);
}
function monsterProjHitPlayer(pr, p) {
  if (pr.type === 'bolt') { damagePlayer(pr.dmg, pr.p); bloodFx(p, null, .4); }
  else if (pr.type === 'rocket') { damagePlayer(pr.dmg, pr.p); knockPlayer(pr.p, pr.dmg, 500); radiusDamage(p, pr.rdmg || pr.dmg, pr.radius || 120, 'player', pr.owner); fxExplosion(p, nrm(pr.v.map(x => -x)), 'rocket'); playAt('boom', p); }
  else if (pr.type === 'grenade') { pr.p = p; grenadeExplode(pr); }
  else if (pr.type === 'bfg') { damagePlayer(pr.dmg, pr.p); radiusDamage(p, 200, 100, 'player', pr.owner); fxBFG(p); playAt('bfgBoom', p); }
}
function explodeEnt(e, act) { // func_explosive_explode
  if (e.dead) return;
  const c = entCenter(e), size = [0, 1, 2].map(i => (e.maxs[i] - e.mins[i]) / 2), dmg = +e.kv.dmg || 0, mass = +e.kv.mass || 75;
  e.st.active = false; e.st.visible = false; e.takedamage = false;
  if (dmg) radiusDamage(c, dmg, dmg + 40, e);
  const at = () => c.map((v, i) => v + crand() * size[i]);
  for (let i = 0; i < Math.min(8, Math.floor(mass / 100)); i++) spawnDebris(at(), 'debris1', 1, [.42, .4, .37]);
  for (let i = 0; i < Math.min(16, Math.floor(mass / 25)); i++) spawnDebris(at(), 'debris2', 2, [.5, .47, .42]);
  for (let i = 0; i < 18; i++) addPart({ p: at(), v: randDir().map(x => x * rnd(20, 80)), life: rnd(1.5, 3), size0: rnd(15, 25), size1: rnd(60, 100), kind: 1, blend: 1, ramp: 'smoke', g: rnd(.3, .45), a0: .5, drag: 1.5, buoy: 10 });
  if (dmg) { fxExplosion(c, [0, 0, 1], 'rocket'); playAt('boom', c); } else { playAt('land', c); nearFx(c, .4); }
  e.allowDead = true; useTargets(e, act || 'player'); killEnt(e);
}
function barrelExplode(e) { // barrel_explode
  if (e.dead) return;
  e.box.active = false; e.takedamage = false;
  const c = entCenter(e), half = [16, 16, 20], spd = 1.5 * e.dmg / 200;
  radiusDamage(c, e.dmg, e.dmg + 40, e);
  for (let i = 0; i < 2; i++) spawnDebris(c.map((v, k) => v + crand() * half[k]), 'debris1', spd, [.45, .28, .16]);
  for (const [dx, dy] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) spawnDebris([c[0] + dx, c[1] + dy, e.box.mins[2]], 'debris3', spd, [.4, .26, .15]);
  for (let i = 0; i < 8; i++) spawnDebris(c.map((v, k) => v + crand() * half[k]), 'debris2', 2 * e.dmg / 200, [.5, .32, .18]);
  fxExplosion(c, [0, 0, 1], 'barrel'); playAt('gboom', c);
  decalAt(Q.trace(c, Z3, Z3, [c[0], c[1], c[2] - 64], Q.MASK_SOLID), 56, 1 + Math.random());
  e.allowDead = true; useTargets(e, 'player'); killEnt(e);
}

// ---------- weapons (port of p_weapon.c timing: Weapon_Generic at 10 Hz) ----------
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const WEAPONS = [
  { name: 'Blaster', key: 'Digit1', v: 'v_blast', w: 'w_blaster', act: 4, fire: 8, idle: 52, deact: 55, pause: [19, 32], ff: [5], fn: () => { blasterFire(Z3, 15, false); W.frame++; }, col: [.8, .7, .2] },
  { name: 'Shotgun', key: 'Digit2', v: 'v_shotg', w: 'w_shotgun', act: 7, fire: 18, idle: 36, deact: 39, pause: [22, 28, 34], ff: [8, 9], fn: () => { if (W.frame === 9) { W.frame++; return; } shotgunFire(); W.frame++; }, col: [.45, .35, .25] },
  { name: 'Super Shotgun', key: 'Digit3', v: 'v_shotg2', w: 'w_sshotgun', act: 6, fire: 17, idle: 57, deact: 61, pause: [29, 42, 57], ff: [7], fn: () => { sshotgunFire(); W.frame++; }, col: [.35, .3, .28] },
  { name: 'Machinegun', key: 'Digit4', v: 'v_machn', w: 'w_machinegun', act: 3, fire: 5, idle: 45, deact: 49, pause: [23, 45], ff: [4, 5], fn: machinegunFire, col: [.3, .32, .3] },
  { name: 'Chaingun', key: 'Digit5', v: 'v_chain', w: 'w_chaingun', act: 4, fire: 31, idle: 61, deact: 64, pause: [38, 43, 51, 61], ff: range(5, 21), fn: chaingunFire, col: [.25, .25, .27] },
  { name: 'Grenade Launcher', key: 'Digit6', v: 'v_launch', w: 'w_glauncher', act: 5, fire: 16, idle: 59, deact: 64, pause: [34, 51, 59], ff: [6], fn: () => { glFire(); W.frame++; }, col: [.3, .4, .25] },
  { name: 'Rocket Launcher', key: 'Digit7', v: 'v_rocket', w: 'w_rlauncher', act: 4, fire: 12, idle: 50, deact: 54, pause: [25, 33, 42, 50], ff: [5], fn: () => { rocketFire(); W.frame++; }, col: [.29, .31, .27] },
  { name: 'HyperBlaster', key: 'Digit8', v: 'v_hyperb', w: 'w_hyperblaster', act: 5, fire: 20, idle: 49, deact: 53, pause: [], ff: range(6, 11), fn: hyperFire, col: [.3, .35, .45] },
  { name: 'Railgun', key: 'Digit9', v: 'v_rail', w: 'w_railgun', act: 3, fire: 18, idle: 56, deact: 61, pause: [56], ff: [4], fn: () => { railFire(); W.frame++; }, col: [.25, .3, .5] },
  { name: 'BFG10K', key: 'Digit0', v: 'v_bfg', w: 'w_bfg', act: 8, fire: 32, idle: 55, deact: 58, pause: [39, 45, 50, 55], ff: [9, 17], fn: () => { if (W.frame === 9) { play('bfgCharge'); addLight(muzzle(), 250, [.3, 1, .3], .3); W.frame++; return; } bfgFire(); W.frame++; }, col: [.25, .45, .25] },
  { name: 'Hand Grenade', key: 'KeyG', v: 'v_handgr', w: 'a_grenades', grenade: true, col: [.35, .4, .2] }
];
const W = { cur: 6, next: -1, last: 0, state: 'ready', frame: 13, oldFrame: 13, timer: 0, held: false, gtime: 0, blew: false };
const attackHeld = () => mouseFire || keys.has('KeyF') || touch.fire;
function aimVectors() { const f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0]; Q.angleVectors([pitch, yaw, 0], f, r, u); return { f, r, u }; }
function projectSource(off) { // P_ProjectSource / G_ProjectSource, pulled back if it ends up inside a wall
  const { f, r } = aimVectors(), o = ps.origin.map(v => v / 8), eye = [o[0], o[1], o[2] + pm.viewheight];
  const s = [o[0] + f[0] * off[0] + r[0] * off[1], o[1] + f[1] * off[0] + r[1] * off[1], o[2] + f[2] * off[0] + r[2] * off[1] + off[2]];
  const t = Q.trace(eye, Z3, Z3, s, Q.MASK_SHOT); return t.fraction < 1 ? t.endpos : s;
}
const vh8 = () => pm.viewheight - 8;
function muzzle() { const { f, r } = aimVectors(), o = ps.origin.map(v => v / 8); return [o[0] + f[0] * 24 + r[0] * 6, o[1] + f[1] * 24 + r[1] * 6, o[2] + pm.viewheight + f[2] * 24 - 4]; }
function flash(c) { addLight(muzzle(), 220, c || [1, .85, .45], .1); lastFire = simTime; noiseT = simTime; noiseP = ps.origin.map(v => v / 8); hearSound(noiseP, 1500, 'player', 'fire'); if (PL.quad > simTime) play('quadFire', .6); }
function fireLead(start, aim, dmg, hs, vs, kind) { // fire_lead
  const a = [0, 0, 0], ang = [-Math.atan2(aim[2], Math.hypot(aim[0], aim[1])) * 180 / Math.PI, Math.atan2(aim[1], aim[0]) * 180 / Math.PI, 0], f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0];
  Q.angleVectors(ang, f, r, u); const rr = crand() * hs, uu = crand() * vs;
  const end = [0, 1, 2].map(i => start[i] + f[i] * 8192 + r[i] * rr + u[i] * uu);
  const t = Q.trace(start, Z3, Z3, end, Q.MASK_SHOT);
  waterEntry(start, t.endpos, kind === 'shotgun' ? .12 : .2); lastHitFrom = start;
  if (t.fraction < 1 && !(t.surf & Q.SURF_SKY)) {
    if (t.hit && t.hit.takedamage) damageEnt(t.hit, dmg);
    if (t.hit && t.hit.rag) ragdollShot(t.hit.rag, t.endpos, f, dmg * 40);
    if (t.hit && t.hit.isMonster) bloodFx(t.endpos, t.normal, kind === 'shotgun' ? .3 : .6); else fxImpact(t, kind);
    if (kind === 'bullet') { const k = Math.random() * 16 | 0; if (k >= 1 && k <= 3) playAt('ric' + k, t.endpos); }
  }
}
function blasterFire(g, dmg, hyper) {
  const { f } = aimVectors(), s = projectSource([24 + g[0], 8 + g[1], vh8() + g[2]]);
  projs.push({ type: 'bolt', p: s, v: f.map(x => x * 1000), dmg, life: 10000 });
  play(hyper ? 'hyper' : 'blaster', .8); flash([1, .85, .3]); kick = 2; kickP = -1;
}
function shotgunFire() { const { f } = aimVectors(), s = projectSource([0, 8, vh8()]); for (let i = 0; i < 12; i++) fireLead(s, f, 4, 500, 500, 'shotgun'); play('shotgun', .9); flash(); kick = 2; kickP = -2; }
function sshotgunFire() {
  const s = projectSource([0, 8, vh8()]);
  for (const dy of [-5, 5]) { const f = [0, 0, 0]; Q.angleVectors([pitch, yaw + dy, 0], f); for (let i = 0; i < 10; i++) fireLead(s, f, 6, 1000, 500, 'shotgun'); }
  play('sshotgun', 1); flash(); kick = 3; kickP = -2;
}
function machinegunFire() {
  if (!attackHeld()) { W.frame++; return; }
  W.frame = W.frame === 5 ? 4 : 5;
  const { f } = aimVectors(); fireLead(projectSource([0, 8, vh8()]), f, 8, 300, 500, 'bullet');
  play('mg' + (1 + (Math.random() * 5 | 0)), .7); flash(); kick = 1; kickP = crand() * .7;
}
function chaingunFire() {
  if (W.frame === 5) play('cgUp', .7);
  if (W.frame === 14 && !attackHeld()) { W.frame = 32; setLoop(null); return; }
  else if (W.frame === 21 && attackHeld()) W.frame = 15;
  else W.frame++;
  if (W.frame === 22) { setLoop(null); play('cgDown', .7); } else setLoop('cgLoop');
  const shots = W.frame <= 9 ? 1 : W.frame <= 14 ? (attackHeld() ? 2 : 1) : 3, { f } = aimVectors();
  for (let i = 0; i < shots; i++) fireLead(projectSource([0, 7 + crand() * 4, crand() * 4 + vh8()]), f, 6, 300, 500, 'bullet');
  play('mg' + (1 + (Math.random() * 5 | 0)), .55); flash(); kick = 1.2; kickP = crand() * .5;
}
function throwGrenade(start, aim, dmg, speed, timer, radius, hand) { // fire_grenade / fire_grenade2
  const ang = [-Math.atan2(aim[2], Math.hypot(aim[0], aim[1])) * 180 / Math.PI, Math.atan2(aim[1], aim[0]) * 180 / Math.PI, 0], f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0];
  Q.angleVectors(ang, f, r, u); const up = 200 + crand() * 10, rt = crand() * 10;
  projs.push({ type: 'grenade', hand, p: start, v: [0, 1, 2].map(i => aim[i] * speed + u[i] * up + r[i] * rt), dmg, radius, life: timer * 1000, spin: 0 });
}
function glFire() { const { f } = aimVectors(); throwGrenade(projectSource([8, 8, vh8()]), f, 120, 600, 2.5, 160, false); play('gl', .9); flash(); kick = 2; kickP = -1; }
function rocketFire() { const { f } = aimVectors(); projs.push({ type: 'rocket', p: projectSource([8, 8, vh8()]), v: f.map(x => x * 650), dmg: 100 + Math.random() * 20 | 0, life: 8000 }); play('fire', .9); flash(); kick = 4; kickP = -1; }
function hyperFire() {
  setLoop('hyperLoop');
  if (!attackHeld()) W.frame++;
  else {
    const rot = (W.frame - 5) * 2 * Math.PI / 6;
    blasterFire([-4 * Math.sin(rot), 0, 4 * Math.cos(rot)], 15, true);
    W.frame++; if (W.frame === 12) W.frame = 6;
  }
  if (W.frame === 12) { play('hyperDown', .7); setLoop(null); }
}
function railFire() {
  const { f } = aimVectors(), s = projectSource([0, 7, vh8()]), end = s.map((v, i) => v + f[i] * 8192);
  const cm = Q.getCM(), bx = cm.boxes; cm.boxes = []; // rails pass through bbox entities and stop on world / brush models
  const t = Q.trace(s, Z3, Z3, end, Q.MASK_SHOT); cm.boxes = bx;
  const solidEnd = t.endpos;
  lastHitFrom = s; for (const e of [...E.barrels, ...E.monsters]) if (e.box && e.box.active && e.takedamage && segBox(s, solidEnd, e.box)) { damageEnt(e, 100); if (e.isMonster) bloodFx(entCenter(e), null, 1); if (e.rag) ragdollShot(e.rag, entCenter(e), f, 3000); } // rails pass through bbox ents
  if (t.hit && t.hit.takedamage) damageEnt(t.hit, 100);
  waterEntry(s, solidEnd, .3); fxBeam(s, solidEnd, 'rail'); if (t.fraction < 1 && !(t.surf & Q.SURF_SKY)) fxImpact(t, 'rail');
  play('rail', 1); flash([.5, .6, 1.2]); kick = 3; kickP = -3;
}
function segBox(a, b, box) { let t0 = 0, t1 = 1; for (let i = 0; i < 3; i++) { const d = b[i] - a[i]; if (Math.abs(d) < 1e-9) { if (a[i] < box.mins[i] || a[i] > box.maxs[i]) return false; continue; } let u0 = (box.mins[i] - a[i]) / d, u1 = (box.maxs[i] - a[i]) / d; if (u0 > u1) [u0, u1] = [u1, u0]; t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return false; } return true; }
function bfgFire() { const { f } = aimVectors(); projs.push({ type: 'bfg', p: projectSource([8, 8, vh8()]), v: f.map(x => x * 400), dmg: 200, life: 8000, laser: 0 }); flash([.3, 1, .3]); kick = 5; kickP = -8; }
function changeWeapon() { W.last = W.cur; W.cur = W.next; W.next = -1; W.state = 'activating'; W.frame = 0; W.oldFrame = 0; setLoop(null); updateWeaponHud(true); }
function weaponGeneric(d) {
  const FIRE_FIRST = d.act + 1, IDLE_FIRST = d.fire + 1, DEACT_FIRST = d.idle + 1;
  if (W.state === 'dropping') { if (W.frame >= d.deact) { changeWeapon(); return; } W.frame++; return; }
  if (W.state === 'activating') { if (W.frame >= d.act) { W.state = 'ready'; W.frame = IDLE_FIRST; return; } W.frame++; return; }
  if (W.next >= 0 && W.state !== 'firing') { W.state = 'dropping'; W.frame = DEACT_FIRST; return; }
  if (W.state === 'ready') {
    if (attackHeld() && affordable(W.cur)) { W.state = 'firing'; W.frame = FIRE_FIRST; }
    else { if (attackHeld()) noAmmo(); if (W.frame >= d.idle) { W.frame = IDLE_FIRST; return; } if (d.pause.includes(W.frame) && Math.random() < 15 / 16) return; W.frame++; return; }
  }
  if (W.state === 'firing') {
    if (d.ff.includes(W.frame)) {
      const f0 = W.frame, a = Q2_AMMO[W.cur], cost = a && (W.cur === 1 && f0 === 9 ? 0 : W.cur === 9 && f0 !== 17 ? 0 : a[1]);
      if (ammoOn() && cost && AMMO[a[0]] < cost) { W.state = 'ready'; W.frame = IDLE_FIRST; noAmmo(); return; }
      d.fn(); if (cost) spendAmmo([a[0], cost]);
    } else W.frame++;
    if (W.frame === IDLE_FIRST + 1) W.state = 'ready';
  }
}
function weaponGrenade() { // Weapon_Grenade
  if (W.next >= 0 && W.state === 'ready') { changeWeapon(); return; }
  if (W.state === 'activating') { W.state = 'ready'; W.frame = 16; return; }
  if (W.state === 'ready') {
    if (attackHeld() && affordable(10)) { W.frame = 1; W.state = 'firing'; W.gtime = 0; return; }
    if (attackHeld()) noAmmo();
    if (W.frame >= 48) { W.frame = 16; return; }
    if ([29, 34, 39, 48].includes(W.frame) && Math.random() < 15 / 16) return;
    W.frame++; return;
  }
  if (W.state === 'firing') {
    if (W.frame === 5) play('hgPin', .7);
    if (W.frame === 11) {
      if (!W.gtime) { W.gtime = simTime + 3200; W.blew = false; setLoop('hgCook'); }
      if (!W.blew && simTime >= W.gtime) { setLoop(null); handGrenadeFire(true); W.blew = true; }
      if (attackHeld()) return;
      if (W.blew) { if (simTime >= W.gtime) { W.frame = 15; W.blew = false; } else return; }
    }
    if (W.frame === 12) { setLoop(null); handGrenadeFire(false); }
    if (W.frame === 15 && simTime < W.gtime) return;
    W.frame++;
    if (W.frame === 16) { W.gtime = 0; W.state = 'ready'; }
  }
}
function handGrenadeFire(held) {
  spendAmmo(['grenades', 1]);
  const timer = (W.gtime - simTime) / 1000, speed = 400 + (3 - timer) * (400 / 3), { f } = aimVectors();
  if (held) { const o = ps.origin.map(v => v / 8); grenadeExplode({ p: o, v: [0, 0, 0], dmg: 125, radius: 165, type: 'grenade' }); }
  else { throwGrenade(projectSource([8, 8, vh8()]), f, 125, speed, Math.max(.05, timer), 165, true); play('hgThrow', .8); }
  lastFire = simTime;
}
function weaponTick(msec) {
  const pressed = attackHeld() && !W.held; W.held = attackHeld();
  W.timer += msec;
  const d = WEAPONS[W.cur];
  if (W.timer >= 100 || (pressed && W.state === 'ready')) {
    W.timer = 0; W.oldFrame = W.frame;
    if (d.grenade) weaponGrenade(); else weaponGeneric(d);
  }
}
// ---------- weapon inventory ----------
// On real maps you start with what the game gave you: Quake II (and the built-in set) the Blaster, Quake III the
// Gauntlet and Machinegun. Weapons are added by picking them up and carry over to the next level. The built-in test
// map, and the "Start with all weapons" setting, hand you everything.
const INV = { q2: new Set(range(0, 10)), q3: new Set(range(0, 11)) };
let campaignMode = false;
const limitedInv = () => campaignMode && !S.allWeapons;
const invSet = () => S.wset === 'q3' ? INV.q3 : INV.q2;
const hasWeapon = i => !limitedInv() || invSet().has(i);
// pickups name the same classes in both games (weapon_shotgun…), so read them by map type: [Quake II index, Quake III index]
const GIVE_Q2MAP = { weapon_shotgun: [1, 2], weapon_supershotgun: [2, 5], weapon_machinegun: [3, 1], weapon_chaingun: [4, 11], weapon_grenadelauncher: [5, 3], ammo_grenades: [10, null], weapon_rocketlauncher: [6, 4], weapon_hyperblaster: [7, 7], weapon_railgun: [8, 6], weapon_bfg: [9, 8] };
const GIVE_Q3MAP = { weapon_gauntlet: [0, 0], weapon_machinegun: [3, 1], weapon_shotgun: [2, 2], weapon_grenadelauncher: [5, 3], weapon_rocketlauncher: [6, 4], weapon_lightning: [4, 5], weapon_railgun: [8, 6], weapon_plasmagun: [7, 7], weapon_bfg: [9, 8], weapon_nailgun: [1, 9], weapon_prox_launcher: [10, 10], weapon_chaingun: [4, 11] };
function forceWeapon(w, i, set) { // put a weapon straight in hand, no switch animation
  w.cur = i; w.next = -1; w.state = 'ready'; w.time = 0;
  if (set === WEAPONS) { const d = WEAPONS[i]; w.frame = w.oldFrame = d.grenade ? 0 : d.fire + 1; w.timer = 0; w.gtime = 0; w.blew = false; }
}
function resetInventory(all) {
  INV.q2 = new Set(all ? range(0, 10) : [0]); INV.q3 = new Set(all ? range(0, 11) : [0, 1]);
  for (const k in AMMO) AMMO[k] = all ? MAXAM[k] : 0; if (!all) AMMO.bullets = 100;
  forceWeapon(W, all ? Math.min(W.cur, 10) : 0, WEAPONS); W.last = 0; forceWeapon(W3, all ? W3.cur : 1, Q3W); W3.last = 0;
  setLoop(null); updateWeaponHud(false);
}
function ensureOwnedWeapon() { // after switching sets, never hold something you don't have
  const w = curW(); if (hasWeapon(w.cur)) return;
  forceWeapon(w, S.wset === 'q3' ? (hasWeapon(1) ? 1 : 0) : 0, curSet()); updateWeaponHud(false);
}
function giveWeapon(cls) {
  const g = (world.q3 ? GIVE_Q3MAP : GIVE_Q2MAP)[cls]; if (!g) return;
  const [a, b] = g, new2 = a !== null && !INV.q2.has(a), new3 = b !== null && !INV.q3.has(b); giveAmmoFor(a, b);
  if (a !== null) INV.q2.add(a); if (b !== null) INV.q3.add(b);
  const mine = S.wset === 'q3' ? (new3 ? b : null) : (new2 ? a : null);
  if (limitedInv() && mine !== null && !PL.dead) selectWeapon(mine); // both games switch to a weapon you didn't have
}
// ---------- ammo ----------
// Real maps and bot matches use ammo; the built-in test map (and the "Unlimited ammo" setting) don't.
const Q2_AMMO = [null, ['shells', 1], ['shells', 2], ['bullets', 1], ['bullets', 1], ['grenades', 1], ['rockets', 1], ['cells', 1], ['slugs', 1], ['cells', 50], ['grenades', 1]];
const Q3_AMMO = [null, ['bullets', 1], ['shells', 1], ['grenades', 1], ['rockets', 1], ['lightning', 1], ['slugs', 1], ['cells', 1], ['bfgam', 1], ['nails', 1], ['mines', 1], ['belt', 1]];
const PICK_Q2 = { 1: ['shells', 10], 2: ['shells', 10], 3: ['bullets', 50], 4: ['bullets', 50], 5: ['grenades', 5], 6: ['rockets', 5], 7: ['cells', 50], 8: ['slugs', 10], 9: ['cells', 50] };
const PICK_Q3 = { 1: ['bullets', 40], 2: ['shells', 10], 3: ['grenades', 10], 4: ['rockets', 10], 5: ['lightning', 100], 6: ['slugs', 10], 7: ['cells', 50], 8: ['bfgam', 20], 9: ['nails', 20], 10: ['mines', 5], 11: ['belt', 80] };
const AMMO_ITEM = { ammo_bullets: ['bullets', 50, 50], ammo_shells: ['shells', 10, 10], ammo_grenades: ['grenades', 5, 5], ammo_rockets: ['rockets', 5, 5], ammo_cells: ['cells', 50, 30], ammo_slugs: ['slugs', 10, 10], ammo_lightning: ['lightning', 60, 60], ammo_bfg: ['bfgam', 15, 15], ammo_nails: ['nails', 20, 20], ammo_mines: ['mines', 10, 10], ammo_belt: ['belt', 100, 100] };
const ammoOn = () => !S.infAmmo && (campaignMode || BOT.on);
const affordable = i => { if (!ammoOn()) return true; const a = (S.wset === 'q3' ? Q3_AMMO : Q2_AMMO)[i]; return !a || AMMO[a[0]] >= a[1]; };
function spendAmmo(a) { if (!ammoOn() || !a) return; AMMO[a[0]] = Math.max(0, AMMO[a[0]] - a[1]); updateWeaponHud(false); }
function addAmmo(type, n) { AMMO[type] = Math.min(MAXAM[type], AMMO[type] + n); updateWeaponHud(false); }
function fillAmmo() { for (const k in AMMO) AMMO[k] = MAXAM[k]; updateWeaponHud(false); }
let noAmmoT = 0;
function noAmmo() { // click, then reach for something that still has ammo
  if (noAmmoT > simTime + 700) noAmmoT = 0; if (simTime < noAmmoT) return; noAmmoT = simTime + 700; if (AC) { const b = q3Mode() && getSnd(SND_Q3.noammo); if (b) playBuf(b, .5); else synth('click', .5); }
  const pref = S.wset === 'q3' ? [11, 1, 7, 5, 4, 2, 3, 6, 8, 9, 10, 0] : [4, 3, 7, 6, 2, 1, 8, 5, 9, 10, 0], cur = curW().cur;
  for (const i of pref) if (i !== cur && hasWeapon(i) && affordable(i)) { selectWeapon(i); return; }
}
function giveAmmoFor(a, b) { // a pickup feeds whichever weapon set it maps to, once per ammo type
  const got = {}; if (a !== null && PICK_Q2[a]) got[PICK_Q2[a][0]] = PICK_Q2[a][1];
  if (b !== null && PICK_Q3[b]) got[PICK_Q3[b][0]] = Math.max(got[PICK_Q3[b][0]] || 0, PICK_Q3[b][1]);
  for (const k in got) addAmmo(k, got[k]);
}
function cycleWeapon(dir) {
  const L = curSet(), w = curW(), from = w.next >= 0 ? w.next : w.cur;
  for (let k = 1; k <= L.length; k++) { const i = (from + dir * k + L.length * 2) % L.length; if (hasWeapon(i)) { selectWeapon(i); return; } }
}
function selectWeapon(i) {
  const L = curSet(), w = curW(); if (i < 0 || i >= L.length) return;
  if (!hasWeapon(i)) { updateWeaponHud(true); $('wpn').textContent = 'No ' + L[i].name; return; }
  if (i === w.cur && w.next < 0) { updateWeaponHud(true); return; }
  w.next = i; updateWeaponHud(true, i);
}
let wbarT = 0;
function updateWeaponHud(show, pending) {
  const L = curSet(), w = curW(), i = pending !== undefined ? pending : w.next >= 0 ? w.next : w.cur;
  { const a = ammoOn() && (S.wset === 'q3' ? Q3_AMMO : Q2_AMMO)[i]; $('wpn').textContent = L[i].name + (a ? '  ·  ' + AMMO[a[0]] : ''); }
  if (show) {
    const bar = $('wbar'); bar.innerHTML = L.map((d, k) => `<span class="${k === i ? 'on' : ''}${hasWeapon(k) ? '' : ' no'}">${d.key === 'Minus' ? '-' : d.key === 'Equal' ? '=' : d.key.replace('Digit', '').replace('Key', '')}<b>${d.name}</b></span>`).join('');
    bar.style.opacity = 1; clearTimeout(wbarT); wbarT = setTimeout(() => bar.style.opacity = 0, 1500);
  }
}

// ---------- projectiles ----------
const projs = [];
function grenadeExplode(g, direct) {
  const origin = g.p.map((v, i) => v - .02 * g.v[i]);
  if (g.q3) radiusDamageQ3(g.p, g.rdmg || g.dmg, g.radius, direct); else radiusDamage(g.p, g.dmg, g.radius, direct, g.owner || 'player');
  const down = Q.trace(g.p, Z3, Z3, [g.p[0], g.p[1], g.p[2] - 40], Q.MASK_SOLID);
  fxExplosion(origin, down.fraction < 1 ? down.normal : [0, 0, 1], 'grenade'); playAt(g.q3 ? 'q3boom' : 'gboom', origin);
  decalAt(down, 44, 1 + Math.random());
}
let nailSndT = -1e9;
function updateProjectiles(msec) {
  const dt = msec / 1000;
  for (let i = projs.length - 1; i >= 0; i--) {
    const pr = projs[i]; pr.life -= msec;
    if (pr.type === 'prox') { updateProx(pr, i, msec); continue; }
    if (pr.type === 'grenade') {
      if (pr.life <= 0) { projs.splice(i, 1); grenadeExplode(pr); continue; }
      if (pr.rest) continue;
      pr.v[2] -= 800 * dt; pr.spin += dt * 300;
      const end = pr.p.map((v, k) => v + pr.v[k] * dt), st = pr.owner ? shotTrace(pr.p, end, pr.owner) : null, t = st ? st.t : Q.trace(pr.p, Z3, Z3, end, Q.MASK_SHOT);
      fxTrail(pr, Math.hypot(...pr.v) * dt * t.fraction);
      if (st && st.player) { projs.splice(i, 1); monsterProjHitPlayer(pr, st.p); continue; }
      crossWater(pr.p, t.fraction < 1 ? t.endpos : end, pr.type === 'rocket' ? .7 : pr.type === 'grenade' ? .55 : .3);
      if (t.fraction < 1) {
        if (t.surf & Q.SURF_SKY) { projs.splice(i, 1); continue; }
        if (t.hit && t.hit.takedamage) { projs.splice(i, 1); lastHitFrom = pr.p; damageEnt(t.hit, pr.dmg); grenadeExplode(pr, t.hit); continue; }
        pr.p = t.endpos; const n = t.normal;
        if (pr.q3) { const dd = Q.dot(pr.v, n); for (let k = 0; k < 3; k++) pr.v[k] = (pr.v[k] - 2 * dd * n[k]) * .65; if (n[2] > .2 && Math.hypot(...pr.v) < 40) { pr.rest = true; pr.v = [0, 0, 0]; } }
        else { const b = Q.dot(pr.v, n) * 1.5; for (let k = 0; k < 3; k++) { pr.v[k] -= n[k] * b; if (Math.abs(pr.v[k]) < .1) pr.v[k] = 0; } if (n[2] > .7 && pr.v[2] < 60) { pr.rest = true; pr.v = [0, 0, 0]; } }
        if (simTime - (pr.lastB || -1e9) > 120) { pr.lastB = simTime; playAt(pr.q3 ? (Math.random() < .5 ? 'q3gb1' : 'q3gb2') : pr.hand ? (Math.random() < .5 ? 'hgBounce1' : 'hgBounce2') : 'gbounce', pr.p); }
      } else pr.p = end;
      continue;
    }
    const end = pr.p.map((v, k) => v + pr.v[k] * dt), st = pr.owner ? shotTrace(pr.p, end, pr.owner) : null, t = st ? st.t : Q.trace(pr.p, Z3, Z3, end, Q.MASK_SHOT);
    fxTrail(pr, Math.hypot(...pr.v) * dt * t.fraction);
      if (st && st.player) { projs.splice(i, 1); monsterProjHitPlayer(pr, st.p); continue; }
      crossWater(pr.p, t.fraction < 1 ? t.endpos : end, pr.type === 'rocket' ? .7 : pr.type === 'grenade' ? .55 : .3);
    if (pr.type === 'bfg' && (pr.laser -= msec) <= 0) { // bfg_think lasers (only barrels qualify as targets here)
      pr.laser = 100;
      for (const e of E.barrels) { if (e.dead || !e.takedamage) continue; const c = entCenter(e); if (Math.hypot(c[0] - pr.p[0], c[1] - pr.p[1], c[2] - pr.p[2]) > 256) continue; const lt = Q.trace(pr.p, Z3, Z3, c, Q.MASK_SOLID); if (lt.fraction === 1 || lt.hit === e) { damageEnt(e, 5); fxBeam(pr.p, c, 'laser'); } }
    }
    if (t.fraction < 1 || t.startsolid) {
      projs.splice(i, 1);
      if (t.surf & Q.SURF_SKY) continue;
      const hit = t.hit;
      lastHitFrom = pr.p;
      if (pr.type === 'rocket' && pr.q3) { if (hit && hit.takedamage) damageEnt(hit, pr.dmg); radiusDamageQ3(t.endpos, pr.rdmg, pr.radius, hit); fxExplosion(t.endpos.map((v, k) => v - .02 * pr.v[k]), t.normal, 'rocket'); playAt('q3boom', t.endpos); decalAt(t, 42, 1 + Math.random()); }
      else if (pr.type === 'nail') {
        if (hit && hit.takedamage) { damageEnt(hit, pr.dmg); if (hit.isMonster) { bloodFx(t.endpos, t.normal, .3); if (simTime - nailSndT > 40) { nailSndT = simTime; playAt('q3ngHitFlesh', t.endpos, .6); } } }
        else { fxImpact(t, 'shotgun'); if (simTime - nailSndT > 40) { nailSndT = simTime; playAt(t.surf & 0x1000 ? 'q3ngHitMetal' : 'q3ngHit', t.endpos, .6); } }
      }
      else if (pr.type === 'plasma') { if (hit && hit.takedamage) damageEnt(hit, pr.dmg); radiusDamageQ3(t.endpos, pr.rdmg, pr.radius, hit); fxPlasma(t); playAt('q3pgHit', t.endpos, .7); }
      else if (pr.type === 'bfg3') { if (hit && hit.takedamage) damageEnt(hit, pr.dmg); radiusDamageQ3(t.endpos, pr.rdmg, pr.radius, hit); fxBFG(t.endpos); playAt('bfgBoom', t.endpos); decalAt(t, 50, 1.5); }
      else if (pr.type === 'rocket') {
        if (hit && hit.takedamage) damageEnt(hit, pr.dmg, pr.owner ? 'monster' : 0);
        radiusDamage(t.endpos, pr.rdmg || 120, pr.radius || 120, hit, pr.owner || 'player');
        fxExplosion(t.endpos.map((v, k) => v - .02 * pr.v[k]), t.normal, 'rocket'); playAt('boom', t.endpos); decalAt(t, 42, 1 + Math.random());
      } else if (pr.type === 'bolt') {
        if (hit && hit.takedamage) damageEnt(hit, pr.dmg, pr.owner ? 'monster' : 0); if (hit && hit.isMonster) bloodFx(t.endpos, t.normal, .5); else fxImpact(t, 'blaster'); playAt('lashit', t.endpos);
      } else if (pr.type === 'bfg') {
        if (hit && hit.takedamage) damageEnt(hit, 200);
        radiusDamage(t.endpos, 200, 100, hit, pr.owner || 'player');
        for (const e of E.damageables.slice()) { // bfg_explode: the BFG effect on everything visible within 1000
          if (!e.takedamage || e.dead) continue; const c = entCenter(e), dd = Math.hypot(c[0] - t.endpos[0], c[1] - t.endpos[1], c[2] - t.endpos[2]);
          if (dd > 1000 || !canDamageEnt(t.endpos, e)) continue; fxBeam(t.endpos, c, 'laser'); damageEnt(e, 200 * (1 - Math.sqrt(dd / 1000)));
        }
        fxBFG(t.endpos); playAt('bfgBoom', t.endpos); decalAt(t, 60, 1.5);
      }
    } else if (pr.life <= 0) projs.splice(i, 1);
    else pr.p = end;
  }
}

// ---------- player health, armor, powerups ----------
const PL = { health: 100, maxHealth: 100, armor: 0, armorFrac: 0, dead: false, deadT: 0, painT: 0, quad: 0, invul: 0, kills: 0, total: 0 };
let hurtA = 0, noiseT = -1e9, noiseP = [0, 0, 0];
const canHurt = () => BOT.on || S.hurt === 'always' || (S.hurt === 'monsters' && E && E.monsters.length > 0);
function playerBox(o) { o = o || ps.origin.map(v => v / 8); return { mins: [o[0] + pm.mins[0], o[1] + pm.mins[1], o[2] + pm.mins[2]], maxs: [o[0] + pm.maxs[0], o[1] + pm.maxs[1], o[2] + pm.maxs[2]] }; }
function playerCenter() { const o = ps.origin.map(v => v / 8); return [o[0], o[1], o[2] + (pm.mins[2] + pm.maxs[2]) / 2]; }
function damagePlayer(dmg, from, selfInflicted) {
  if (PL.dead || ps.noclip || PL.god || !canHurt() || dmg <= 0) return;
  if (PL.invul > simTime) { if (simTime > PL.painT) { PL.painT = simTime + 500; play('protect', .7); } return; }
  dmg = Math.max(1, Math.trunc(dmg));
  let save = Math.min(PL.armor, Math.ceil(dmg * PL.armorFrac)); PL.armor -= save; if (!PL.armor) PL.armorFrac = 0;
  const take = dmg - save; PL.health -= take;
  hurtA = Math.min(.75, hurtA + .15 + take / 50); kickP = Math.max(kickP - Math.min(6, dmg * .2), -8);
  if (PL.health <= 0) { playerDie(); return; }
  if (simTime > PL.painT) {
    PL.painT = simTime + 700; const l = PL.health < 25 ? 25 : PL.health < 50 ? 50 : PL.health < 75 ? 75 : 100;
    const p = sexed(`pain${l}_${1 + (Math.random() * 2 | 0)}.wav`), b = AC && getSnd(p); if (b) playBuf(b, .9); else if (b === null) synth('hurt', .8);
  }
}
// capture + render info for a ragdoll of the player model, in a given pose (the live one when pose is omitted)
function playerRagSource(box, o, yaw, pose, P = player) {
  const q3sets = X => [...md3World(P.lower.m, ...X.lf, X.Ml), ...md3World(P.upper.m, ...X.tf, X.Mu), ...md3World(P.head.m, 0, 0, 0, X.Mh)];
  if (S.pset === 'q3' && P && P.q3) {
    const [legs, torso] = pose ? pose.q3 : q3PlayerAnim(), X = q3PlayerMats(P, o, yaw, 0, legs, torso); box.capture = q3sets(X); box.render = { type: 'md3', parts: [P.lower, P.upper, P.head] };
  } else if (S.pset === 'q2' && P && !P.q3) {
    const [an, at, loop] = pose ? pose.q2 : playerAnim(), [fa, fb, ft] = animFrames(P.m, an, at, loop); box.capture = [md2World(P.m, fa, fb, ft, entMat(o, yaw, 0))]; box.render = { type: 'md2', inst: P.inst, tex: P.tex };
  } else { box.pts = pose ? humanPose(o, yaw, box.mins, box.maxs, builtinPose(0, { move: 0, duck: false, air: false, fire: false, pitch: 0 })) : builtinPlayerPoints(o); box.render = { type: 'boxes' }; }
}
function makePlayerRagdoll() {
  const o = ps.origin.map(v => v / 8), vel = ps.velocity.map(v => v / 8), dir = lastHitFrom ? nrm(sub3(playerCenter(), lastHitFrom)) : [0, 0, 0], imp = [dir[0] * 250, dir[1] * 250, 60];
  const box = { kind: 'h', o, yaw, mins: [-16, -16, -24], maxs: [16, 16, 32], vel, impulse: imp };
  playerRagSource(box, o, yaw, null);
  PL.rag = createRagdoll(box);
}
function playerDie() {
  if (S.ragdoll) makePlayerRagdoll(); else PL.rag = null;
  PL.dead = true; PL.deadT = simTime; PL.health = Math.min(PL.health, 0); setLoop(null);
  if (BOT.on) { BOT.deaths++; if (BOT.lastShooter && simTime - BOT.shooterT < 4000) BOT.lastShooter.frags++; }
  const b = AC && getSnd(sexed(`death${1 + (Math.random() * 4 | 0)}.wav`)); if (b) playBuf(b, 1); else synth('land', 1);
  $('dead').hidden = false; $('deadSub').textContent = spLike() ? 'loading options…' : 'click / fire / jump to respawn';
}
function respawnPlayer() {
  PL.dead = false; PL.health = 100; PL.maxHealth = 100; PL.armor = 0; PL.armorFrac = 0; PL.quad = PL.invul = 0; $('dead').hidden = true;
  if (BOT.on) { resetInventory(false); respawn(pickSpawnIdx()); } else respawn(spawnIdx); play('respawn', .7);
  for (const m of E.monsters) if (!m.dead) { m.enemy = false; m.act = null; }
}

// ---------- save / load ----------
// A save is a snapshot of the level's *state* (player, inventory, items taken, monsters, movers, killed entities); loading reloads the map and
// lays the snapshot over a fresh copy, so closures (door timers, AI plans) are rebuilt rather than serialised.
const SAVE = { pending: null, lastAuto: 0, menuUp: false, KEY: 'strafelab.saves.v1', mem: { auto: null, slots: [] } };
try { const j = JSON.parse(localStorage.getItem(SAVE.KEY) || 'null'); if (j && j.slots) SAVE.mem = j; } catch (e) {}
const saveStore = () => { try { localStorage.setItem(SAVE.KEY, JSON.stringify(SAVE.mem)); } catch (e) { try { SAVE.mem.slots.splice(0, Math.max(0, SAVE.mem.slots.length - 3)); localStorage.setItem(SAVE.KEY, JSON.stringify(SAVE.mem)); } catch (e2) {} } };
const isDM = () => BOT.on && BOT.mode === 'dm';
const spLike = () => !!world && !isDM();
const r1 = a => a.map(v => Math.round(v * 100) / 100);
function takeSnap(label) {
  if (!world || !E) return null;
  const mons = E.monsters.filter(m => !m.bot);
  return {
    v: 1, t: Date.now(), label, map: world.demo ? (world.builtin || 'test') : lastMapPath, mapName: world.name || (world.demo ? 'Test map' : lastMapPath), skill: S.skill,
    coop: BOT.on && BOT.mode === 'coop', bots: BOT.on ? BOT.bots.length : 0,
    p: { o: ps.origin.slice(), vel: ps.velocity.slice(), flags: ps.flags, yaw, pitch, hp: PL.health, mhp: PL.maxHealth, ar: PL.armor, af: PL.armorFrac,
      quad: Math.max(0, PL.quad - simTime), invul: Math.max(0, PL.invul - simTime), kills: PL.kills },
    inv: { q2: [...INV.q2], q3: [...INV.q3], ammo: { ...AMMO }, w: W.cur, w3: W3.cur, campaign: campaignMode },
    keys: [...(E.keys || [])],
    items: E.items.map((e, i) => e.taken ? i : -1).filter(i => i >= 0),
    mons: mons.map(m => ({ o: r1(m.o), y: Math.round(m.yaw || 0), h: Math.round(m.health), d: m.dead ? 1 : 0, g: m.gibbed ? 1 : 0, hid: m.hidden ? 1 : 0, aw: m.enemy ? 1 : 0 })),
    movers: E.movers.map(e => e.st ? { s: e.state || '', o: r1(e.st.o), m: e.moveTo ? r1(e.moveTo) : null, dead: e.dead ? 1 : 0 } : null),
    killed: E.list.map((e, i) => (e.dead && !e.isMonster && !e.bot && !e.st) ? i : -1).filter(i => i >= 0)
  };
}
function applyMover(e, r) {
  if (!r || !e.st) return;
  if (r.dead) { killEnt(e); return; }
  const to = r.m || r.o; let st = r.s;
  if (st === 'up') st = 'top'; else if (st === 'down') st = 'bottom';
  e.st.o = to.slice(); e.state = st; e.moveTo = null; e.onArrive = null; e.think = null;
  if (st !== 'top') return;
  if (e.cls === 'func_door' && e.wait >= 0 && !(e.spawnflags & 32)) { e.nextT = simTime + Math.max(1500, e.wait * 1000); e.think = () => doorGoDown(e); }
  else if (e.cls === 'func_plat') { e.nextT = simTime + 3000; e.think = () => platGoDown(e); }
  else if (e.cls === 'func_button' && e.wait >= 0) { e.state = 'bottom'; e.st.o = e.pos1 ? e.pos1.slice() : e.st.o; }
}
function applySnap(s) {
  const p = s.p; resetPlayer(); PL.dead = false; PL.rag = null;
  ps.origin = p.o.slice(); ps.velocity = p.vel.slice(); ps.flags = p.flags & ~Q.PMF_TIME_TELEPORT; ps.time = 0; yaw = p.yaw; pitch = p.pitch;
  pm.mins = [-16, -16, -24]; pm.maxs = [16, 16, 32]; pm.viewheight = 22; vh = 22; prevOrigin = ps.origin.slice(); Q.initialSnapPosition(); prevOrigin = ps.origin.slice();
  PL.health = p.hp; PL.maxHealth = p.mhp; PL.armor = p.ar; PL.armorFrac = p.af; PL.quad = p.quad ? simTime + p.quad : 0; PL.invul = p.invul ? simTime + p.invul : 0;
  campaignMode = !!s.inv.campaign; INV.q2 = new Set(s.inv.q2); INV.q3 = new Set(s.inv.q3); for (const k in AMMO) AMMO[k] = s.inv.ammo[k] ?? AMMO[k];
  forceWeapon(W, s.inv.w, WEAPONS); forceWeapon(W3, s.inv.w3, Q3W); setLoop(null); updateWeaponHud(false);
  E.keys = new Set(s.keys);
  for (const i of s.items) if (E.items[i]) E.items[i].taken = true;
  E.movers.forEach((e, i) => applyMover(e, s.movers[i]));
  for (const i of s.killed) if (E.list[i]) killEnt(E.list[i]);
  const mons = E.monsters.filter(m => !m.bot);
  s.mons.forEach((r, i) => {
    const m = mons[i]; if (!m) return;
    m.o = r.o.slice(); m.ro = m.o.slice(); m.yaw = m.ryaw = r.y; m.health = r.h; m.hidden = !!r.hid; m.vel = [0, 0, 0]; m.act = null; m.enemy = r.aw ? m.enemy : false;
    if (r.hid) { m.box.active = false; m.takedamage = false; }
    if (r.d) {
      m.dead = true; m.box.dead = true; m.mmaxs = [m.mmaxs[0], m.mmaxs[1], m.mmins[2] + 16]; updateBox(m);
      setAnim(m, 'death', false); m.ai = m.list.length - 1; m.frame = m.oldFrame = m.list[m.ai]; m.done = true; if (m.mon.fly !== undefined) m.air = true;
      if (r.g) { m.gibbed = true; m.box.active = false; m.takedamage = false; }
    } else updateBox(m);
  });
  PL.kills = p.kills;
  if (BOT.on && BOT.mode === 'coop') for (const b of BOT.bots) { const sp = coopSpot(); b.o = sp.o.slice(); b.ro = b.o.slice(); b.yaw = b.ryaw = sp.yaw; b.vel = [0, 0, 0]; updateBox(b); }
  SAVE.lastAuto = simTime;
}
function autosave(label) {
  if (!spLike() || PL.dead) return; const s = takeSnap(label || 'Autosave'); if (!s) return;
  SAVE.mem.auto = s; SAVE.lastAuto = simTime; saveStore();
}
function saveGame(name) {
  if (!spLike()) { toast('Saving is for singleplayer and co-op'); return false; }
  if (PL.dead) { toast('You are dead'); return false; }
  const s = takeSnap(name || 'Quicksave'); if (!s) return false;
  const k = SAVE.mem.slots.findIndex(x => x.label === s.label); if (k >= 0) SAVE.mem.slots.splice(k, 1);
  SAVE.mem.slots.unshift(s); SAVE.mem.slots.length = Math.min(SAVE.mem.slots.length, 12); saveStore();
  toast(`Saved — ${s.label}`, 1800); refreshSaveLists(); return true;
}
async function loadSnap(s) {
  if (!s) { toast('No save to load'); return; }
  const demo = !!BUILTIN_MAPS[s.map];
  if (!demo && !VFS.has(s.map)) { toast(`Map ${s.map} isn't loaded — add the game files first`, 4000); return; }
  hideDeathMenu(); SAVE.pending = s; if (s.skill !== undefined) S.skill = s.skill;
  BOT.mode = s.coop ? 'coop' : BOT.mode; BOT.pending = s.coop ? s.bots + 1 : 0;
  if (demo) { const w = builtinWorld(s.map); resetPlayer(); campaignMode = !!s.inv.campaign; resetInventory(true); setWorld(w); loaded = true; startGame(); }
  else await loadMap(s.map, null, false);
  if (SAVE.pending) { SAVE.pending = null; } // map failed to load
  toast(`Loaded — ${s.label}`, 2000);
}
const ago = t => { const d = (Date.now() - t) / 1000; return d < 90 ? 'just now' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
function fillSaveList(el, close) {
  el.textContent = ''; const all = [...(SAVE.mem.auto ? [SAVE.mem.auto] : []), ...SAVE.mem.slots];
  if (!all.length) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'No saved games yet'; el.appendChild(d); return; }
  for (const s of all) {
    const b = document.createElement('button'), a = document.createElement('span'), c = document.createElement('span');
    a.textContent = `${s === SAVE.mem.auto ? '↻ ' : '▤ '}${s.label} — ${w_name(s.mapName || s.map)}${s.coop ? ' (co-op)' : ''}`; c.textContent = ago(s.t); b.append(a, c);
    b.onclick = () => { if (close) close(); loadSnap(s); }; el.appendChild(b);
  }
}
function refreshSaveLists() { if (!$('mainSaves').hidden) fillSaveList($('mainSaves')); if (!$('dmList').hidden) fillSaveList($('dmList')); }
function showDeathMenu() {
  if (SAVE.menuUp) return; SAVE.menuUp = true; $('dead').hidden = true; $('deathmenu').hidden = false; $('dmList').hidden = true;
  $('dmAuto').disabled = !SAVE.mem.auto; $('dmAuto').textContent = SAVE.mem.auto ? `↻ Load last autosave — ${SAVE.mem.auto.label} (${ago(SAVE.mem.auto.t)})` : '↻ No autosave';
  keys.clear(); mouseFire = mouseJump = false; touch.jump = touch.duck = touch.fire = false; if (locked()) document.exitPointerLock();
}
function hideDeathMenu() { SAVE.menuUp = false; $('deathmenu').hidden = true; $('dmList').hidden = true; }
$('dmAuto').onclick = () => loadSnap(SAVE.mem.auto);
$('dmSaved').onclick = () => { const l = $('dmList'); l.hidden = !l.hidden; if (!l.hidden) fillSaveList(l); };
$('dmQuit').onclick = () => { hideDeathMenu(); pauseGame(); };
$('saveBtn').onclick = () => { if (saveGame('Quicksave')) refreshSaveLists(); };
$('loadBtn').onclick = () => { const l = $('mainSaves'); l.hidden = !l.hidden; if (!l.hidden) fillSaveList(l); };

// ---------- items ----------
const ITEMS = {
  item_health: { m: 'items/healing/medium', n: 'Health', h: 10, hmax: 100, s: 'items/n_health.wav' }, item_health_small: { m: 'items/healing/stimpack', n: 'Stimpack', h: 2, hmax: 200, s: 'items/s_health.wav' },
  item_health_large: { m: 'items/healing/large', n: 'Large Health', h: 25, hmax: 100, s: 'items/l_health.wav' }, item_health_mega: { m: 'items/mega_h', n: 'MegaHealth', h: 100, hmax: 200, s: 'items/m_health.wav' },
  item_armor_shard: { m: 'items/armor/shard', n: 'Armor Shard', a: 2, amax: 999, s: 'misc/ar2_pkup.wav' }, item_armor_jacket: { m: 'items/armor/jacket', n: 'Jacket Armor', a: 25, amax: 50, af: .3, s: 'misc/ar1_pkup.wav' },
  item_armor_combat: { m: 'items/armor/combat', n: 'Combat Armor', a: 50, amax: 100, af: .6, s: 'misc/ar1_pkup.wav' }, item_armor_body: { m: 'items/armor/body', n: 'Body Armor', a: 100, amax: 200, af: .8, s: 'misc/ar3_pkup.wav' },
  item_quad: { m: 'items/quaddama', n: 'Quad Damage', quad: 30 }, item_invulnerability: { m: 'items/invulner', n: 'Invulnerability', inv: 30 }, item_adrenaline: { m: 'items/adrenal', n: 'Adrenaline', adr: 1 },
  item_ancient_head: { m: 'items/c_head', n: 'Ancient Head', maxh: 2 }, item_bandolier: { m: 'items/band', n: 'Bandolier' }, item_pack: { m: 'items/pack', n: 'Ammo Pack' }, item_silencer: { m: 'items/silencer', n: 'Silencer' },
  item_breather: { m: 'items/breather', n: 'Rebreather' }, item_enviro: { m: 'items/enviro', n: 'Environment Suit' }, item_power_screen: { m: 'items/armor/screen', n: 'Power Screen' }, item_power_shield: { m: 'items/armor/shield', n: 'Power Shield' },
  weapon_shotgun: { m: 'weapons/g_shotg', n: 'Shotgun', w: 1 }, weapon_supershotgun: { m: 'weapons/g_shotg2', n: 'Super Shotgun', w: 2 }, weapon_machinegun: { m: 'weapons/g_machn', n: 'Machinegun', w: 3 },
  weapon_chaingun: { m: 'weapons/g_chain', n: 'Chaingun', w: 4 }, weapon_grenadelauncher: { m: 'weapons/g_launch', n: 'Grenade Launcher', w: 5 }, weapon_rocketlauncher: { m: 'weapons/g_rocket', n: 'Rocket Launcher', w: 6 },
  weapon_hyperblaster: { m: 'weapons/g_hyperb', n: 'HyperBlaster', w: 7 }, weapon_railgun: { m: 'weapons/g_rail', n: 'Railgun', w: 8 }, weapon_bfg: { m: 'weapons/g_bfg', n: 'BFG10K', w: 9 },
  ammo_shells: { m: 'items/ammo/shells/medium', n: 'Shells', am: 1 }, ammo_bullets: { m: 'items/ammo/bullets/medium', n: 'Bullets', am: 1 }, ammo_cells: { m: 'items/ammo/cells/medium', n: 'Cells', am: 1 },
  ammo_rockets: { m: 'items/ammo/rockets/medium', n: 'Rockets', am: 1 }, ammo_slugs: { m: 'items/ammo/slugs/medium', n: 'Slugs', am: 1 }, ammo_grenades: { m: 'items/ammo/grenades/medium', n: 'Grenades', am: 1, w: 10 },
  key_data_cd: { m: 'items/keys/data_cd', n: 'Data CD', key: 1 }, key_power_cube: { m: 'items/keys/power', n: 'Power Cube', key: 1 }, key_pyramid: { m: 'items/keys/pyramid', n: 'Pyramid Key', key: 1 },
  key_data_spinner: { m: 'items/keys/spinner', n: 'Data Spinner', key: 1 }, key_pass: { m: 'items/keys/pass', n: 'Security Pass', key: 1 }, key_blue_key: { m: 'items/keys/key', n: 'Blue Key', key: 1 },
  key_red_key: { m: 'items/keys/red_key', n: 'Red Key', key: 1 }, key_commander_head: { m: 'monsters/commandr/head', n: "Commander's Head", key: 1 }, key_airstrike_target: { m: 'items/keys/target', n: 'Airstrike Marker', key: 1 }
};
function setupItem(e, cm) {
  const def = (world.q3 ? ITEMS_Q3 : ITEMS)[e.cls], o = e.origin, t = Q.trace([o[0], o[1], o[2] + 1], [-15, -15, -15], [15, 15, 15], [o[0], o[1], o[2] - 128], Q.MASK_SOLID, true);
  e.item = def; e.o = t.allsolid || t.startsolid ? o.slice() : t.endpos; e.hidden = !!(e.spawnflags & 1);
  e.use = () => { e.hidden = false; };
  E.items.push(e);
}
function touchItems() {
  if (PL.dead || ps.noclip) return;
  const pb = playerBox();
  for (const e of E.items) {
    if (e.taken || e.hidden) continue; const o = e.o;
    if (pb.mins[0] > o[0] + 15 || pb.maxs[0] < o[0] - 15 || pb.mins[1] > o[1] + 15 || pb.maxs[1] < o[1] - 15 || pb.mins[2] > o[2] + 15 || pb.maxs[2] < o[2] - 15) continue;
    const d = itemDef(e), q3i = world.q3 || d !== e.item;
    if (d.h) { const cap = d.hmax === 200 ? Math.max(200, PL.maxHealth) : PL.maxHealth; if (PL.health >= cap) continue; PL.health = Math.min(cap, PL.health + d.h); }
    if (d.a && q3i) { if (PL.armor >= 200) continue; PL.armor = Math.min(200, PL.armor + d.a); PL.armorFrac = .66; }
    else if (d.a) {
      if (!d.af) { PL.armor += d.a; if (!PL.armorFrac) PL.armorFrac = .3; }
      else if (PL.armorFrac < d.af) { PL.armor = Math.round(PL.armor * PL.armorFrac / d.af) + d.a; PL.armorFrac = d.af; }
      else { if (PL.armor >= 200) continue; PL.armor = Math.min(200, PL.armor + Math.round(d.a * d.af / PL.armorFrac)); }
    }
    if (d.quad) PL.quad = Math.max(PL.quad, simTime) + d.quad * 1000;
    if (d.inv) PL.invul = Math.max(PL.invul, simTime) + d.inv * 1000; if (d.quad || d.inv) powPop(d.quad ? 'quad' : 'inv');
    if (d.adr) { PL.maxHealth++; PL.health = Math.max(PL.health, PL.maxHealth); }
    if (d.maxh) PL.maxHealth += d.maxh;
    if (d.key) E.keys.add(e.cls);
    const ai = AMMO_ITEM[e.cls]; if (d.am && ai) { if (ammoOn() && AMMO[ai[0]] >= MAXAM[ai[0]]) continue; addAmmo(ai[0], q3i ? ai[2] : ai[1]); }
    e.taken = true; giveWeapon(e.cls); if (BOT.on && BOT.mode === 'dm' && !d.key) e.respawnAt = simTime + (q3i ? (d.w ? 5000 : d.quad || d.inv ? 120000 : d.am ? 40000 : d.h ? 35000 : 25000) : (d.w ? 8000 : d.quad || d.inv ? 90000 : 25000));
    const snd = d.s || (d.w ? 'misc/w_pkup.wav' : d.am ? 'misc/am_pkup.wav' : 'items/pkup.wav'), b = AC && getSnd(snd); if (b) playBuf(b, .8); else if (b === null) synth('pickup', .8);
    toast('You got the ' + d.n, 1500);
    useTargets(e, 'player');
  }
}

// ---------- monsters ----------
// dir = models/monsters/<dir>; att/att2 = [type, damage]; melee = damage; bbox; run speed (ups); fly/swim; sounds in sound/<path>
const ms = (dir, o) => Object.assign({ dir, skin: 0, hp: 100, gib: -40, mass: 200, run: 130, walk: 50, bbox: [-16, -16, -24, 16, 16, 32] }, o);
const SS = (a, b) => ({ sight: a + '/' + b[0], pain: a + '/' + b[1], death: a + '/' + b[2], idle: a + '/' + b[3], fire: b[4] && a + '/' + b[4], fire2: b[5] && a + '/' + b[5], melee: b[6] && a + '/' + b[6] });
const SOLDIER_S = ['solsght1.wav', 'solpain1.wav', 'soldeth1.wav', 'solidle1.wav'];
const MON = {
  monster_soldier_light: ms('soldier', { skin: 0, hp: 20, gib: -30, mass: 100, run: 140, att: ['blaster', 5, 600], snd: SS('soldier', [...SOLDIER_S, 'solatck2.wav']) }),
  monster_soldier: ms('soldier', { skin: 2, hp: 30, gib: -30, mass: 100, run: 140, att: ['shotgun', 2], snd: SS('soldier', [...SOLDIER_S, 'solatck1.wav']) }),
  monster_soldier_ss: ms('soldier', { skin: 4, hp: 40, gib: -30, mass: 100, run: 140, att: ['mg', 2], snd: SS('soldier', [...SOLDIER_S, 'solatck3.wav']) }),
  monster_infantry: ms('infantry', { hp: 100, run: 140, att: ['mg', 3], melee: 8, snd: SS('infantry', ['infsght1.wav', 'infpain1.wav', 'infdeth1.wav', 'infidle1.wav', 'infatck1.wav', 0, 'melee2.wav']) }),
  monster_gunner: ms('gunner', { hp: 175, gib: -70, run: 130, att: ['mg', 3], att2: ['grenade', 50], snd: SS('gunner', ['sight1.wav', 'gunpain1.wav', 'death1.wav', 'gunidle1.wav', 'gunatck2.wav', 'gunatck3.wav']) }),
  monster_berserk: ms('berserk', { hp: 240, gib: -60, mass: 250, run: 210, melee: 18, snd: SS('berserk', ['sight.wav', 'berpain2.wav', 'berdeth2.wav', 'beridle1.wav', 0, 0, 'attack.wav']) }),
  monster_gladiator: ms('gladiatr', { hp: 400, gib: -175, mass: 400, run: 140, bbox: [-32, -32, -24, 32, 32, 64], att: ['rail', 50], melee: 20, snd: SS('gladiator', ['sight.wav', 'pain.wav', 'glddeth2.wav', 'gldidle1.wav', 'railgun.wav', 0, 'melee1.wav']) }),
  monster_tank: ms('tank', { hp: 750, gib: -200, mass: 500, run: 85, bbox: [-32, -32, -16, 32, 32, 72], att: ['rocket', 50, 550], att2: ['blaster', 30, 800], painChance: .2, snd: SS('tank', ['sight1.wav', 'tnkpain2.wav', 'death.wav', 'tnkidle1.wav', 'tnkatck1.wav', 'tnkatck3.wav']) }),
  monster_tank_commander: ms('tank', { skin: 2, hp: 1000, gib: -225, mass: 500, run: 85, bbox: [-32, -32, -16, 32, 32, 72], att: ['rocket', 50, 550], att2: ['mg', 20], painChance: .15, snd: SS('tank', ['sight1.wav', 'tnkpain2.wav', 'death.wav', 'tnkidle1.wav', 'tnkatck1.wav', 'tnkatck3.wav']) }),
  monster_chick: ms('bitch', { hp: 175, gib: -70, run: 150, bbox: [-16, -16, 0, 16, 16, 56], att: ['rocket', 50, 500], melee: 10, snd: SS('chick', ['chksght1.wav', 'chkpain1.wav', 'chkdeth1.wav', 'chkidle1.wav', 'chkatck2.wav', 0, 'chkatck3.wav']) }),
  monster_mutant: ms('mutant', { hp: 300, gib: -120, mass: 300, run: 230, bbox: [-32, -32, -24, 32, 32, 48], melee: 12, snd: SS('mutant', ['mutsght1.wav', 'mutpain1.wav', 'mutdeth1.wav', 'mutidle1.wav', 0, 0, 'mutatck2.wav']) }),
  monster_parasite: ms('parasite', { hp: 175, gib: -50, mass: 250, run: 120, bbox: [-16, -16, -24, 16, 16, 24], melee: 6, meleeRange: 120, snd: SS('parasite', ['parsght1.wav', 'parpain1.wav', 'pardeth1.wav', 'paridle1.wav', 0, 0, 'paratck2.wav']) }),
  monster_brain: ms('brain', { hp: 300, gib: -150, mass: 400, run: 100, melee: 15, snd: SS('brain', ['brnsght1.wav', 'brnpain1.wav', 'brndeth1.wav', 'brnidle1.wav', 0, 0, 'melee1.wav']) }),
  monster_medic: ms('medic', { hp: 300, gib: -130, mass: 400, run: 120, bbox: [-24, -24, -24, 24, 24, 32], att: ['hyper', 2, 1000], snd: SS('medic', ['medsght1.wav', 'medpain1.wav', 'meddeth1.wav', 'idle.wav', 'medatck1.wav']) }),
  monster_flyer: ms('flyer', { hp: 50, gib: -40, mass: 50, run: 220, fly: 48, att: ['blaster', 1, 1000], melee: 5, snd: SS('flyer', ['flysght1.wav', 'flypain1.wav', 'flydeth1.wav', 'flysrch1.wav', 'flyatck3.wav', 0, 'flyatck1.wav']) }),
  monster_floater: ms('float', { hp: 200, gib: -80, mass: 300, run: 90, fly: 24, bbox: [-24, -24, -24, 24, 24, 32], att: ['blaster', 1, 1000], melee: 5, snd: SS('floater', ['fltsght1.wav', 'fltpain1.wav', 'fltdeth1.wav', 'fltidle1.wav', 'fltatck1.wav', 0, 'fltatck3.wav']) }),
  monster_hover: ms('hover', { hp: 240, gib: -100, mass: 150, run: 130, fly: 64, bbox: [-24, -24, -24, 24, 24, 32], att: ['blaster', 1, 1000], snd: SS('hover', ['hovsght1.wav', 'hovpain1.wav', 'hovdeth1.wav', 'hovidle1.wav', 'hovatck1.wav']) }),
  monster_flipper: ms('flipper', { hp: 50, gib: -30, mass: 100, run: 130, fly: 0, swim: true, bbox: [-16, -16, 0, 16, 16, 32], melee: 5, snd: SS('flipper', ['flpsght1.wav', 'flppain1.wav', 'flpdeth1.wav', 'flpidle1.wav', 0, 0, 'flpatck1.wav']) }),
  monster_supertank: ms('boss1', { hp: 1500, gib: -500, mass: 800, run: 60, bbox: [-64, -64, 0, 64, 64, 112], att: ['mg', 6], att2: ['rocket', 50, 500], painChance: .1, snd: SS('bosstank', ['btkunqv1.wav', 'btkpain1.wav', 'btkdeth1.wav', 'btkengn1.wav']) }),
  monster_boss2: ms('boss2', { hp: 2000, gib: -500, mass: 1000, run: 110, fly: 96, bbox: [-56, -56, 0, 56, 56, 80], att: ['mg', 6], att2: ['rocket', 50, 500], painChance: .1, snd: SS('bosshovr', ['bhvunqv1.wav', 'bhvpain1.wav', 'bhvdeth1.wav', 'bhvengn1.wav']) }),
  monster_jorg: ms('boss3/jorg', { hp: 3000, gib: -2000, mass: 1000, run: 60, bbox: [-80, -80, 0, 80, 80, 140], att: ['mg', 6], att2: ['bfg', 50, 300], painChance: .05, snd: SS('boss3', ['bs3srch1.wav', 'bs3pain1.wav', 'bs3deth1.wav', 'bs3idle1.wav', 'xfire.wav']) }),
  monster_makron: ms('boss3/rider', { hp: 3000, gib: -2000, mass: 500, run: 100, bbox: [-30, -30, 0, 30, 30, 90], att: ['rail', 50], att2: ['bfg', 50, 300], painChance: .05, snd: SS('makron', ['voice4.wav', 'pain1.wav', 'death.wav', 'voice.wav', 'blaster.wav']) }),
  monster_insane: ms('insane', { hp: 100, gib: -50, mass: 300, run: 60, passive: true, snd: SS('insane', ['insane1.wav', 'insane4.wav', 'insane10.wav', 'insane5.wav']) })
};
const MM = {}; // loaded monster models by dir
const FAKE_ANIMS = (() => { const r = n => Array.from({ length: n }, (_, i) => i); return { stand: [r(10)], walk: [r(8)], run: [r(6)], attack: [r(9)], melee: [r(8)], pain: [r(4)], death: [r(8)], duck: [r(5)] }; })();
function classifyAnims(md) {
  const o = { stand: [], walk: [], run: [], attack: [], melee: [], pain: [], death: [], duck: [] };
  for (const [name, fr] of Object.entries(md.anims)) {
    const n = name.toLowerCase();
    if (/^(death|die|dead)/.test(n)) o.death.push(fr); else if (/^pain/.test(n)) o.pain.push(fr); else if (/^(duck|dodge)/.test(n)) o.duck.push(fr);
    else if (/(melee|slash|swing|punch|claw|smash|bite|drain|tent|stab|swipe|hit)/.test(n)) o.melee.push(fr);
    else if (/^(att|atk|attack|shoot|fire|blast|rail|rock|grn|chain|burst|spin)/.test(n)) o.attack.push(fr);
    else if (/^run/.test(n)) o.run.push(fr); else if (/^walk/.test(n)) o.walk.push(fr);
    else if (/^(stand|idle|stnd|fly|hover|swim|bank|frame)/.test(n)) o.stand.push(fr);
  }
  const first = Object.values(md.anims)[0] || [0];
  if (!o.stand.length) o.stand.push(first); if (!o.run.length) o.run = o.walk.length ? o.walk : o.stand; if (!o.walk.length) o.walk = o.run;
  if (!o.attack.length) o.attack = o.melee.length ? o.melee : o.run; if (!o.melee.length) o.melee = o.attack; if (!o.pain.length) o.pain = [o.stand[0].slice(0, 3)];
  if (!o.death.length) o.death = [[o.stand[0][0]]];
  o.stand.sort((a, b) => b.length - a.length);
  return o;
}
async function loadMonsterModels() {
  if (!E) return;
  const dirs = new Set(E.monsters.map(m => m.mon.dir));
  for (const dir of dirs) {
    if (MM[dir] !== undefined) continue; MM[dir] = null;
    const path = 'models/monsters/' + dir + '/tris.md2', m = await getMD2(path); if (!m) continue;
    const skins = []; for (const s of m.skins) skins.push(await getSkin(mainCtx, s));
    MM[dir] = { m, inst: getInst(mainCtx, path, m), skins, cats: classifyAnims(m) };
  }
  for (const k of ['gib_meat', 'gib_bone', 'gib_head']) if (!PM[k]) PM[k] = await loadSimple(mainCtx, 'models/objects/gibs/' + { gib_meat: 'sm_meat', gib_bone: 'bone', gib_head: 'head2' }[k] + '/tris.md2');
  await loadShaderScripts();
  for (const e of E.items) {
    const al = !world.q3 && (Q2_TO_Q3_ITEM[e.cls] || Q2_TO_Q3_EXTRA[e.cls]) && ITEMS_Q3[Q2_TO_Q3_ITEM[e.cls] || Q2_TO_Q3_EXTRA[e.cls]]; if (al) for (const p of al.m) if (!(p in IM)) { IM[p] = null; IM[p] = await loadMD3Simple(mainCtx, p); }
    if (Array.isArray(e.item.m)) { for (const p of e.item.m) if (!(p in IM)) { IM[p] = null; IM[p] = await loadMD3Simple(mainCtx, p); } continue; }
    const p = 'models/' + e.item.m + '/tris.md2'; if (!(p in IM)) { IM[p] = null; IM[p] = await loadSimple(mainCtx, p); }
  }
}
const IM = {};
// Quake 3 weapon mode in a Quake II map: pickups show the Quake 3 gun you will get (Super Shotgun -> Lightning Gun, HyperBlaster -> Plasma Gun)
const Q2_TO_Q3_EXTRA = { item_health_small: 'item_health_small', item_health: 'item_health', item_health_large: 'item_health_large', item_health_mega: 'item_health_mega', item_adrenaline: 'item_health_large', item_ancient_head: 'item_health_mega',
  item_armor_shard: 'item_armor_shard', item_armor_jacket: 'item_armor_combat', item_armor_combat: 'item_armor_combat', item_armor_body: 'item_armor_body', item_power_screen: 'item_armor_combat', item_power_shield: 'item_armor_body',
  item_quad: 'item_quad', item_invulnerability: 'item_enviro', item_enviro: 'item_enviro',
  ammo_shells: 'ammo_shells', ammo_bullets: 'ammo_bullets', ammo_cells: 'ammo_cells', ammo_rockets: 'ammo_rockets', ammo_slugs: 'ammo_slugs', ammo_grenades: 'ammo_grenades' };
const itemDef = e => { if (!world.q3 && q3Mode()) { const k = Q2_TO_Q3_ITEM[e.cls] || Q2_TO_Q3_EXTRA[e.cls]; if (k && ITEMS_Q3[k]) return ITEMS_Q3[k]; } return e.item; };
const Q2_TO_Q3_ITEM = { weapon_shotgun: 'weapon_shotgun', weapon_supershotgun: 'weapon_lightning', weapon_machinegun: 'weapon_machinegun', weapon_chaingun: 'weapon_chaingun', weapon_grenadelauncher: 'weapon_grenadelauncher', weapon_rocketlauncher: 'weapon_rocketlauncher', weapon_hyperblaster: 'weapon_plasmagun', weapon_railgun: 'weapon_railgun', weapon_bfg: 'weapon_bfg' };
function setupMonster(e, cm) {
  const def = MON[e.cls]; e.mon = def; e.isMonster = true; e.allowDead = true;
  e.mmins = def.bbox.slice(0, 3); e.mmaxs = def.bbox.slice(3);
  let o = e.origin.slice();
  if (!def.fly && !def.swim) { const t = Q.trace([o[0], o[1], o[2] + 1], e.mmins, e.mmaxs, [o[0], o[1], o[2] - 256], Q.MASK_MONSTERSOLID, true); if (!t.allsolid && !t.startsolid) o = t.endpos; }
  e.o = o; e.ro = o.slice(); e.vel = [0, 0, 0];
  e.yaw = e.kv.angle !== undefined ? +e.kv.angle : e.kv.angles ? Q.vecOf(e.kv.angles)[1] : 0; e.ryaw = e.yaw;
  e.box = { mins: [0, 0, 0], maxs: [0, 0, 0], active: true, ent: e }; updateBox(e); cm.boxes.push(e.box);
  e.maxHealth = e.health = +e.kv.health || def.hp; e.takedamage = true; e.thinkT = Math.random() * 100; e.attackT = 0; e.painT = 0;
  e.enemy = false; e.act = null; e.ambush = !!(e.spawnflags & 1); e.air = !def.fly;
  if (e.spawnflags & 2) { e.hidden = true; e.box.active = false; e.takedamage = false; }
  e.use = () => { if (e.dead) return; if (e.hidden) { e.hidden = false; e.box.active = true; e.takedamage = true; } wake(e); };
  setAnim(e, 'stand', true);
  E.monsters.push(e); E.damageables.push(e); PL.total++;
}
function updateBox(e) { for (let i = 0; i < 3; i++) { e.box.mins[i] = e.o[i] + e.mmins[i]; e.box.maxs[i] = e.o[i] + e.mmaxs[i]; } }
const catsOf = m => (MM[m.mon.dir] && MM[m.mon.dir].cats) || FAKE_ANIMS;
function setAnim(m, cat, loop) {
  const lists = catsOf(m)[cat] || catsOf(m).stand, list = lists[Math.floor(Math.random() * lists.length)];
  m.cat = cat; m.list = list; m.ai = 0; m.loop = !!loop; m.done = false; m.oldFrame = m.frame === undefined ? list[0] : m.frame; m.frame = list[0];
}
function advanceAnim(m) {
  m.oldFrame = m.frame;
  if (m.ai < m.list.length - 1) m.ai++; else if (m.loop) m.ai = 0; else m.done = true;
  m.frame = m.list[m.ai];
}
const monSnd = (m, k) => m.mon.snd && m.mon.snd[k];
function wake(m) {
  if (m.dead || PL.dead) return;
  if (!m.enemy) { hearSound(m.o, 900, m.bot ? 'bot' : 'monster', 'sight', m); m.enemy = true; if (!m.sighted || Math.random() < .3) playPathAt(monSnd(m, 'sight'), m.o); m.sighted = true; }
}
function eyeOf(m) { return [m.o[0], m.o[1], m.o[2] + m.mmaxs[2] * .75]; }
function canSee(m, P) {
  const a = eyeOf(m), b = [P[0], P[1], P[2] + 14];
  return Q.trace(a, Z3, Z3, b, Q.MASK_OPAQUE, true).fraction === 1;
}
const yawTo = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
function changeYaw(m, ideal, speed) { let d = ((ideal - m.yaw) % 360 + 540) % 360 - 180; if (d > speed) d = speed; if (d < -speed) d = -speed; m.yaw = ((m.yaw + d) % 360 + 360) % 360; }
function infront(m, P) { const r = m.yaw * Math.PI / 180, d = nrm([P[0] - m.o[0], P[1] - m.o[1], 0]); return Math.cos(r) * d[0] + Math.sin(r) * d[1] > .3; }
function overlapsPlayer(m, o) {
  if (PL.dead || ps.noclip) return false; const pb = playerBox();
  return o[0] + m.mmins[0] < pb.maxs[0] && o[0] + m.mmaxs[0] > pb.mins[0] && o[1] + m.mmins[1] < pb.maxs[1] && o[1] + m.mmaxs[1] > pb.mins[1] && o[2] + m.mmins[2] < pb.maxs[2] && o[2] + m.mmaxs[2] > pb.mins[2];
}
function stepMove(m, yaw, dist) { // SV_movestep: step up 18, move, drop down; refuse ledges and steep slopes
  const r = yaw * Math.PI / 180, dx = Math.cos(r) * dist, dy = Math.sin(r) * dist, was = m.box.active; m.box.active = false;
  try {
    if (m.mon.fly !== undefined || m.mon.swim) {
      const end = [m.o[0] + dx, m.o[1] + dy, m.o[2]], t = Q.trace(m.o, m.mmins, m.mmaxs, end, Q.MASK_MONSTERSOLID);
      if (t.allsolid || t.fraction < .3) return false;
      if (m.mon.swim && !(Q.pointContents(t.endpos) & Q.MASK_WATER)) return false;
      if (overlapsPlayer(m, t.endpos)) return false; m.o = t.endpos; return true;
    }
    let up = [m.o[0], m.o[1], m.o[2] + 18]; if (Q.trace(up, m.mmins, m.mmaxs, up, Q.MASK_MONSTERSOLID).allsolid) up = m.o.slice();
    const t = Q.trace(up, m.mmins, m.mmaxs, [up[0] + dx, up[1] + dy, up[2]], Q.MASK_MONSTERSOLID);
    if (t.allsolid || t.fraction < .3) return false;
    const d = Q.trace(t.endpos, m.mmins, m.mmaxs, [t.endpos[0], t.endpos[1], t.endpos[2] - 36], Q.MASK_MONSTERSOLID);
    if (d.allsolid || d.startsolid || d.fraction === 1 || d.normal[2] < .7) return false;
    if (overlapsPlayer(m, d.endpos)) return false;
    m.o = d.endpos; return true;
  } finally { m.box.active = was; updateBox(m); }
}
function moveToGoal(m, goal, dist) { // M_MoveToGoal / SV_NewChaseDir, simplified
  const g = yawTo(m.o, goal);
  if (m.dirT > simTime && stepMove(m, m.dir, dist)) return true;
  if (stepMove(m, g, dist)) { m.dir = g; return true; }
  const s = Math.random() < .5 ? 1 : -1;
  for (const a of [45, 90, 135, 180]) for (const sg of [s, -s]) if (stepMove(m, g + a * sg, dist)) { m.dir = g + a * sg; m.dirT = simTime + 300 + Math.random() * 700; return true; }
  return false;
}
function flyToward(m, P, dist) {
  const want = [P[0], P[1], P[2] + (m.mon.fly || 0)], d = [want[0] - m.o[0], want[1] - m.o[1], want[2] - m.o[2]], len = Math.hypot(...d);
  let dir = len > 1 ? d.map(x => x / len) : [0, 0, 0];
  if (len < 180 && m.act === null) { const r = (m.yaw + 90 * (m.strafe || 1)) * Math.PI / 180; dir = [Math.cos(r) * .7, Math.sin(r) * .7, dir[2] * .5]; if (Math.random() < .05) m.strafe = -(m.strafe || 1); }
  const was = m.box.active; m.box.active = false;
  const end = m.o.map((v, i) => v + dir[i] * dist), t = Q.trace(m.o, m.mmins, m.mmaxs, end, Q.MASK_MONSTERSOLID);
  m.box.active = was;
  if (!t.allsolid && t.fraction > 0 && !overlapsPlayer(m, t.endpos) && (!m.mon.swim || Q.pointContents(t.endpos) & Q.MASK_WATER)) { m.o = t.endpos; updateBox(m); return true; }
  return moveToGoal(m, want, dist);
}
function monsterPhysics(m, dt) {
  if (m.hidden || m.gibbed || m.rag) return;
  const flying = (m.mon.fly !== undefined || m.mon.swim) && !m.dead;
  const v = m.vel, moving = Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) > 1;
  if (!moving && (!m.air || flying)) return;
  if (!flying) v[2] -= 800 * dt;
  const was = m.box.active; m.box.active = false;
  const end = m.o.map((x, i) => x + v[i] * dt), t = Q.trace(m.o, m.mmins, m.mmaxs, end, Q.MASK_MONSTERSOLID);
  m.box.active = was;
  if (t.allsolid || (t.startsolid && t.fraction === 1 && !flying)) { m.o[2] += 1; m.vel = [0, 0, 0]; updateBox(m); return; }
  m.o = t.endpos;
  if (t.fraction < 1) { const n = t.normal, b = Q.dot(v, n); for (let i = 0; i < 3; i++) v[i] -= n[i] * b; if (n[2] > .7) { m.air = false; v[2] = 0; } }
  const k = flying ? Math.exp(-dt * 3) : m.air ? 1 : Math.max(0, 1 - dt * 6); v[0] *= k; v[1] *= k; if (flying) v[2] *= k;
  updateBox(m);
}
function groundCheck(m) {
  if (m.mon.fly !== undefined && !m.dead || m.mon.swim) { m.air = false; return; }
  const was = m.box.active; m.box.active = false;
  const t = Q.trace(m.o, m.mmins, m.mmaxs, [m.o[0], m.o[1], m.o[2] - 1], Q.MASK_MONSTERSOLID);
  m.box.active = was; m.air = t.fraction === 1;
}
function muzzleOf(m) { const r = m.yaw * Math.PI / 180, f = m.mmaxs[0] + 6; return [m.o[0] + Math.cos(r) * f, m.o[1] + Math.sin(r) * f, m.o[2] + m.mmaxs[2] * .55]; }
function segBoxFrac(a, b, box) { let t0 = 0, t1 = 1; for (let i = 0; i < 3; i++) { const d = b[i] - a[i]; if (Math.abs(d) < 1e-9) { if (a[i] < box.mins[i] || a[i] > box.maxs[i]) return null; continue; } let u0 = (box.mins[i] - a[i]) / d, u1 = (box.maxs[i] - a[i]) / d; if (u0 > u1) [u0, u1] = [u1, u0]; t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return null; } return t0; }
function shotTrace(a, b, owner, mask) {
  const ob = owner && owner.box, was = ob && ob.active; if (ob) ob.active = false;
  const t = Q.trace(a, Z3, Z3, b, mask || Q.MASK_SHOT); if (ob) ob.active = was;
  if (owner && !owner.ally && !PL.dead && !ps.noclip) { const f = segBoxFrac(a, b, playerBox()); if (f !== null && f <= t.fraction) return { player: true, f, p: a.map((v, i) => v + (b[i] - a[i]) * f), t }; }
  return { player: false, t };
}
function bloodFx(p, n, amt = 1) {
  for (let i = 0; i < 14 * amt; i++) { const d = randDir(), dir = n ? nrm([d[0] + n[0], d[1] + n[1], d[2] + n[2]]) : d; addPart({ p: p.slice(), v: dir.map(x => x * rnd(60, 200)), life: rnd(.4, .9), size0: rnd(1.5, 3), size1: 1, kind: 2, blend: 1, ramp: 'lin', c0: [.55, .02, .01, 1], c1: [.3, 0, 0, 0], grav: 500, collide: true, bounce: .1 }); }
  addPart({ p: p.slice(), v: [0, 0, 5], life: rnd(.6, 1), size0: 6 * amt, size1: 16 * amt, kind: 1, blend: 1, ramp: 'lin', c0: [.45, .03, .02, .6], c1: [.25, 0, 0, 0] });
}
function monsterLead(m, a, aim, dmg, hs, vs) {
  const ang = [-Math.atan2(aim[2], Math.hypot(aim[0], aim[1])) * 180 / Math.PI, Math.atan2(aim[1], aim[0]) * 180 / Math.PI, 0], f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0];
  Q.angleVectors(ang, f, r, u); const rr = crand() * hs, uu = crand() * vs;
  const end = [0, 1, 2].map(i => a[i] + f[i] * 8192 + r[i] * rr + u[i] * uu), s = shotTrace(a, end, m); waterEntry(a, s.player ? s.p : s.t.endpos, .15);
  if (s.player) { damagePlayer(dmg, a); bloodFx(s.p, null, .4); return; }
  const t = s.t; if (t.fraction < 1 && !(t.surf & Q.SURF_SKY)) { if (t.hit && t.hit.takedamage) { if (m.ally && t.hit.bot) return; damageEnt(t.hit, dmg, 'monster'); if (t.hit.isMonster) { bloodFx(t.endpos, t.normal, .5); return; } } fxImpact(t, 'shotgun'); }
}
function monsterFire(m, spec, P) {
  const [type, dmg, speed] = spec, mz = muzzleOf(m), tgt = type === 'rail' ? m.aimP : P, aim = nrm([tgt[0] - mz[0], tgt[1] - mz[1], tgt[2] - mz[2]]);
  const sndKey = spec === m.mon.att2 && m.mon.snd.fire2 ? 'fire2' : 'fire'; let fb = { blaster: 'blaster', hyper: 'hyper', shotgun: 'shotgun', mg: 'mg' + (1 + (Math.random() * 5 | 0)), rocket: 'fire', grenade: 'gl', rail: 'rail', bfg: 'bfgCharge' }[type];
  if (m.set === 'q3') fb = { mg: 'q3mg' + (1 + (Math.random() * 4 | 0)), shotgun: 'q3sg', rocket: 'q3rl', grenade: 'q3gl' }[type] || fb;
  hearSound(mz, 1500, m.bot ? 'bot' : 'monster', 'fire', m);
  if (!(type === 'mg' && m.burst++ % 2)) playPathAt(monSnd(m, sndKey), mz, 1, 1, fb);
  addLight(mz, 160, type === 'bfg' ? [.3, 1, .3] : type === 'rail' ? [.5, .6, 1.2] : [1, .8, .4], .1);
  switch (type) {
    case 'blaster': case 'hyper': projs.push({ type: 'bolt', p: mz, v: aim.map(x => x * (speed || 600)), dmg, life: 10000, owner: m }); break;
    case 'shotgun': for (let i = 0; i < 12; i++) monsterLead(m, mz, aim, dmg, 1000, 500); break;
    case 'mg': monsterLead(m, mz, aim, dmg, 300, 500); break;
    case 'rocket': projs.push({ type: 'rocket', p: mz, v: aim.map(x => x * (speed || 550)), dmg, rdmg: dmg, radius: dmg + 20, life: 8000, owner: m }); break;
    case 'grenade': { throwGrenade(mz, aim, dmg, 600, 2.5, dmg + 40, false); projs[projs.length - 1].owner = m; break; }
    case 'rail': { const end = mz.map((v, i) => v + aim[i] * 8192), s = shotTrace(mz, end, m, Q.MASK_SOLID); const ep = s.player ? s.p : s.t.endpos; fxBeam(mz, ep, 'rail'); if (s.player) damagePlayer(dmg, mz); else if (s.t.fraction < 1) fxImpact(s.t, 'rail'); break; }
    case 'bfg': projs.push({ type: 'bfg', p: mz, v: aim.map(x => x * (speed || 300)), dmg, life: 8000, laser: 0, owner: m }); break;
  }
}
function startAttack(m, kind, P) {
  m.act = kind === 'melee' ? 'melee' : 'attack'; m.spec = kind === 'melee' ? null : m.mon[kind]; m.fired = false; m.burst = 0; m.aimP = P.slice();
  setAnim(m, kind === 'melee' ? 'melee' : 'attack', false);
}
function attackStep(m, P, d) {
  changeYaw(m, yawTo(m.o, P), 40);
  const n = m.list.length, f = n > 1 ? m.ai / (n - 1) : 1;
  if (m.act === 'melee') {
    if (!m.fired && f >= .45) { m.fired = true; const reach = (m.mon.meleeRange || 80) + m.mmaxs[0];
      playPathAt(monSnd(m, 'melee'), m.o, 1, 1);
      if (d < reach + 16 && canSee(m, P) && m.tgtBot) damageEnt(m.tgtBot, m.mon.melee + Math.random() * 5, 'monster');
      else if (d < reach + 16 && canSee(m, P)) { damagePlayer(m.mon.melee + Math.random() * 5, m.o); const dir = nrm([P[0] - m.o[0], P[1] - m.o[1], .3]); for (let i = 0; i < 3; i++) ps.velocity[i] += Math.trunc(dir[i] * 120 * 8); bloodFx(P, null, .5); } }
  } else if (m.spec[0] === 'mg' || m.spec[0] === 'hyper') { if (f >= .25 && f <= .85 && canSee(m, P)) monsterFire(m, m.spec, P); }
  else if (!m.fired && f >= .45) { m.fired = true; monsterFire(m, m.spec, P); }
}
function monsterThink(m) {
  if (m.hidden || m.gibbed) return;
  groundCheck(m);
  advanceAnim(m);
  if (m.dead) return;
  if (m.bot) { botThink(m); return; }
  let P = playerCenter(); m.tgtBot = null;
  if (BOT.on && BOT.mode === 'coop') { let bd = d3(m.o, P) * .8; for (const b of BOT.bots) if (!b.dead) { const bp = [b.o[0], b.o[1], b.o[2] + 4], dd = d3(m.o, bp); if (dd < bd && dd < 800 && canSee(m, bp)) { P = bp; bd = dd; m.tgtBot = b; } } }
  const def = m.mon, d = Math.hypot(P[0] - m.o[0], P[1] - m.o[1], P[2] - m.o[2]);
  if (m.act === 'pain') { if (m.done) { m.act = null; setAnim(m, m.enemy ? 'run' : 'stand', true); } return; }
  if (m.act === 'attack' || m.act === 'melee') { attackStep(m, P, d); if (m.done) { m.act = null; setAnim(m, 'run', true); } return; }
  const alive = !PL.dead || !!m.tgtBot;
  const vis = alive && canSee(m, P);
  if (!m.enemy && alive && !def.passive) {
    if (vis && d < 1000 && (d < 80 || infront(m, P) || (d < 500 && simTime - noiseT < 1000))) wake(m);
    else if (!m.ambush && simTime - noiseT < 600 && Math.hypot(noiseP[0] - m.o[0], noiseP[1] - m.o[1], noiseP[2] - m.o[2]) < 1000) wake(m);
  }
  if (!m.enemy || !alive || def.passive) {
    if (m.path) { // patrol along path_corners
      const c = m.path.origin; if (m.cat !== 'walk') setAnim(m, 'walk', true);
      changeYaw(m, yawTo(m.o, c), 20);
      if (Math.hypot(c[0] - m.o[0], c[1] - m.o[1]) < 24 || !moveToGoal(m, c, def.walk * .1)) { const n = m.path.kv.target && pickTarget(m.path.kv.target); m.path = n && n.cls === 'path_corner' ? n : null; if (!m.path) setAnim(m, 'stand', true); }
    } else if (def.passive && m.enemy !== 'x') { if (Math.random() < .02) m.wanderYaw = Math.random() * 360; if (m.wanderYaw !== undefined) { changeYaw(m, m.wanderYaw, 15); if (moveToGoal(m, [m.o[0] + Math.cos(m.wanderYaw * Math.PI / 180) * 100, m.o[1] + Math.sin(m.wanderYaw * Math.PI / 180) * 100, m.o[2]], def.walk * .1)) { if (m.cat !== 'walk') setAnim(m, 'walk', true); } } }
    else if (m.cat !== 'stand') setAnim(m, 'stand', true);
    if (Math.random() < .004) playPathAt(monSnd(m, 'idle'), m.o, .8, 2);
    return;
  }
  if (vis) { m.last = P.slice(); m.lastT = simTime; }
  const goal = vis ? P : (m.last || P);
  changeYaw(m, yawTo(m.o, goal), 20);
  if (vis) { // M_CheckAttack
    const reach = (def.meleeRange || 80) + m.mmaxs[0];
    if (def.melee && d < reach) { startAttack(m, 'melee', P); return; }
    if (def.att && simTime >= m.attackT && d < 1000) {
      let ch = d < 80 ? .2 : d < 500 ? .1 : .02; ch *= [.5, 1, 2][S.skill];
      if (Math.random() < ch * (def.fly !== undefined ? 2 : 1)) { startAttack(m, def.att2 && Math.random() < .4 ? 'att2' : 'att', P); m.attackT = simTime + 2000 * Math.random(); return; }
    }
  }
  if (m.cat !== 'run') setAnim(m, 'run', true);
  if (def.fly !== undefined || def.swim) flyToward(m, goal, def.run * .1);
  else if (!m.air && (vis ? d > (def.melee && !def.att ? 40 : 64) : Math.hypot(goal[0] - m.o[0], goal[1] - m.o[1]) > 16)) moveToGoal(m, goal, def.run * .1);
}
function damageMonster(m, dmg, src) {
  if (m.bot) { damageBot(m, dmg, src); return; }
  if (m.hidden || m.gibbed) return; m.lastDmg = dmg;
  m.health -= dmg;
  if (m.dead) { if (m.health <= m.mon.gib) gibMonster(m); return; }
  if (m.health <= 0) { monsterDie(m); if (m.health <= m.mon.gib) gibMonster(m); return; }
  wake(m);
  if (simTime >= m.painT) {
    m.painT = simTime + 3000; playPathAt(monSnd(m, 'pain'), m.o);
    if (Math.random() < (m.mon.painChance ?? .7) && m.act !== 'melee') { m.act = 'pain'; setAnim(m, 'pain', false); }
  }
}
const RAG_BOX = new Set(['flyer', 'float', 'hover', 'flipper', 'boss2', 'boss3/jorg', 'boss1', 'parasite']);
function makeMonsterRagdoll(m) {
  const mm = MM[m.mon.dir], kind = mm || !RAG_BOX.has(m.mon.dir) ? 'h' : 'box', M = entMat(m.ro, m.ryaw, 0);
  const dir = lastHitFrom ? nrm(sub3(entCenter(m), lastHitFrom)) : [0, 0, 0], pw = Math.min(520, (m.lastDmg || 20) * 7), imp = [dir[0] * pw, dir[1] * pw, dir[2] * pw * .5 + 90];
  let capture = null, render;
  if (mm) {
    const ft = Math.max(0, Math.min(1, (100 - m.thinkT) / 100)); capture = [md2World(mm.m, m.oldFrame, m.frame, ft, M)]; render = { type: 'md2', inst: mm.inst, tex: mm.skins[m.mon.skin + 1] || mm.skins[m.mon.skin] || mm.skins[0] };
  }
  else render = { type: 'boxes', colors: { fig: FIG[m.mon.dir] || FIG.default, noGun: true }, drone: DRONE[m.mon.dir] || DRONE.flyer, scale: (m.mmaxs[2] - m.mmins[2]) / 56 };
  m.rag = createRagdoll({ kind, o: m.ro.slice(), yaw: m.ryaw, mins: m.mmins.slice(), maxs: m.mmaxs.slice(), vel: m.vel.slice(), impulse: imp, capture, render, ent: m });
}
function monsterDie(m) {
  if (S.ragdoll) makeMonsterRagdoll(m);
  m.dead = true; m.act = null; m.box.dead = true; m.mmaxs = [m.mmaxs[0], m.mmaxs[1], m.mmins[2] + 16]; updateBox(m);
  setAnim(m, 'death', false); playPathAt(monSnd(m, 'death'), m.o); PL.kills++;
  if (m.mon.fly !== undefined) m.air = true;
  const t = m.kv.deathtarget || (m.kv.target && !(E.byName.get(m.kv.target) || []).some(x => x.cls === 'path_corner') ? m.kv.target : null);
  if (t) { m.target = t; useTargets(m, 'player'); }
  if (m.kv.killtarget) useTargets(m, 'player');
}
function gibMonster(m) {
  if (m.gibbed) return; m.gibbed = true; m.box.active = false; m.takedamage = false;
  if (m.rag) { const i = ragdolls.indexOf(m.rag); if (i >= 0) ragdolls.splice(i, 1); m.rag = null; }
  const c = entCenter(m), sz = m.mmaxs[0] - m.mmins[0];
  playAt('gib', c);
  for (let i = 0; i < 4; i++) spawnDebris(c.map((v, k) => v + crand() * sz * .4), 'gib_meat', 2, [.5, .05, .04]);
  spawnDebris(c, 'gib_bone', 2, [.8, .75, .65]); spawnDebris([c[0], c[1], c[2] + 10], 'gib_head', 1.5, [.6, .3, .25]);
  for (let i = 0; i < 3; i++) bloodFx(c.map((v, k) => v + crand() * 10), null, 1.5);
  for (const d of debris.slice(-6)) d.blood = true;
}
// ---------- bot deathmatch ----------
// Bots are monsters wearing the player model: they chase, strafe, shoot (the player and each other), collect items and respawn.
const BOT_NAMES = ['Sarge', 'Hunter', 'Crash', 'Orbb', 'Razor', 'Visor', 'Lucy', 'Gorre'];
const BOTPM = new Map(), capName = n => n.charAt(0).toUpperCase() + n.slice(1);
// A bot's name is its player model: Quake III bots are named after the model folders you have, Quake II bots after the skins.
// Every bot belongs to one family — Quake II (a Q2 player model + skin, Q2 weapons and sounds) or Quake III (a Q3 model + skin, Q3 weapons and sounds).
function botFamily(set) {
  const r = [];
  if (set === 'q3') for (const m of listQ3Models()) { const sk = listQ3Skins(m); r.push({ set, name: capName(m), model: m, skin: sk.includes('default') ? 'default' : sk[0] || 'default' }); }
  if (set === 'q2') for (const m of listPlayerModels()) for (const sk of listSkins(m)) r.push({ set, name: capName(sk), model: m, skin: sk });
  return r;
}
function botRoster(only) { // only: 'q2' | 'q3' for that family; otherwise the family of your player-model setting (or whichever is installed)
  let r = only ? botFamily(only) : botFamily(S.pset);
  if (!r.length && !only) r = botFamily('q3').concat(botFamily('q2'));
  if (!r.length && !only) r = BOT_NAMES.map(n => ({ name: n }));
  for (let i = r.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
// Bot picker: one slot per bot in the Multiplayer menu, each "Random" or a chosen character
const botKey = r => `${r.set || ''}/${r.model || ''}/${r.skin || ''}/${r.name}`;
function botChoices() { const seen = new Set(); return botFamily('q2').concat(botFamily('q3')).filter(r => { const k = botKey(r); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.set === b.set ? a.name.localeCompare(b.name) : a.set < b.set ? -1 : 1); }
function fillBotSlots() {
  const box = $('botSlots'); if (!box) return; const n = +$('botCount').value, ch = botChoices(); S.botPicks = S.botPicks || [];
  box.textContent = '';
  for (let i = 0; i < n; i++) {
    const l = document.createElement('label'), sel = document.createElement('select');
    l.append(`Bot ${i + 1}`, sel);
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('', 'Random'); const fam = botFamily('q2').length, f3 = botFamily('q3').length; if (fam) add('*q2', 'Random — Quake II'); if (f3) add('*q3', 'Random — Quake III');
    for (const set of ['q2', 'q3']) { const g = ch.filter(r => r.set === set); if (!g.length) continue; const og = document.createElement('optgroup'); og.label = set === 'q2' ? 'Quake II model, skin & weapons' : 'Quake III model, skin & weapons'; sel.appendChild(og);
      for (const r of g) { const o = document.createElement('option'); o.value = botKey(r); o.textContent = r.name + (r.model && r.model.toLowerCase() !== r.name.toLowerCase() ? ` (${r.model})` : ''); og.appendChild(o); } }
    sel.value = ch.some(r => botKey(r) === S.botPicks[i]) || (S.botPicks[i] === '*q2' && fam) || (S.botPicks[i] === '*q3' && f3) ? S.botPicks[i] : '';
    sel.onchange = () => { S.botPicks[i] = sel.value; saveS(); };
    box.appendChild(l);
  }
}
function pickedRoster(n) { // chosen characters first, the rest random (without repeating anyone already chosen)
  const ch = botChoices(), byKey = new Map(ch.map(r => [botKey(r), r])), picks = (S.botPicks || []).slice(0, n), used = new Set(picks.filter(k => byKey.has(k)));
  const pools = { '': botRoster().filter(r => !used.has(botKey(r))), '*q2': botRoster('q2').filter(r => !used.has(botKey(r))), '*q3': botRoster('q3').filter(r => !used.has(botKey(r))) }, out = [], count = new Map();
  for (let i = 0; i < n; i++) {
    let r = byKey.get(picks[i]); if (r) r = { ...r }; else { const pk = pools[picks[i]] ? picks[i] : ''; const pool = pools[pk]; r = pool.shift() || (pool.push(...(pk ? botRoster(pk.slice(1)) : botRoster())), pool.shift()) || botRoster().shift(); }
    if (!r) break; const c = (count.get(r.name) || 0) + 1; count.set(r.name, c); if (c > 1) r.name += ' ' + ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][c]; out.push(r);
  }
  return out;
}
function loadBotModel(b) {
  if (!b.model || !mainCtx) return; const key = `${b.set}/${b.model}/${b.skin}`;
  if (!BOTPM.has(key)) BOTPM.set(key, (b.set === 'q3' ? loadQ3Player(mainCtx, b.model, b.skin) : loadCharacter(mainCtx, b.model, b.skin)).catch(() => null));
  BOTPM.get(key).then(p => { b.pm = p; });
}
MON.bot = ms('bot', { hp: 100, gib: -1e9, mass: 200, run: 215, walk: 90, snd: {} });
const BOT_GUNS = [ // 0 machinegun, 1 shotgun, 2 rocket launcher — Quake II's numbers
  { spec: ['mg', 6], rate: 110, q2: 3, q3: 1 }, { spec: ['shotgun', 4], rate: 1000, q2: 1, q3: 2 }, { spec: ['rocket', 55, 650], rate: 1150, q2: 6, q3: 4 }];
const BOT_GUNS_Q3 = [ // Quake III bots shoot Quake III's: a faster-firing machinegun, a rocket launcher that hits harder and flies quicker
  { spec: ['mg', 7], rate: 100, q2: 3, q3: 1 }, { spec: ['shotgun', 5], rate: 1000, q2: 1, q3: 2 }, { spec: ['rocket', 100, 900], rate: 800, q2: 6, q3: 4 }];
const botGun = m => (m.set === 'q3' ? BOT_GUNS_Q3 : BOT_GUNS)[m.wpn || 0];
const BOT_COL = { torso: [.6, .16, .14, 1], limb: [.45, .12, .1, 1], head: [.95, .75, .3, 1], boot: [.18, .1, .08, 1] };
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function pickSpawnIdx() { // the spawn point farthest from everyone alive
  const list = world.spawns, who = [playerCenter(), ...BOT.bots.filter(b => !b.dead).map(b => b.o)]; let best = 0, bd = -1;
  for (let i = 0; i < list.length; i++) { const p = list[i].o, d = Math.min(...who.map(w => d3(p, w))) + Math.random() * 120; if (d > bd) { bd = d; best = i; } }
  return best;
}
function spawnBot() {
  if (!BOT.roster.length) BOT.roster = botRoster();
  const id = BOT.roster.shift() || { name: BOT_NAMES[BOT.bots.length % BOT_NAMES.length] + (BOT.bots.length >= BOT_NAMES.length ? ' II' : '') };
  const sp = BOT.mode === 'coop' ? coopSpot() : world.spawns[pickSpawnIdx()], e = { cls: 'bot', kv: {}, spawnflags: 0, origin: [sp.o[0], sp.o[1], sp.o[2] + 9], classname: 'bot' };
  setupMonster(e, world.cm); PL.total--;
  Object.assign(e, { bot: true, ally: BOT.mode === 'coop', name: id.name, set: id.set, model: id.model, skin: id.skin, hue: BOT.bots.length, frags: 0, deaths: 0, fireT: 0, wpn: 0, burst: 0, yaw: sp.yaw, ryaw: sp.yaw, enemy: true });
  BOT.bots.push(e); loadBotModel(e); return e;
}
function coopSpot() { // somewhere near the player on open floor
  const c = ps.origin.map(v => v / 8);
  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 90, p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2] + 2];
    const t = Q.trace([p[0], p[1], p[2] + 1], [-16, -16, -24], [16, 16, 32], [p[0], p[1], p[2] - 64], Q.MASK_MONSTERSOLID, true);
    if (!t.allsolid && !t.startsolid && t.fraction < 1) return { o: [t.endpos[0], t.endpos[1], t.endpos[2]], yaw: Math.random() * 360 };
  }
  return { o: [c[0], c[1], c[2] + 4], yaw: 0 };
}
function beginBotMatch(n) {
  BOT.on = true; BOT.over = false; BOT.startT = simTime; BOT.frags = BOT.deaths = 0; BOT.bots = []; BOT.lastShooter = null; BOT.roster = pickedRoster(n);
  if (BOT.mode === 'coop') { // the level keeps its monsters; the bots are on your side
    for (let i = 0; i < n; i++) spawnBot();
    toast(`Co-op — ${BOT.bots.map(b => b.name).join(', ')} fight beside you.`, 4000); return;
  }
  for (const m of E.monsters) { m.hidden = true; m.takedamage = false; m.box.active = false; }
  E.monsters.length = 0; E.damageables = E.damageables.filter(x => !x.isMonster); PL.total = PL.kills = 0;
  campaignMode = true; resetPlayer(); resetInventory(false);
  respawn(pickSpawnIdx());
  for (let i = 0; i < n; i++) spawnBot();
  toast(`Deathmatch — ${BOT.bots.map(b => b.name).join(', ')}. Ammo and health are real; items respawn.`, 4000);
}
let lastMapPath = null;
function startBotMatch(n, path, mode, rules) { // path: a map, 'test' for the built-in one, or nothing for the last map played
  if (mode) BOT.mode = mode; if (rules) { BOT.fragLimit = rules.frag | 0; BOT.timeLimit = rules.time | 0; }
  BOT.count = n === undefined || n === null || isNaN(n) ? BOT.count : Math.max(0, Math.min(7, n | 0)); BOT.pending = BOT.count + 1; // +1 so "0 bots" still triggers a match
  if (path && !BUILTIN_MAPS[path]) { loadMap(path, null, running); return; }
  if (!path && world && world.builtin && world.builtin !== 'test') path = world.builtin;
  if (!path && world && !world.demo && lastMapPath && VFS.has(lastMapPath)) { loadMap(lastMapPath, null, running); return; }
  if (!gl) return; const bid = BUILTIN_MAPS[path] ? path : 'test', w = builtinWorld(bid); resetPlayer(); campaignMode = BOT.mode === 'coop' && BUILTIN_MAPS[bid].campaign; resetInventory(!campaignMode); setWorld(w); loaded = true; startGame();
}
function matchLine() { // the score line, with limits
  const left = BOT.timeLimit ? Math.max(0, BOT.timeLimit * 60000 - (simTime - BOT.startT)) : -1, clock = left >= 0 ? `  ·  ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : '';
  return `FRAGS ${BOT.frags}${BOT.fragLimit ? ' / ' + BOT.fragLimit : ''}  ·  DEATHS ${BOT.deaths}${clock}\n` + BOT.bots.map(b => `${b.name} ${b.frags}`).join('  ·  ');
}
function checkMatchEnd() {
  if (BOT.over || !BOT.on) return; let msg = null;
  const best = BOT.bots.reduce((a, b) => b.frags > a.frags ? b : a, { frags: -1, name: '' });
  if (BOT.mode === 'dm' && BOT.fragLimit && (BOT.frags >= BOT.fragLimit || best.frags >= BOT.fragLimit)) msg = BOT.frags >= best.frags ? `Frag limit reached — you win with ${BOT.frags} frags!` : `Frag limit reached — ${best.name} wins with ${best.frags} frags.`;
  if (!msg && BOT.timeLimit && simTime - BOT.startT >= BOT.timeLimit * 60000) {
    if (BOT.mode === 'coop') msg = `Time limit — ${PL.kills} of ${PL.total} monsters killed.`;
    else msg = !BOT.bots.length || BOT.frags > best.frags ? `Time limit — you win with ${BOT.frags} frags!` : BOT.frags === best.frags ? `Time limit — tied at ${BOT.frags} frags.` : `Time limit — ${best.name} wins with ${best.frags} frags (you: ${BOT.frags}).`;
  }
  if (msg) { BOT.over = true; setStatus(msg); toast(msg, 5000); pauseGame(); showScreen('mp'); }
}
function updateBots() {
  checkMatchEnd();
  for (const b of BOT.bots) botSteps(b);
  if (NAV.w !== world || NAV.E !== E) { NAV.w = world; NAV.E = E; navReset(); BOT.log = []; BOT.plan = null; BOT.planT = 0; }
  navPump();
  if (BOT.mode === 'coop' && simTime >= BOT.planT) { BOT.planT = simTime + 900; squadPlan(); }
  for (const m of BOT.bots) if (m.dead && simTime >= m.respawnAt) botRespawn(m);
  for (const e of E.items) if (e.taken && e.respawnAt && simTime >= e.respawnAt) { e.taken = false; e.respawnAt = 0; addLight(e.o, 120, [.6, .8, 1], .4); }
}
function botRespawn(m) {
  const sp = BOT.mode === 'coop' ? coopSpot() : world.spawns[pickSpawnIdx()]; let o = [sp.o[0], sp.o[1], sp.o[2] + (BOT.mode === 'coop' ? 0 : 9)];
  m.mmins = [-16, -16, -24]; m.mmaxs = [16, 16, 32];
  const t = Q.trace([o[0], o[1], o[2] + 1], m.mmins, m.mmaxs, [o[0], o[1], o[2] - 256], Q.MASK_MONSTERSOLID, true); if (!t.allsolid && !t.startsolid) o = t.endpos;
  m.o = o; m.ro = o.slice(); m.yaw = m.ryaw = sp.yaw; m.vel = [0, 0, 0]; m.health = m.maxHealth = 100; m.armorB = 0; m.dead = false; m.hidden = false; m.takedamage = true; m.box.active = true;
  m.rag = null; m.last = null; m.goal = null; m.quad = m.inv = 0; m.nav = null; m.role = 'follow'; m.plan = null; m.alert = null; m.hideSpot = null; m.air = true; m.act = null; m.fireT = simTime + 600; updateBox(m); addLight(o, 200, [.5, .7, 1], .5);
}
function botRagdoll(m) {
  const dir = lastHitFrom ? nrm(sub3(entCenter(m), lastHitFrom)) : [0, 0, 0], imp = [dir[0] * 250, dir[1] * 250, 60];
  const box = { kind: 'h', o: m.o.slice(), yaw: m.yaw, mins: [-16, -16, -24], maxs: [16, 16, 32], vel: m.vel.slice(), impulse: imp, ent: m };
  playerRagSource(box, m.o, m.yaw, { q3: [[QA.LEGS_IDLE, 0], [QA.TORSO_STAND, 0]], q2: ['stand', 0, true] }, m.pm || player);
  if (box.render && box.render.type === 'boxes') box.render.colors = { fig: botFig(m.hue), noGun: true };
  m.rag = createRagdoll(box);
}
function damageBot(m, dmg, src) {
  if (m.dead || m.hidden || !m.takedamage) return; if (m.ally && src !== 'monster') return; if (m.inv > simTime) { if (simTime >= (m.painT || 0)) { m.painT = simTime + 500; playAt('protect', m.o, .7); } return; } m.lastDmg = dmg; if (m.ally) m.combatT = simTime; hearSound(m.o, 700, 'bot', 'pain', m);
  const save = Math.min(m.armorB || 0, Math.ceil(dmg * .6)); m.armorB = (m.armorB || 0) - save; m.health -= dmg - save;
  if (m.health <= 0) { botDie(m, src !== 'monster'); return; }
  if (src !== 'monster' && !PL.dead) { m.last = playerCenter(); m.lastT = simTime; }
  if (simTime >= (m.painT || 0)) { m.painT = simTime + 500; playPathAt(botVoice(m, `pain${m.health < 25 ? 25 : m.health < 50 ? 50 : m.health < 75 ? 75 : 100}_${1 + (Math.random() * 2 | 0)}.wav`), m.o, 1, 1, 'hurt', null); }
}
function botDie(m, byPlayer) {
  m.dead = true; m.health = 0; m.takedamage = false; m.box.active = false; m.deaths++; m.quad = m.inv = 0; m.role = 'follow'; m.nav = null; hearSound(m.o, 800, 'bot', 'death', m);
  if (S.ragdoll) botRagdoll(m); playPathAt(botVoice(m, `death${1 + (Math.random() * 4 | 0)}.wav`), m.o, 1, 1, 'land');
  m.hidden = true; m.respawnAt = simTime + (m.ally ? 5000 : 2200) + Math.random() * 1500;
  if (m.ally) return;
  if (byPlayer) { BOT.frags++; toast(`You fragged ${m.name}`, 1500); }
  else { const k = BOT.lastShooter; if (k && k !== m && simTime - BOT.shooterT < 4000) k.frags++; }
}
function botTarget(m) { // nearest enemy in sight: the player or another bot (deathmatch), the level's monsters (co-op)
  let best = null, bd = 1e9;
  if (m.ally) {
    for (const e of E.monsters) if (!e.bot && !e.dead && !e.hidden && !e.gibbed && e.takedamage) { const P = [e.o[0], e.o[1], e.o[2] + 4], d = d3(m.o, P); if (d < bd && d < 1600 && canSee(m, P)) { best = { P, ent: e }; bd = d; } }
    return best && { ...best, d: bd };
  }
  if (!PL.dead && !ps.noclip) { const P = playerCenter(), d = d3(m.o, P); if (d < 2400 && canSee(m, P)) { best = { P, ent: null }; bd = d; } }
  for (const b of BOT.bots) if (b !== m && !b.dead) { const P = [b.o[0], b.o[1], b.o[2] + 4], d = d3(m.o, P); if (d < bd && d < 1800 && canSee(m, P)) { best = { P, ent: b }; bd = d; } }
  return best && { ...best, d: bd };
}
function botPickGoal(m) {
  const want = m.health < 60 ? e => e.item.h : e => e.item.w || e.item.a || e.item.h || e.item.quad || e.item.inv || e.item.am;
  let best = null, bs = 1e9;
  for (const e of E.items) { if (e.taken || e.hidden || !want(e)) continue; const sc = d3(m.o, e.o) + Math.random() * 500; if (sc < bs) { bs = sc; best = e; } }
  if (best && Math.random() < .8) m.goal = { o: best.o, item: best }; else { const sp = world.spawns[Math.floor(Math.random() * world.spawns.length)]; m.goal = { o: sp.o }; }
  m.goalT = simTime + 9000;
}
function botCollect(m) {
  for (const e of E.items) {
    if (e.taken || e.hidden || d3(m.o, e.o) > 34 || Math.abs(m.o[2] - e.o[2]) > 40) continue; const d = e.item; if (d.key) continue;
    if (d.h) { if (m.health >= 100 && d.hmax !== 200) continue; m.health = Math.min(d.hmax === 200 ? 200 : 100, m.health + d.h); }
    if (d.a) m.armorB = Math.min(200, (m.armorB || 0) + d.a);
    if (d.quad) m.quad = Math.max(m.quad || 0, simTime) + d.quad * 1000; if (d.inv) m.inv = Math.max(m.inv || 0, simTime) + d.inv * 1000;
    if (d.quad || d.inv) { addLight(m.o, 240, d.quad ? [.3, .5, 1] : [1, .8, .25], .6); playAt('protect', m.o, .8); }
    e.taken = true; e.respawnAt = simTime + (d.w ? 8000 : d.quad || d.inv ? 90000 : 25000); if (m.goal && m.goal.item === e) m.goal = null;
  }
}
// ---------- bot senses: hearing ----------
// Everything the game plays is also a noise in the world: gunfire, explosions, footsteps, doors, pickups, pain and death cries. Bots
// hear it (louder things carry farther, walls muffle it), and a monster woken by a bot's gunfire joins the fight.
const NOISES = [];
const LOUD = { fire: 1600, boom: 1800, gboom: 1500, bfgBoom: 2000, bfgCharge: 1000, rail: 1200, shotgun: 1200, sshotgun: 1300, blaster: 900, hyper: 900, gl: 1000, hgThrow: 500, hgPin: 400, lashit: 500,
  jump: 280, land: 330, fall1: 500, fall2: 450, push: 650, jumppad: 650, tele: 800, telein: 800, respawn: 700, protect: 600, quadFire: 650, gib: 650, doorStart: 600, doorEnd: 450, platStart: 600, platEnd: 450, button: 550, click: 0, talk: 0 };
const loudOf = k => { if (LOUD[k] !== undefined) return LOUD[k]; if (/^(mg|cg|q3mg|q3cg|q3sg|q3rl|q3rg|q3pg|q3lg|q3ng|q3gl|q3bfg|q3px|cgUp|cgLoop)/.test(k)) return 1100; if (/^(q3boom|q3pgHit|q3ngHit)/.test(k)) return 900; if (/^step/.test(k)) return 300; if (/^watr/.test(k)) return 380; return 260; };
let noiseThrottle = 0;
function hearSound(p, r, src, kind, owner) {
  if (!p || r <= 0 || !E || !world || !BOT.on) return;
  const last = NOISES[NOISES.length - 1];
  if (last && last.src === src && last.kind === kind && last.owner === owner && simTime - last.t < 120 && d3(last.p, p) < 120) return;
  NOISES.push({ p: p.slice(), r, t: simTime, src, kind, owner }); while (NOISES.length > 48) NOISES.shift();
  if (src === 'bot' && BOT.on && simTime >= noiseThrottle) { // a bot's gunfire wakes monsters near it
    noiseThrottle = simTime + 350;
    for (const m of E.monsters) if (!m.bot && !m.enemy && !m.dead && !m.hidden && !m.ambush && d3(m.o, p) < r * .6) wake(m);
  }
}
function botHear(m) {
  const since = m.heardT ?? -1; let best = null, bs = 0;
  for (let i = NOISES.length - 1; i >= 0; i--) {
    const n = NOISES[i]; if (n.t <= since) break; if (n.owner === m || simTime - n.t > 2500) continue;
    if (m.ally ? (n.src === 'player' || n.src === 'bot') : (n.src === 'monster')) continue; // allies hunt monsters; deathmatch bots hunt the player and each other
    if (m.ally && n.src === 'world' && d3(n.p, playerCenter()) < 420) continue; // your own rockets aren't a mystery
    const d = d3(m.o, n.p); if (d < 60) continue;
    const reach = n.r * (Q.trace(eyeOf(m), Z3, Z3, [n.p[0], n.p[1], n.p[2] + 16], Q.MASK_OPAQUE, true).fraction === 1 ? 1 : .55); // walls muffle
    if (d > reach) continue; const sc = (1 - d / reach) * n.r; if (sc > bs) { bs = sc; best = n; }
  }
  m.heardT = simTime; if (!best) return null;
  m.heard = { p: best.p, t: simTime, kind: best.kind, src: best.src };
  return m.heard;
}
// ---------- path finding: A* over a lazily-built grid of places a bot can stand ----------
// Nodes sit on a 32-unit lattice; an edge is a walk the bot's own hull can make (steps up to 18, drops up to 64). Neighbour lists are
// cached per node, so every bot's search enriches the same map, and searches run a slice at a time so a big level never stalls a tick.
const NAV = { nb: new Map(), doors: [], queue: [], budgetMs: 1.6, searches: 0, expanded: 0 };
const NHULL = { mins: [-16, -16, -24], maxs: [16, 16, 32] }, NDIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
const nkey = (x, y, z) => ((Math.round(x / 32) + 4096) * 8192 + (Math.round(y / 32) + 4096)) * 2048 + (Math.round(z / 16) + 1024);
function navReset() {
  NAV.nb.clear(); NAV.queue.length = 0; NOISES.length = 0;
  NAV.doors = E.movers.filter(e => e.cls === 'func_door' && !e.targetname && e.st && !e.dead);
}
function navStep(o, dx, dy) { // can a bot standing at o walk (dx,dy) from here? returns the new standing point and a cost multiplier
  const M = Q.MASK_MONSTERSOLID, hm = NHULL.mins, hx = NHULL.maxs;
  let up = [o[0], o[1], o[2] + 18]; if (Q.trace(up, hm, hx, up, M, true).allsolid) up = o.slice();
  const t = Q.trace(up, hm, hx, [up[0] + dx, up[1] + dy, up[2]], M, true);
  if (t.allsolid || t.fraction < 1) return null;
  const d = Q.trace(t.endpos, hm, hx, [t.endpos[0], t.endpos[1], t.endpos[2] - 82], M, true);
  if (d.allsolid || d.startsolid || d.fraction === 1 || d.normal[2] < .7) return null;
  const p = d.endpos, drop = o[2] - p[2]; if (drop > 64) return null;
  const c = Q.pointContents([p[0], p[1], p[2] - 22]); if (c & (Q.CONTENTS_LAVA | Q.CONTENTS_SLIME)) return null;
  return { o: p, pen: 1 + (c & Q.MASK_WATER ? .5 : 0) + (drop > 20 ? drop / 80 : 0) };
}
function navNb(n) {
  let r = NAV.nb.get(n.k); if (r) return r; r = [];
  for (const [dx, dy] of NDIRS) {
    const s = navStep(n.o, dx * 32, dy * 32); if (!s) continue;
    const len = Math.hypot(dx, dy) * 32, lo = [Math.min(n.o[0], s.o[0]) - 18, Math.min(n.o[1], s.o[1]) - 18, Math.min(n.o[2], s.o[2]) - 24], hi = [Math.max(n.o[0], s.o[0]) + 18, Math.max(n.o[1], s.o[1]) + 18, Math.max(n.o[2], s.o[2]) + 32];
    let door = null; for (const d of NAV.doors) { const m0 = d.st.mins, m1 = d.st.maxs; if (lo[0] <= m1[0] && hi[0] >= m0[0] && lo[1] <= m1[1] && hi[1] >= m0[1] && lo[2] <= m1[2] && hi[2] >= m0[2]) { door = d; break; } }
    r.push({ k: nkey(s.o[0], s.o[1], s.o[2]), o: s.o, c: len * s.pen + (door ? 24 : 0), door });
  }
  NAV.nb.set(n.k, r); return r;
}
function withDoorsOpen(fn) { // plan through doors a bot can open by walking at them
  const was = NAV.doors.map(d => d.st.active); NAV.doors.forEach(d => { d.st.active = false; });
  try { return fn(); } finally { NAV.doors.forEach((d, i) => { d.st.active = was[i]; }); }
}
function navSnap(o) { // the lattice node a bot standing at o can reach (or the point a goal sits over)
  const bx = Math.round(o[0] / 32) * 32, by = Math.round(o[1] / 32) * 32, c = [[bx, by], [bx + 32, by], [bx - 32, by], [bx, by + 32], [bx, by - 32], [bx + 32, by + 32], [bx - 32, by - 32], [bx + 32, by - 32], [bx - 32, by + 32]];
  c.sort((a, b) => Math.hypot(a[0] - o[0], a[1] - o[1]) - Math.hypot(b[0] - o[0], b[1] - o[1]));
  for (const [x, y] of c) {
    const top = [x, y, o[2] + 24], t = Q.trace(top, NHULL.mins, NHULL.maxs, [x, y, o[2] - 96], Q.MASK_MONSTERSOLID, true);
    if (t.allsolid || t.startsolid || t.fraction === 1 || t.normal[2] < .7) continue;
    return { k: nkey(x, y, t.endpos[2]), o: t.endpos };
  }
  return null;
}
class NavSearch {
  constructor(from, goal) {
    this.goal = goal; this.done = false; this.path = null; this.partial = false; this.n = 0; this.heap = []; this.seen = new Map(); this.best = null;
    const a = withDoorsOpen(() => navSnap(from)), b = withDoorsOpen(() => navSnap(goal));
    if (!a) { this.done = true; return; }
    this.gk = b ? b.k : -1; this.gp = b ? b.o : goal;
    const s = { k: a.k, o: a.o, g: 0, f: 0, p: null, door: null }; this.seen.set(a.k, s); this.push(s); this.best = s; s.h = this.h(s.o);
  }
  h(o) { const dx = Math.abs(o[0] - this.gp[0]), dy = Math.abs(o[1] - this.gp[1]); return (Math.max(dx, dy) + .41 * Math.min(dx, dy)) * 1.15 + Math.abs(o[2] - this.gp[2]) * .3; }
  push(s) { const H = this.heap; H.push(s); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p].f <= H[i].f) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } }
  pop() { const H = this.heap, top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < H.length && H[l].f < H[m].f) m = l; if (r < H.length && H[r].f < H[m].f) m = r; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return top; }
  step(max) {
    if (this.done) return true;
    withDoorsOpen(() => {
      for (let i = 0; i < max && this.heap.length; i++) {
        const c = this.pop(); if (c.closed) continue; c.closed = true; this.n++; NAV.expanded++;
        if (c.k === this.gk || (Math.hypot(c.o[0] - this.gp[0], c.o[1] - this.gp[1]) < 40 && Math.abs(c.o[2] - this.gp[2]) < 56)) { this.finish(c, false); return; }
        if (c.h < this.best.h) this.best = c;
        if (this.n > 6000) { this.finish(this.best, true); return; }
        for (const e of navNb(c)) {
          const g = c.g + e.c; let s = this.seen.get(e.k);
          if (s && (s.closed || s.g <= g)) continue;
          if (!s) { s = { k: e.k, o: e.o, h: this.h(e.o) }; this.seen.set(e.k, s); }
          s.g = g; s.f = g + s.h * 1.25; s.p = c; s.door = e.door; this.push(s);
        }
      }
      if (!this.heap.length) this.finish(this.best, true);
    });
    return this.done;
  }
  finish(node, partial) {
    this.done = true; this.partial = partial && node !== null; const path = [], doors = [];
    for (let s = node; s && s.p; s = s.p) { path.push(s.o); doors.push(s.door); }
    this.path = path.reverse(); this.doors = doors.reverse();
  }
}
function navRequest(m, goal) {
  const s = new NavSearch(m.o, goal); NAV.searches++;
  if (!s.done) NAV.queue.push({ m, s, goal: goal.slice() }); else navApply(m, s, goal);
  return s;
}
function navApply(m, s, goal) {
  const n = m.nav; n.req = null; n.goal = goal; n.t = simTime;
  if (s.path && s.path.length) { n.path = s.path; n.doors = s.doors; n.i = 0; n.partial = s.partial; n.fail = 0; } else { n.path = null; n.noPath = simTime; }
}
function navPump() {
  const t0 = performance.now();
  while (NAV.queue.length && performance.now() - t0 < NAV.budgetMs) {
    const q = NAV.queue[0]; q.s.step(60);
    if (q.s.done) { NAV.queue.shift(); if (q.m.nav && q.m.nav.req === q.s) navApply(q.m, q.s, q.goal); } else NAV.queue.push(NAV.queue.shift());
  }
}
function botDoors(m) { // a bot walking up to a door opens it
  for (const d of NAV.doors) { if (d.dead || d.state === 'up' || d.state === 'top') continue; const o = d.st.o, a = d.st.mins, b = d.st.maxs;
    if (m.o[0] > a[0] + o[0] - 56 && m.o[0] < b[0] + o[0] + 56 && m.o[1] > a[1] + o[1] - 56 && m.o[1] < b[1] + o[1] + 56 && m.o[2] > a[2] + o[2] - 40 && m.o[2] < b[2] + o[2] + 40) doorUse(d, 'player'); }
}
const hdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// Walk toward goal along an A* path (planned in the background; until it arrives the bot heads straight at it). face: turn to look where it goes.
function botGo(m, goal, spd, face = true) {
  const n = m.nav || (m.nav = { path: null, i: 0, goal: null, t: 0, req: null, fail: 0, reqT: 0 });
  if (m.mon.fly !== undefined || m.mon.swim) return moveToGoal(m, goal, spd);
  const close = hdist(m.o, goal) < 70 && Math.abs(m.o[2] - goal[2]) < 40;
  if (close) { n.path = null; const y = yawTo(m.o, goal); if (face) changeYaw(m, y, 40); return stepMove(m, y, spd) || moveToGoal(m, goal, spd); }
  if ((!n.path || d3(n.goal || [1e9, 0, 0], goal) > 120 || simTime > n.t + 4000 || n.fail > 2) && !n.req && simTime >= n.reqT) { n.reqT = simTime + 450 + Math.random() * 250; n.req = navRequest(m, goal); }
  if (n.path && n.i < n.path.length) {
    while (n.i < n.path.length - 1 && hdist(m.o, n.path[n.i]) < 24 && Math.abs(m.o[2] - n.path[n.i][2]) < 34) n.i++;
    const wp = n.path[n.i]; if (n.doors && n.doors[n.i]) { const d = n.doors[n.i]; if (d.state !== 'up' && d.state !== 'top') doorUse(d, 'player'); }
    if (n.i >= n.path.length - 1 && hdist(m.o, wp) < 24) { n.path = null; return false; }
    const y = yawTo(m.o, wp); if (face) changeYaw(m, y, 45);
    let moved = stepMove(m, y, spd);
    if (!moved) for (const a of [30, -30, 60, -60]) if ((moved = stepMove(m, y + a, spd))) break;
    if (moved) n.fail = Math.max(0, n.fail - .25); else { n.fail++; if (n.fail > 3) { n.path = null; n.fail = 0; } }
    return moved;
  }
  return moveToGoal(m, goal, spd); // no path yet (still being planned, or none exists): head straight for it
}
// ---------- squad tactics (co-op) ----------
// Every second or so the squad sizes up the fight and hands each bot a job: Initiate (take the fight to a threat), Flank (come at it from
// the side), Cover (cover fire from a protected spot, or stand between you and the threat when you're hurt), Retreat (hurt bots fall back
// behind cover and recover), Follow (hold a formation spot around you) or Investigate (go and see what that noise was).
const ROLE_LABEL = { follow: 'FOLLOW', initiate: 'INITIATE', flank: 'FLANK', cover: 'COVER', guard: 'COVER YOU', retreat: 'FALL BACK', investigate: 'INVESTIGATE' };
const ROLE_SAY = { follow: ['On you.', 'Right behind you.'], initiate: ['Engaging!', "I've got eyes on it — moving in!"], flank: ['Flanking!', 'Going around the side!'], cover: ['Covering!', 'Suppressing — go!'], guard: ["I've got your back!", 'Staying with you!'], retreat: ['Need cover — falling back!', 'Hurt — pulling back!'], investigate: ['Heard something…', 'Checking that out.'] };
function say(m, role) { if (simTime - (m.sayT || -1e9) < 4000) return; m.sayT = simTime; const t = ROLE_SAY[role]; playAt('talk', m.o, .55, .6, null); if (m.set === 'q3' && (role === 'initiate' || role === 'flank') && Math.random() < .5) playPathAt(botVoice(m, 'taunt.wav'), m.o, .9, .8); BOT.log.push({ t: simTime, s: `${m.name}: ${t[Math.random() * t.length | 0]}` }); while (BOT.log.length > 4) BOT.log.shift(); }
const visFrom = (a, b) => Q.trace(a, Z3, Z3, b, Q.MASK_OPAQUE, true).fraction === 1;
function groundAt(x, y, z) { const t = Q.trace([x, y, z + 40], NHULL.mins, NHULL.maxs, [x, y, z - 120], Q.MASK_MONSTERSOLID, true); return t.allsolid || t.startsolid || t.fraction === 1 || t.normal[2] < .7 ? null : t.endpos; }
function squadThreats(bots) {
  const pc = playerCenter(), out = [];
  for (const e of E.monsters) {
    if (e.bot || e.dead || e.hidden || e.gibbed || !e.takedamage || !e.enemy) continue; const P = [e.o[0], e.o[1], e.o[2] + 4];
    if (d3(P, pc) > 2000 && !bots.some(b => d3(b.o, P) < 1500)) continue;
    const seen = (!PL.dead && visFrom([pc[0], pc[1], pc[2] + 18], [P[0], P[1], P[2] + 14])) || bots.some(b => d3(b.o, P) < 1600 && canSee(b, P));
    const heard = NOISES.some(n => n.owner === e && simTime - n.t < 4000);
    if (seen || heard) out.push({ P, ent: e, seen, d: d3(P, pc) });
  }
  return out.sort((a, b) => a.d - b.d);
}
function findCover(m, th, mode) { // mode 'hide': out of the threat's sight, near the bot. 'support': a protected spot with a clear shot, near the player
  const pc = playerCenter(), base = mode === 'hide' ? m.o : pc, eye = [th[0], th[1], th[2] + 18]; let best = null, bs = 1e9;
  for (let k = 0; k < 22; k++) {
    const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 300, g = groundAt(Math.round((base[0] + Math.cos(a) * r) / 32) * 32, Math.round((base[1] + Math.sin(a) * r) / 32) * 32, base[2]); if (!g) continue;
    const head = [g[0], g[1], g[2] + 28], vis = visFrom(eye, head), dt = d3(g, th);
    if (mode === 'hide') { if (vis) continue; const sc = d3(g, m.o) + (d3(g, pc) > 700 ? 400 : 0); if (sc < bs) { bs = sc; best = g; } continue; }
    if (!vis || dt < 260 || dt > 800) continue;
    let wall = 0; for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Q.trace(head, Z3, Z3, [head[0] + sx * 44, head[1] + sy * 44, head[2]], Q.MASK_SOLID, true).fraction < 1) wall++; // standing against a wall/corner is "cover"
    const sc = d3(g, pc) * .8 + d3(g, m.o) * .25 - wall * 55 - (dt > 360 ? 0 : 120); if (sc < bs) { bs = sc; best = g; }
  }
  return best;
}
function flankPoint(m, th) {
  const pc = playerCenter(), ax = nrm([pc[0] - th[0], pc[1] - th[1], 0]), perp = [-ax[1], ax[0], 0], eye = [th[0], th[1], th[2] + 18]; let best = null, bs = 1e9;
  for (const side of [1, -1]) for (const reach of [330, 420]) {
    const g = groundAt(Math.round((th[0] + perp[0] * side * reach + ax[0] * 120) / 32) * 32, Math.round((th[1] + perp[1] * side * reach + ax[1] * 120) / 32) * 32, th[2]); if (!g || !visFrom(eye, [g[0], g[1], g[2] + 28])) continue;
    const sc = d3(g, m.o) + (side === m.flankSide ? -80 : 0); if (sc < bs) { bs = sc; best = g; m.flankSide = side; }
  }
  return best;
}
const FORM = [[-110, 120], [-110, -120], [-210, 0], [-190, 230], [-190, -230], [-300, 110], [-300, -110]];
function formationSpot(m, idx) {
  const pc = playerCenter(), r = yaw * Math.PI / 180, f = [Math.cos(r), Math.sin(r)], l = [-f[1], f[0]], o = FORM[idx % FORM.length];
  return [pc[0] + f[0] * o[0] + l[0] * o[1], pc[1] + f[1] * o[0] + l[1] * o[1], pc[2]];
}
function setRole(b, role, plan) { if (b.role !== role) { b.role = role; b.roleT = simTime + 2800; if (role !== 'follow') say(b, role); } b.plan = plan || null; }
function squadPlan() {
  const bots = BOT.bots.filter(b => !b.dead && !b.hidden); if (!bots.length) { BOT.plan = null; return; }
  const pc = playerCenter(), threats = squadThreats(bots);
  const hold = b => simTime < (b.roleT || 0) && b.role !== 'follow' && b.role !== 'investigate';
  if (!threats.length) {
    BOT.plan = { kind: 'patrol', label: 'Moving with you', n: 0 };
    bots.forEach((b, i) => { b.slot = i; const al = b.alert && simTime - b.alert.t < 6000; if (b.health < 50 && b.role === 'retreat') { if (simTime < b.roleT) return; } if (al && !PL.dead && d3(b.alert.p, pc) < 1200) setRole(b, 'investigate', { p: b.alert.p }); else if (!hold(b)) setRole(b, 'follow'); });
    return;
  }
  const th = threats[0], n = threats.length; BOT.plan = { kind: n > 3 ? 'assault' : 'engage', label: `${n} hostile${n > 1 ? 's' : ''} — ${th.seen ? 'in sight' : 'heard'}`, n, P: th.P };
  const hurt = [], able = [];
  for (const b of bots) (b.health < 38 || (b.role === 'retreat' && b.health < 62) ? hurt : able).push(b);
  hurt.forEach(b => setRole(b, 'retreat', { P: th.P }));
  able.sort((a, b) => d3(a.o, th.P) - d3(b.o, th.P));
  able.forEach((b, i) => {
    if (hold(b) && b.role !== 'retreat') { b.plan = { ...(b.plan || {}), P: th.P }; return; }
    if (i === 0 && (th.d > 200 || able.length === 1)) setRole(b, PL.health < 45 && able.length === 1 ? 'guard' : 'initiate', { P: th.P });
    else if (i === 1 && able.length > 2 || (i === 1 && able.length === 2 && n > 1)) setRole(b, 'flank', { P: th.P, F: flankPoint(b, th.P) });
    else if (PL.health < 50 || (i === able.length - 1 && able.length > 1)) setRole(b, 'guard', { P: th.P });
    else setRole(b, 'cover', { P: th.P, spot: findCover(b, th.P, 'support') });
  });
}
function allyThink(m, tg, spd) {
  const pc = playerCenter(), dPl = d3(m.o, pc), role = m.role || 'follow', plan = m.plan || {};
  if (dPl > 1100 || (dPl > 520 && !tg && simTime - (m.farT = m.farT || simTime) > 6000)) { const sp = coopSpot(); m.o = sp.o.slice(); m.ro = m.o.slice(); m.vel = [0, 0, 0]; updateBox(m); m.farT = 0; m.nav && (m.nav.path = null); addLight(m.o, 160, [.5, .7, 1], .4); }
  else if (dPl < 520) m.farT = 0;
  const fight = (dmin, dmax) => { // hold a fighting distance on the target and strafe
    if (simTime > (m.strafeT || 0)) { m.strafe = Math.random() < .5 ? 1 : -1; m.strafeT = simTime + 700 + Math.random() * 1200; }
    const want = yawTo(m.o, tg.P); let moved = false;
    if (tg.d > dmax) moved = botGo(m, tg.P, spd, false); else if (tg.d < dmin) moved = stepMove(m, want + 180, spd);
    else { moved = stepMove(m, want + 90 * m.strafe, spd * .9); if (!moved) { m.strafe = -m.strafe; moved = stepMove(m, want - 90 * m.strafe, spd * .9); } }
    return moved;
  };
  let moved = false, goal = null;
  switch (role) {
    case 'initiate': { const P = tg ? tg.P : plan.P; if (tg) moved = fight(240, 520); else if (P) { goal = P; moved = botGo(m, P, spd); } break; }
    case 'flank': {
      const F = plan.F; if (F && hdist(m.o, F) > 80 && !(tg && tg.d < 480)) { goal = F; moved = botGo(m, F, spd, !tg); }
      else if (tg) moved = fight(220, 560); else if (plan.P) { goal = plan.P; moved = botGo(m, plan.P, spd); } break;
    }
    case 'cover': {
      if (!plan.spot || simTime > (m.spotT || 0)) { plan.spot = plan.P ? findCover(m, plan.P, 'support') : null; m.spotT = simTime + 3500; m.plan = plan; }
      const s = plan.spot; if (s && hdist(m.o, s) > 50) { goal = s; moved = botGo(m, s, spd, !tg); } else if (tg && tg.d < 200) moved = stepMove(m, yawTo(m.o, tg.P) + 180, spd); break;
    }
    case 'guard': { // keep yourself between the player and the threat
      const T = (tg && tg.P) || plan.P; if (T) { const ax = nrm([T[0] - pc[0], T[1] - pc[1], 0]), s = groundAt(pc[0] + ax[0] * 110, pc[1] + ax[1] * 110, pc[2]); if (s && hdist(m.o, s) > 60) { goal = s; moved = botGo(m, s, spd, !tg); } } break;
    }
    case 'retreat': {
      const T = plan.P || (tg && tg.P); if (T) { if (!m.hideSpot || simTime > (m.hideT || 0) || visFrom([T[0], T[1], T[2] + 18], [m.o[0], m.o[1], m.o[2] + 28])) { m.hideSpot = findCover(m, T, 'hide'); m.hideT = simTime + 2500; }
        if (m.hideSpot && hdist(m.o, m.hideSpot) > 40) { goal = m.hideSpot; moved = botGo(m, m.hideSpot, spd * 1.05, !tg); } else if (!tg && simTime > (m.regenT || 0)) { m.regenT = simTime + 500; m.health = Math.min(70, m.health + 2); } } break; // behind cover, a bot catches its breath
    }
    case 'investigate': {
      const P = plan.P || (m.alert && m.alert.p); if (P && hdist(m.o, P) > 90 && simTime - (m.alert ? m.alert.t : 0) < 7000) { goal = P; moved = botGo(m, P, spd); if (tg) moved = fight(240, 520); } else { m.alert = null; setRole(m, 'follow'); } break;
    }
    default: { // follow: hold a formation spot beside and behind the player; fight what comes, but never stray far
      const S = formationSpot(m, m.slot || 0);
      if (tg && dPl < 650) moved = fight(200, 560); else if (hdist(m.o, S) > 70 || Math.abs(m.o[2] - S[2]) > 50) { goal = S; moved = botGo(m, S, spd, !tg); } else if (!tg) changeYaw(m, yaw, 20);
    }
  }
  if (moved) m.moveT = simTime;
  m.goalP = goal;
}
function squadInCombat() { return BOT.bots.some(b => !b.dead && !b.hidden && simTime - (b.combatT ?? -1e9) < 3500) || E.monsters.some(e => !e.bot && e.enemy && !e.dead && !e.hidden && !e.gibbed && BOT.bots.some(b => !b.dead && d3(b.o, e.o) < 700 && canSee(b, [e.o[0], e.o[1], e.o[2] + 4]))); }
const squadAlive = () => BOT.on && BOT.mode === 'coop' && BOT.bots.some(b => !b.dead && !b.hidden);
function coopRevive() { // the squad has cleared the fight: you come back beside the nearest living bot
  const bots = BOT.bots.filter(b => !b.dead && !b.hidden), pc = playerCenter(); bots.sort((a, b) => d3(a.o, pc) - d3(b.o, pc));
  const b = bots[0]; if (!b) return false; const c = b.o;
  let sp = null; for (let k = 0; k < 24 && !sp; k++) { const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 70, g = groundAt(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]); if (g && !Q.trace(g, [-16, -16, -24], [16, 16, 32], g, Q.MASK_PLAYERSOLID, true).allsolid) sp = { o: [g[0], g[1], g[2]], yaw: b.yaw }; }
  sp = sp || { o: [c[0], c[1], c[2] + 4], yaw: b.yaw };
  PL.dead = false; PL.health = 100; PL.maxHealth = Math.max(100, PL.maxHealth); PL.armor = 0; PL.armorFrac = 0; PL.quad = PL.invul = 0; $('dead').hidden = true; $('deadSub').textContent = 'click / fire / jump to respawn';
  ps.origin = [Math.round(sp.o[0] * 8), Math.round(sp.o[1] * 8), Math.round((sp.o[2] + 9) * 8)]; ps.velocity = [0, 0, 0]; ps.flags = 0; ps.time = 0;
  pm.mins = [-16, -16, -24]; pm.maxs = [16, 16, 32]; pm.viewheight = 22; vh = 22; Q.initialSnapPosition(); prevOrigin = ps.origin.slice(); yaw = sp.yaw; pitch = 0;
  play('respawn', .7); addLight(sp.o, 260, [.5, .8, 1], .6); toast(`${b.name}: Welcome back — we cleared it.`, 2800); return true;
}
function updateSquadHud() {
  const el = $('squad'); if (!el) return;
  if (!(BOT.on && BOT.mode === 'coop' && running)) { if (!el.hidden) el.hidden = true; return; }
  const bots = BOT.bots, lines = [];
  if (BOT.plan) lines.push('SQUAD · ' + BOT.plan.label.toUpperCase());
  for (const b of bots) lines.push(`${b.name.padEnd(9).slice(0, 9)} ${b.dead || b.hidden ? 'DOWN' : (ROLE_LABEL[b.role || 'follow'] || '').padEnd(11) + String(Math.max(0, Math.round(b.health))).padStart(3)}`);
  for (const l of BOT.log) if (simTime - l.t < 5000) lines.push('› ' + l.s);
  const t = lines.join('\n'); if (el.textContent !== t) el.textContent = t; el.hidden = false;
}

function botSteps(m) { // bots are heard moving: footsteps on the ground, a splash in water
  if (m.dead || m.hidden || !m.moveT || simTime - m.moveT > 250 || simTime < (m.stepT || 0)) return;
  const wet = Q.pointContents([m.o[0], m.o[1], m.o[2] - 16]) & Q.MASK_WATER; m.stepT = simTime + (wet ? 520 : 330 + Math.random() * 40);
  playAt(wet ? 'watrOut' : 'step' + (1 + (Math.random() * 4 | 0)), [m.o[0], m.o[1], m.o[2] - 20], wet ? .35 : .5, 1.3, 'bot', m);
}
function botThink(m) {
  const sk = S.skill, dm = [.7, 1, 1.35][sk], spd = m.mon.run * .1 * [.85, .95, 1.05][sk], acc = [.13, .085, .05][sk];
  if (!m.ally) botCollect(m);
  const tg = botTarget(m);
  if (tg && m.ally) m.combatT = simTime;
  botDoors(m);
  const hr = botHear(m);
  if (hr && !tg) { if (m.ally) m.alert = { p: hr.p.slice(), t: simTime }; else if (!(m.last && simTime - m.lastT < 2000)) { m.last = hr.p.slice(); m.lastT = simTime; } }
  if (m.wanderT > simTime) { changeYaw(m, m.wanderYaw, 30); if (stepMove(m, m.wanderYaw, spd)) m.moveT = simTime; return; }
  if (tg) {
    m.last = tg.P.slice(); m.lastT = simTime;
    const want = yawTo(m.o, tg.P); changeYaw(m, want, 50);
    if (simTime > (m.gunT || 0)) { m.wpn = tg.d < 340 ? 1 : !m.ally && tg.d < 1100 && tg.d > 220 && Math.random() < .6 ? 2 : 0; m.gunT = simTime + 1200; }
    const g = botGun(m), off = Math.abs(((want - m.yaw) % 360 + 540) % 360 - 180);
    if (simTime >= m.fireT && off < 22) {
      const spec = [g.spec[0], g.spec[1] * dm * (m.quad > simTime ? 4 : 1), g.spec[2]], P = tg.P.map((v, i) => v + crand() * tg.d * acc * (i === 2 ? .5 : 1));
      m.aimP = P.slice(); BOT.lastShooter = m; BOT.shooterT = simTime; monsterFire(m, spec, P);
      m.fireT = simTime + g.rate * [1.3, 1, .85][sk]; m.shotT = simTime;
    }
    // keep a fighting distance and strafe while doing it
    if (simTime > (m.strafeT || 0)) { m.strafe = Math.random() < .5 ? 1 : -1; m.strafeT = simTime + 700 + Math.random() * 1200; }
    let moved = false;
    if (m.ally) allyThink(m, tg, spd); else {
    if (m.health < 40 && tg.d < 1000 && (m.hideSpot = (simTime < (m.hideT || 0) && m.hideSpot) || findCover(m, tg.P, 'hide'))) { if (!(m.hideT > simTime)) m.hideT = simTime + 2500; moved = botGo(m, m.hideSpot, spd * 1.05, false); }
    else if (tg.d > (m.wpn === 1 ? 160 : 520)) moved = botGo(m, tg.P, spd, false);
    else if (tg.d < 170 && m.wpn !== 1) moved = stepMove(m, want + 180, spd);
    else { moved = stepMove(m, want + 90 * m.strafe, spd * .9); if (!moved) { m.strafe = -m.strafe; moved = stepMove(m, want - 90 * (m.strafe), spd * .9); } }
    if (moved) m.moveT = simTime; }
  } else if (m.ally) { allyThink(m, null, spd);
  } else {
    let goal;
    if (m.last && simTime - m.lastT < 3500 && d3(m.o, m.last) > 40) goal = m.last;
    else { if (!m.goal || simTime > m.goalT || d3(m.o, m.goal.o) < 40 || (m.goal.item && m.goal.item.taken)) botPickGoal(m); goal = m.goal.o; }
    changeYaw(m, yawTo(m.o, goal), 35);
    if (botGo(m, goal, spd)) m.moveT = simTime;
  }
  // stuck? shake loose in a random direction for a moment
  m.chkT = (m.chkT || 0) + 1;
  if (m.chkT >= 12) { if (m.chkP && d3(m.chkP, m.o) < 14 && !tg) { m.wanderT = simTime + 700; m.wanderYaw = Math.random() * 360; m.goal = null; m.last = null; } m.chkP = m.o.slice(); m.chkT = 0; }
}
function drawBot(m, vp, shade) {
  const o = m.ro, clock = realTime / 1000, moving = m.moveT && simTime - m.moveT < 260, shot = (simTime - (m.shotT || -1e9)) / 1000, wi = m.wpn || 0, g = botGun(m), P = m.pm;
  if (m.model && !P) return; // its model is still loading
  if (P && P.q3) {
    const legs = [moving ? QA.LEGS_RUN : QA.LEGS_IDLE, clock], torso = shot < .4 ? [QA.TORSO_ATTACK, shot] : [QA.TORSO_STAND, clock], X = q3PlayerMats(P, o, m.ryaw, 0, legs, torso);
    drawQ3Player(mainCtx, P, X, vp, shade); const V = VM3[g.q3]; if (V && V.w) md3Draw(mainCtx, V.w.inst, V.w.texs, 0, 0, 0, vp, X.Mw, shade, .6); return;
  }
  if (P && !P.q3) {
    const [fa, fb, ft] = shot < .8 ? animFrames(P.m, 'attack', shot, false) : animFrames(P.m, moving ? 'run' : 'stand', clock, true), M = entMat(o, m.ryaw, 0);
    md2Draw(mainCtx, P.inst, P.tex, fa, fb, ft, vp, M, shade);
    const wv = P.weps && P.weps[g.q2]; if (wv) md2Draw(mainCtx, wv.inst, wv.tex, fa, fb, ft, vp, M, shade); return;
  }
  const hue = (m.hue || 0) % 5, col = [[.6, .16, .14], [.15, .35, .6], [.2, .5, .22], [.55, .4, .12], [.4, .2, .55]][hue];
  const Pp = humanPose(o, m.ryaw, [-16, -16, -24], [16, 16, 32], builtinPose(clock, { move: moving ? 1 : 0, duck: false, air: false, fire: shot < .3, pitch: 0 }));
  drawFigure(vp, Pp, { ...botFig(m.hue), gunShape: ['mg', 'shotgun', 'rl'][m.wpn || 0], gunCol: [[.3, .3, .32], [.4, .3, .2], [.45, .2, .2]][m.wpn || 0] }, 1, true);
}
function drawItemShape(vp, M, it, time) { // built-in pickups: a medkit, a vest, a gun, an ammo crate, a glowing powerup
  const B = (x, y, z, sx, sy, sz, c, lit = 1, mesh = rbox) => drawSolid(vp, mesh, mul(M, trs(x, y, z, sx, sy, sz)), c, lit), p = [M[12], M[13], M[14]];
  if (it.quad || it.inv || it.adr) { const c = it.quad ? [.35, .5, 1] : it.inv ? [1, .8, .25] : [1, .35, .35]; B(0, 0, 2, 11, 11, 11, [...c, 1], .35, sphere); B(0, 0, 2, 16, 16, 1.2, [...c.map(v => v * .8), 1], 0, cyl); glows.push({ p: [p[0], p[1], p[2] + 2], s: 14, c: [...c, .5] }); return; }
  if (it.h) { const mega = it.h >= 100, big = it.h >= 25; if (mega) { B(0, 0, 0, 12, 12, 12, [.35, .55, 1, 1], .5, sphere); B(0, 0, 0, 3, 13, 3.5, [1, 1, 1, 1], 0); B(0, 0, 0, 3, 3.5, 13, [1, 1, 1, 1], 0); return; }
    const s = big ? 1.3 : it.h <= 10 ? .75 : 1; B(0, 0, 0, 10 * s, 12 * s, 8 * s, [.9, .92, .9, 1]); B(0, 0, 4.1 * s, 3 * s, 8 * s, .6, [.85, .1, .1, 1], .6); B(0, 0, 4.1 * s, 8 * s, 3 * s, .6, [.85, .1, .1, 1], .6); B(0, 0, -3.5 * s, 10.4 * s, 12.4 * s, 1.5, [.4, .42, .4, 1]); return; }
  if (it.a) { const c = it.a >= 100 ? [.85, .22, .18] : it.a >= 50 ? [.85, .75, .2] : it.a >= 25 ? [.35, .6, .3] : [.6, .6, .55], s = it.a < 5 ? .55 : 1;
    B(0, 0, 0, 5 * s, 12 * s, 13 * s, [...c, 1]); B(1, 0, 1, 4 * s, 9 * s, 8 * s, [...c.map(v => v * 1.25), 1]); for (const y of [-1, 1]) B(0, y * 6.5 * s, 5.5 * s, 6 * s, 4 * s, 3 * s, [...c.map(v => v * .8), 1]); return; }
  if (it.w !== undefined) { const gm = [.22, .23, .25, 1]; B(0, 0, 0, 20, 3.4, 4.4, gm); B(-7, 0, -1.5, 6, 3, 6, [.32, .26, .2, 1]); B(4, 0, 2.6, 9, 1.6, 1.4, [.55, .6, .65, 1]); B(-1, 0, -3.6, 2.6, 2.4, 4.4, gm); B(9, 0, 0, 3, 3.8, 3.8, [.9, .55, .15, 1], 0); return; }
  if (it.am || it.ammo) { for (const [x, y] of [[-3.2, -2.6], [3.2, -2.6], [-3.2, 2.6], [3.2, 2.6]]) B(x, y, 0, 6, 5, 7, [.42, .42, .28, 1]); B(0, 0, 3.8, 12.6, 10.6, 1, [.9, .7, .2, 1], .6); return; }
  B(0, 0, 0, 7, 7, 7, [.6, .6, .65, 1]); B(0, 0, 0, 8, 2, 2, [.9, .8, .3, 1], 0);
}
function drawBuiltinMonster(vp, m, M) { // no model files: a drone for the flyers, an armoured figure for everyone else
  const dir = m.mon.dir, t = realTime / 1000 + (m.hue || (m.hue = Math.random() * 10));
  if (RAG_BOX.has(dir) || m.mon.fly !== undefined || m.mon.swim) {
    const zc = (m.mmaxs[2] + m.mmins[2]) / 2 + Math.sin(t * 2.2) * 2, s = (m.mmaxs[0] - m.mmins[0]) * .62;
    drawDrone(vp, mul(M, trs(0, 0, zc, 1, 1, 1)), s, DRONE[dir] || (dir.startsWith('boss') ? { body: [.35, .36, .4], plate: [.55, .56, .62], visor: [1, .3, .15] } : DRONE.flyer), t); return;
  }
  const act = m.act, pose = builtinPose(t, { move: act === 'run' ? 1 : act === 'walk' ? .55 : 0, duck: act === 'duck', air: false, fire: act === 'attack' || act === 'melee', pitch: 0 });
  let Pp = humanPose(m.ro, m.ryaw, m.mmins, m.mmaxs, pose);
  if (m.dead) { const r = m.ryaw * Math.PI / 180, f = [Math.cos(r), Math.sin(r), 0], base = m.ro[2] + m.mmins[2]; Pp = Pp.map(p => { const d = sub3(p, m.ro), fx = Q.dot(d, f), zz = p[2] - base; return [m.ro[0] + d[0] - f[0] * (fx + zz), m.ro[1] + d[1] - f[1] * (fx + zz), base + 4 + Math.max(0, fx) * .3]; }); }
  let st = FIG[dir] || FIG.default; if (act === 'pain' && !m.dead) st = { ...st, body: st.body.map(v => Math.min(1, v + .35)) };
  drawFigure(vp, Pp, st, (m.mmaxs[2] - m.mmins[2]) / 56, !m.dead);
}
function runMonsters(msec) {
  const dt = msec / 1000;
  if (BOT.on) updateBots();
  for (const m of E.monsters) {
    if (m.gibbed || m.hidden) continue;
    monsterPhysics(m, dt);
    m.thinkT -= msec; if (m.thinkT > 0) continue; m.thinkT += 100;
    monsterThink(m);
  }
}

function setupSpeaker(e) {
  let n = e.kv.noise; if (!n) return; if (!/\.wav$/i.test(n)) n += '.wav'; if (/^sound\//i.test(n)) n = '#' + n.toLowerCase();
  const at = e.kv.attenuation === undefined ? 1 : +e.kv.attenuation === -1 ? 0 : (+e.kv.attenuation || 1);
  const sp = { path: n, p: e.origin, vol: +e.kv.volume || 1, attn: at, loop: !!(e.spawnflags & 3), startOn: !!(e.spawnflags & 1) };
  speakers.push(sp);
  e.use = () => { if (sp.loop) { if (sp.want) speakerOff(sp); else speakerOn(sp); } else playPathAt(sp.path, sp.p, sp.vol, sp.attn); };
}
let lastWL = 0, rippleT = 0, bubbleT = 0;
function preloadWorldSounds() { if (E) preload([...speakers.map(sp => sp.path), ...E.monsters.flatMap(m => Object.values(m.mon.snd || {})), ...E.items.flatMap(e => { const k = Q2_TO_Q3_ITEM[e.cls] || Q2_TO_Q3_EXTRA[e.cls], q = k && ITEMS_Q3[k]; return [e.item.s || 'items/pkup.wav', q && q.s, q && 'misc/w_pkup.wav', q && 'misc/am_pkup.wav'].filter(Boolean); }), 'misc/w_pkup.wav', 'misc/am_pkup.wav', sexed('pain100_1.wav'), sexed('pain75_1.wav'), sexed('pain50_1.wav'), sexed('pain25_1.wav'), sexed('death1.wav')]); }
function tick(msec) {
  if (loadingMap) return;
  prevOrigin = ps.origin.slice();
  runEntities(msec);
  tickRagdolls(msec);
  cmdFromInput(msec);
  if (PL.dead) { const c = pm.cmd; c.forwardmove = c.sidemove = c.upmove = 0; if (spLike()) {
    if (squadAlive() && simTime - PL.deadT < 180000) { // your squad is still fighting: you stay down until the area is clear, then rejoin beside them
      if (PL.calmT === undefined || PL.calmT < PL.deadT) PL.calmT = PL.deadT;
      const fighting = squadInCombat(); if (fighting) PL.calmT = simTime;
      $('deadSub').textContent = fighting ? 'your squad is still in combat — hold on…' : 'your squad is securing the area…';
      if (!loadingMap && simTime - PL.deadT > 1400 && simTime - PL.calmT > 2500) coopRevive();
    } else if (simTime - PL.deadT > 1400 && !loadingMap) { $('deadSub').textContent = 'click / fire / jump to respawn'; showDeathMenu(); }
  } else if (simTime - PL.deadT > 1000 && (attackHeld() || keys.has('Space') || touch.jump)) respawnPlayer(); }
  else if (spLike() && simTime - SAVE.lastAuto > 60000 && PL.health >= 25 && (ps.flags & Q.PMF_ON_GROUND) && !ps.noclip) autosave('Checkpoint');
  pm.q3 = q3Mode();
  if (pm.q3 && !PL.dead && simTime >= (PL.decayT || 0)) { PL.decayT = simTime + 1000; if (PL.health > PL.maxHealth) PL.health--; if (PL.armor > PL.maxHealth) PL.armor--; } // Q3 counts extra health and armor down
  const wasGround = !!(ps.flags & Q.PMF_ON_GROUND), oldVz = ps.velocity[2] / 8, oldZ = ps.origin[2];
  Q.pmove();
  const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8;
  if (!ps.noclip) {
    if (wasGround && !pm.ground && pm.cmd.upmove >= 10 && pm.waterlevel === 0) play('jump', 0.6);
    if (!wasGround && pm.ground && oldVz < 0) { // P_FallingDamage
      let delta = oldVz * oldVz * 0.0001; if (pm.waterlevel === 3) delta = 0; else if (pm.waterlevel === 2) delta *= .25; else if (pm.waterlevel === 1) delta *= .5;
      if (delta > 7) { W3.landT = simTime; W3.landChange = delta > 60 ? -24 : delta > 40 ? -16 : -8; }
      if (pm.q3) { // PM_CrashLand + G_FallDamage: 10 for a far fall, 5 for a medium one, nothing else
        if (ps.flags & Q.PMF_DUCKED) delta *= 2;
        if (delta > 60) { play('fall1', .9); damagePlayer(10, null, true); } else if (delta > 40) { play('fall2', .9); damagePlayer(5, null, true); }
        else if (delta > 7) play('land', .8); else if (delta >= 1) play('step' + (1 + (Math.random() * 4 | 0)), 0.5);
      } else if (delta >= 1 && delta < 15) play('step' + (1 + (Math.random() * 4 | 0)), 0.5); else if (delta >= 15 && delta <= 30) play('land', .8);
      else if (delta > 30) { play(delta >= 55 ? 'fall1' : 'fall2', .9); damagePlayer(Math.max(1, (delta - 30) / 2), null, true); }
    }
    const po = ps.origin.map(v => v / 8), feet = [po[0], po[1], po[2] + pm.mins[2] + 1];
    if (pm.waterlevel && !lastWL) { const sp = surfaceBetween(feet, [po[0], po[1], po[2] + 64]); fxSplash(sp || po, Math.max(.35, -oldVz / 420), liquidAt(feet)); }
    else if (!pm.waterlevel && lastWL) { play('watrOut', .7); const sp = surfaceBetween([po[0], po[1], po[2] + pm.mins[2] - 6], [po[0], po[1], po[2] + pm.mins[2] + 40]); if (sp) fxSplash(sp, .3, 1, true); }
    if (pm.waterlevel === 3 && lastWL !== 3) play('watrUn', .6);
    if (pm.waterlevel >= 1 && pm.waterlevel < 3 && xy > 50 && simTime > rippleT) { rippleT = simTime + 160; const sp = surfaceBetween(feet, [po[0], po[1], po[2] + 64]); if (sp) { fxRipple(sp, .5 + xy / 600); if (Math.random() < .3) fxSplash(sp, .15, liquidAt(feet), true); } }
    if (pm.waterlevel === 3 && simTime > bubbleT) { bubbleT = simTime + rnd(900, 2000); fxBubbles([po[0], po[1], po[2] + pm.viewheight], 5, 3); }
    if (wasGround && pm.ground) { const dz = (ps.origin[2] - oldZ) / 8; if (dz > 7.9 && dz < 20) { stepAmt = dz + Math.max(0, stepAmt * (1 - (simTime - stepTime) / 100)); stepTime = simTime; } }
    if (pm.ground && xy > 225) { stepTimer += msec; if (stepTimer >= 400) { stepTimer -= 400; play('step' + (1 + (Math.random() * 4 | 0)), 0.35); } } else stepTimer = 300;
  }
  lastWL = pm.waterlevel;
  airTime = pm.ground || pm.waterlevel >= 2 ? 0 : airTime + msec;
  if (xy > topSpeed) topSpeed = xy;
  touchTriggers();
  touchItems();
  runMonsters(msec);
  if (!PL.dead) (S.wset === 'q3' ? weaponTickQ3 : weaponTick)(msec);
  updateProjectiles(msec);
  updateDebris(msec);
  simTime += msec;
}

// ---------- matrices ----------
function perspective(fovy, aspect, n, f) { const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16); m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; }
function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function viewMat(e, f, r, u) { return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -Q.dot(r, e), -Q.dot(u, e), Q.dot(f, e), 1]); }
function trs(x, y, z, sx, sy, sz) { return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]); }
function basis(o, f, l, u) { return new Float32Array([f[0], f[1], f[2], 0, l[0], l[1], l[2], 0, u[0], u[1], u[2], 0, o[0], o[1], o[2], 1]); }
function entMat(o, y, p) { const f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0]; Q.angleVectors([p, y, 0], f, r, u); return basis(o, f, [-r[0], -r[1], -r[2]], u); }

// ---------- characters ----------
let mainCtx = null, player = null, charToken = 0; let VM = [], PM = {};
async function refreshCharacter() {
  if (!gl) return; const tok = ++charToken;
  if (!mainCtx) mainCtx = makeCtx(gl);
  let models = [], skins = [], p = null;
  if (S.pset === 'q3') {
    models = listQ3Models(); if (models.length && !models.includes(S.model3)) S.model3 = models.includes('sarge') ? 'sarge' : models[0];
    skins = models.length ? listQ3Skins(S.model3) : []; if (skins.length && !skins.includes(S.skin3)) S.skin3 = skins.includes('default') ? 'default' : skins[0];
    if (models.length) { await loadShaderScripts(); p = await loadQ3Player(mainCtx, S.model3, S.skin3); }
  } else if (S.pset === 'q2') {
    models = listPlayerModels(); if (models.length && !models.includes(S.model)) S.model = models.includes('male') ? 'male' : models[0];
    skins = listSkins(S.model); if (skins.length && !skins.includes(S.skin)) S.skin = skins.includes('grunt') ? 'grunt' : skins[0];
    if (models.length) p = await loadCharacter(mainCtx, S.model, S.skin);
  }
  const vm = []; for (const d of WEAPONS) vm.push(await loadSimple(mainCtx, 'models/weapons/' + d.v + '/tris.md2'));
  const pmods = {};
  for (const [k, path] of Object.entries({ rocket: 'objects/rocket', grenade: 'objects/grenade', grenade2: 'objects/grenade2', laser: 'objects/laser', barrel: 'objects/barrels', debris1: 'objects/debris1', debris2: 'objects/debris2', debris3: 'objects/debris3' })) pmods[k] = await loadSimple(mainCtx, 'models/' + path + '/tris.md2');
  await loadShaderScripts();
  const vm3 = await loadQ3WeaponModels(mainCtx), pm3 = { rocket: await loadMD3Simple(mainCtx, 'models/ammo/rocket/rocket.md3'), grenade: await loadMD3Simple(mainCtx, 'models/ammo/grenade1.md3'), nail: await loadMD3Simple(mainCtx, 'models/weaphits/nail.md3'), prox: await loadMD3Simple(mainCtx, 'models/weaphits/proxmine.md3') };
  if (tok !== charToken) return;
  player = p; VM = vm; PM = Object.assign(PM, pmods); VM3 = vm3; PM3 = pm3;
  renderCharUI(models, skins);
  refreshPreview();
}
function drawHeld(vp, M, shade) { if (S.wset === 'q3' && drawQ3Weapon(mainCtx, W3.cur, M, vp, shade, false)) return; const d = curSet()[curW().cur]; drawSolid(vp, cube, mul(M, trs(8, 0, 0, 9, 1.6, 1.6)), [...d.col, 1]); }
function drawPlayerBody(vp, o, shade) {
  if (S.pset === 'q3' && player && player.q3) { const [legs, torso] = q3PlayerAnim(), X = q3PlayerMats(player, o, yaw, pitch, legs, torso); drawQ3Player(mainCtx, player, X, vp, shade); drawHeld(vp, X.Mw, shade); return; }
  if (S.pset === 'q2' && player && !player.q3) {
    const [an, at, loop] = playerAnim(), [fa, fb, ft] = animFrames(player.m, an, at, loop), M = entMat(o, yaw, pitch / 3);
    md2Draw(mainCtx, player.inst, player.tex, fa, fb, ft, vp, M, shade);
    const wv = S.wset === 'q2' && player.weps[W.cur]; if (wv) md2Draw(mainCtx, wv.inst, wv.tex, fa, fb, ft, vp, M, shade); else drawHeld(vp, mul(M, trs(6, -7, 8, 1, 1, 1)), shade);
    return;
  }
  const P = builtinPlayerPoints(o), wd = curSet()[curW().cur] || {}; drawFigure(vp, P, wd.grenade ? FIG.player : { ...FIG.player, gunShape: GUN_OF[wd.name] || 'mg', gunCol: wd.col }, 1, !wd.grenade);
  const hx = nrm(sub3(P[9], P[8])), hy = nrm(Q.cross([0, 0, 1], hx)); drawHeld(vp, basis(P[9], hx, hy, Q.cross(hx, hy)), shade);
}
function playerAnim() {
  const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8, duck = ps.flags & Q.PMF_DUCKED, since = (simTime - lastFire) / 1000, clock = realTime / 1000;
  if (PL.dead) return ['death1', (simTime - PL.deadT) / 1000, false];
  if (duck) { if (since < 0.9) return ['crattak', since, false]; return [xy > 20 ? 'crwalk' : 'crstnd', clock, true]; }
  if (since < 0.8) return ['attack', since, false];
  if (airTime > 120) return ['jump', 0.12, false];
  return [xy > 20 ? 'run' : 'stand', clock, true];
}

// ---------- rendering ----------
let realTime = 0, attract = false; // attract: the slow fly-around behind the title screen
let solidFrame = -1, vmSpin = 0;
function drawSolid(vp, mesh, M, color, lit = 1) {
  gl.useProgram(solidP.p);
  if (solidFrame !== realTime) { solidFrame = realTime; gl.uniform3fv(solidP.u.uEye, curEye); gl.uniform4fv(solidP.u['uDL[0]'], DLP); gl.uniform3fv(solidP.u['uDLC[0]'], DLC); gl.uniform1i(solidP.u.uNDL, nDL); }
  gl.uniformMatrix4fv(solidP.u.uMVP, false, mul(vp, M)); gl.uniformMatrix4fv(solidP.u.uM, false, M);
  if (POWV[3] > 0) { const a = POWV[3], w = .5 + .5 * Math.sin(realTime / 1000 * 7 + M[12] * .07 + M[13] * .05 + M[14] * .1); color = [0, 1, 2].map(i => Math.min(1.4, color[i] * (1 + POWV[i] * .9 * a) + POWV[i] * a * (.2 + .45 * w))).concat(color[3]); } // powerup glow on box-built models
  gl.uniform4fv(solidP.u.uColor, color); gl.uniform1f(solidP.u.uLit, lit);
  gl.bindVertexArray(mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
}
function drawBatches(list) {
  const ms = world.mstate;
  for (const b of list) {
    let off = Z3; if (b.model) { const s = ms[b.model]; if (s) { if (!s.visible) continue; off = s.o; } }
    gl.uniform3fv(worldP.u.uOff, off);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, b.anim ? b.anim[Math.floor(realTime / 1000 * b.animFps) % b.anim.length] : b.tex);
    gl.uniform1i(worldP.u.uWarp, b.warp ? 1 : 0); gl.uniform1f(worldP.u.uAlpha, b.alpha);
    gl.uniform1i(worldP.u.uLiquid, b.liquid || 0); gl.uniform1f(worldP.u.uAlphaTest, b.alphaTest ? .5 : 0); gl.uniform1i(worldP.u.uTexAlpha, b.texAlpha ? 1 : 0); gl.uniform2fv(worldP.u.uScroll, b.scroll || [0, 0]);
    if (b.polyOff) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2); }
    gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, b.start * 4);
    if (b.polyOff) gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}
function drawPlaceholder(vp, o, y) {
  const M0 = entMat(o, y, 0), part = (x, yy, z, sx, sy, sz, c) => drawSolid(vp, cube, mul(M0, trs(x, yy, z, sx, sy, sz)), c, 1);
  const duck = ps.flags & Q.PMF_DUCKED, dz = duck ? -18 : 0;
  part(0, 6, -12 + dz / 2, 4, 4, duck ? 6 : 12, [.3, .32, .28, 1]); part(0, -6, -12 + dz / 2, 4, 4, duck ? 6 : 12, [.3, .32, .28, 1]);
  part(0, 0, 10 + dz, 6, 10, 12, [.45, .38, .22, 1]); part(1, 0, 27 + dz, 5, 5, 5, [.75, .6, .5, 1]);
  part(10, -9, 12 + dz, 10, 2, 2, [...WEAPONS[W.cur].col, 1]);
}
// dynamic lights shared by the world and MD2 shaders
let curEye = [0, 0, 0];
const DLP = new Float32Array(32), DLC = new Float32Array(24); let nDL = 0;
function gatherLights(eye) {
  const L = [];
  for (const d of dlights) { const k = 1 - d.age / d.life; L.push({ p: d.p, r: d.r * (.35 + .65 * k), c: d.c.map(x => x * k) }); }
  for (const pr of projs) {
    if (pr.type === 'rocket') L.push({ p: pr.p, r: 220, c: [1, .6, .25] });
    else if (pr.type === 'bolt') L.push({ p: pr.p, r: 180, c: [1, .85, .3] });
    else if (pr.type === 'bfg' || pr.type === 'bfg3') L.push({ p: pr.p, r: 320, c: [.3, 1.1, .3] });
    else if (pr.type === 'plasma') L.push({ p: pr.p, r: 130, c: [.4, .5, 1.2] });
  }
  L.sort((a, b) => (Math.hypot(a.p[0] - eye[0], a.p[1] - eye[1], a.p[2] - eye[2]) - a.r) - (Math.hypot(b.p[0] - eye[0], b.p[1] - eye[1], b.p[2] - eye[2]) - b.r));
  nDL = Math.min(8, L.length);
  const keep = L.slice(0, nDL).map(l => ({ p: l.p, r: l.r, c: l.c.slice() }));
  for (let j = nDL; j < L.length; j++) { // no popping when a ninth light shows up
    const x = L[j]; let bi = -1, bd = 1e9; keep.forEach((k, i) => { const d = Math.hypot(k.p[0] - x.p[0], k.p[1] - x.p[1], k.p[2] - x.p[2]); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) continue; const k = keep[bi], w = Math.max(0, 1 - bd / (k.r + x.r)) * Math.min(1, x.r / k.r);
    for (let c = 0; c < 3; c++) k.c[c] += x.c[c] * w;
  }
  for (let i = 0; i < nDL; i++) { DLP.set([...keep[i].p, keep[i].r], i * 4); DLC.set(keep[i].c, i * 3); }
}
// particle + decal GPU buffers
let partVao = null, partBuf = null, decalVao = null, decalBuf = null, decalCount = 0, partData = new Float32Array(10 * 4096);
function initFxGL() {
  partVao = gl.createVertexArray(); gl.bindVertexArray(partVao);
  const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  [[1, 4, 0], [2, 4, 16], [3, 2, 32]].forEach(([loc, n, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 40, off); gl.vertexAttribDivisor(loc, 1); });
  decalVao = gl.createVertexArray(); gl.bindVertexArray(decalVao);
  decalBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, decalBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
}
function drawParticles(vp, r, u, blend) {
  let n = 0; const push = (p, size, c, kind, seed) => {
    if (n * 10 + 10 > partData.length) { const nd = new Float32Array(partData.length * 2); nd.set(partData); partData = nd; }
    partData.set([p[0], p[1], p[2], size, c[0], c[1], c[2], c[3], kind, seed], n * 10); n++;
  };
  for (const q of parts) { if (q.age < 0 || (q.blend || 0) !== blend) continue; const t = q.age / q.life; push(q.p, q.size0 + (q.size1 - q.size0) * t, partColor(q, t), q.kind, q.seed); }
  if (blend === 0) for (const g of glows) push(g.p, g.s, g.c, 0, 0);
  if (!n) return;
  gl.useProgram(partP.p); gl.uniformMatrix4fv(partP.u.uVP, false, vp); gl.uniform3fv(partP.u.uR, r); gl.uniform3fv(partP.u.uU, u); gl.uniform3fv(partP.u.uEye, curEye);
  gl.bindVertexArray(partVao); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf); gl.bufferData(gl.ARRAY_BUFFER, partData.subarray(0, n * 10), gl.STREAM_DRAW);
  gl.blendFunc(gl.SRC_ALPHA, blend === 0 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
}
function drawDecals(vp) {
  if (decalsDirty) { let n = 0; for (const q of decals) n += q.length; const d = new Float32Array(n * 6); let k = 0; for (const q of decals) for (const v of q) d.set(v, (k++) * 6); gl.bindBuffer(gl.ARRAY_BUFFER, decalBuf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW); decalCount = n; decalsDirty = false; }
  if (!decalCount) return;
  gl.useProgram(decalP.p); gl.uniformMatrix4fv(decalP.u.uVP, false, vp);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
  gl.bindVertexArray(decalVao); gl.drawArrays(gl.TRIANGLES, 0, decalCount);
  gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND);
}
function aimMat(p, v) { const yw = Math.atan2(v[1], v[0]) * 180 / Math.PI, pt = -Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180 / Math.PI; return entMat(p, yw, pt); }
function render(alpha, dt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W2 = Math.floor(cv.clientWidth * dpr), Hh = Math.floor(cv.clientHeight * dpr);
  if (cv.width !== W2 || cv.height !== Hh) { cv.width = W2; cv.height = Hh; }
  gl.viewport(0, 0, W2, Hh); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!world) return;
  if (!partVao) initFxGL();
  const o = [0, 1, 2].map(i => (prevOrigin[i] + (ps.origin[i] - prevOrigin[i]) * alpha) / 8);
  vh += ((PL.dead ? -8 : pm.viewheight) - vh) * Math.min(1, dt * (PL.dead ? 4 : 18));
  let sz = 0; const sd = simTime - stepTime; if (sd < 100) sz = -stepAmt * (100 - sd) / 100;
  let head = [o[0], o[1], o[2] + vh + sz];
  const aspect = W2 / Hh, fovy = 2 * Math.atan(Math.tan(S.fov * Math.PI / 360) * 0.75);
  // half the size of the near clip plane: a camera needs at least this much room or it sees through the wall beside it
  const camR = 4 * Math.tan(fovy / 2) * Math.hypot(aspect, 1) + 1, cb = [-camR, -camR, -camR], cB = [camR, camR, camR];
  const camTrace = (a, b) => { let t = Q.trace(a, cb, cB, b, Q.MASK_SOLID, true); if (t.startsolid) t = Q.trace(a, [-2, -2, -2], [2, 2, 2], b, Q.MASK_SOLID, true); return t.startsolid ? a : t.endpos; };
  if (PL.dead && PL.rag) { // death cam: lift from the chest toward the head, stopping short of walls
    const P = PL.rag.pts, base = [P[2][0], P[2][1], P[2][2] + 2], hp = P[0];
    head = camTrace(base, [hp[0], hp[1], hp[2] + 6]);
  }
  const f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0]; Q.angleVectors([Math.max(-89, Math.min(89, pitch + kickP)), yaw, 0], f, r, u);
  let eye = head;
  if (S.third) { // pulls in at once when something gets between you and the camera, eases back out
    const dv = [-f[0] * 90, -f[1] * 90, -f[2] * 90 + 14], want = head.map((v, i) => v + dv[i]), hit = camTrace(head, want);
    const frac = Math.hypot(...hit.map((v, i) => v - head[i])) / 90.2; thirdFrac = frac < thirdFrac ? frac : Math.min(frac, thirdFrac + dt * 2.5);
    eye = head.map((v, i) => v + dv[i] * thirdFrac);
  } else thirdFrac = 1;
  if (shake > .05) eye = camTrace(eye, eye.map(v => v + crand() * shake));
  const view = viewMat(eye, f, r, u), vp = mul(perspective(fovy, aspect, 4, 16384), view);
  const time = realTime / 1000;
  updateListener(eye, f, u); hurtA *= Math.exp(-dt * 2.2);
  gatherLights(eye); glows.length = 0; curEye = eye;
  // sky
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.useProgram(skyP.p); gl.uniformMatrix4fv(skyP.u.uMVP, false, vp); gl.uniform3fv(skyP.u.uEye, eye); gl.uniform1f(skyP.u.uTime, time);
  gl.uniform1i(skyP.u.uHasSky, world.skyTex ? 1 : world.skyCloud ? 2 : 0); gl.uniform1i(skyP.u.uSky, 2); gl.uniform1i(skyP.u.uCloud, 3);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, world.skyCloud || null);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, world.skyTex || null);
  gl.uniform1f(skyP.u.uScale, 100); gl.uniform3fv(skyP.u.uOff, eye); gl.bindVertexArray(cube.vao); gl.drawArrays(gl.TRIANGLES, 0, cube.n);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.bindVertexArray(world.vao);
  if (world.sky.length) { gl.uniform1f(skyP.u.uScale, 1); for (const b of world.sky) { const s = b.model && world.mstate[b.model]; if (s && !s.visible) continue; gl.uniform3fv(skyP.u.uOff, s ? s.o : Z3); gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, b.start * 4); } }
  gl.useProgram(worldP.p); gl.uniformMatrix4fv(worldP.u.uMVP, false, vp); gl.uniform1f(worldP.u.uBright, S.bright); gl.uniform1f(worldP.u.uTime, time);
  gl.uniform4fv(worldP.u['uDL[0]'], DLP); gl.uniform3fv(worldP.u['uDLC[0]'], DLC); gl.uniform1i(worldP.u.uNDL, nDL); gl.uniform3fv(worldP.u.uEye, eye);
  gl.uniform1i(worldP.u.uTex, 0); gl.uniform1i(worldP.u.uLMap, 1); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, world.lmTex);
  drawBatches(world.opaque);
  drawDecals(vp);
  const shade = 0.55 + 0.25 * S.bright;
  if (S.third && !PL.dead && !attract) { POWV = powVec(PL.quad, PL.invul); drawPlayerBody(vp, o, shade); POWV = POW0; }
  for (const e of E.barrels) {
    if (e.dead) continue; const b = e.box;
    if (PM.barrel) md2Draw(mainCtx, PM.barrel.inst, PM.barrel.tex, 0, 0, 0, vp, entMat([(b.mins[0] + b.maxs[0]) / 2, (b.mins[1] + b.maxs[1]) / 2, b.mins[2]], 0, 0), shade, .5);
    else { const c = [(b.mins[0] + b.maxs[0]) / 2, (b.mins[1] + b.maxs[1]) / 2, b.mins[2] + 20], U = basis(c, [0, 0, 1], [1, 0, 0], [0, 1, 0]); // a steel drum with hazard bands
      drawSolid(vp, cyl, mul(U, trs(0, 0, 0, 39, 28, 28)), [.52, .18, .12, 1]); for (const z of [-12, 12]) drawSolid(vp, cyl, mul(U, trs(z, 0, 0, 3, 29.5, 29.5)), [.22, .1, .08, 1]); drawSolid(vp, cyl, mul(U, trs(4, 0, 0, 7, 28.6, 28.6)), [.92, .72, .14, 1]); drawSolid(vp, cyl, mul(U, trs(19.6, 0, 0, 1, 20, 20)), [.3, .3, .3, 1]); }
  }
  for (const rd of ragdolls) if (rd !== PL.rag || S.third || !PL.dead) drawRagdoll(rd, vp, shade);
  for (const m of E.monsters) {
    if (m.hidden || m.gibbed) continue;
    if (m.rag) { if (ragdolls.indexOf(m.rag) < 0) drawRagdoll(m.rag, vp, shade); continue; }
    const jump = Math.hypot(m.o[0] - m.ro[0], m.o[1] - m.ro[1], m.o[2] - m.ro[2]) > 96, k = jump ? 1 : Math.min(1, dt * 14);
    for (let i = 0; i < 3; i++) m.ro[i] += (m.o[i] - m.ro[i]) * k;
    m.ryaw += (((m.yaw - m.ryaw) % 360 + 540) % 360 - 180) * Math.min(1, dt * 12);
    if (m.bot) { POWV = powVec(m.quad || 0, m.inv || 0); drawBot(m, vp, shade); POWV = POW0; continue; }
    const mm = MM[m.mon.dir], M = entMat(m.ro, m.ryaw, 0);
    if (mm) { const ft = Math.max(0, Math.min(1, (100 - m.thinkT) / 100)), sk = mm.skins[m.mon.skin + (m.health < m.maxHealth / 2 ? 1 : 0)] || mm.skins[m.mon.skin] || mm.skins[0]; md2Draw(mainCtx, mm.inst, sk, m.oldFrame, m.frame, ft, vp, M, shade, .45); }
    else {
      drawBuiltinMonster(vp, m, M);
    }
  }
  for (const e of E.items) {
    if (e.taken || e.hidden) continue;
    const vis = itemDef(e);
    if (Array.isArray(vis.m)) { const M = entMat([e.o[0], e.o[1], e.o[2] + 4 + Math.cos(time * 2.5 + e.o[0] * .01) * 4], (time * 175) % 360, 0); let any = false; for (const p of vis.m) { const im = IM[p]; if (im) { md3Draw(mainCtx, im.inst, im.texs, 0, 0, 0, vp, M, shade * 1.1, .6); any = true; } } if (any) continue; }
    const im = IM['models/' + e.item.m + '/tris.md2'], M = entMat(e.o, (time * 180) % 360, 0);
    if (im) md2Draw(mainCtx, im.inst, im.tex, 0, 0, 0, vp, M, shade * 1.1, .6);
    else drawItemShape(vp, mul(M, trs(0, 0, -4 + Math.sin(time * 3) * 2, 1, 1, 1)), e.item, time);
  }
  for (const c of debris) {
    const k = Math.min(1, (c.life - c.age) * 2), M = mul(entMat(c.p, c.a[1], c.a[0]), trs(0, 0, 0, k, k, k)), m = PM[c.model];
    if (m) md2Draw(mainCtx, m.inst, m.tex, 0, 0, 0, vp, M, shade, .5); else drawSolid(vp, cube, mul(M, trs(0, 0, 0, c.size, c.size * .7, c.size * .5)), [...c.col, 1]);
  }
  for (const pr of projs) {
    if (pr.type === 'plasma') { glows.push({ p: pr.p, s: 8, c: [.45, .55, 1, .9] }); glows.push({ p: pr.p, s: 3, c: [.9, .95, 1, 1] }); continue; }
    if (pr.type === 'bfg3') { glows.push({ p: pr.p, s: 20, c: [.3, 1, .3, .8] }); glows.push({ p: pr.p, s: 8, c: [.9, 1, .9, 1] }); continue; }
    if (pr.type === 'rocket' && pr.q3 && PM3.rocket) { md3Draw(mainCtx, PM3.rocket.inst, PM3.rocket.texs, 0, 0, 0, vp, aimMat(pr.p, pr.v), 1.2, .7); glows.push({ p: pr.p, s: 12, c: [1, .6, .2, .55] }); continue; }
    if (pr.type === 'nail') { if (PM3.nail) md3Draw(mainCtx, PM3.nail.inst, PM3.nail.texs, 0, 0, 0, vp, aimMat(pr.p, pr.v), shade, .7); else drawSolid(vp, cube, mul(aimMat(pr.p, pr.v), trs(0, 0, 0, 3, .4, .4)), [.75, .72, .65, 1]); continue; }
    if (pr.type === 'prox') {
      const M = aimMat(pr.p, pr.stuck ? pr.n : pr.stuckTo ? [0, 0, 1] : pr.v);
      if (PM3.prox) md3Draw(mainCtx, PM3.prox.inst, PM3.prox.texs, 0, 0, 0, vp, M, shade, .5); else drawSolid(vp, cube, mul(M, trs(0, 0, 0, 2.5, 3, 3)), [.35, .3, .28, 1]);
      if (pr.armed || pr.stuckTo) { const on = pr.trigAt || pr.stuckTo ? (time * 8 | 0) & 1 : (time * 1.5 | 0) & 1; if (on) glows.push({ p: pr.p.map((v, k) => v + (pr.n || [0, 0, 1])[k] * 3), s: 3, c: [1, .15, .1, .9] }); }
      continue;
    }
    if (pr.type === 'grenade' && pr.q3 && PM3.grenade) { md3Draw(mainCtx, PM3.grenade.inst, PM3.grenade.texs, 0, 0, 0, vp, entMat(pr.p, pr.spin += 0, 0), shade, .5); continue; }
    if (pr.type === 'rocket') { if (PM.rocket) md2Draw(mainCtx, PM.rocket.inst, PM.rocket.tex, 0, 0, 0, vp, aimMat(pr.p, pr.v), 1.2, .7); glows.push({ p: pr.p, s: 12, c: [1, .6, .2, .55] }); }
    else if (pr.type === 'grenade') { const m = pr.hand ? PM.grenade2 : PM.grenade, M = entMat(pr.p, pr.spin, pr.spin * .7); if (m) md2Draw(mainCtx, m.inst, m.tex, 0, 0, 0, vp, M, shade, .5); else drawSolid(vp, sphere, trs(pr.p[0], pr.p[1], pr.p[2], 3, 3, 3), [.25, .3, .2, 1]); }
    else if (pr.type === 'bolt') { if (PM.laser) md2Draw(mainCtx, PM.laser.inst, PM.laser.tex, 0, 0, 0, vp, aimMat(pr.p, pr.v), 1.6, 1); glows.push({ p: pr.p, s: 9, c: [1, .85, .3, .8] }); glows.push({ p: pr.p, s: 3, c: [1, 1, .9, 1] }); }
    else if (pr.type === 'bfg') { const pu = 1 + .15 * Math.sin(time * 30); glows.push({ p: pr.p, s: 34 * pu, c: [.3, 1, .3, .7] }); glows.push({ p: pr.p, s: 14, c: [.9, 1, .9, 1] }); }
  }
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  if (world.trans.length) { gl.useProgram(worldP.p); gl.bindVertexArray(world.vao); drawBatches(world.trans); }
  if (world.add && world.add.length) { gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(worldP.p); gl.bindVertexArray(world.vao); drawBatches(world.add); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  drawLgBeam(vp); gl.useProgram(partP.p);
  drawParticles(vp, r, u, 1);
  drawParticles(vp, r, u, 0);
  gl.disable(gl.BLEND); gl.depthMask(true);
  // first-person weapon
  if (!S.third && !PL.dead && S.viewmodel !== false && !attract) {
    gl.clear(gl.DEPTH_BUFFER_BIT); POWV = powVec(PL.quad, PL.invul);
    const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8;
    if (pm.ground && !ps.noclip) bobT += dt * Math.min(xy, 320) / 320 * 9;
    const amt = Math.min(1, xy / 300), bx = Math.sin(bobT) * 0.5 * amt, by = -Math.abs(Math.cos(bobT)) * 0.4 * amt;
    kick = Math.max(0, kick - dt * 14);
    const vmod = S.wset === 'q2' ? VM[W.cur] : null, ft = Math.min(1, W.timer / 100);
    if (S.wset === 'q3' && VM3[W3.cur] && VM3[W3.cur].w) {
      const V = VM3[W3.cur], H = V.hand, n = H ? H.nframes : 0, hf = n > 1 ? q3HandFrames(simTime) : [0, 0, 0];
      // id's hand files carry the shot (frames 1..6) and the switch (6..14); a gun without them gets a plain kick / drop
      const handFire = n >= 7, handSw = n >= 15;
      const drop = handSw ? 0 : W3.state === 'dropping' ? -(1 - Math.max(0, W3.time) / 200) * 8 : W3.state === 'raising' ? -(Math.max(0, W3.time) / 250) * 8 : 0;
      const g = q3GunBasis(head, dt), go = [0, 1, 2].map(i => g.o[i] - (handFire ? 0 : g.f[i] * kick * .5) + g.u[i] * drop);
      let M = basis(go, g.f, g.l, g.u);
      M = mul(M, H ? tagMat(H, 'tag_weapon', Math.min(hf[0], n - 1), Math.min(hf[1], n - 1), hf[2]) : trs(8, -6, -7, 1, 1, 1));
      drawQ3Weapon(mainCtx, W3.cur, M, mul(q3GunProj(W2, Hh), view), shade, true);
    } else if (vmod) {
      const gfov = 2 * Math.atan(Math.tan(Math.min(S.fov, 90) * Math.PI / 360) * 0.75), gvp = mul(perspective(gfov, aspect, 1, 400), view);
      const go = [0, 1, 2].map(i => head[i] - f[i] * kick * 0.6 + r[i] * bx + u[i] * by);
      const nf = vmod.m.frames.length, fa = Math.min(W.oldFrame, nf - 1), fb = Math.min(W.frame, nf - 1);
      md2Draw(mainCtx, vmod.inst, vmod.tex, fa, Math.abs(fb - fa) > 2 ? fa : fb, Math.abs(fb - fa) > 2 ? 0 : ft, gvp, basis(go, f, [-r[0], -r[1], -r[2]], u), shade, 0.6);
    } else {
      const cw = curW(), d = curSet()[cw.cur], vproj = perspective(fovy, aspect, 1, 200), drop = cw.state === 'dropping' || cw.state === 'activating' || cw.state === 'raising' ? -6 : 0;
      const gx = 7.5 + bx, gy = -8 + by + drop, gz = kick - 5, len = d.grenade ? 3 : S.wset === 'q3' ? [5, 10, 11, 10, 13, 11, 16, 10, 12][cw.cur] || 12 : [8, 12, 11, 10, 11, 10, 13, 11, 16, 12][cw.cur] || 12;
      const c = [...d.col, 1], dark = [d.col[0] * .6, d.col[1] * .6, d.col[2] * .6, 1];
      solidFrame = realTime; gl.useProgram(solidP.p); gl.uniform3fv(solidP.u.uEye, Z3); gl.uniform1i(solidP.u.uNDL, 0); // view space: the eye is the origin
      if (d.grenade) { drawSolid(vproj, sphere, trs(gx, gy + 1, gz - 12, 3, 3, 3.6), [.3, .34, .26, 1]); drawSolid(vproj, cyl, mul(trs(gx, gy + 4, gz - 12, 1, 1, 1), basis(Z3, [0, 1, 0], [1, 0, 0], [0, 0, -1])), [.55, .55, .5, 1]); }
      else { // a built-in gun, shaped like the weapon it is
        const O = [gx + 2.5, gy + 1, gz - 2], k = .62, f = nrm([-.06, .035, -1]), l = nrm(Q.cross([0, 1, 0], f)), u = Q.cross(f, l); // turned a little inward, so you see the gun's side
        const G = (fw, lf, up, sf, sl, su, col, mesh = rbox, lit = 1) => drawSolid(vproj, mesh, mul(basis([0, 1, 2].map(i => O[i] + (f[i] * fw + l[i] * lf + u[i] * up) * k), f, l, u), trs(0, 0, 0, sf * k, sl * k, su * k)), col, lit);
        vmSpin = (vmSpin || 0) + (attackHeld() ? .35 : .02); drawGunShape(GUN_OF[d.name] || 'mg', G, d.col, { spin: vmSpin, time, firing: attackHeld() });
      }
      solidFrame = -1;
    }
    POWV = POW0;
  }
  const c = Q.pointContents(eye), wEl = $('water');
  setUnderwater(!!(c & Q.MASK_WATER));
  $('hurt').style.opacity = hurtA.toFixed(3);
  if (c & Q.MASK_WATER) { wEl.style.display = 'block'; wEl.style.background = c & Q.CONTENTS_LAVA ? 'rgba(200,70,10,.45)' : c & Q.CONTENTS_SLIME ? 'rgba(60,140,30,.4)' : 'rgba(30,90,150,.35)'; }
  else wEl.style.display = 'none';
  $('flash').style.opacity = flashA.toFixed(3);
  $('xhair').style.opacity = S.third ? .5 : 1;
}

// ---------- character preview (separate canvas) ----------
let pctx = null, previewChar = null, previewAnim = 0;
const PREVIEW_ANIMS = ['stand', 'run', 'attack', 'jump', 'crstnd', 'crwalk', 'taunt', 'wave', 'salute', 'point', 'flip', 'death'];
async function refreshPreview() {
  const box = $('charBox'); if (!box.open) return;
  if (S.pset === 'builtin' || !(S.pset === 'q3' ? listQ3Models() : listPlayerModels()).length) { previewChar = null; return; }
  if (!pctx) { const g = $('preview').getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true }); if (!g) return; pctx = makeCtx(g); }
  const tok = charToken, c = S.pset === 'q3' ? await loadQ3Player(pctx, S.model3, S.skin3) : await loadCharacter(pctx, S.model, S.skin);
  if (tok === charToken) previewChar = c;
}
function renderPreview() {
  if (!pctx || !previewChar || !$('charBox').open) return;
  const g = pctx.g, c = g.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.floor(c.clientWidth * dpr), Hh = Math.floor(c.clientHeight * dpr);
  if (!W || !Hh) return;
  if (c.width !== W || c.height !== Hh) { c.width = W; c.height = Hh; }
  g.viewport(0, 0, W, Hh); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT); g.enable(g.DEPTH_TEST);
  if (previewChar.q3) {
    const L = [[QA.LEGS_IDLE, QA.TORSO_STAND, 'idle'], [QA.LEGS_RUN, QA.TORSO_STAND, 'run'], [QA.LEGS_WALK, QA.TORSO_STAND, 'walk'], [QA.LEGS_IDLE, QA.TORSO_ATTACK, 'attack'], [QA.LEGS_JUMP, QA.TORSO_STAND, 'jump'], [QA.LEGS_IDLECR, QA.TORSO_STAND, 'crouch'], [QA.LEGS_SWIM, QA.TORSO_STAND, 'swim'], [0, 0, 'death']];
    const sel = L[previewAnim % L.length], t = realTime / 1000; $('animName').textContent = sel[2] + ' · tap to change';
    const vp = mul(perspective(0.62, W / Hh, 4, 400), viewMat([128, 0, 4], [-1, 0, 0], [0, 1, 0], [0, 0, 1]));
    const X = q3PlayerMats(previewChar, [0, 0, 0], 200 + t * 35, 0, [sel[0], sel[2] === 'jump' ? t % 1.2 : sel[2] === 'death' ? t % 3 : t], [sel[1], sel[2] === 'attack' ? t % .8 : sel[2] === 'death' ? t % 3 : t]);
    drawQ3Player(pctx, previewChar, X, vp, 1.15); return;
  }
  const ak = Object.keys(previewChar.m.anims), anims = PREVIEW_ANIMS.map(a => ak.find(k => k === a) || ak.find(k => k.startsWith(a))).filter(Boolean), name = anims[previewAnim % Math.max(1, anims.length)] || 'stand';
  $('animName').textContent = name + ' · tap to change';
  const vp = mul(perspective(0.62, W / Hh, 4, 400), viewMat([128, 0, 4], [-1, 0, 0], [0, 1, 0], [0, 0, 1]));
  const M = entMat([0, 0, 0], 200 + realTime / 1000 * 35, 0), [fa, fb, ft] = animFrames(previewChar.m, name, realTime / 1000, true);
  md2Draw(pctx, previewChar.inst, previewChar.tex, fa, fb, ft, vp, M, 1.15, 0.55);
  const pw = S.wset === 'q2' && previewChar.weps[W.cur]; if (pw) md2Draw(pctx, pw.inst, pw.tex, fa, fb, ft, vp, M, 1.15, 0.55);
}
$('preview').addEventListener('click', () => { previewAnim++; });
$('charBox').addEventListener('toggle', () => refreshPreview());
async function renderCharUI(models, skins) {
  const sel = $('modelSel'), box = $('skins'), q3 = S.pset === 'q3';
  $('pset').value = S.pset; $('wset').value = S.wset;
  const hint = S.pset === 'builtin' ? 'Built-in articulated figure: no files needed. It animates procedurally and turns into a ragdoll when it dies.'
    : !models.length ? (q3 ? 'Load Quake III\'s pak0.pk3 (baseq3) to choose from its MD3 player models and skins.' : 'Load pak0.pak to choose from the Quake II player models and skins.') : '';
  $('charHint').textContent = hint; $('charHint').hidden = !hint; $('charPick').hidden = !models.length;
  sel.innerHTML = ''; for (const m of models) { const o = document.createElement('option'); o.value = o.textContent = m; sel.appendChild(o); } sel.value = q3 ? S.model3 : S.model;
  box.innerHTML = '';
  for (const s of skins) {
    const cur = q3 ? S.skin3 : S.skin, b = document.createElement('button'); b.className = 'skin' + (s === cur ? ' on' : ''); b.title = s;
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 32; b.appendChild(cvs);
    const lab = document.createElement('span'); lab.textContent = s; b.appendChild(lab);
    b.onclick = () => { if (q3) S.skin3 = s; else S.skin = s; saveS(); refreshCharacter(); };
    box.appendChild(b);
    loadImg(q3 ? `models/players/${S.model3}/icon_${s}.tga` : `players/${S.model}/${s}_i.pcx`, true).then(img => {
      if (!img) { cvs.remove(); return; }
      const x = cvs.getContext('2d'); cvs.width = img.w; cvs.height = img.h;
      if (img.bitmap) x.drawImage(img.bitmap, 0, 0); else x.putImageData(new ImageData(new Uint8ClampedArray(img.rgba.buffer), img.w, img.h), 0, 0);
    });
  }
}
$('modelSel').onchange = e => { if (S.pset === 'q3') { S.model3 = e.target.value; S.skin3 = ''; } else { S.model = e.target.value; S.skin = ''; } saveS(); refreshCharacter(); };
$('pset').onchange = e => { S.pset = e.target.value; saveS(); refreshCharacter(); };
$('wset').onchange = e => { S.wset = e.target.value; saveS(); setLoop(null); W.next = W3.next = -1; W.state = W3.state = 'ready'; W3.time = 0; ensureOwnedWeapon(); updateWeaponHud(true); refreshPreview(); };

// ---------- Quake III: shader scripts ----------
const shaderDefs = new Map(); let shadersFor = -1;
async function loadShaderScripts() {
  if (shadersFor === vfsVersion) return; shadersFor = vfsVersion; shaderDefs.clear();
  for (const k of [...VFS.keys()].filter(k => /^scripts\/.*\.shader$/.test(k))) { const d = await vfsGet(k); if (d) try { parseShaderText(new TextDecoder('latin1').decode(d)); } catch (e) {} }
}
function parseShaderText(txt) {
  txt = txt.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, def = null, stage = null, pending = null;
  for (let raw of txt.split(/\r?\n/)) {
    raw = raw.replace(/\/\/.*$/, ''); const toks = raw.match(/[{}]|"[^"]*"|[^\s{}]+/g); if (!toks) continue;
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t === '{') { depth++; if (depth === 1) def = { name: pending, stages: [], parm: {} }; else if (depth === 2) stage = {}; i++; continue; }
      if (t === '}') { if (depth === 2 && stage && def) { def.stages.push(stage); stage = null; } else if (depth === 1 && def) { if (def.name) shaderDefs.set(def.name, finishShader(def)); def = null; } depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0) { pending = t.toLowerCase().replace(/\\/g, '/').replace(/"/g, ''); i++; continue; }
      const args = []; let j = i + 1; while (j < toks.length && toks[j] !== '{' && toks[j] !== '}') args.push(toks[j++].replace(/"/g, ''));
      const key = t.toLowerCase();
      if (depth === 1 && def) {
        if (key === 'surfaceparm') def.parm[(args[0] || '').toLowerCase()] = true; else if (key === 'skyparms') def.sky = args; else if (key === 'fogparms') def.fog = true;
        else if (key === 'qer_editorimage') def.editor = args[0]; else if (key === 'cull') def.cull = args[0]; else if (key === 'polygonoffset') def.polyOff = true;
      } else if (depth === 2 && stage) {
        if (key === 'map' || key === 'clampmap') stage.map = args[0]; else if (key === 'animmap') { stage.map = args[1]; stage.anim = { fps: +args[0] || 1, maps: args.slice(1) }; }
        else if (key === 'tcgen' || key === 'texgen') { if (/^environment$/i.test(args[0])) stage.env = true; }
        else if (key === 'blendfunc') stage.blend = (args.length === 1 ? { add: 'gl_one gl_one', filter: 'gl_dst_color gl_zero', blend: 'gl_src_alpha gl_one_minus_src_alpha' }[args[0].toLowerCase()] || args[0] : args.join(' ')).toLowerCase(); else if (key === 'alphafunc') stage.alphaTest = true;
        else if (key === 'tcmod' && /^scroll$/i.test(args[0])) stage.scroll = [+args[1] || 0, +args[2] || 0]; else if (key === 'tcmod' && /^turb$/i.test(args[0])) stage.turb = true; else if (key === 'tcmod' && /^scale$/i.test(args[0])) stage.tscale = [+args[1] || 1, +args[2] || 1];
      }
      i = j;
    }
  }
}
function finishShader(def) {
  const usable = s => s.map && !/^\$(lightmap|whiteimage)$/i.test(s.map);
  // the base picture is the first stage that isn't an environment-mapped overlay; reflections are kept separately for models
  let idx = def.stages.findIndex(s => usable(s) && !s.env); if (idx < 0) idx = def.stages.findIndex(usable);
  const st = def.stages[idx], envSt = def.stages.find(s => usable(s) && s.env && s !== st);
  const out = { name: def.name, parm: def.parm, sky: def.sky, fog: def.fog, hasStages: def.stages.length > 0, polyOff: !!def.polyOff };
  if (st) {
    out.map = st.map.toLowerCase().replace(/\\/g, '/'); const bl = st.blend || '';
    if (idx === 0) out.blend = /\badd\b|gl_one gl_one\b/.test(bl) ? 'add' : /\bblend\b|gl_src_alpha gl_one_minus_src_alpha/.test(bl) ? 'alpha' : /filter|gl_dst_color gl_zero|gl_zero gl_src_color/.test(bl) ? 'filter' : '';
    else out.blend = '';
    if (envSt) out.env = { map: envSt.map.toLowerCase().replace(/\\/g, '/'), blend: /\bblend\b|src_alpha/.test(envSt.blend || '') ? 'alpha' : 'add' };
    if (st.anim && st.anim.maps.length > 1) out.anim = { fps: st.anim.fps, maps: st.anim.maps.map(m => m.toLowerCase().replace(/\\/g, '/')) };
    out.alphaTest = !!st.alphaTest; out.scroll = st.scroll; out.turb = !!st.turb; out.tscale = st.tscale;
  } else if (def.editor) out.map = def.editor.toLowerCase();
  if (def.sky) out.cloud = st ? out.map : null;
  return out;
}
const shaderImage = name => { const n = name.toLowerCase().replace(/\.(tga|jpg|png)$/, ''), d = shaderDefs.get(n) || shaderDefs.get(name.toLowerCase()); return d && d.map ? d.map : name; };

// ---------- Quake III: world ----------
async function buildQ3World(path, progress) {
  const u8 = await vfsGet(path); if (!u8) throw new Error('Could not read ' + path);
  const b = Q.parseQ3BSP(u8), ents = Q.parseEntities(b.entities);
  if (!palette) await loadPalette();
  progress('shaders…'); await loadShaderScripts();
  const texCache = new Map();
  const texFor = async (p, cut) => { const k = cut ? p + '|cut' : p; if (texCache.has(k)) return texCache.get(k); const img = await loadImg(p); const t = img ? { tex: makeTex(gl, img.bitmap || img.rgba, img.w, img.h, { cutout: !!cut }), w: img.w, h: img.h } : null; texCache.set(k, t); return t; };
  // lightmap pages -> atlas with 1px borders; last cell is white
  const nl = b.numLightmaps, cols = Math.ceil(Math.sqrt(nl + 1)), cell = 130; let size = 256; while (size < cols * cell) size *= 2;
  const A = new Uint8Array(size * size * 4), LM = b.lightmaps;
  for (let p = 0; p <= nl; p++) {
    const cx = (p % cols) * cell, cy = Math.floor(p / cols) * cell;
    for (let y = -1; y <= 128; y++) for (let x = -1; x <= 128; x++) {
      const sx = Math.min(127, Math.max(0, x)), sy = Math.min(127, Math.max(0, y)), di = ((cy + 1 + y) * size + cx + 1 + x) * 4;
      if (p === nl) { A[di] = A[di + 1] = A[di + 2] = 255; } else { const si = p * 49152 + (sy * 128 + sx) * 3; A[di] = LM[si]; A[di + 1] = LM[si + 1]; A[di + 2] = LM[si + 2]; }
      A[di + 3] = 255;
    }
  }
  const lmuv = (p, u, v) => { if (p < 0 || p >= nl) p = nl, u = v = .5; return [((p % cols) * cell + 1 + u * 128) / size, (Math.floor(p / cols) * cell + 1 + v * 128) / size]; };
  const modelEnt = {}; for (const e of ents) if (e.model && e.model[0] === '*') modelEnt[+e.model.slice(1)] = e;
  const G = new Map(); let skyDef = null, nf = 0;
  for (let mi = 0; mi < b.models.length; mi++) {
    const m = b.models[mi], e = modelEnt[mi], cls = mi === 0 ? 'worldspawn' : (e ? e.classname : '');
    if (/^trigger_/.test(cls) || (mi > 0 && !e)) continue;
    for (let fi = m.firstface; fi < m.firstface + m.numfaces; fi++) {
      const f = b.faces[fi], sh = b.shaders[f.shader]; if (!sh || f.type === 4 || f.type < 1) continue;
      if (++nf % 400 === 0) { progress(`faces ${nf}`); await new Promise(r => setTimeout(r)); }
      if (sh.surf & Q.SURF_NODRAW) continue;
      const def = shaderDefs.get(sh.name);
      if (def && def.fog) continue;
      const V = []; // vertex -> 8 floats
      const vtx = v => { const [lu, lv] = lmuv(f.lm, b.vlm[v * 2], b.vlm[v * 2 + 1]); const lit = f.lm >= 0 ? 1 : (b.vcol[v * 4] + b.vcol[v * 4 + 1] + b.vcol[v * 4 + 2]) / 765 * .6; return [b.vpos[v * 3], b.vpos[v * 3 + 1], b.vpos[v * 3 + 2], b.vst[v * 2], b.vst[v * 2 + 1], lu, lv, lit]; };
      let idx = [];
      if (f.type === 2) {
        const t = Q.tessPatch(i => vtx(f.vertex + i), f.size[0], f.size[1], 8);
        for (const v of t.verts) V.push(v); idx = t.idx;
      } else { for (let k = 0; k < f.nverts; k++) V.push(vtx(f.vertex + k)); for (let k = 0; k < f.nmesh; k++) idx.push(b.meshverts[f.meshvert + k]); }
      if ((sh.surf & Q.SURF_SKY) || (def && (def.parm.sky || def.sky))) { if (!skyDef) skyDef = def || { name: sh.name }; const g = grp(G, 'sky' + mi, { kind: 'sky', model: mi }); addTris(g, V, idx); continue; }
      if (!def && /^textures\/common\//.test(sh.name)) continue;
      if (def && !def.map && def.hasStages) continue;
      const img = def && def.map ? def.map : sh.name, T = (await texFor(img, def && (def.alphaTest || def.blend === 'alpha'))) || getMissing();
      const liquid = sh.cont & Q.CONTENTS_LAVA ? 3 : sh.cont & Q.CONTENTS_SLIME ? 2 : sh.cont & Q.CONTENTS_WATER ? 1 : 0;
      let kind = 'opaque', alpha = 1, texAlpha = false;
      if (liquid === 1 || liquid === 2) { kind = 'trans'; alpha = liquid === 1 ? .5 : .8; }
      else if (def && def.blend === 'add') kind = 'add';
      else if (def && (def.blend === 'alpha' || def.blend === 'filter')) { kind = 'trans'; texAlpha = def.blend === 'alpha'; alpha = def.blend === 'filter' ? .6 : 1; }
      else if (def && def.parm.trans && !def.alphaTest) { kind = 'trans'; alpha = .7; }
      if (def && def.tscale) for (const v of V) { v[3] *= def.tscale[0]; v[4] *= def.tscale[1]; }
      const polyOff = !!(def && def.polyOff);
      let anim = null; if (def && def.anim) { anim = []; for (const m of def.anim.maps) { const f = await texFor(m, def.alphaTest || def.blend === 'alpha'); anim.push(f ? f.tex : T.tex); } }
      const g = grp(G, `${mi}|${kind}|${img}|${liquid}|${polyOff ? 1 : 0}`, { anim, animFps: def && def.anim ? def.anim.fps : 0, tex: T.tex, kind, alpha, warp: liquid > 0 || !!(def && def.turb), liquid, alphaTest: !!(def && def.alphaTest), texAlpha, scroll: def && def.scroll, model: mi, polyOff });
      addTris(g, V, idx);
    }
  }
  const w = uploadWorld(G, makeTex(gl, A, size, size, { lightmap: true }));
  w.textures = [...new Set([...texCache.values()].filter(Boolean).map(t => t.tex))];
  w.cm = Q.cmFromQ3(b); w.models = b.models; b.models.forEach((m, i) => m.headnode = w.cm.modelHeads[i]);
  w.ents = ents; w.staticTriggers = []; w.q3 = true;
  const ws = ents.find(e => e.classname === 'worldspawn') || {};
  w.message = ws.message ? ws.message.replace(/\\n/g, ' ') : ''; w.music = ws.music;
  progress('sky…');
  if (skyDef && skyDef.sky && skyDef.sky[0] && skyDef.sky[0] !== '-') w.skyTex = await loadSky(s => skyDef.sky[0] + '_' + s + '.tga');
  else if (skyDef && skyDef.cloud) { const img = await loadImg(skyDef.cloud); if (img) { w.skyCloud = makeTex(gl, img.bitmap || img.rgba, img.w, img.h); w.textures.push(w.skyCloud); } }
  const yawOf = e => e.angle !== undefined ? +e.angle : e.angles ? Q.vecOf(e.angles)[1] : 0, spawns = [];
  for (const e of ents) if (e.classname === 'info_player_deathmatch' || e.classname === 'info_player_start') spawns.push({ o: Q.vecOf(e.origin), yaw: yawOf(e), name: e.targetname || '' });
  if (!spawns.length) { const m = b.models[0]; spawns.push({ o: [0, 1, 2].map(i => (m.mins[i] + m.maxs[i]) / 2), yaw: 0, name: '' }); }
  w.spawns = spawns; w.name = path.replace(/^maps\//, '').replace(/\.bsp$/i, '');
  return w;
}
function addTris(g, V, idx) { const base = g.v.length / 8; for (const v of V) g.v.push(...v); for (const i of idx) g.i.push(base + i); }
// Q3 trigger_push: AimAtTarget
function aimAtTarget(box, target) {
  const o = [0, 1, 2].map(i => (box.mins[i] + box.maxs[i]) / 2), height = target[2] - o[2], g = 800, time = Math.sqrt(Math.max(1, height) / (.5 * g));
  const d = [target[0] - o[0], target[1] - o[1], 0], dist = Math.hypot(d[0], d[1]) || 1, fwd = dist / time;
  return [d[0] / dist * fwd, d[1] / dist * fwd, time * g];
}
// Quake III items
const Q3I = (m, n, o) => Object.assign({ m: Array.isArray(m) ? m : [m], n }, o);
const ITEMS_Q3 = {
  item_health_small: Q3I(['models/powerups/health/small_cross.md3', 'models/powerups/health/small_sphere.md3'], '5 Health', { h: 5, hmax: 200, s: 'items/s_health.wav' }),
  item_health: Q3I(['models/powerups/health/medium_cross.md3', 'models/powerups/health/medium_sphere.md3'], '25 Health', { h: 25, hmax: 100, s: 'items/n_health.wav' }),
  item_health_large: Q3I(['models/powerups/health/large_cross.md3', 'models/powerups/health/large_sphere.md3'], '50 Health', { h: 50, hmax: 100, s: 'items/l_health.wav' }),
  item_health_mega: Q3I(['models/powerups/health/mega_cross.md3', 'models/powerups/health/mega_sphere.md3'], 'Mega Health', { h: 100, hmax: 200, s: 'items/m_health.wav' }),
  item_armor_shard: Q3I('models/powerups/armor/shard.md3', 'Armor Shard', { a: 5, af: .66, s: 'misc/ar1_pkup.wav' }),
  item_armor_combat: Q3I('models/powerups/armor/armor_yel.md3', 'Armor', { a: 50, af: .66, s: 'misc/ar2_pkup.wav' }),
  item_armor_body: Q3I('models/powerups/armor/armor_red.md3', 'Heavy Armor', { a: 100, af: .66, s: 'misc/ar2_pkup.wav' }),
  item_quad: Q3I('models/powerups/instant/quad.md3', 'Quad Damage', { quad: 30, s: 'items/quaddamage.wav' }),
  item_enviro: Q3I('models/powerups/instant/enviro.md3', 'Battle Suit', { inv: 30, s: 'items/protect.wav' }),
  item_haste: Q3I('models/powerups/instant/haste.md3', 'Speed'), item_invis: Q3I('models/powerups/instant/invis.md3', 'Invisibility'), item_regen: Q3I('models/powerups/instant/regen.md3', 'Regeneration'),
  item_flight: Q3I('models/powerups/instant/flight.md3', 'Flight'), holdable_teleporter: Q3I('models/powerups/holdable/teleporter.md3', 'Personal Teleporter'), holdable_medkit: Q3I('models/powerups/holdable/medkit.md3', 'Medkit')
};
for (const [cls, dir, n] of [['weapon_gauntlet', 'gauntlet', 'Gauntlet'], ['weapon_machinegun', 'machinegun', 'Machinegun'], ['weapon_shotgun', 'shotgun', 'Shotgun'], ['weapon_grenadelauncher', 'grenadel', 'Grenade Launcher'], ['weapon_rocketlauncher', 'rocketl', 'Rocket Launcher'], ['weapon_lightning', 'lightning', 'Lightning Gun'], ['weapon_railgun', 'railgun', 'Railgun'], ['weapon_plasmagun', 'plasma', 'Plasma Gun'], ['weapon_bfg', 'bfg', 'BFG10K']])
  ITEMS_Q3[cls] = Q3I(`models/weapons2/${dir}/${dir}.md3`, n, { w: 1, s: 'misc/w_pkup.wav' });
for (const [cls, d, n] of [['weapon_nailgun', 'nailgun', 'Nailgun'], ['weapon_prox_launcher', 'proxmine', 'Prox Launcher'], ['weapon_chaingun', 'vulcan', 'Chaingun']])
  ITEMS_Q3[cls] = Q3I(`models/weapons/${d}/${d}.md3`, n, { w: 1, s: 'misc/w_pkup.wav' });
for (const [cls, f, n] of [['ammo_nails', 'nailgunam', 'Nails'], ['ammo_mines', 'proxmineam', 'Proximity Mines'], ['ammo_belt', 'chaingunam', 'Chaingun Belt']])
  ITEMS_Q3[cls] = Q3I(`models/powerups/ammo/${f}.md3`, n, { am: 1, s: 'misc/am_pkup.wav' });
for (const [cls, f, n] of [['ammo_bullets', 'machinegunam', 'Bullets'], ['ammo_shells', 'shotgunam', 'Shells'], ['ammo_grenades', 'grenadeam', 'Grenades'], ['ammo_rockets', 'rocketam', 'Rockets'], ['ammo_lightning', 'lightningam', 'Lightning'], ['ammo_slugs', 'railgunam', 'Slugs'], ['ammo_cells', 'plasmaam', 'Cells'], ['ammo_bfg', 'bfgam', 'Bfg Ammo']])
  ITEMS_Q3[cls] = Q3I(`models/powerups/ammo/${f}.md3`, n, { am: 1, s: 'misc/am_pkup.wav' });

// ---------- MD3 (Quake III models) ----------
function parseMD3(d) {
  if (!d || d.length < 108) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), I = o => dv.getInt32(o, true), F = o => dv.getFloat32(o, true);
  if (dv.getUint32(0, true) !== 0x33504449 || I(4) !== 15) return null;
  const nfr = I(76), ntag = I(80), nsurf = I(84), ofsTags = I(96); let off = I(100);
  const tags = {};
  for (let f = 0; f < nfr; f++) for (let t = 0; t < ntag; t++) {
    const o = ofsTags + (f * ntag + t) * 112, name = Q.cstr(d, o, 64).toLowerCase();
    (tags[name] = tags[name] || [])[f] = { o: [F(o + 64), F(o + 68), F(o + 72)], ax: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => F(o + 76 + k * 4)) };
  }
  const surfaces = [];
  for (let s = 0; s < nsurf; s++) {
    const name = Q.cstr(d, off + 4, 64).toLowerCase(), sf = I(off + 72), nsh = I(off + 76), nv = I(off + 80), nt = I(off + 84);
    const oTri = off + I(off + 88), oSh = off + I(off + 92), oSt = off + I(off + 96), oXyz = off + I(off + 100);
    const shader = nsh ? Q.cstr(d, oSh, 64).toLowerCase() : '';
    const idx = new Uint32Array(nt * 3); for (let i = 0; i < nt * 3; i++) idx[i] = I(oTri + i * 4);
    const uv = new Float32Array(nv * 2); for (let i = 0; i < nv * 2; i++) uv[i] = F(oSt + i * 4);
    const pos = new Float32Array(sf * nv * 3), nrm = new Float32Array(sf * nv * 3);
    for (let f = 0; f < sf; f++) for (let v = 0; v < nv; v++) {
      const o = oXyz + (f * nv + v) * 8, k = (f * nv + v) * 3;
      pos[k] = dv.getInt16(o, true) / 64; pos[k + 1] = dv.getInt16(o + 2, true) / 64; pos[k + 2] = dv.getInt16(o + 4, true) / 64;
      const lat = d[o + 6] * Math.PI / 128, lng = d[o + 7] * Math.PI / 128;
      nrm[k] = Math.cos(lat) * Math.sin(lng); nrm[k + 1] = Math.sin(lat) * Math.sin(lng); nrm[k + 2] = Math.cos(lng);
    }
    surfaces.push({ name, shader, nv, nf: sf, idx, uv, pos, nrm });
    off += I(off + 104);
  }
  return { md3: true, nframes: nfr, tags, surfaces };
}
const md3Cache = new Map();
async function getMD3(path) { if (!md3Cache.has(path)) md3Cache.set(path, parseMD3(await vfsGet(path))); return md3Cache.get(path); }
function md3Inst(ctx, model) {
  const g = ctx.g;
  return model.surfaces.map(s => {
    const vao = g.createVertexArray(); g.bindVertexArray(vao);
    const dyn = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, dyn); g.bufferData(g.ARRAY_BUFFER, s.nv * 24, g.DYNAMIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, 24, 0); g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 3, g.FLOAT, false, 24, 12);
    const ub = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, ub); g.bufferData(g.ARRAY_BUFFER, s.uv, g.STATIC_DRAW); g.enableVertexAttribArray(2); g.vertexAttribPointer(2, 2, g.FLOAT, false, 8, 0);
    const ib = g.createBuffer(); g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ib); g.bufferData(g.ELEMENT_ARRAY_BUFFER, s.idx, g.STATIC_DRAW);
    g.bindVertexArray(null); return { vao, dyn, buf: new Float32Array(s.nv * 6), n: s.idx.length, s };
  });
}
function getInst3(ctx, path, m) { const k = '3:' + path; if (!ctx.inst.has(k)) ctx.inst.set(k, md3Inst(ctx, m)); return ctx.inst.get(k); }
function modelUniforms(ctx, vp, M, shade, amb) {
  const g = ctx.g, P = ctx.P; g.useProgram(P.p);
  g.uniformMatrix4fv(P.u.uMVP, false, mul(vp, M)); g.uniformMatrix4fv(P.u.uM, false, M);
  g.uniform1f(P.u.uAmb, amb); g.uniform1f(P.u.uShade, shade); g.uniform4fv(P.u.uPow, POWV); g.uniform1f(P.u.uPowT, realTime / 1000); g.uniform3fv(P.u.uLDir, [0.4, 0.3, 0.866]); g.uniform1i(P.u.uTex, 0);
  if (ctx === mainCtx) { g.uniform4fv(P.u['uDL[0]'], DLP); g.uniform3fv(P.u['uDLC[0]'], DLC); g.uniform1i(P.u.uNDL, nDL); } else g.uniform1i(P.u.uNDL, 0);
}
function md3Draw(ctx, inst, texs, fa, fb, t, vp, M, shade = 1, amb = .5, raw) {
  const g = ctx.g; modelUniforms(ctx, vp, M, shade, amb);
  inst.forEach((si, k) => {
    const s = si.s, out = si.buf;
    if (raw) { const P = raw[k]; for (let v = 0; v < s.nv; v++) { out.set(P.pos.subarray(v * 3, v * 3 + 3), v * 6); out.set(P.nrm.subarray(v * 3, v * 3 + 3), v * 6 + 3); } }
    else {
      const A = Math.min(fa, s.nf - 1) * s.nv * 3, B = Math.min(fb, s.nf - 1) * s.nv * 3;
      for (let v = 0; v < s.nv; v++) for (let c = 0; c < 3; c++) { const i = v * 3 + c; out[v * 6 + c] = s.pos[A + i] + (s.pos[B + i] - s.pos[A + i]) * t; out[v * 6 + 3 + c] = s.nrm[A + i] + (s.nrm[B + i] - s.nrm[A + i]) * t; }
    }
    g.bindBuffer(g.ARRAY_BUFFER, si.dyn); g.bufferSubData(g.ARRAY_BUFFER, 0, out);
    const tx = texs && texs[k], fx = tx && modelTexFx.get(tx), U = ctx.P.u;
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tx || greyTex(ctx)); g.uniform1i(U.uEnv, 0); g.uniform1f(U.uCut, fx && fx.cut ? .5 : 0);
    g.bindVertexArray(si.vao); g.drawElements(g.TRIANGLES, si.n, g.UNSIGNED_INT, 0);
    if (fx && fx.env) { // shader's tcGen environment stage: a reflection layer over the base picture
      const was = g.isEnabled(g.BLEND); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE); g.depthMask(false); g.depthFunc(g.LEQUAL);
      g.bindTexture(g.TEXTURE_2D, fx.env); g.uniform1i(U.uEnv, 1); g.uniform1f(U.uCut, 0); g.uniform3fv(U.uEyeM, typeof curEye !== 'undefined' && curEye ? curEye : [0, 0, 0]);
      g.drawElements(g.TRIANGLES, si.n, g.UNSIGNED_INT, 0);
      g.uniform1i(U.uEnv, 0); g.depthMask(true); if (!was) g.disable(g.BLEND);
    }
  });
}
function md3World(model, fa, fb, t, M) { // world-space vertices per surface (for ragdoll binding)
  return model.surfaces.map(s => {
    const A = Math.min(fa, s.nf - 1) * s.nv * 3, B = Math.min(fb, s.nf - 1) * s.nv * 3, pos = new Float32Array(s.nv * 3), nrm = new Float32Array(s.nv * 3);
    for (let v = 0; v < s.nv; v++) {
      const p = [0, 1, 2].map(c => s.pos[A + v * 3 + c] + (s.pos[B + v * 3 + c] - s.pos[A + v * 3 + c]) * t), n = [0, 1, 2].map(c => s.nrm[A + v * 3 + c]);
      for (let c = 0; c < 3; c++) { pos[v * 3 + c] = M[c] * p[0] + M[4 + c] * p[1] + M[8 + c] * p[2] + M[12 + c]; nrm[v * 3 + c] = M[c] * n[0] + M[4 + c] * n[1] + M[8 + c] * n[2]; }
    }
    return { pos, nrm };
  });
}
function tagMat(model, name, fa, fb, t) {
  const T = model && model.tags[name]; if (!T) return trs(0, 0, 0, 1, 1, 1);
  const A = T[Math.min(fa, T.length - 1)] || T[0], B = T[Math.min(fb, T.length - 1)] || A, L = (a, b) => a + (b - a) * t;
  const o = [0, 1, 2].map(i => L(A.o[i], B.o[i])), ax = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => L(A.ax[i], B.ax[i]));
  const x = nrm(ax.slice(0, 3)), y0 = ax.slice(3, 6), yv = nrm(y0.map((v, i) => v - x[i] * Q.dot(y0, x))), z = Q.cross(x, yv);
  return basis(o, x, yv, z);
}
const modelTexFx = new WeakMap();
let texStem = null, texStemFor = -1;
function texByStem(stem) { // last resort: any picture under models/ with this file name
  if (texStemFor !== vfsVersion) { texStemFor = vfsVersion; texStem = new Map(); for (const k of VFS.keys()) { const m = k.startsWith('models/') && k.match(/([^/]+)\.(tga|jpg|jpeg|png)$/); if (m && !texStem.has(m[1])) texStem.set(m[1], k); } }
  return texStem.get(stem) || null;
}
async function modelTexs(ctx, m, skinMap) {
  const out = [];
  for (const s of m.surfaces) {
    const raw = String((skinMap && skinMap[s.name]) || s.shader || '').toLowerCase().replace(/\\/g, '/'), key = raw.replace(/\.(tga|jpg|jpeg|png)$/, ''), def = shaderDefs.get(key) || shaderDefs.get(raw);
    let t = null;
    for (const c of [def && def.map, raw, key, def && def.editor]) { if (c && (t = await getSkin(ctx, c))) break; }
    if (!t && key) { const st = texByStem(key.split('/').pop()); if (st) t = await getSkin(ctx, st); }
    if (t && def && (def.env || def.alphaTest) && !modelTexFx.has(t)) modelTexFx.set(t, { cut: !!def.alphaTest, env: def.env ? await getSkin(ctx, def.env.map) : null });
    out.push(t);
  }
  return out;
}
async function loadSkinFile(path) {
  const d = await vfsGet(path); if (!d) return null; const map = {};
  for (const line of new TextDecoder('latin1').decode(d).split(/\r?\n/)) { const [a, b] = line.split(','); if (a && b && b.trim()) map[a.trim().toLowerCase()] = b.trim(); }
  return map;
}
async function loadMD3Simple(ctx, path, skinMap) { const m = await getMD3(path); if (!m) return null; return { m, inst: getInst3(ctx, path, m), texs: await modelTexs(ctx, m, skinMap) }; }

// ---------- Quake III player models ----------
const QA = { DEATH1: 0, TORSO_GESTURE: 6, TORSO_DROP: 9, TORSO_RAISE: 10, TORSO_ATTACK: 7, TORSO_ATTACK2: 8, TORSO_STAND: 11, TORSO_STAND2: 12, LEGS_WALKCR: 13, LEGS_WALK: 14, LEGS_RUN: 15, LEGS_BACK: 16, LEGS_SWIM: 17, LEGS_JUMP: 18, LEGS_IDLE: 22, LEGS_IDLECR: 23 };
function parseAnimCfg(txt) {
  const a = [];
  for (const line of txt.split(/\r?\n/)) { const t = line.replace(/\/\/.*$/, '').trim().split(/\s+/); if (t.length >= 4 && /^-?\d+$/.test(t[0]) && /^-?\d+$/.test(t[1])) a.push({ first: +t[0], num: +t[1], loop: +t[2], fps: +t[3] || 10 }); }
  if (a.length < 25) return null;
  const skip = a[13].first - a[6].first; for (let i = 13; i < 25; i++) a[i].first -= skip;
  return a;
}
function listQ3Models() { const s = new Set(); for (const k of VFS.keys()) { const m = k.match(/^models\/players\/([^/]+)\/upper\.md3$/); if (m) s.add(m[1]); } return [...s].sort(); }
function listQ3Skins(model) { const s = new Set(), pre = 'models/players/' + model + '/upper_'; for (const k of VFS.keys()) if (k.startsWith(pre) && k.endsWith('.skin')) s.add(k.slice(pre.length, -5)); return [...s].sort(); }
async function loadQ3Player(ctx, name, skin) {
  const base = 'models/players/' + name + '/', P = { q3: true, name };
  for (const part of ['lower', 'upper', 'head']) {
    const m = await getMD3(base + part + '.md3'); if (!m) return null;
    const sk = (await loadSkinFile(base + part + '_' + skin + '.skin')) || (await loadSkinFile(base + part + '_default.skin'));
    P[part] = { m, inst: getInst3(ctx, base + part + '.md3', m), texs: await modelTexs(ctx, m, sk) };
  }
  const cfg = await vfsGet(base + 'animation.cfg'); P.anims = cfg ? parseAnimCfg(new TextDecoder('latin1').decode(cfg)) : null;
  return P;
}
function q3Frame(an, t) {
  if (!an) return [0, 0, 0];
  const n = Math.max(1, an.num), pos = Math.max(0, t) * an.fps, f = Math.floor(pos);
  const map = k => { if (k >= n) { k -= n; if (an.loop) { k %= an.loop; k += n - an.loop; } else k = n - 1; } return an.first + k; };
  return [map(f), map(f + 1), pos - f];
}
function q3PlayerMats(P, o, yaw, pitch, legs, torso) {
  const A = P.anims, [la, lb, lt] = q3Frame(A && A[legs[0]], legs[1]), [ta, tb, tt] = q3Frame(A && A[torso[0]], torso[1]);
  const Ml = entMat(o, yaw, 0), Mu = mul(mul(Ml, tagMat(P.lower.m, 'tag_torso', la, lb, lt)), entMat([0, 0, 0], 0, pitch * .45));
  const Mh = mul(mul(Mu, tagMat(P.upper.m, 'tag_head', ta, tb, tt)), entMat([0, 0, 0], 0, pitch * .35)), Mw = mul(Mu, tagMat(P.upper.m, 'tag_weapon', ta, tb, tt));
  return { Ml, Mu, Mh, Mw, lf: [la, lb, lt], tf: [ta, tb, tt] };
}
function drawQ3Player(ctx, P, X, vp, shade) {
  md3Draw(ctx, P.lower.inst, P.lower.texs, ...X.lf, vp, X.Ml, shade);
  md3Draw(ctx, P.upper.inst, P.upper.texs, ...X.tf, vp, X.Mu, shade);
  md3Draw(ctx, P.head.inst, P.head.texs, 0, 0, 0, vp, X.Mh, shade);
}
function q3PlayerAnim() {
  const v = ps.velocity.map(x => x / 8), xy = Math.hypot(v[0], v[1]), f = [0, 0, 0]; Q.angleVectors([0, yaw, 0], f);
  const duck = ps.flags & Q.PMF_DUCKED, clock = realTime / 1000, since = (simTime - lastFire) / 1000, gaunt = S.wset === 'q3' && W3.cur === 0;
  let legs;
  if (!pm.ground && pm.waterlevel < 2 && airTime > 120) legs = [QA.LEGS_JUMP, airTime / 1000];
  else if (pm.waterlevel >= 2) legs = [QA.LEGS_SWIM, clock];
  else if (duck) legs = [xy > 20 ? QA.LEGS_WALKCR : QA.LEGS_IDLECR, clock];
  else if (xy > 20) legs = [v[0] * f[0] + v[1] * f[1] < -10 ? QA.LEGS_BACK : xy < 220 ? QA.LEGS_WALK : QA.LEGS_RUN, clock];
  else legs = [QA.LEGS_IDLE, clock];
  const torso = S.wset === 'q3' ? [W3.torso.anim, (simTime - W3.torso.start) / 1000] : since < .4 ? [gaunt ? QA.TORSO_ATTACK2 : QA.TORSO_ATTACK, since] : [gaunt ? QA.TORSO_STAND2 : QA.TORSO_STAND, clock];
  return [legs, torso];
}

// ---------- Quake III weapons (g_weapon.c / bg_pmove.c PM_Weapon) ----------
const Q3W = [
  { name: 'Gauntlet', key: 'Digit1', dir: 'gauntlet', refire: 400, fn: q3Gauntlet, loop: 'q3gaunt', col: [.5, .45, .3] },
  { name: 'Machinegun', key: 'Digit2', dir: 'machinegun', refire: 100, fn: () => { q3Lead(7, 200, 1); play('q3mg' + (1 + (Math.random() * 4 | 0)), .7); }, col: [.35, .35, .3] },
  { name: 'Shotgun', key: 'Digit3', dir: 'shotgun', refire: 1000, fn: () => { q3Lead(10, 700, 11); play('q3sg', .9); }, col: [.4, .3, .2] },
  { name: 'Grenade Launcher', key: 'Digit4', dir: 'grenadel', refire: 800, fn: q3Grenade, col: [.3, .4, .25] },
  { name: 'Rocket Launcher', key: 'Digit5', dir: 'rocketl', refire: 800, fn: q3Rocket, col: [.45, .2, .2] },
  { name: 'Lightning Gun', key: 'Digit6', dir: 'lightning', refire: 50, fn: q3Lightning, loop: 'q3lgHum', col: [.6, .6, .65] },
  { name: 'Railgun', key: 'Digit7', dir: 'railgun', refire: 1500, fn: q3Rail, col: [.2, .4, .3] },
  { name: 'Plasma Gun', key: 'Digit8', dir: 'plasma', refire: 100, fn: q3Plasma, col: [.3, .35, .6] },
  { name: 'BFG10K', key: 'Digit9', dir: 'bfg', refire: 200, fn: q3BFG, col: [.25, .45, .25] },
  // Team Arena (missionpack): models live under models/weapons/ rather than models/weapons2/
  { name: 'Nailgun', key: 'Digit0', dir: 'nailgun', base: 'models/weapons/nailgun/nailgun', ta: 1, refire: 1000, fn: q3Nailgun, col: [.45, .4, .3] },
  { name: 'Prox Launcher', key: 'Minus', dir: 'proxmine', base: 'models/weapons/proxmine/proxmine', ta: 1, refire: 800, fn: q3Prox, col: [.5, .25, .2] },
  { name: 'Chaingun', key: 'Equal', dir: 'vulcan', base: 'models/weapons/vulcan/vulcan', ta: 1, refire: 30, fn: () => { q3Lead(7, 600, 1); play('q3cg' + (1 + (Math.random() * 4 | 0)), .55); }, loop: 'q3cgLoop', col: [.3, .3, .33] }
];
const W3 = { cur: 4, next: -1, last: 1, state: 'ready', time: 0, flashT: -1e9, flashSeen: -1e9, landT: -1e9, landChange: 0,
  torso: { anim: 11, start: 0, from: null }, barrel: { spinning: false, time: 0, angle: 0 } };
function q3Muzzle() { const { f } = aimVectors(), o = ps.origin.map(v => v / 8), eye = [o[0], o[1], o[2] + pm.viewheight], m = eye.map((v, i) => v + f[i] * 14); const t = Q.trace(eye, Z3, Z3, m, Q.MASK_SHOT); return t.fraction < 1 ? eye : m; }
function q3Flash(c) { W3.flashT = simTime; addLight(muzzle(), 200, c || [1, .8, .4], .08); lastFire = simTime; noiseT = simTime; noiseP = ps.origin.map(v => v / 8); hearSound(noiseP, 1500, 'player', 'fire'); if (PL.quad > simTime) play('quadFire', .6); }
function q3Lead(dmg, spread, n) { const { f } = aimVectors(), s = q3Muzzle(); for (let i = 0; i < n; i++) fireLead(s, f, dmg, spread, spread, n > 1 ? 'shotgun' : 'bullet'); q3Flash(); kick = n > 1 ? 2 : .8; }
function q3Gauntlet() {
  const { f } = aimVectors(), o = ps.origin.map(v => v / 8), eye = [o[0], o[1], o[2] + pm.viewheight], t = Q.trace(eye, Z3, Z3, eye.map((v, i) => v + f[i] * 32), Q.MASK_SHOT);
  if (!(t.fraction < 1 && t.hit && t.hit.takedamage)) return false; // Quake III: the gauntlet only "fires" when it actually hits something
  lastFire = simTime; lastHitFrom = eye; damageEnt(t.hit, 50); if (t.hit.isMonster) bloodFx(t.endpos, t.normal, 1); play('q3gauntHit', .9); W3.flashT = simTime;
  return true;
}
function q3Grenade() { const { f } = aimVectors(), d = nrm([f[0], f[1], f[2] + .2]); projs.push({ type: 'grenade', q3: true, p: q3Muzzle(), v: d.map(x => x * 700), dmg: 100, rdmg: 100, radius: 150, life: 2500, spin: 0 }); play('q3gl', .9); q3Flash(); kick = 2; }
function q3Rocket() { const { f } = aimVectors(); projs.push({ type: 'rocket', q3: true, p: q3Muzzle(), v: f.map(x => x * 900), dmg: 100, rdmg: 100, radius: 120, life: 15000 }); play('q3rl', .9); q3Flash(); kick = 3; }
function q3Plasma() { const { f } = aimVectors(); projs.push({ type: 'plasma', q3: true, p: q3Muzzle(), v: f.map(x => x * 2000), dmg: 20, rdmg: 15, radius: 20, life: 10000 }); play('q3pg', .6); q3Flash([.4, .5, 1.2]); kick = .8; }
// fire_nail x15 (g_missile.c): each nail picks its own spread and a speed between 555 and 2355
function q3Nailgun() {
  const { f, r, u } = aimVectors(), s = q3Muzzle();
  for (let k = 0; k < 15; k++) {
    const a = Math.random() * Math.PI * 2, uo = Math.sin(a) * crand() * 500 * 16, ro = Math.cos(a) * crand() * 500 * 16;
    const dir = nrm([0, 1, 2].map(c => f[c] * 8192 * 16 + r[c] * ro + u[c] * uo)), sp = 555 + Math.random() * 1800;
    projs.push({ type: 'nail', q3: true, p: s.slice(), v: dir.map(x => x * sp), dmg: 20, life: 10000 });
  }
  play('q3ngFire', .9); q3Flash([1, .75, 0]); kick = 2;
}
// fire_prox: lobbed like a grenade, sticks where it lands, arms after 2 s, goes off half a second after
// something walks within 150 units, and gives up after 20 s
function q3Prox() { const { f } = aimVectors(), d = nrm([f[0], f[1], f[2] + .2]); projs.push({ type: 'prox', q3: true, p: q3Muzzle(), v: d.map(x => x * 700), dmg: 0, rdmg: 100, radius: 150, life: 1e9 }); play('q3pxFire', .9); q3Flash([1, .7, 0]); kick = 2; }
function proxExplode(pr) { const n = pr.n || [0, 0, 1], o = pr.p.map((v, k) => v + n[k] * 2); lastHitFrom = o; radiusDamageQ3(o, pr.rdmg, pr.radius, pr.stuckTo || null); if (pr.stuckTo && pr.stuckTo.takedamage) damageEnt(pr.stuckTo, 100); fxExplosion(o, n, 'grenade'); playAt('q3boom', o); }
function updateProx(pr, i, msec) {
  const dt = msec / 1000;
  if (pr.stuckTo) { // riding on a monster: Quake III's mine on a player
    const e = pr.stuckTo, eo = e.o || e.origin; if (eo) pr.p = eo.map((v, k) => v + pr.off[k]);
    if (simTime >= pr.boomAt || e.dead || e.health <= 0) { projs.splice(i, 1); proxExplode(pr); } else if (simTime - (pr.tickT || -1e9) > 1000) { pr.tickT = simTime; playAt('q3pxTick', pr.p, .7); }
    return;
  }
  if (!pr.stuck) {
    pr.v[2] -= 800 * dt;
    const end = pr.p.map((v, k) => v + pr.v[k] * dt), t = Q.trace(pr.p, Z3, Z3, end, Q.MASK_SHOT);
    fxTrail(pr, Math.hypot(...pr.v) * dt * t.fraction); crossWater(pr.p, t.fraction < 1 ? t.endpos : end, .5);
    if (t.fraction < 1 || t.startsolid) {
      if (t.surf & Q.SURF_SKY) { projs.splice(i, 1); return; }
      if (t.hit && t.hit.takedamage) {
        if (t.hit.isMonster && (t.hit.o || t.hit.origin) && !t.hit.dead) { const ho = t.hit.o || t.hit.origin; pr.stuckTo = t.hit; pr.off = t.endpos.map((v, k) => v - ho[k]); pr.boomAt = simTime + 2000; pr.n = [0, 0, 1]; playAt('q3pxStickMetal', t.endpos); return; }
        projs.splice(i, 1); pr.p = t.endpos; pr.n = t.normal; proxExplode(pr); return;
      }
      pr.stuck = true; pr.p = t.endpos.map((v, k) => v + t.normal[k] * .5); pr.n = t.normal; pr.v = [0, 0, 0];
      pr.armAt = simTime + 2000; pr.dieAt = simTime + 20000; playAt(t.surf & 0x1000 ? 'q3pxStickMetal' : 'q3pxStick', pr.p);
    } else pr.p = end;
    return;
  }
  if (pr.trigAt) { if (simTime >= pr.trigAt) { projs.splice(i, 1); proxExplode(pr); } return; }
  if (simTime >= pr.dieAt) { projs.splice(i, 1); proxExplode(pr); return; }
  if (simTime < pr.armAt) return;
  if (!pr.armed) { pr.armed = true; playAt('q3pxActv', pr.p, .8); }
  for (const e of E.damageables) {
    if (!e.isMonster || e.dead || !e.takedamage) continue; const c = entCenter(e);
    if (Math.hypot(c[0] - pr.p[0], c[1] - pr.p[1], c[2] - pr.p[2]) > pr.radius) continue;
    const lt = Q.trace(pr.p.map((v, k) => v + pr.n[k] * 2), Z3, Z3, c, Q.MASK_SOLID); if (lt.fraction < 1 && lt.hit !== e) continue;
    pr.trigAt = simTime + 500; playAt('q3pxTick', pr.p); break;
  }
}
function q3BFG() { const { f } = aimVectors(); projs.push({ type: 'bfg3', q3: true, p: q3Muzzle(), v: f.map(x => x * 2000), dmg: 100, rdmg: 100, radius: 120, life: 10000 }); play('q3bfg', .8); q3Flash([.3, 1, .3]); kick = 3; }
function q3Lightning() {
  const { f } = aimVectors(), s = q3Muzzle(), end = s.map((v, i) => v + f[i] * 768), t = Q.trace(s, Z3, Z3, end, Q.MASK_SHOT);
  if (!W3.lgOn) { play('q3lgFire', .7); W3.lgOn = true; }
  lastHitFrom = s; if (t.fraction < 1 && t.hit && t.hit.takedamage) { damageEnt(t.hit, 8); if (t.hit.isMonster) bloodFx(t.endpos, t.normal, .3); }
  else if (t.fraction < 1 && !(t.surf & Q.SURF_SKY) && Math.random() < .35) fxImpact(t, 'rail');
  if ((S.lgBeam || 'new') === 'particles') fxLightning(s, t.endpos); waterEntry(s, t.endpos, .12);
  W3.flashT = simTime; addLight(t.endpos, 160, [.6, .7, 1.3], .06); lastFire = simTime; noiseT = simTime; noiseP = ps.origin.map(v => v / 8); hearSound(noiseP, 1500, 'player', 'fire');
}
function fxLightning(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d); if (len < 1) return;
  const f = d.map(x => x / len), up0 = Math.abs(f[2]) < .9 ? [0, 0, 1] : [1, 0, 0], R = nrm(Q.cross(f, up0)), U = Q.cross(R, f);
  let jr = 0, ju = 0;
  for (let s = 0; s < len; s += 4) { jr += crand() * 1.6; ju += crand() * 1.6; jr *= .8; ju *= .8; addPart({ p: [0, 1, 2].map(k => a[k] + f[k] * s + R[k] * jr + U[k] * ju), v: [0, 0, 0], life: .06, size0: 2.2, size1: 1.6, kind: 0, ramp: 'lin', c0: [.75, .85, 1, 1], c1: [.4, .5, 1, .3] }); }
}
function q3Rail() {
  const { f } = aimVectors(), s = q3Muzzle(), end = s.map((v, i) => v + f[i] * 8192);
  const cm = Q.getCM(), bx = cm.boxes; cm.boxes = []; const t = Q.trace(s, Z3, Z3, end, Q.MASK_SHOT); cm.boxes = bx;
  lastHitFrom = s;
  for (const e of [...E.barrels, ...E.monsters]) if (e.box && e.box.active && e.takedamage && segBox(s, t.endpos, e.box)) { damageEnt(e, 100); if (e.isMonster) bloodFx(entCenter(e), null, 1); }
  if (t.hit && t.hit.takedamage) damageEnt(t.hit, 100);
  fxBeam(s, t.endpos, 'rail'); if (t.fraction < 1 && !(t.surf & Q.SURF_SKY)) fxImpact(t, 'rail'); waterEntry(s, t.endpos, .3);
  play('q3rg', 1); q3Flash([.5, .6, 1.2]); kick = 3;
}
function weaponTickQ3(msec) {
  const att = attackHeld(), gaunt = () => W3.cur === 0;
  if (W3.time > 0) W3.time -= msec;
  if (W3.state === 'dropping' && W3.time <= 0) { W3.last = W3.cur; W3.cur = W3.next; W3.next = -1; W3.state = 'raising'; W3.time = 250; setTorso(QA.TORSO_RAISE, true); play('q3change', .5); updateWeaponHud(true); } // PM_FinishWeaponChange
  if (W3.state === 'raising' && W3.time <= 0) { W3.state = 'ready'; setTorso(gaunt() ? QA.TORSO_STAND2 : QA.TORSO_STAND, true); }
  const d = Q3W[W3.cur];
  if (W3.state !== 'ready' || !att) { if (!att) W3.lgOn = false; if (d.loop && loopKey === d.loop && !att) setLoop(null); }
  if (W3.state !== 'ready' || W3.time > 0) return;
  if (W3.next >= 0) { W3.state = 'dropping'; W3.time = 200; setTorso(QA.TORSO_DROP, true); setLoop(null); return; } // PM_BeginWeaponChange
  if (!att) { setTorso(gaunt() ? QA.TORSO_STAND2 : QA.TORSO_STAND); return; } // PM_TorsoAnimation: back to standing once the weapon is ready
  const a3 = Q3_AMMO[W3.cur];
  if (ammoOn() && a3 && AMMO[a3[0]] < a3[1]) { setLoop(null); noAmmo(); W3.time += 500; return; }
  if (d.loop) setLoop(d.loop);
  if (d.fn() === false) return;
  if (a3) spendAmmo(a3);
  W3.time += d.refire; setTorso(gaunt() ? QA.TORSO_ATTACK2 : QA.TORSO_ATTACK, true); // every shot restarts the attack animation (ANIM_TOGGLEBIT)
}
let VM3 = [], PM3 = {};
async function loadQ3WeaponModels(ctx) {
  const out = [];
  for (const d of Q3W) {
    const base = d.base || `models/weapons2/${d.dir}/${d.dir}`;
    out.push({ w: await loadMD3Simple(ctx, base + '.md3'), hand: await getMD3(base + '_hand.md3'), barrel: await loadMD3Simple(ctx, base + '_barrel.md3'), flash: await loadMD3Simple(ctx, base + '_flash.md3') });
  }
  return out;
}
function drawQ3Weapon(ctx, i, M, vp, shade, firstPerson) {
  const V = VM3[i]; if (!V || !V.w) return false;
  md3Draw(ctx, V.w.inst, V.w.texs, 0, 0, 0, vp, M, shade, .6);
  if (V.barrel) { const a = q3BarrelAngle(simTime) * Math.PI / 180; md3Draw(ctx, V.barrel.inst, V.barrel.texs, 0, 0, 0, vp, mul(mul(M, tagMat(V.w.m, 'tag_barrel', 0, 0, 0)), rotX(a)), shade, .6); }
  if (V.flash && q3FlashOn(i)) {
    W3.flashSeen = W3.flashT;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    md3Draw(ctx, V.flash.inst, V.flash.texs, 0, 0, 0, vp, mul(mul(M, tagMat(V.w.m, 'tag_flash', 0, 0, 0)), rotX(crand() * 10 * Math.PI / 180)), 1.4, 1);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
  return true;
}
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
// muzzle flash: MUZZLE_FLASH_TIME (20 ms) after each shot — but never fewer than one drawn frame;
// the lightning gun and gauntlet show it the whole time the trigger is held (EF_FIRING)
function q3FlashOn(i) {
  if ((i === 0 || i === 5) && attackHeld() && W3.state === 'ready' && !PL.dead) return true;
  if (W3.flashT > simTime) W3.flashT = W3.flashSeen = -1e9;
  return simTime - W3.flashT < 20 || W3.flashSeen !== W3.flashT;
}
// CG_MachinegunSpinAngle: 0.9°/ms while firing, coasting down over a second after you let go
function q3BarrelAngle(now) {
  const B = W3.barrel, firing = !PL.dead && attackHeld() && W3.state === 'ready';
  if (B.time > now) B.time = now;
  let delta = now - B.time, angle;
  if (B.spinning) angle = B.angle + delta * .9;
  else { delta = Math.min(delta, 1000); angle = B.angle + delta * (.5 * (.9 + (1000 - delta) / 1000)); }
  if (B.spinning !== firing) { B.time = now; B.angle = angle % 360; B.spinning = firing; }
  return angle;
}
// ---------- Quake III view weapon (cg_weapons.c) ----------
// The gun is never placed by hand: the *_hand.md3 sits exactly at the camera origin and its tag_weapon says where the
// gun goes. The hand's frames carry the motion — frame 0 at rest, 1..6 the shot, 6..14 the weapon switch — chosen by
// mapping the player's torso animation onto them (CG_MapTorsoToWeaponFrame), so the timing follows animation.cfg.
const Q3_TORSO_DEFAULT = (() => { const a = []; // stock model timings, when no Quake III player model is in use
  a[QA.TORSO_ATTACK] = { first: 100, num: 6, loop: 0, fps: 15 }; a[QA.TORSO_ATTACK2] = { first: 106, num: 6, loop: 0, fps: 15 };
  a[QA.TORSO_DROP] = { first: 112, num: 5, loop: 0, fps: 20 }; a[QA.TORSO_RAISE] = { first: 117, num: 4, loop: 0, fps: 20 };
  a[QA.TORSO_STAND] = { first: 121, num: 1, loop: 0, fps: 15 }; a[QA.TORSO_STAND2] = { first: 122, num: 1, loop: 0, fps: 15 }; return a; })();
function q3TorsoAnims() { const A = S.pset === 'q3' && player && player.q3 && player.anims; return A && A[QA.TORSO_DROP] && A[QA.TORSO_ATTACK] ? A : Q3_TORSO_DEFAULT; }
// CG_RunLerpFrame: a new animation blends in from the frame on screen over one frame time (initialLerp = 1000 / fps)
function torsoLerp(now) {
  const T = W3.torso, A = q3TorsoAnims(), an = A[T.anim] || A[QA.TORSO_STAND]; if (!an) return [0, 0, 0];
  if (T.start > now) T.start = now - 1e4; // stale timestamp from an older clock: treat the animation as long finished
  const fps = an.fps || 15, u = Math.max(0, now - T.start) / 1000 * fps;
  if (T.from === null) return q3Frame(an, u / fps);
  if (u < 1) return [T.from, an.first, u];
  return q3Frame(an, (u - 1) / fps);
}
function setTorso(anim, restart) {
  const T = W3.torso; if (!restart && T.anim === anim) return;
  const [a, b, t] = torsoLerp(simTime); T.from = t < .5 ? a : b; T.anim = anim; T.start = simTime;
}
function mapTorsoToWeaponFrame(A, fr) {
  const d = A[QA.TORSO_DROP], a1 = A[QA.TORSO_ATTACK], a2 = A[QA.TORSO_ATTACK2];
  if (d && fr >= d.first && fr < d.first + 9) return fr - d.first + 6;      // change weapon (drop, then raise)
  if (a1 && fr >= a1.first && fr < a1.first + 6) return 1 + fr - a1.first;  // stand attack
  if (a2 && fr >= a2.first && fr < a2.first + 6) return 1 + fr - a2.first;  // stand attack 2 (gauntlet)
  return 0;
}
function q3HandFrames(now) { const A = q3TorsoAnims(), [a, b, t] = torsoLerp(now); return [mapTorsoToWeaponFrame(A, a), mapTorsoToWeaponFrame(A, b), t]; }
// CG_CalculateWeaponPosition: the hand at the eye, turned by the step bob and an idle drift, dropped on landing
let q3BobCycle = 0;
function q3GunBasis(head, dt) {
  const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8;
  if (pm.ground && !ps.noclip) q3BobCycle = xy < 5 ? 0 : (q3BobCycle + (ps.flags & Q.PMF_DUCKED ? .5 : xy > 220 ? .4 : .3) * dt * 1000) % 256; // PM_Footsteps
  const cyc = q3BobCycle | 0, frac = Math.abs(Math.sin((cyc & 127) / 127 * Math.PI)), sc = (cyc & 128) ? -xy : xy;
  const idle = (xy + 40) * Math.sin(realTime * .001) * .01;
  const ap = xy * frac * .005 + idle, ay = sc * frac * .01 + idle, ar = sc * frac * .005 + idle;
  let dz = 0; if (W3.landT > simTime) W3.landT = -1e9; const ld = simTime - W3.landT;
  if (ld < 150) dz = W3.landChange * .25 * ld / 150; else if (ld < 450) dz = W3.landChange * .25 * (450 - ld) / 300;
  const f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0]; Q.angleVectors([Math.max(-89, Math.min(89, pitch + kickP)) + ap, yaw + ay, ar], f, r, u);
  return { o: [head[0], head[1], head[2] + dz], f, l: [-r[0], -r[1], -r[2]], u };
}
// Quake III draws the gun with cg_fov 90 on a 4:3 screen. That exact frame is kept and pinned to the bottom-right
// of any screen, so the gun has Quake III's size and spot at every field of view and aspect ratio.
const Q3_GUN_FOVY = 2 * Math.atan(.75);
function q3GunProj(Wd, Hd) {
  const Hv = Math.min(Hd, Math.max(Wd * .75, Math.min(Hd * .5, Wd * .85))), Wv = Hv * 4 / 3, n = 1, fr = 400;
  const top = n * Math.tan(Q3_GUN_FOVY / 2), right = top * 4 / 3, l = (2 * (Wv - Wd) / Wv - 1) * right, t = (1 - 2 * (Hv - Hd) / Hv) * top, b = -top;
  const m = new Float32Array(16); m[0] = 2 * n / (right - l); m[5] = 2 * n / (t - b); m[8] = (right + l) / (right - l); m[9] = (t + b) / (t - b); m[10] = -(fr + n) / (fr - n); m[11] = -1; m[14] = -2 * fr * n / (fr - n); return m;
}
// active weapon set helpers
const curSet = () => S.wset === 'q3' ? Q3W : WEAPONS;
const curW = () => S.wset === 'q3' ? W3 : W;

// ---------- ragdolls: Verlet point skeleton, rigid-skinned to the model's mesh at the moment of death ----------
let lastHitFrom = null;
const ragdolls = [];
const RAG_STIFF = .2; // joints are 20% stiffer: limits 20% tighter, corrections 20% stronger, bending damped 20% more
const HUM = { // x fwd, y left, z up for a 56-unit body standing on z = -24
  pts: [[1, 0, 27], [0, 0, 19], [0, 0, 10], [0, 0, -1], [0, 8, 17], [1, 10, 6], [4, 10, -4], [0, -8, 17], [1, -10, 6], [4, -10, -4], [0, 4.5, -4], [1, 4.5, -14], [0, 4.5, -23], [0, -4.5, -4], [1, -4.5, -14], [0, -4.5, -23]],
  rad: [5, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2.5, 2, 2, 2.5],
  bones: [[1, 0], [2, 1], [3, 2], [4, 5], [5, 6], [7, 8], [8, 9], [10, 11], [11, 12], [13, 14], [14, 15], [1, 4], [1, 7], [3, 10], [3, 13]],
  legBones: new Set([7, 8, 9, 10, 13, 14]), boneSet: new Set([[1, 0], [2, 1], [3, 2], [4, 5], [5, 6], [7, 8], [8, 9], [10, 11], [11, 12], [13, 14], [14, 15], [1, 4], [1, 7], [3, 10], [3, 13]].map(([a, b]) => a * 16 + b)),
  braces: [[4, 7], [10, 13], [4, 3], [7, 3], [4, 10], [7, 13], [2, 4], [2, 7], [0, 2], [1, 3], [0, 4], [0, 7], [2, 10], [2, 13], [10, 7], [13, 4], [0, 3]],
  soft: [[6, 3, .45], [9, 3, .45], [12, 3, .8], [15, 3, .8], [5, 2, .35], [8, 2, .35], [11, 2, .55], [14, 2, .55], [12, 15, .25], [4, 6, .72], [7, 9, .72], [10, 12, .78], [13, 15, .78]].map(([a, b, k]) => [a, b, k + (1 - k) * RAG_STIFF]) // [a, b, min fraction of rest]: keeps limbs from folding through the torso
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function boneFrame(rd, bi) {
  const [a, b] = rd.bones[bi], P = rd.pts, x = nrm(sub3(P[b], P[a]));
  // keep each bone's side axis continuous from frame to frame (parallel transport), so the skin never flips
  // when a limb swings into line with the shoulders or hips
  let y = null; const fy = rd.fy && rd.fy[bi];
  if (rd.kind === 'h') { // twist is locked to the torso/pelvis side axis: a limb can bend but its skin can't roll around it
    const ref = HUM.legBones.has(bi) ? sub3(P[10], P[13]) : sub3(P[4], P[7]), t = sub3(ref, x.map(v => v * Q.dot(ref, x))), l = Math.hypot(...t);
    if (l > .35 * Math.hypot(...ref)) y = t.map(v => v / l);
  }
  if (!y && fy) { const t = sub3(fy, x.map(v => v * Q.dot(fy, x))), l = Math.hypot(...t); if (l > .25) y = t.map(v => v / l); }
  if (!y) {
    const ref = rd.kind === 'h' ? (HUM.legBones.has(bi) ? sub3(P[10], P[13]) : sub3(P[4], P[7])) : sub3(P[2], P[0]);
    y = sub3(ref, x.map(v => v * Q.dot(ref, x))); if (Math.hypot(...y) < 1e-3) y = Math.abs(x[2]) < .9 ? [0, 0, 1] : [1, 0, 0];
    y = nrm(sub3(y, x.map(v => v * Q.dot(y, x))));
  }
  (rd.fy = rd.fy || [])[bi] = y;
  return { o: P[a], x, y, z: Q.cross(x, y) };
}
function humanPose(o, yaw, mins, maxs, local) {
  const H = maxs[2] - mins[2], Wd = (maxs[0] - mins[0]) / 32, r = yaw * Math.PI / 180, f = [Math.cos(r), Math.sin(r), 0], l = [-Math.sin(r), Math.cos(r), 0];
  return (local || HUM.pts).map(([x, y, z]) => { const zz = mins[2] + (z + 24) * H / 56; return [o[0] + f[0] * x * Wd + l[0] * y * Wd, o[1] + f[1] * x * Wd + l[1] * y * Wd, o[2] + zz]; });
}
const clampLen = (v, m) => { const l = Math.hypot(...v); return l > m ? v.map(x => x * m / l) : v; };
const RAG_MAXV = 1200; const ragH = () => Math.max(1, S.tick || 8) / 1000; // ragdolls step once per game tick // units/s: fast enough for a rocket-jumped corpse, slow enough that nothing tunnels or explodes
function createRagdoll(src) {
  let pts, cons = [], bones, rad, kind = src.kind || 'h';
  if (kind === 'h') { pts = src.pts || humanPose(src.o, src.yaw, src.mins, src.maxs); bones = HUM.bones; const sc = (src.maxs[2] - src.mins[2]) / 56; rad = HUM.rad.map(x => x * sc); for (const [a, b] of [...HUM.bones, ...HUM.braces]) cons.push([a, b, Math.hypot(...sub3(pts[a], pts[b])), 0]); for (const [a, b, k] of HUM.soft) cons.push([a, b, Math.hypot(...sub3(pts[a], pts[b])) * k, 1]); }
  else {
    const c = [0, 1, 2].map(i => (src.mins[i] + src.maxs[i]) / 2), h = [0, 1, 2].map(i => (src.maxs[i] - src.mins[i]) / 2 * .8), r = src.yaw * Math.PI / 180, f = [Math.cos(r), Math.sin(r), 0], l = [-Math.sin(r), Math.cos(r), 0];
    pts = []; for (let i = 0; i < 8; i++) { const x = (i & 1 ? 1 : -1) * h[0], y = (i & 2 ? 1 : -1) * h[1], z = (i & 4 ? 1 : -1) * h[2]; pts.push([src.o[0] + f[0] * (c[0] + x) + l[0] * (c[1] + y), src.o[1] + f[1] * (c[0] + x) + l[1] * (c[1] + y), src.o[2] + c[2] + z]); }
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) cons.push([a, b, Math.hypot(...sub3(pts[a], pts[b])), 0]);
    bones = [[0, 1]]; rad = pts.map(() => 2);
  }
  { // a body that dies against a wall must not start with limbs inside it
    const c = src.o ? [src.o[0], src.o[1], src.o[2] + (kind === 'h' ? 0 : 0)] : pts[2];
    const cc = Q.pointContents(c) & Q.MASK_SOLID ? null : c;
    if (cc) pts = pts.map(p => { const t = Q.trace(cc, Z3, Z3, p, Q.MASK_SOLID, true); if (t.fraction >= 1) return p; const d = nrm(sub3(cc, p)); return t.endpos.map((x, k) => x + d[k] * 1.5); });
  }
  if (Q.pointContents(src.o || pts[2]) & Q.MASK_SOLID) ragUnstick({ kind, pts, prev: pts.map(p => p.slice()) });
  const v = clampLen(src.vel || [0, 0, 0], 900), imp = clampLen(src.impulse || [0, 0, 0], 1400), dt = ragH();
  const prev = pts.map((p, i) => { const w = kind === 'h' ? (i <= 2 || i === 4 || i === 7 ? 1 : i >= 10 ? .35 : .7) : (i & 4 ? 1 : .6); return [p[0] - (v[0] + imp[0] * w) * dt, p[1] - (v[1] + imp[1] * w) * dt, p[2] - (v[2] + imp[2] * w) * dt]; });
  const rd = { pts: pts.map(p => p.slice()), prev, cons, bones, rad, kind, sleep: 0, age: 0, render: src.render, ent: src.ent, wet: pts.map(() => false), splashT: 0 };
  if (kind === 'h') { // the pose the head and arms hold (in the chest's frame), and how far any point may ever be from the body's middle
    const F = ragFrame(rd.pts), loc = (i, j) => { const d = sub3(rd.pts[i], rd.pts[j]); return [Q.dot(d, F.f), Q.dot(d, F.l), Q.dot(d, F.u)]; };
    rd.pose = { head: loc(0, 1), ua: [loc(5, 4), loc(8, 7)], fa: [loc(6, 5), loc(9, 8)] };
    rd.ext = Math.max(...rd.pts.map(p => Math.hypot(...sub3(p, rd.pts[2])))) * 1.35 + 6;
  } else rd.ext = Math.max(...pts.map(p => Math.hypot(...sub3(p, pts[0])))) * 1.35 + 6;
  if (src.capture) {
    const r = src.render || {}; let topo = null;
    if (r.type === 'md2') topo = [{ tris: r.inst.model.corners, part: null }];
    else if (r.type === 'md3') { topo = []; const names = ['lower', 'upper', 'head']; (r.parts || []).forEach((pt, i) => { for (const sf of pt.inst) topo.push({ tris: sf.s.idx, part: names[i] }); }); }
    bindRagdoll(rd, src.capture, topo); buildRagHull(rd); liftRagdoll(rd);
  }
  ragdolls.push(rd); capRagdolls();
  return rd;
}
// Every body lasts: none is ever frozen or removed (only one that falls out of the map through a leak).
function capRagdolls() {}
// Smooth skinning with *surface* distances. Every vertex is bound to the bone whose region it is connected to along the mesh, so an arm
// hanging against the torso follows the arm, not the ribs it merely touches. Blending happens only within a short band of the seam
// between two bones that share a joint, so everything away from a joint is one rigid piece and cannot stretch.
const PART_BONES = { head: [0, 1], upper: [1, 2, 3, 4, 5, 6, 11, 12], lower: [2, 7, 8, 9, 10, 13, 14] }; // MD3 parts only ever use their own bones
function meshGraph(pos, tris) { // welded adjacency (MD3 duplicates vertices along UV seams; MD2 shares them already)
  const n = pos.length / 3, rep = new Int32Array(n), map = new Map(); let nr = 0;
  for (let v = 0; v < n; v++) { const k = Math.round(pos[v * 3] * 20) + ',' + Math.round(pos[v * 3 + 1] * 20) + ',' + Math.round(pos[v * 3 + 2] * 20); let r = map.get(k); if (r === undefined) { r = nr++; map.set(k, r); } rep[v] = r; }
  const nb = Array.from({ length: nr }, () => new Map()), P = (r, v) => v, first = new Int32Array(nr).fill(-1);
  for (let v = n - 1; v >= 0; v--) first[rep[v]] = v;
  const link = (a, b) => { if (a === b) return; const ra = rep[a], rb = rep[b]; if (ra === rb) return; const va = first[ra], vb = first[rb], d = Math.hypot(pos[va * 3] - pos[vb * 3], pos[va * 3 + 1] - pos[vb * 3 + 1], pos[va * 3 + 2] - pos[vb * 3 + 2]); nb[ra].set(rb, d); nb[rb].set(ra, d); };
  for (let i = 0; i + 2 < tris.length; i += 3) { link(tris[i], tris[i + 1]); link(tris[i + 1], tris[i + 2]); link(tris[i + 2], tris[i]); }
  return { rep, nr, first, nb: nb.map(m => [...m]) };
}
function dijkstra(G, seeds) { // multi-source shortest surface distance
  const d = new Float32Array(G.nr).fill(Infinity), heap = []; // [dist, node] binary heap
  const push = x => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of seeds) { d[s] = 0; push([0, s]); }
  while (heap.length) { const [dd, u] = pop(); if (dd > d[u]) continue; for (const [v, w] of G.nb[u]) if (dd + w < d[v]) { d[v] = dd + w; push([d[v], v]); } }
  return d;
}
function bindRagdoll(rd, sets, topo) { // sets: [{pos, nrm}] world space; topo: [{tris, part}] per set (optional)
  const F = rd.bones.map((_, i) => boneFrame(rd, i)), P = rd.pts, nb = rd.bones.length;
  const lens = rd.bones.map(([a, b]) => Math.hypot(...sub3(P[b], P[a]))), band = Math.max(1.5, (lens.reduce((x, y) => x + y, 0) / nb) * .14);
  const adj = rd.bones.map(([a, b], i) => rd.bones.map(([c, d], j) => j !== i && (a === c || a === d || b === c || b === d)));
  rd.bind = sets.map(({ pos, nrm: nn }, si) => {
    const n = pos.length / 3, bone = new Uint8Array(n), bone2 = new Uint8Array(n), wt = new Float32Array(n), loc = new Float32Array(n * 3), loc2 = new Float32Array(n * 3), ln = new Float32Array(n * 3), ln2 = new Float32Array(n * 3);
    const tp = topo && topo[si], allow = (rd.kind === 'h' && tp && tp.part && PART_BONES[tp.part]) || range(0, nb - 1), isAllowed = new Uint8Array(nb); for (const b of allow) isAllowed[b] = 1;
    const dist = new Float32Array(n * nb);
    for (let v = 0; v < n; v++) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      for (let b = 0; b < nb; b++) { const A = P[rd.bones[b][0]], B = P[rd.bones[b][1]], ab = sub3(B, A), t = Math.max(0, Math.min(1, Q.dot(sub3(p, A), ab) / (Q.dot(ab, ab) || 1))); dist[v * nb + b] = isAllowed[b] ? Math.hypot(p[0] - A[0] - ab[0] * t, p[1] - A[1] - ab[1] * t, p[2] - A[2] - ab[2] * t) : Infinity; }
    }
    const nearest = v => { let b0 = allow[0]; for (const b of allow) if (dist[v * nb + b] < dist[v * nb + b0]) b0 = b; return b0; };
    let g = null, G = null; // g[b]: surface distance from bone b's region, per welded vertex
    if (tp && tp.tris && tp.tris.length >= 3) {
      G = meshGraph(pos, tp.tris); const lab = new Int16Array(G.nr);
      for (let r = 0; r < G.nr; r++) lab[r] = nearest(G.first[r]);
      const seen = new Uint8Array(G.nr), seeds = Array.from({ length: nb }, () => []), best = new Float32Array(nb).fill(Infinity);
      for (let r0 = 0; r0 < G.nr; r0++) { // connected components of equal label; each bone keeps the component holding its closest vertex
        if (seen[r0]) continue; const b = lab[r0], comp = [r0]; seen[r0] = 1; let md = Infinity;
        for (let i = 0; i < comp.length; i++) { const u = comp[i]; md = Math.min(md, dist[G.first[u] * nb + b]); for (const [w] of G.nb[u]) if (!seen[w] && lab[w] === b) { seen[w] = 1; comp.push(w); } }
        if (md < best[b]) { best[b] = md; seeds[b] = comp; }
      }
      g = seeds.map((s, b) => s.length ? dijkstra(G, s) : null);
    }
    for (let v = 0; v < n; v++) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], nv = [nn[v * 3], nn[v * 3 + 1], nn[v * 3 + 2]]; let best = nearest(v), second = -1, w = 1;
      if (g) {
        const r = G.rep[v]; let bb = -1, bd = Infinity; for (const b of allow) if (g[b] && g[b][r] < bd) { bd = g[b][r]; bb = b; }
        if (bb >= 0) {
          best = bb; let sd = Infinity; for (const b of allow) if (b !== best && adj[best][b] && g[b] && g[b][r] < sd) { sd = g[b][r]; second = b; }
          if (second >= 0 && Number.isFinite(sd)) { const k = Math.max(0, Math.min(1, (sd - bd) / band)); w = .5 + .5 * k * k * (3 - 2 * k); } else second = -1;
        }
      }
      const put = (bi, L, N) => { const f = F[bi], d = sub3(p, f.o); L[v * 3] = Q.dot(d, f.x); L[v * 3 + 1] = Q.dot(d, f.y); L[v * 3 + 2] = Q.dot(d, f.z); N[v * 3] = Q.dot(nv, f.x); N[v * 3 + 1] = Q.dot(nv, f.y); N[v * 3 + 2] = Q.dot(nv, f.z); };
      bone[v] = best; put(best, loc, ln); if (second >= 0 && w < 1) { bone2[v] = second; put(second, loc2, ln2); wt[v] = w; } else { bone2[v] = best; put(best, loc2, ln2); wt[v] = 1; }
    }
    return { bone, bone2, wt, loc, loc2, ln, ln2, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), tris: tp && tp.tris };
  });
}
function skinRagdoll(rd) {
  const F = rd.bones.map((_, i) => boneFrame(rd, i));
  for (const s of rd.bind) for (let v = 0; v < s.bone.length; v++) {
    const f = F[s.bone[v]], g = F[s.bone2[v]], w = s.wt[v], i3 = v * 3;
    for (let k = 0; k < 3; k++) {
      const a = f.o[k] + f.x[k] * s.loc[i3] + f.y[k] * s.loc[i3 + 1] + f.z[k] * s.loc[i3 + 2], nA = f.x[k] * s.ln[i3] + f.y[k] * s.ln[i3 + 1] + f.z[k] * s.ln[i3 + 2];
      if (w >= 1) { s.pos[i3 + k] = a; s.nrm[i3 + k] = nA; continue; }
      const b = g.o[k] + g.x[k] * s.loc2[i3] + g.y[k] * s.loc2[i3 + 1] + g.z[k] * s.loc2[i3 + 2], nB = g.x[k] * s.ln2[i3] + g.y[k] * s.ln2[i3 + 1] + g.z[k] * s.ln2[i3 + 2];
      s.pos[i3 + k] = a * w + b * (1 - w); s.nrm[i3 + k] = nA * w + nB * (1 - w);
    }
  }
}
let ragAcc = 0;
function updateRagdolls(dt) {
  // physics runs in tickRagdolls(), once per game tick; this just tidies up per frame
  for (let i = ragdolls.length - 1; i >= 0; i--) { // a body that fell out of the map (a leak) keeps falling at the cap: drop it
    const rd = ragdolls[i], vz = (rd.pts[2][2] - rd.prev[2][2]) / ragH();
    rd.fallT = vz < -RAG_MAXV * .9 ? (rd.fallT || 0) + dt : 0;
    if (rd.fallT > 2.5) { if (rd.ent && rd.ent.rag === rd) rd.ent.ragFrozen = true; ragdolls.splice(i, 1); }
  }
  for (const rd of ragdolls) if (rd.ent && rd.ent.box && rd.ent.rag === rd && !rd.ent.gibbed) { // corpse hitbox follows the body
    const b = rd.ent.box; b.mins = [1e9, 1e9, 1e9]; b.maxs = [-1e9, -1e9, -1e9];
    for (const p of rd.pts) for (let k = 0; k < 3; k++) { b.mins[k] = Math.min(b.mins[k], p[k] - 6); b.maxs[k] = Math.max(b.maxs[k], p[k] + 6); }
  }
}
function tickRagdolls(msec) { const h = msec / 1000; for (const rd of ragdolls) { rd.frozen = false; if (rd.sleep > .5 && rd.rest) restRagdoll(rd, h); else stepRagdoll(rd, h); } }
// A body at rest still gets its tick: it checks, one contact at a time, that whatever it lies on is still there (a plat that
// moved away, a door that closed into it) and wakes up the moment it isn't. Pushes and shots wake it directly.
function restRagdoll(rd, h) {
  rd.age += h; const R = rd.rest; if (!R.length) { rd.sleep = 0; return; }
  const i = R[(rd.restI = ((rd.restI || 0) + 1) % R.length)], p = rd.pts[i];
  const inside = Q.pointContents(p) & Q.MASK_SOLID, t = inside ? null : Q.trace(p, Z3, Z3, [p[0], p[1], p[2] - 3], Q.MASK_SOLID, true);
  if (inside || t.fraction >= 1) { rd.sleep = 0; rd.rest = null; }
}
// the chest's frame: up the spine, across the shoulders, and forward
function ragFrame(P) {
  const u = nrm(sub3(P[1], P[3])), l0 = sub3(P[4], P[7]), l = nrm(sub3(l0, u.map(v => v * Q.dot(l0, u)))), f = Q.cross(l, u);
  return { u, l, f };
}
// Stiff joints: the head holds its place on the neck almost rigidly, the arms resist bending away from the pose they died in (gravity still
// sags them a little). Each correction pulls the child toward its target and the parent slightly the other way, so the body doesn't drift.
const RAG_HEAD_K = .6, RAG_UARM_K = .06, RAG_FARM_K = .05;
function ragStiffen(rd, h) {
  const P = rd.pts, F = ragFrame(P), po = rd.pose; if (!po || ![...F.u, ...F.l, ...F.f].every(Number.isFinite)) return;
  const pull = (c, par, L, k, back) => {
    const kk = 1 - Math.pow(1 - k, h * 60), t = [0, 1, 2].map(i => P[par][i] + F.f[i] * L[0] + F.l[i] * L[1] + F.u[i] * L[2]), m = sub3(t, P[c]);
    for (let i = 0; i < 3; i++) { P[c][i] += m[i] * kk; for (const [b, w] of back) P[b][i] -= m[i] * kk * w; }
  };
  pull(0, 1, po.head, RAG_HEAD_K, [[1, .12], [4, .06], [7, .06]]);
  pull(5, 4, po.ua[0], RAG_UARM_K, [[4, .25]]); pull(8, 7, po.ua[1], RAG_UARM_K, [[7, .25]]);
  pull(6, 5, po.fa[0], RAG_FARM_K, [[5, .3]]); pull(9, 8, po.fa[1], RAG_FARM_K, [[8, .3]]);
}
// A body that ends a tick torn apart, scattered, inside a wall or full of NaNs goes back to its last good state, at rest.
function ragHealthy(rd) {
  const P = rd.pts, core = rd.kind === 'h' ? P[2] : P[0];
  for (const p of P) { if (!p.every(Number.isFinite)) return false; if (Math.hypot(...sub3(p, core)) > rd.ext) return false; }
  for (const [a, b, len, soft] of rd.cons) if (!soft && Math.abs(Math.hypot(...sub3(P[b], P[a])) - len) > len * .45 + 2) return false;
  return !(Q.pointContents(core) & Q.MASK_SOLID);
}
function ragUnstick(rd) { // the body's middle is inside something: move the whole body to the nearest open spot
  const P = rd.pts, core = rd.kind === 'h' ? P[2] : P.reduce((a, p) => a.map((x, k) => x + p[k] / P.length), [0, 0, 0]);
  if (!core.every(Number.isFinite) || !(Q.pointContents(core) & Q.MASK_SOLID)) return false;
  for (const r of [8, 16, 24, 32, 48, 64, 96, 128, 160]) for (const [dx, dy, dz] of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [.7, .7, 0], [-.7, .7, 0], [.7, -.7, 0], [-.7, -.7, 0], [0, 0, -1]]) {
    const o = [dx * r, dy * r, dz * r], c = core.map((v, k) => v + o[k]);
    if (Q.pointContents(c) & Q.MASK_SOLID) continue; const t = Q.trace(c, [-6, -6, -6], [6, 6, 6], c, Q.MASK_SOLID, true); if (t.allsolid || t.startsolid) continue;
    if (Q.trace(c, Z3, Z3, [c[0], c[1], c[2] - 600], Q.MASK_SOLID, true).fraction >= 1) continue; // nothing underneath: that's outside the map
    for (let i = 0; i < P.length; i++) for (let k = 0; k < 3; k++) { P[i][k] += o[k]; rd.prev[i][k] = P[i][k]; }
    return true;
  }
  return false;
}
function ragGuard(rd) {
  if (ragHealthy(rd)) { rd.bad = 0; if (!rd.good || (rd.goodN = (rd.goodN || 0) + 1) % 3 === 0) rd.good = rd.pts.map(p => p.slice()); return; }
  rd.bad = (rd.bad || 0) + 1;
  if (ragUnstick(rd) && ragHealthy(rd)) { rd.bad = 0; rd.good = rd.pts.map(p => p.slice()); return; }
  if (rd.good && rd.bad < 20) { rd.pts = rd.good.map(p => p.slice()); rd.prev = rd.good.map(p => p.slice()); rd.fy = null; return; }
  // nothing good to go back to: pull every point back into shape around the middle, motionless
  const core = rd.kind === 'h' ? rd.pts[2] : rd.pts[0], c = core.every(Number.isFinite) ? core : (rd.good ? rd.good[2] || rd.good[0] : [0, 0, 0]);
  rd.pts = rd.pts.map(p => p.every(Number.isFinite) && Math.hypot(...sub3(p, c)) < rd.ext ? p.slice() : c.map(x => x + (Math.random() - .5)));
  rd.prev = rd.pts.map(p => p.slice()); rd.good = rd.pts.map(p => p.slice()); rd.bad = 0; rd.fy = null;
}
function stepRagdoll(rd, h) {
  const P = rd.pts, V = rd.prev, n = P.length, maxStep = RAG_MAXV * h; rd.age += h;
  if ((rd.chk = (rd.chk || 0) + 1) % 6 === 0) { // a point stuck inside the world is pulled back toward the body
    const core = rd.kind === 'h' ? P[2] : P.reduce((a, p) => a.map((x, k) => x + p[k] / n), [0, 0, 0]);
    if (!(Q.pointContents(core) & Q.MASK_SOLID)) for (let i = 0; i < n; i++) if (Q.pointContents(P[i]) & Q.MASK_SOLID) {
      const t = Q.trace(core, Z3, Z3, P[i], Q.MASK_SOLID, true), d = nrm(sub3(core, P[i])); P[i] = t.endpos.map((x, k) => x + d[k] * .5); V[i] = P[i].slice();
    }
  }
  const old = P.map(p => p.slice());
  // 1. integrate (Verlet), with water drag / buoyancy and a speed cap
  for (let i = 0; i < n; i++) {
    const wet = !!(Q.pointContents(P[i]) & Q.MASK_WATER), damp = Math.pow(wet ? .94 : .995, h * 60);
    if (wet !== rd.wet[i]) { rd.wet[i] = wet; const sp = Math.hypot(...sub3(P[i], V[i])) / h; if (wet && sp > 120 && rd.age - rd.splashT > .25) { rd.splashT = rd.age; fxSplash(surfaceBetween(old[i], P[i]) || P[i], Math.min(1, sp / 500), liquidAt(P[i])); } }
    let v = sub3(P[i], V[i]).map(x => x * damp); const vl = Math.hypot(...v); if (vl > maxStep) v = v.map(x => x * maxStep / vl);
    V[i] = P[i].slice(); P[i] = [P[i][0] + v[0], P[i][1] + v[1], P[i][2] + v[2] - (wet ? 160 : 800) * h * h];
  }
  // 2. sweep every point from where it was to where it wants to be; bounce a little, slide with friction
  const touch = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = ragSweep(rd, i, old[i], P[i]); if (!t) continue; touch[i] = 1;
    const nn = t.normal, v = sub3(P[i], V[i]), vn = Q.dot(v, nn), vt = sub3(v, nn.map(x => x * vn));
    P[i] = t.pos; const nv = vt.map((x, c) => x * .8 - nn[c] * Math.min(0, vn) * .1); V[i] = sub3(P[i], nv);
  }
  if (touch.some(x => x)) rd.lastTouch = rd.age;
  // 3. the death animation's pull, bones, braces and joint limits — all of it swept against the world in step 4
  const safe = P.map(p => p.slice());
  const iters = rd.sleep > .5 ? 6 : Math.max(8, Math.min(20, Math.round(20 * h * 60))); // the same solver effort per second at any tick rate
  for (let it = 0; it < iters; it++) {
    for (const [a, b, len, soft] of rd.cons) {
      const d = sub3(P[b], P[a]), l = Math.hypot(...d); if (l < 1e-6 || (soft && l >= len)) continue;
      const k = (l - len) / l * .5; for (let c = 0; c < 3; c++) { P[a][c] += d[c] * k; P[b][c] -= d[c] * k; }
    }
    if (rd.kind === 'h' && (it & 1)) { ragHinges(P); ragCones(P); }
  }
  if (rd.kind === 'h') ragStiffen(rd, h);
  if (rd.kind === 'h') for (let k = 0; k < 4; k++) for (const [a, b, len, soft] of rd.cons) { // bones stay their length: the skin is rigid to them, so a stretched bone is a stretched model
    if (soft || !HUM.boneSet.has(a * 16 + b)) continue; const d = sub3(P[b], P[a]), l = Math.hypot(...d); if (l < 1e-6) continue; const q = (l - len) / l * .5; for (let c = 0; c < 3; c++) { P[a][c] += d[c] * q; P[b][c] -= d[c] * q; }
  }
  // 4. constraints may not push anything into the world: sweep again from the last valid spot
  let motion = 0;
  for (let i = 0; i < n; i++) {
    const t = ragSweep(rd, i, safe[i], P[i]); if (t) { P[i] = t.pos; const dv = sub3(P[i], V[i]), vn = Q.dot(dv, t.normal); if (vn < 0) V[i] = V[i].map((x, c) => x + t.normal[c] * vn); }
    if (!P[i].every(Number.isFinite)) { P[i] = old[i].slice(); V[i] = old[i].slice(); }
    motion += Math.hypot(...sub3(P[i], old[i]));
  }
  if (rd.kind === 'h') { // bending damping: neighbouring bones share some of each other's motion, so limbs don't whip
    const d = Math.min(.5, RAG_STIFF * .1 * h * 60);
    for (const [a, b] of HUM.bones) for (let c = 0; c < 3; c++) { const rel = (P[b][c] - V[b][c]) - (P[a][c] - V[a][c]); V[b][c] += rel * d * .5; V[a][c] -= rel * d * .5; }
    const dj = 1 - Math.pow(1 - .18, h * 60); // the neck and arms are damped harder: they swing, they don't flail
    for (const [a, b] of [[1, 0], [4, 5], [5, 6], [7, 8], [8, 9]]) for (let c = 0; c < 3; c++) { const rel = (P[b][c] - V[b][c]) - (P[a][c] - V[a][c]); V[b][c] += rel * dj * .7; V[a][c] -= rel * dj * .3; }
  }
  if (rd.hull) { ragHullCollide(rd, h); motion = 0; for (let i = 0; i < n; i++) motion += Math.hypot(...sub3(P[i], old[i])); }
  // 5. settle: once nearly still, bleed energy so the body comes to rest instead of trembling
  const avg = motion / n / h;
  // settle smoothly: a slow body loses a little speed each step instead of being braked to a halt
  if (avg < 10 && rd.age - (rd.lastTouch || -9) < .3) { const k = Math.pow(avg < 3 ? .955 : .985, h * 60); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) V[i][c] = P[i][c] - (P[i][c] - V[i][c]) * k; }
  let worst = 0; for (const [a, b, len, soft] of rd.cons) if (!soft) { const l = Math.hypot(...sub3(P[b], P[a])); worst = Math.max(worst, Math.abs(l - len) / len); }
  // only bodies lying on something, barely moving and in shape go to sleep, and by then the stop is invisible
  rd.avgS = (rd.avgS ?? avg) * .92 + avg * .08; rd.sleep = rd.avgS < 5 && worst < .1 && rd.age - (rd.lastTouch || -9) < .3 ? rd.sleep + h : 0;
  if (rd.sleep > .5 && !rd.rest) { rd.rest = []; for (let i = 0; i < n; i++) { const t = Q.trace(P[i], Z3, Z3, [P[i][0], P[i][1], P[i][2] - 3], Q.MASK_SOLID, true); if (t.fraction < 1) rd.rest.push(i); } for (let i = 0; i < n; i++) V[i] = P[i].slice(); }
  else if (!rd.sleep) rd.rest = null;
  ragGuard(rd);
}
// sweep one point (a small box, falling back to a bare point in tight spots); returns the resting spot and normal
function ragSweep(rd, i, from, to) {
  if (Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) + Math.abs(to[2] - from[2]) < 1e-4) return null;
  const r = Math.min(3, rd.rad[i] * .6), mn = [-r, -r, -r], mx = [r, r, r];
  let a = from, b = to, first = null;
  for (let bump = 0; bump < 3; bump++) { // slide along what we hit, like a player move, instead of stopping dead
    let t = Q.trace(a, mn, mx, b, Q.MASK_SOLID, true);
    if (t.startsolid || t.allsolid) t = Q.trace(a, Z3, Z3, b, Q.MASK_SOLID, true);
    if (t.allsolid) return { pos: a.slice(), normal: first ? first.normal : [0, 0, 1] };
    if (t.fraction >= 1) return first ? { pos: b.slice(), normal: first.normal } : null;
    const nn = t.normal; if (!first) first = { normal: nn };
    a = t.endpos.slice(); const rest = sub3(b, a), into = Q.dot(rest, nn);
    b = into < 0 ? a.map((x, c) => x + rest[c] - nn[c] * into) : a.map((x, c) => x + rest[c]);
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) < 1e-3) return { pos: a, normal: first.normal };
  }
  return { pos: a, normal: first.normal };
}
// knees bend forward and elbows backward, never the other way
function ragHinges(P) {
  const up = nrm(sub3(P[1], P[3])), left = nrm(sub3(P[4], P[7])), fwd = nrm(Q.cross(left, up));
  if (!fwd.every(Number.isFinite)) return;
  const hinge = (a, k, f, dir) => {
    const af = sub3(P[f], P[a]), L = Q.dot(af, af); if (L < 1) return;
    const t = Math.max(0, Math.min(1, Q.dot(sub3(P[k], P[a]), af) / L)), q = P[a].map((x, c) => x + af[c] * t), off = sub3(P[k], q), s = Q.dot(off, fwd) * dir;
    if (s >= .2) return; const m = (.2 - s) * dir;
    const st = 1 + RAG_STIFF; for (let c = 0; c < 3; c++) { P[k][c] += fwd[c] * m * .6 * st; P[a][c] -= fwd[c] * m * .2 * st; P[f][c] -= fwd[c] * m * .2 * st; }
  };
  hinge(10, 11, 12, 1); hinge(13, 14, 15, 1); hinge(4, 5, 6, -1); hinge(7, 8, 9, -1);
}
// The skin is rigid to its bones, so a mesh can't sink into the floor if each bone's outermost vertices stay out of it.
// buildRagHull keeps, per bone, the vertices that are extreme along 26 directions in that bone's frame; every tick the few lowest
// of them are traced from the bone's middle, and any that ended up inside the world push the bone back out along the surface normal.
const HULL_DIRS = (() => { const D = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) { const l = Math.hypot(x, y, z); D.push([x / l, y / l, z / l]); } return D; })();
function buildRagHull(rd) {
  const nb = rd.bones.length, hull = Array.from({ length: nb }, () => new Map());
  for (const s of rd.bind) {
    const best = Array.from({ length: nb }, () => HULL_DIRS.map(() => [-1e9, null]));
    for (let v = 0; v < s.bone.length; v++) {
      const b = s.bone[v], L = [s.loc[v * 3], s.loc[v * 3 + 1], s.loc[v * 3 + 2]], B = best[b];
      for (let d = 0; d < HULL_DIRS.length; d++) { const D = HULL_DIRS[d], p = L[0] * D[0] + L[1] * D[1] + L[2] * D[2]; if (p > B[d][0]) { B[d][0] = p; B[d][1] = L; } }
    }
    best.forEach((B, b) => { for (const [, L] of B) if (L) hull[b].set(L.map(x => Math.round(x * 4)).join(), L); });
  }
  rd.hull = hull.map(m => [...m.values()]);
}
function ragHullCollide(rd, h) {
  const P = rd.pts, V = rd.prev;
  for (let b = 0; b < rd.bones.length; b++) {
    const H = rd.hull[b]; if (!H || !H.length) continue;
    const f = boneFrame(rd, b), [ia, ib] = rd.bones[b], mid = [0, 1, 2].map(c => (P[ia][c] + P[ib][c]) / 2);
    if (Q.pointContents(mid) & Q.MASK_SOLID) continue;
    // world positions of this bone's hull, lowest first; check the three lowest and any that are inside something
    const W = H.map(L => [0, 1, 2].map(c => f.o[c] + f.x[c] * L[0] + f.y[c] * L[1] + f.z[c] * L[2])).sort((p, q) => p[2] - q[2]);
    let push = [0, 0, 0], hit = false;
    for (let k = 0; k < W.length; k++) {
      if (k >= 2 && (W[k][2] > W[0][2] + 6 || !(Q.pointContents(W[k]) & Q.MASK_SOLID))) continue;
      const t = Q.trace(mid, Z3, Z3, W[k], Q.MASK_SOLID, true); if (t.fraction >= 1 || t.startsolid) continue;
      const n = t.normal, depth = Q.dot(sub3(t.endpos, W[k]), n) + .05; if (depth <= .08) continue;
      for (let c = 0; c < 3; c++) if (Math.abs(n[c] * depth) > Math.abs(push[c])) push[c] = n[c] * depth;
      hit = true;
    }
    if (!hit) continue;
    { const pl0 = Math.hypot(...push); if (pl0 > 4) push = push.map(x => x * 4 / pl0); } // out of the floor a little at a time, never in one jump
    const ids = rd.kind === 'h' ? [ia, ib] : P.map((_, i) => i), pl = Math.hypot(...push), n = push.map(x => x / pl);
    for (const i of ids) {
      for (let c = 0; c < 3; c++) { P[i][c] += push[c]; V[i][c] += push[c]; }
      const v = sub3(P[i], V[i]), vn = Q.dot(v, n); if (vn < 0) for (let c = 0; c < 3; c++) V[i][c] += n[c] * vn; // no velocity into the floor
      const vt = sub3(sub3(P[i], V[i]), n.map(x => x * Q.dot(sub3(P[i], V[i]), n))); for (let c = 0; c < 3; c++) V[i][c] += vt[c] * .15; // a little friction
    }
    rd.lastTouch = rd.age;
  }
}
function liftRagdoll(rd) { // a body that dies standing on the floor starts with its feet on it, not in it
  for (let it = 0; it < 4; it++) { const before = rd.pts.map(p => p.slice()); ragHullCollide(rd, ragH()); if (rd.pts.every((p, i) => p[2] === before[i][2])) break; }
}
// cone limits for the joints that aren't hinges: neck, spine and hips can only swing so far from their parent bone
function ragCones(P) {
  const lim = (pa, pb, a, b, maxDeg) => { // child bone a->b may not leave the cone around the parent direction pa->pb
    const par = nrm(sub3(P[pb], P[pa])), ch = sub3(P[b], P[a]), L = Math.hypot(...ch); if (L < 1e-6 || !par.every(Number.isFinite)) return;
    const u = ch.map(v => v / L), dt = Q.dot(u, par), cm = Math.cos(maxDeg * Math.PI / 180); if (dt >= cm) return;
    const side = sub3(u, par.map(v => v * dt)), sl = Math.hypot(...side); if (sl < 1e-6) return;
    const sn = Math.sqrt(1 - cm * cm), tgt = [0, 1, 2].map(c => P[a][c] + (par[c] * cm + side[c] / sl * sn) * L);
    for (let c = 0; c < 3; c++) { const m = (tgt[c] - P[b][c]) * .6 * (1 + RAG_STIFF); P[b][c] += m; }
  };
  const s = 1 - RAG_STIFF; lim(3, 2, 2, 1, 40 * s); lim(2, 1, 1, 0, 28); // spine -> chest -> head (the neck barely bends)
  lim(1, 3, 4, 5, 125); lim(1, 3, 7, 8, 125); // upper arms can't swing up past the head
  lim(1, 3, 10, 11, 150 * s); lim(1, 3, 13, 14, 150 * s); // thigh stays within 150 degrees of "down the body" (no knees through the ribs)
}
function ragdollPush(p, radius, power) { // explosions shove nearby bodies
  for (const rd of ragdolls) {
    let hit = false;
    for (let i = 0; i < rd.pts.length; i++) { const d = sub3(rd.pts[i], p), l = Math.hypot(...d); if (l > radius) continue; const k = power * (1 - l / radius) * ragH(), n = nrm([d[0], d[1], d[2] + 8]); for (let c = 0; c < 3; c++) rd.prev[i][c] -= n[c] * k; capVel(rd, i); hit = true; }
    if (hit) { rd.sleep = 0; rd.rest = null; rd.frozen = false; }
  }
}
function ragdollShot(rd, p, dir, power) {
  let bi = 0, bd = 1e9; rd.pts.forEach((q, i) => { const d = Math.hypot(...sub3(q, p)); if (d < bd) { bd = d; bi = i; } });
  for (let c = 0; c < 3; c++) rd.prev[bi][c] -= dir[c] * power * ragH(); capVel(rd, bi); rd.sleep = 0; rd.rest = null; rd.frozen = false;
}
function capVel(rd, i) { const v = sub3(rd.pts[i], rd.prev[i]), l = Math.hypot(...v), m = RAG_MAXV * ragH(); if (l > m) rd.prev[i] = rd.pts[i].map((x, c) => x - v[c] * m / l); }
function drawRagdoll(rd, vp, shade) {
  const r = rd.render; if (!r) return;
  if (r.type === 'boxes') {
    if (rd.pts.length >= 14) { drawBoneBoxes(vp, rd.pts, r.colors, r.scale || 1); return; }
    const P = rd.pts, avg = idx => [0, 1, 2].map(c => idx.reduce((a, i) => a + P[i][c], 0) / idx.length); // a non-humanoid body: the drone, tumbling with its box
    const ctr = avg([0, 1, 2, 3, 4, 5, 6, 7]), f = nrm(sub3(avg([1, 3, 5, 7]), avg([0, 2, 4, 6]))), l0 = sub3(avg([2, 3, 6, 7]), avg([0, 1, 4, 5])), l = nrm(sub3(l0, f.map(v => v * Q.dot(l0, f)))), u = Q.cross(f, l);
    if ([...f, ...l].every(Number.isFinite)) drawDrone(vp, basis(ctr, f, l, u), Math.hypot(...sub3(P[7], P[0])) * .55, r.drone, 0); return;
  }
  skinRagdoll(rd);
  if (r.type === 'md2') { const inst = r.inst, out = inst.buf, c = inst.model.corners, s = rd.bind[0]; for (let i = 0; i < inst.model.n; i++) { const v = c[i] * 3; out[i * 6] = s.pos[v]; out[i * 6 + 1] = s.pos[v + 1]; out[i * 6 + 2] = s.pos[v + 2]; out[i * 6 + 3] = s.nrm[v]; out[i * 6 + 4] = s.nrm[v + 1]; out[i * 6 + 5] = s.nrm[v + 2]; } md2DrawBuf(mainCtx, inst, r.tex, vp, shade); }
  else if (r.type === 'md3') { let k = 0; for (const part of r.parts) { md3Draw(mainCtx, part.inst, part.texs, 0, 0, 0, vp, trs(0, 0, 0, 1, 1, 1), shade, .5, rd.bind.slice(k, k + part.inst.length)); k += part.inst.length; } }
}
function md2DrawBuf(ctx, inst, tex, vp, shade) {
  const g = ctx.g; g.bindBuffer(g.ARRAY_BUFFER, inst.dyn); g.bufferSubData(g.ARRAY_BUFFER, 0, inst.buf);
  modelUniforms(ctx, vp, trs(0, 0, 0, 1, 1, 1), shade, .5); g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex || greyTex(ctx));
  g.bindVertexArray(inst.vao); g.drawArrays(g.TRIANGLES, 0, inst.model.n);
}
function md2World(model, fa, fb, t, M) {
  const nf = model.frames.length, A = model.frames[Math.min(fa, nf - 1)], B = model.frames[Math.min(fb, nf - 1)], n = A.xyz.length / 3, pos = new Float32Array(n * 3), nr = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const p = [0, 1, 2].map(c => A.xyz[v * 3 + c] + (B.xyz[v * 3 + c] - A.xyz[v * 3 + c]) * t), q = [0, 1, 2].map(c => A.nrm[v * 3 + c]);
    for (let c = 0; c < 3; c++) { pos[v * 3 + c] = M[c] * p[0] + M[4 + c] * p[1] + M[8 + c] * p[2] + M[12 + c]; nr[v * 3 + c] = M[c] * q[0] + M[4 + c] * q[1] + M[8 + c] * q[2]; }
  }
  return { pos, nrm: nr };
}

// ---------- built-in articulated character (same skeleton as the ragdoll) ----------
const BUILTIN_COL = { torso: [.42, .4, .25, 1], limb: [.3, .32, .26, 1], head: [.78, .62, .5, 1], boot: [.17, .15, .13, 1] };
function builtinPose(t, st) { // returns HUM-layout local points
  const p = HUM.pts.map(q => q.slice()), sw = Math.sin(t * 9) * st.move, dz = st.duck ? -14 : 0;
  for (const i of [0, 1, 2, 3, 4, 7]) p[i][2] += dz; for (const i of [5, 6, 8, 9]) p[i][2] += dz;
  const leg = (hip, knee, foot, ph) => { const a = (st.air ? .6 : Math.sin(t * 9 + ph) * .55 * st.move) + (st.duck ? .9 : 0), k = st.air ? .9 : Math.max(0, -Math.cos(t * 9 + ph)) * .9 * st.move + (st.duck ? 1.6 : 0);
    p[hip][2] += dz; p[knee] = [p[hip][0] + Math.sin(a) * 10, p[hip][1], p[hip][2] - Math.cos(a) * 10]; p[foot] = [p[knee][0] + Math.sin(a - k) * 9, p[hip][1], p[knee][2] - Math.cos(a - k) * 9]; };
  leg(10, 11, 12, 0); leg(13, 14, 15, Math.PI);
  if (st.duck) for (const i of [10, 11, 12, 13, 14, 15]) p[i][2] = Math.max(p[i][2], -23);
  const arm = (sh, el, ha, a, b) => { p[el] = [p[sh][0] + Math.sin(a) * 10, p[sh][1], p[sh][2] - Math.cos(a) * 10]; p[ha] = [p[el][0] + Math.sin(a + b) * 9, p[sh][1] * .7, p[el][2] - Math.cos(a + b) * 9]; };
  const aim = 1.1 + (st.fire ? .25 : 0) + st.pitch * .8;
  arm(4, 5, 6, aim - .2 + sw * .1, .5); arm(7, 8, 9, aim, .25);
  return p;
}
function drawBoneBoxes(vp, P, col, sc) { drawFigure(vp, P, col && col.fig || FIG.player, sc || 1, !(col && col.noGun)); }
function builtinPlayerPoints(o) {
  const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8;
  const loc = builtinPose(realTime / 1000, { move: Math.min(1, xy / 300), duck: !!(ps.flags & Q.PMF_DUCKED), air: !pm.ground && pm.waterlevel < 2 && airTime > 120, fire: simTime - lastFire < 300, pitch: -pitch / 90 });
  return humanPose(o, yaw, [-16, -16, -24], [16, 16, 32], loc);
}

// ---------- water: splashes, ripples, bubbles ----------
const liquidAt = p => { const c = Q.pointContents(p); return c & Q.CONTENTS_LAVA ? 3 : c & Q.CONTENTS_SLIME ? 2 : c & Q.CONTENTS_WATER ? 1 : 0; };
function surfaceBetween(a, b) { // binary search the liquid surface on a segment where one end is in liquid
  const ia = !!(Q.pointContents(a) & Q.MASK_WATER), ib = !!(Q.pointContents(b) & Q.MASK_WATER); if (ia === ib) return null;
  let lo = a.slice(), hi = b.slice();
  for (let i = 0; i < 12; i++) { const m = lo.map((v, k) => (v + hi[k]) / 2); if (!!(Q.pointContents(m) & Q.MASK_WATER) === ia) lo = m; else hi = m; }
  return lo.map((v, k) => (v + hi[k]) / 2);
}
function surfaceAbove(p, maxUp) { const top = [p[0], p[1], p[2] + (maxUp || 600)], t = Q.trace(p, Z3, Z3, top, Q.MASK_SOLID, true); return surfaceBetween(p, t.endpos); }
function fxSplash(p, s, liq, quiet) {
  if (!p) return; s = Math.max(.15, Math.min(2.2, s)); liq = liq || 1;
  const col = liq === 3 ? [1, .45, .12] : liq === 2 ? [.5, .85, .3] : [.82, .9, 1], bl = liq === 3 ? 0 : 1, z = p[2];
  for (let i = 0; i < 28 * s; i++) { const a = Math.random() * 6.283, r = Math.random(), up = rnd(140, 430) * Math.sqrt(s) * (1 - r * .5); addPart({ p: [p[0] + Math.cos(a) * r * 6 * s, p[1] + Math.sin(a) * r * 6 * s, z + 1], v: [Math.cos(a) * rnd(25, 120) * s, Math.sin(a) * rnd(25, 120) * s, up], life: rnd(.7, 1.4), size0: rnd(1, 2.3), size1: .9, kind: 2, blend: bl, ramp: 'lin', c0: [...col, .95], c1: [...col, .5], grav: 800, killBelow: z - 2 }); }
  for (let i = 0; i < 12 * s; i++) { const d = randDir(); addPart({ p: [p[0] + d[0] * 4 * s, p[1] + d[1] * 4 * s, z + 3], v: [d[0] * rnd(15, 70) * s, d[1] * rnd(15, 70) * s, rnd(50, 230) * s], life: rnd(.45, .9), size0: rnd(4, 8) * s, size1: rnd(12, 24) * s, kind: 1, blend: bl, ramp: 'lin', c0: [...col, .5], c1: [...col, 0], grav: 520, drag: 1.4 }); }
  for (let k = 0; k < 3; k++) addPart({ p: [p[0], p[1], z + .6], v: [0, 0, 0], delay: k * .17, life: rnd(1.1, 1.7), size0: 4 * s, size1: (34 + k * 16) * s, kind: 4, blend: 1, ramp: 'lin', c0: [...col, .6], c1: [...col, 0] });
  addPart({ p: [p[0], p[1], z + .5], v: [0, 0, 0], life: 2, size0: 8 * s, size1: 26 * s, kind: 5, blend: 1, ramp: 'lin', c0: [...col, .5], c1: [...col, 0] });
  if (liq !== 3) for (let i = 0; i < 14 * s; i++) addPart({ p: [p[0] + crand() * 9 * s, p[1] + crand() * 9 * s, z - rnd(3, 30 * s)], v: [crand() * 12, crand() * 12, rnd(20, 70)], life: rnd(.6, 1.5), size0: rnd(.8, 2.2), size1: 1.3, kind: 6, blend: 1, ramp: 'lin', c0: [.9, .97, 1, .75], c1: [.9, .97, 1, 0], buoy: 70, killAbove: z });
  if (liq === 3) addLight([p[0], p[1], z + 8], 180 * s, [1, .5, .2], .5);
  if (!quiet) playAt(s > .9 ? 'watrIn' : 'watrSplash', p, Math.min(1, .35 + s * .35));
}
function fxBubbles(p, n, spread) {
  const surf = surfaceAbove(p, 400), top = surf ? surf[2] : p[2] + 200;
  for (let i = 0; i < n; i++) addPart({ p: [p[0] + crand() * spread, p[1] + crand() * spread, p[2] + crand() * spread], v: [crand() * 15, crand() * 15, rnd(20, 60)], life: rnd(1, 3), size0: rnd(.8, 2.6), size1: 1.4, kind: 6, blend: 1, ramp: 'lin', c0: [.9, .97, 1, .8], c1: [.9, .97, 1, .3], buoy: 90, drag: 1.5, killAbove: top });
}
function fxRipple(p, s) { addPart({ p: [p[0], p[1], p[2] + .6], v: [0, 0, 0], life: 1.2, size0: 6 * s, size1: 30 * s, kind: 4, blend: 1, ramp: 'lin', c0: [.85, .92, 1, .45], c1: [.85, .92, 1, 0] }); }
function waterEntry(a, b, s) { // hitscan crossing a liquid surface
  if (Q.pointContents(a) & Q.MASK_WATER) return; const t = Q.trace(a, Z3, Z3, b, Q.MASK_WATER, true);
  if (t.fraction < 1 && !t.startsolid) { fxSplash(t.endpos, s, liquidAt(t.endpos.map((v, i) => v - t.normal[i] * 2))); for (let i = 0; i < 6; i++) { const f = .03 * i; } }
}
function crossWater(a, b, s) { const ia = Q.pointContents(a) & Q.MASK_WATER, ib = Q.pointContents(b) & Q.MASK_WATER; if (!ia === !ib) return false; const p = surfaceBetween(a, b); if (p) fxSplash(p, s, liquidAt(ia ? a : b)); return true; }

// ---------- main loop ----------
let last = performance.now(), acc = 0, fpsN = 0, fpsT = 0, fps = 0, hudT = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now; realTime += dt * 1000;
  if (running && world && !CON.open) {
    acc += dt * 1000; let n = 0;
    while (acc >= S.tick && n < 40) { acc -= S.tick; tick(S.tick); n++; }
    if (n >= 40) acc = 0;
  }
  if (attract && !running && world) { // title screen: drift around the test map
    const t = realTime / 1000; yaw = ((attractYaw + t * 6) % 360 + 540) % 360 - 180; pitch = 6 + Math.sin(t * .23) * 5;
    ps.origin = attractPos.map(v => Math.round(v * 8)); prevOrigin = ps.origin.slice(); ps.velocity = [0, 0, 0];
    if (Math.random() < dt * .35) { const a = (yaw + 60 + Math.random() * 120) * Math.PI / 180, r = 500 + Math.random() * 900; fxExplosion([attractPos[0] + Math.cos(a) * r, attractPos[1] + Math.sin(a) * r, attractPos[2] - 20], [0, 0, 1], Math.random() < .5 ? 'rocket' : 'grenade'); }
    updateFx(dt);
  }
  if (running && !CON.open) { updateFx(dt); updateRagdolls(dt); }
  if (gl) { try { render(running ? acc / S.tick : 1, dt); if (!menu.hidden) renderPreview(); } catch (e) { console.error(e); } }
  fpsN++; fpsT += dt; if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  hudT += dt; if (hudT > 0.05 && world) { hudT = 0; updateHud(); }
  requestAnimationFrame(frame);
}
function updateHud() {
  const xy = Math.hypot(ps.velocity[0], ps.velocity[1]) / 8;
  $('spd').textContent = Math.round(xy); $('top').textContent = 'top ' + Math.round(topSpeed);
  if ($('wpn').textContent === '') updateWeaponHud(false);
  const hurtable = canHurt(); $('vitals').hidden = !hurtable;
  if (hurtable) { $('hp').textContent = Math.max(0, Math.ceil(PL.health)); $('hp').className = PL.health <= 25 ? 'low' : ''; $('ar').textContent = PL.armor; $('arw').hidden = !PL.armor; }
  const pw = []; if (PL.quad > simTime) pw.push('QUAD ' + Math.ceil((PL.quad - simTime) / 1000)); if (PL.invul > simTime) pw.push('INVULN ' + Math.ceil((PL.invul - simTime) / 1000)); $('pw').textContent = pw.join('  '); updateSquadHud(); { const pf = $('powfx'), c = PL.quad > simTime ? 'quad' : PL.invul > simTime ? 'inv' : '', end = c && Math.min(PL.quad > simTime ? PL.quad : 1e12, PL.invul > simTime ? PL.invul : 1e12) - simTime < 5000 ? '1' : ''; if (pf.dataset.c !== c) pf.dataset.c = c; if ((pf.dataset.e || '') !== end) pf.dataset.e = end; }
  $('kills').textContent = BOT.on && BOT.mode === 'dm' ? matchLine() : BOT.on && BOT.timeLimit && !BOT.over ? `KILLS ${PL.kills}/${PL.total}  ·  ${matchLine().split('\n')[0].split('  ·  ').pop()}` : PL.total ? `KILLS ${PL.kills}/${PL.total}` : '';
  const st = ps.noclip ? 'NOCLIP' : pm.waterlevel >= 2 ? 'SWIM' : Q.pml.ladder ? 'LADDER' : pm.ground ? 'GROUND' : 'AIR';
  const o = ps.origin.map(v => Math.round(v / 8));
  $('info').textContent = `${world.name}${world.message ? ' — ' + world.message : ''}\n${fps} fps · ${Math.round(1000 / S.tick)} Hz pmove\n${st}${ps.flags & Q.PMF_DUCKED ? ' · DUCK' : ''}${S.third ? ' · 3RD PERSON' : ''}\n${o.join(' ')}`;
}

// ---------- input ----------
let toastTimer = 0;
function toast(t, ms = 2500) { const e = $('toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => e.style.opacity = 0, ms); }
function toggleThird() { S.third = !S.third; saveS(); $('third').checked = S.third; toast(S.third ? 'third-person camera' : 'first-person camera', 1200); }
addEventListener('keydown', e => {
  if (e.code === 'Backquote' && e.target !== conIn) { e.preventDefault(); toggleConsole(); return; }
  if (CON.open) return;
  if (!running) { if (e.code === 'Enter' && loaded && e.target.tagName !== 'INPUT') startGame(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Escape') { pauseGame(); return; }
  if (e.code === 'F5') { e.preventDefault(); saveGame('Quicksave'); return; }
  if (e.code === 'F9') { e.preventDefault(); const q = SAVE.mem.slots.find(x => x.label === 'Quicksave'); if (q) loadSnap(q); else toast('No quicksave yet — press F5'); return; }
  if (e.code === 'KeyV') { ps.noclip = !ps.noclip; toast(ps.noclip ? 'noclip ON' : 'noclip OFF'); }
  if (e.code === 'KeyR') { spawnIdx = (spawnIdx + 1) % world.spawns.length; respawn(spawnIdx); toast(`spawn ${spawnIdx + 1}/${world.spawns.length}`); }
  if (e.code === 'KeyT') topSpeed = 0;
  if (e.code === 'KeyH') toggleThird();
  const wi = curSet().findIndex(d => d.key === e.code); if (wi >= 0) selectWeapon(wi);
  if (e.code === 'KeyQ' && hasWeapon(curW().last)) selectWeapon(curW().last);
  if (e.code === 'KeyE') cycleWeapon(1);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseFire = mouseJump = false; });
const locked = () => document.pointerLockElement === cv;
let lockFallback = false, touchActive = false;
addEventListener('mousemove', e => {
  if (!running || CON.open || touchActive || (!locked() && !lockFallback)) return;
  yaw -= e.movementX * S.sens * 0.022; pitch += e.movementY * S.sens * 0.022 * (S.invert ? -1 : 1);
  pitch = Math.max(-89, Math.min(89, pitch)); yaw = ((yaw % 360) + 540) % 360 - 180;
});
cv.addEventListener('mousedown', e => {
  if (!running || CON.open) return;
  if (!locked() && !lockFallback) { requestLock(); return; }
  if (e.button === 0) mouseFire = true; if (e.button === 2) mouseJump = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; if (e.button === 2) mouseJump = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (running) { jumpPulse = 1; e.preventDefault(); } }, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!locked() && running && !lockFallback && !touchActive && !changing && !CON.open && !SAVE.menuUp) pauseGame(); });
function requestLock() {
  if (locked()) return;
  const fallback = () => { lockFallback = true; toast('Mouse lock blocked here — open the page in its own tab for mouse look', 5000); };
  try {
    const p = cv.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(fallback); } catch (e) { fallback(); } });
  } catch (e) { fallback(); }
}
const tl = $('touch');
function setupTouch() {
  tl.hidden = false; touchActive = true;
  const knob = $('knob'), stick = $('stick');
  tl.addEventListener('touchstart', e => {
    e.preventDefault(); ensureAudio();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !touch.joy) { touch.joy = { id: t.identifier, x: t.clientX, y: t.clientY }; stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.style.opacity = 1; }
      else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  tl.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (touch.joy && t.identifier === touch.joy.id) {
        let dx = (t.clientX - touch.joy.x) / 55, dy = (t.clientY - touch.joy.y) / 55; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        touch.jx = dx; touch.jy = dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`;
      } else if (touch.look && t.identifier === touch.look.id) {
        yaw -= (t.clientX - touch.look.x) * S.sens * 0.07; pitch += (t.clientY - touch.look.y) * S.sens * 0.07 * (S.invert ? -1 : 1);
        pitch = Math.max(-89, Math.min(89, pitch)); yaw = ((yaw % 360) + 540) % 360 - 180; touch.look.x = t.clientX; touch.look.y = t.clientY;
      }
    }
  }, { passive: false });
  const end = e => { for (const t of e.changedTouches) { if (touch.joy && t.identifier === touch.joy.id) { touch.joy = null; touch.jx = touch.jy = 0; knob.style.transform = ''; stick.style.opacity = .35; } if (touch.look && t.identifier === touch.look.id) touch.look = null; } };
  tl.addEventListener('touchend', end); tl.addEventListener('touchcancel', end);
  const btn = (id, k) => { const b = $(id); b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); touch[k] = true; b.classList.add('on'); }, { passive: false }); const up = e => { e.preventDefault(); e.stopPropagation(); touch[k] = false; b.classList.remove('on'); }; b.addEventListener('touchend', up); b.addEventListener('touchcancel', up); };
  btn('tJump', 'jump'); btn('tDuck', 'duck'); btn('tFire', 'fire');
  $('tMenu').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); pauseGame(); }, { passive: false });
  $('t3p').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); toggleThird(); }, { passive: false });
  $('tWpn').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); cycleWeapon(1); }, { passive: false });
}

// ---------- menu / flow ----------
const menu = $('menu');
function startGame() {
  if (!world) return;
  attract = false;
  ensureAudio(); menu.hidden = true; running = true; last = performance.now(); acc = 0; keys.clear();
  preloadWorldSounds();
  for (const sp of speakers) if (sp.startOn && !sp.src) speakerOn(sp);
  if (musicEl) { musicEl.volume = S.music; musicEl.play().catch(() => {}); }
  $('hud').hidden = false;
  if (isTouch) { if (!touchActive) setupTouch(); tl.hidden = false; } else requestLock();
  if (world.message) toast(world.message, 3000);
  else toast(isTouch ? 'Left thumb: move · right: look' : 'WASD move · SPACE/wheel jump · C duck · click fire · H 3rd person · R respawn · V noclip', 4500);
}
function pauseGame() {
  if (CON.open) { CON.open = false; $('console').hidden = true; }
  running = false; menu.hidden = false; keys.clear(); mouseFire = mouseJump = false; touch.jump = touch.duck = touch.fire = false;
  tl.hidden = true; hideDeathMenu(); $('mainSaves').hidden = true; $('saveBtn').hidden = !(spLike() && !PL.dead); $('resume').hidden = !world || (spLike() && PL.dead); if (typeof showScreen === 'function') showScreen('main'); if (locked()) document.exitPointerLock(); setLoop(null);
  if (AC && AC.state === 'running') AC.suspend().catch(() => {}); if (musicEl) musicEl.pause();
  refreshPreview();
}
const setStatus = (t, err) => { const s = $('status'); s.textContent = t; s.classList.toggle('err', !!err); };
function demoEnts() { const d = Q.demoMap(); return [...d.barrels.map(b => ({ classname: 'misc_explobox', origin: b.join(' ') })), ...(S.testEnemies ? d.monsters.map(([c, x, y, z, a]) => ({ classname: c, origin: `${x} ${y} ${z}`, angle: String(a) })) : []), ...d.items.map(([c, x, y, z]) => ({ classname: c, origin: `${x} ${y} ${z}` }))]; }
$('playDemo').onclick = () => startBuiltin('test', false);
$('playKappa').onclick = () => startBuiltin('kappa', true);
function resetPlayer() { PL.dead = false; PL.health = 100; PL.maxHealth = 100; PL.armor = 0; PL.armorFrac = 0; PL.quad = PL.invul = 0; $('dead').hidden = true; }
$('resume').onclick = () => startGame();
$('botBtn').onclick = () => startBotMatch(+$('botCount').value, $('mpMap').value, $('matchMode').value, { frag: +$('mpFrag').value, time: +$('mpTime').value });
$('botCount').value = String(BOT.count); $('botCount').onchange = () => { BOT.count = +$('botCount').value; fillBotSlots(); };
$('matchMode').onchange = fillMpMap; fillMpMap();
$('botSkill').value = String(S.skill); $('botSkill').onchange = () => { S.skill = +$('botSkill').value; $('skill').value = String(S.skill); saveS(); };
// title-screen pages: main → play → singleplayer / multiplayer, plus options and the notes
const SCR_PARENT = { main: null, play: 'main', sp: 'play', mp: 'play', options: 'main', sim: 'main' }, SCR_NAME = { main: 'MAIN MENU', play: 'PLAY', sp: 'PLAY / SINGLEPLAYER', mp: 'PLAY / MULTIPLAYER', options: 'OPTIONS', sim: "WHAT'S SIMULATED" };
let curScr = 'main';
function showScreen(n) { curScr = n; if (n === 'mp') fillBotSlots(); document.querySelectorAll('#menu [data-scr]').forEach(e => { e.hidden = e.dataset.scr !== n; }); $('crumb').textContent = SCR_NAME[n]; $('backBtn').hidden = !SCR_PARENT[n]; const m = document.querySelector('#menu .panel'); if (m) m.scrollTop = 0; }
document.querySelectorAll('#menu [data-go]').forEach(b => { b.onclick = () => showScreen(b.dataset.go); });
$('backBtn').onclick = () => showScreen(SCR_PARENT[curScr] || 'main'); showScreen('main');
$('campaign').onclick = () => loadMap('maps/base1.bsp');
async function addFiles(list) {
  const files = [...list].filter(f => /\.(pak|zip|pk3|pkz|bsp|wal|pcx|tga|wav|png|jpg|md2|md3|skin|shader|cfg|ogg|mp3|flac)$/i.test(f.name));
  if (!files.length) { setStatus('No usable files there — I need .pak, .zip/.pk3 or .bsp files.', true); return; }
  resetLgTex();
  files.sort((a, b) => { const pa = /\.pak$/i.test(a.name), pb = /\.pak$/i.test(b.name); return pa !== pb ? (pa ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }); });
  for (const f of files) {
    setStatus(`Reading ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`);
    try {
      const buf = await f.arrayBuffer(), ln = f.name.toLowerCase();
      if (ln.endsWith('.pak')) { if (Q.readPak(buf, vfsPut) < 0) throw new Error(f.name + ' is not a PACK file'); }
      else if (/\.(zip|pk3|pkz)$/.test(ln)) { if (await Q.readZip(buf, vfsPut) < 0) throw new Error(f.name + ' is not a zip'); }
      else if (ln.endsWith('.bsp') && !(f.webkitRelativePath || '').includes('/maps/')) { const u = new Uint8Array(buf); vfsPut('maps/' + f.name, () => u); }
      else if (/\.(ogg|mp3|flac)$/.test(ln) && !(f.webkitRelativePath || '').includes('/music/')) { const u = new Uint8Array(buf); vfsPut('music/' + f.name, () => u); }
      else { const u = new Uint8Array(buf); vfsPut(Q.stripBase(f.webkitRelativePath || f.name), () => u); }
    } catch (e) { setStatus(e.message, true); }
  }
  vfsVersion++; palette = null; soundsFor = -1; md2Cache.clear(); md3Cache.clear(); shadersFor = -1; mapInfoCache.clear(); for (const k in MM) delete MM[k]; for (const k in IM) delete IM[k]; if (AC) ensureAudio();
  if (mainCtx) { mainCtx.tex.clear(); mainCtx.inst.clear(); } if (pctx) { pctx.tex.clear(); pctx.inst.clear(); }
  await listMaps();
  refreshCharacter();
  const maps = [...VFS.keys()].filter(k => /^maps\/.*\.bsp$/.test(k)).length, chars = listPlayerModels().length, c3 = listQ3Models().length;
  setStatus(`${VFS.size} files mounted · ${maps} map${maps === 1 ? '' : 's'} · ${chars} Quake II and ${c3} Quake III player model${c3 === 1 ? '' : 's'}. Pick a map.`);
}
const mapInfoCache = new Map();
async function mapInfo(path) {
  if (mapInfoCache.has(path)) return mapInfoCache.get(path);
  let info = { cat: 'other', title: '' };
  const d = await vfsGet(path);
  if (d && d.length > 160) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), mg = String.fromCharCode(d[0], d[1], d[2], d[3]);
    if (mg === 'IBSP' || mg === 'QBSP') {
      const o = dv.getInt32(8, true), l = Math.min(dv.getInt32(12, true), d.length - o);
      const s = new TextDecoder('latin1').decode(d.subarray(o, o + l));
      info.cat = dv.getInt32(4, true) >= 46 ? 'q3' : /"classname"\s*"(monster_|target_changelevel)/.test(s) ? 'sp' : /"info_player_deathmatch"/.test(s) ? 'dm' : 'other';
      const m = s.match(/"message"\s*"([^"]*)"/); if (m) info.title = m[1].replace(/\\n/g, ' ').trim();
    } else info.cat = 'bad';
  }
  mapInfoCache.set(path, info); return info;
}
function fillMpMap() { // Deathmatch picks any arena; Co-op picks a single-player unit
  const sel = $('mpMap'), coop = $('matchMode').value === 'coop', keep = sel.value; $('mapLbl').textContent = coop ? 'Unit' : 'Map'; $('fragRow').classList.toggle('off', coop);
  sel.innerHTML = ''; const add = (v, t, g) => { const o = document.createElement('option'); o.value = v; o.textContent = t; (g || sel).appendChild(o); };
  const grp = (label, list) => { if (!list || !list.length) return; const g = document.createElement('optgroup'); g.label = label; for (const [m, i] of list) add(m, `${m.slice(5, -4)} — ${i.title}`, g); sel.appendChild(g); };
  add('test', 'Test map'); add('kappa', coop ? 'Outpost Kappa (built-in campaign)' : 'Outpost Kappa (built-in)');
  if (MAPCAT) { if (coop) grp('Single-player units', MAPCAT.sp); else { grp('Quake II deathmatch', MAPCAT.dm); grp('Quake III arenas', MAPCAT.q3); grp('Other maps', MAPCAT.other); grp('Single-player maps', MAPCAT.sp); } }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : (sel.options.length > 1 ? sel.options[1].value : 'test');
}
async function listMaps() {
  try { if (curScr === 'mp') fillBotSlots(); } catch (e) {}
  const box = $('maps'), filt = $('mapFilter').value.trim().toLowerCase();
  const maps = [...VFS.keys()].filter(k => /^maps\/.*\.bsp$/.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  $('mapsBox').hidden = !maps.length; $('campaign').hidden = !VFS.has('maps/base1.bsp');
  const groups = { sp: [], dm: [], q3: [], other: [], bad: [] };
  for (const m of maps) { const i = await mapInfo(m); groups[i.cat].push([m, i]); }
  MAPCAT = groups; fillMpMap();
  box.innerHTML = '';
  const labels = { sp: 'Quake II single-player', dm: 'Quake II deathmatch', q3: 'Quake III arenas', other: 'Other', bad: 'Unsupported format' };
  for (const k of ['sp', 'dm', 'q3', 'other', 'bad']) {
    const items = groups[k].filter(([m, i]) => !filt || m.includes(filt) || i.title.toLowerCase().includes(filt));
    if (!items.length) continue;
    const h = document.createElement('div'); h.className = 'mhead'; h.textContent = `${labels[k]} · ${items.length}`; box.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'mgrid'; box.appendChild(grid);
    for (const [m, i] of items) {
      const b = document.createElement('button'); b.className = 'map'; b.disabled = k === 'bad';
      b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = m.slice(5, -4); b.lastChild.textContent = i.title;
      b.onclick = () => loadMap(m); grid.appendChild(b);
    }
  }
}
async function loadMap(path, spot, keepRunning) {
  if (!gl) return; lastMapPath = path;
  setStatus('Loading ' + path + '…'); loadingMap = true; if (!keepRunning) { resetPlayer(); campaignMode = true; resetInventory(!!S.allWeapons); }
  try {
    const hd = await vfsGet(path), isQ3 = hd && hd.length > 8 && new DataView(hd.buffer, hd.byteOffset, hd.byteLength).getInt32(4, true) >= 46;
    const w = await (isQ3 ? buildQ3World : buildBSPWorld)(path, t => { setStatus(path + ' — ' + t); if (keepRunning) toast('Loading ' + w_name(path) + ' — ' + t, 8000); });
    setWorld(w, spot); loaded = true;
    setStatus(`${w.name}: ${w.tris.toLocaleString()} triangles · ${E.monsters.length} monsters · ${E.items.length} items · ${speakers.length} sound emitters`);
    loadingMap = false;
    if (keepRunning && running) { toast(w.message || w.name, 3000); } else startGame();
  } catch (e) { console.error(e); loadingMap = false; setStatus(e.message || String(e), true); if (keepRunning) toast('Could not load ' + path + ': ' + e.message, 5000); }
}
const w_name = p => p.replace(/^maps\//, '').replace(/\.bsp$/, '');
$('files').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('folder').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('mapFilter').oninput = () => listMaps();
addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
addEventListener('dragleave', e => { if (e.target === document.body || !e.relatedTarget) document.body.classList.remove('drag'); });
addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drag'); if (running) pauseGame(); addFiles(e.dataTransfer.files); });

function bindRange(id, key, fmt) { const el = $(id), out = $(id + 'V'); el.value = S[key]; out.textContent = fmt(S[key]); el.oninput = () => { S[key] = +el.value; out.textContent = fmt(S[key]); saveS(); if (key === 'vol' && master) master.gain.value = S.vol; }; }
bindRange('sens', 'sens', v => v.toFixed(1)); bindRange('fov', 'fov', v => v + '°'); bindRange('bright', 'bright', v => v.toFixed(1) + '×'); bindRange('vol', 'vol', v => Math.round(v * 100) + '%');
{ const lb = $('lgBeam'); lb.value = S.lgBeam || 'new'; lb.onchange = () => { S.lgBeam = lb.value; saveS(); }; }
const tk = $('tick'); tk.value = S.tick; tk.onchange = () => { S.tick = +tk.value; saveS(); };
for (const [id, key, num] of [['skill', 'skill', 1], ['hurt', 'hurt', 0]]) { const el = $(id); el.value = S[key]; el.onchange = () => { S[key] = num ? +el.value : el.value; saveS(); }; }
bindRange('music', 'music', v => Math.round(v * 100) + '%'); { const el = $('ragdoll'); el.checked = S.ragdoll; el.onchange = () => { S.ragdoll = el.checked; saveS(); }; } $('music').addEventListener('input', () => { if (musicEl) musicEl.volume = S.music; });
for (const k of ['run', 'autohop', 'invert', 'third', 'testEnemies', 'allWeapons', 'infAmmo']) { const el = $(k); el.checked = S[k]; el.onchange = () => { S[k] = el.checked; saveS(); }; }
$('allWeapons').addEventListener('change', () => { ensureOwnedWeapon(); updateWeaponHud(false); });
if (isTouch) document.body.classList.add('touch');
if (isTouch || !('webkitdirectory' in document.createElement('input'))) $('folder').removeAttribute('webkitdirectory');
// ---------- console ----------
// ` (or the ›_ buttons) drops it down; the game freezes while it's open. give/god/noclip/kill need sv_cheats 1, as in Quake.
const CON = { open: false, resume: false, hist: [], hi: -1, cheats: false };
const conLog = $('conLog'), conIn = $('conIn');
function conPrint(t, cls) {
  const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = t; conLog.appendChild(d);
  while (conLog.childNodes.length > 500) conLog.firstChild.remove(); conLog.scrollTop = conLog.scrollHeight;
}
function openConsole() {
  if (CON.open) return; CON.open = true; $('console').hidden = false; CON.resume = running;
  keys.clear(); mouseFire = mouseJump = false; touch.jump = touch.duck = touch.fire = false; setLoop(null);
  if (locked()) document.exitPointerLock();
  setTimeout(() => conIn.focus(), 30);
}
function closeConsole() {
  if (!CON.open) return; CON.open = false; $('console').hidden = true; conIn.blur(); keys.clear();
  if (CON.resume && running) { last = performance.now(); acc = 0; if (!isTouch) requestLock(); }
}
const toggleConsole = () => (CON.open ? closeConsole() : openConsole());
const cheatsOK = () => { if (CON.cheats) return true; conPrint('Cheats are not enabled on this server. Type sv_cheats 1 first.', 'err'); return false; };
const normName = s => String(s).toLowerCase().replace(/^(weapon|item|ammo|key|holdable)_/, '').replace(/[^a-z0-9]/g, '');
function giveTargets() {
  const T = [];
  WEAPONS.forEach((d, i) => T.push({ name: d.name, set: 'Quake II', kind: 'weapon', fn: () => { INV.q2.add(i); giveAmmoFor(i, null); } }));
  Q3W.forEach((d, i) => T.push({ name: d.name, set: 'Quake III', kind: 'weapon', fn: () => { INV.q3.add(i); giveAmmoFor(null, i); } }));
  const items = world && world.q3 ? [ITEMS_Q3, ITEMS] : [ITEMS, ITEMS_Q3], seen = new Set(T.map(t => normName(t.name)));
  for (const tbl of items) for (const [cls, d] of Object.entries(tbl)) {
    if (d.w && !d.key && /^weapon_/.test(cls)) continue; const nm = d.n || cls, k = normName(nm); if (seen.has(k)) continue; seen.add(k);
    T.push({ name: nm, cls, kind: d.key ? 'key' : d.am ? 'ammo' : 'item', fn: () => applyItemFx(d, cls) });
  }
  return T;
}
function applyItemFx(d, cls) { // the pickup's effect, without the "already full" checks
  if (d.h) PL.health = Math.max(PL.health, Math.min(d.hmax === 200 ? Math.max(200, PL.maxHealth) : PL.maxHealth, PL.health + d.h));
  if (d.a) { const f = d.af || .3; if (PL.armorFrac <= f) { PL.armor = Math.round(PL.armor * (PL.armorFrac || 0) / f) + d.a; PL.armorFrac = f; } else PL.armor = Math.min(200, PL.armor + Math.round(d.a * f / PL.armorFrac)); }
  if (d.quad) PL.quad = Math.max(PL.quad, simTime) + d.quad * 1000;
  if (d.inv) PL.invul = Math.max(PL.invul, simTime) + d.inv * 1000; if (d.quad || d.inv) powPop(d.quad ? 'quad' : 'inv');
  if (d.adr) { PL.maxHealth++; PL.health = Math.max(PL.health, PL.maxHealth); }
  if (d.maxh) PL.maxHealth += d.maxh;
  if (d.key && E.keys) E.keys.add(cls);
  const ai = AMMO_ITEM[cls]; if (d.am && ai) addAmmo(ai[0], world.q3 ? ai[2] : ai[1]);
}
function findGive(q) {
  const T = giveTargets(), n = normName(q);
  let hit = T.filter(t => normName(t.name) === n || (t.cls && normName(t.cls) === n)); if (hit.length) return hit;
  hit = T.filter(t => normName(t.name).startsWith(n)); if (hit.length) return hit;
  return T.filter(t => normName(t.name).includes(n));
}
function cmdGive(args) {
  if (!cheatsOK()) return; if (!world) { conPrint('Start a map first.', 'err'); return; }
  const q = args.join(' ').trim(), num = /\s(\d+)$/.test(q) ? +q.match(/\s(\d+)$/)[1] : null, what = num !== null ? q.replace(/\s\d+$/, '') : q;
  if (!what) { conPrint('usage: give all | health [n] | armor [n] | weapons | <weapon, item or powerup name>', 'dim'); return; }
  const w = normName(what);
  if (w === 'all' || w === 'weapons') {
    INV.q2 = new Set(range(0, WEAPONS.length - 1)); INV.q3 = new Set(range(0, Q3W.length - 1)); fillAmmo();
    if (w === 'all') {
      PL.health = Math.max(PL.health, PL.maxHealth); PL.armor = 200; PL.armorFrac = world.q3 ? .66 : .8;
      for (const [cls, d] of Object.entries(ITEMS)) if (d.key) E.keys.add(cls);
    }
    updateWeaponHud(true); conPrint(w === 'all' ? 'Gave everything: all weapons, health, 200 armor, keys.' : 'Gave all weapons.', 'ok'); return;
  }
  if (w === 'ammo') { fillAmmo(); conPrint('Gave full ammo.', 'ok'); return; }
  if (w === 'health') { PL.health = num !== null ? num : PL.maxHealth; PL.dead = PL.health <= 0 ? PL.dead : PL.dead; conPrint(`health ${PL.health}`, 'ok'); return; }
  if (w === 'armor' || w === 'armour') { PL.armor = num !== null ? num : 200; PL.armorFrac = PL.armorFrac || (world.q3 ? .66 : .8); conPrint(`armor ${PL.armor}`, 'ok'); return; }
  let hit = findGive(what);
  if (!hit.length) { conPrint(`unknown item: ${what}`, 'err'); return; }
  let names = [...new Set(hit.map(h => normName(h.name)))];
  if (names.length > 1) { const wn = [...new Set(hit.filter(h => h.kind === 'weapon').map(h => normName(h.name)))]; if (wn.length === 1) { hit = hit.filter(h => normName(h.name) === wn[0]); names = wn; } }
  if (names.length > 1) { conPrint(`"${what}" could be: ${[...new Set(hit.map(h => h.name))].slice(0, 12).join(', ')}`, 'err'); return; }
  for (const h of hit) h.fn();
  const sets = hit.filter(h => h.kind === 'weapon').map(h => h.set);
  conPrint(`Gave ${hit[0].name}${sets.length ? ' (' + sets.join(' + ') + ' weapons)' : ''}.`, 'ok');
  if (hit.some(h => h.kind === 'weapon')) {
    const L = curSet(), i = L.findIndex(d => normName(d.name) === normName(hit[0].name)); if (i >= 0 && running && !PL.dead) selectWeapon(i); else updateWeaponHud(true);
  }
}
const cvarShow = (k, v) => conPrint(`"${k}" is "${v}"`);
const COMMANDS = {
  help: ['list commands', () => { conPrint('Commands', 'hd'); for (const [k, [d]] of Object.entries(COMMANDS)) conPrint(`  ${k.padEnd(16)} ${d}`); }],
  cmdlist: ['same as help', () => COMMANDS.help[1]([])],
  clear: ['clear the console', () => { conLog.textContent = ''; }],
  echo: ['print text', a => conPrint(a.join(' '))],
  sv_cheats: ['0 or 1: allow cheat commands', a => {
    if (!a.length) return cvarShow('sv_cheats', CON.cheats ? 1 : 0);
    CON.cheats = !!+a[0]; conPrint(CON.cheats ? 'Cheats enabled.' : 'Cheats disabled.', CON.cheats ? 'ok' : 'dim');
    if (!CON.cheats) { PL.god = false; if (ps.noclip) ps.noclip = false; }
  }],
  give: ['give all | <weapon, item or powerup> [amount]', cmdGive],
  god: ['toggle god mode (cheat)', () => { if (!cheatsOK()) return; PL.god = !PL.god; conPrint('godmode ' + (PL.god ? 'ON' : 'OFF'), 'ok'); }],
  noclip: ['toggle noclip (cheat)', () => { if (!cheatsOK()) return; ps.noclip = !ps.noclip; conPrint('noclip ' + (ps.noclip ? 'ON' : 'OFF'), 'ok'); }],
  save: ['[name] save the game (singleplayer / co-op)', a => { if (saveGame(a.join(' ') || 'Quicksave')) conPrint('Game saved.', 'ok'); else conPrint('Cannot save now.', 'err'); }],
  load: ['[name] load a saved game, or "auto" for the autosave', a => { const n = a.join(' ').toLowerCase(), s = n === 'auto' ? SAVE.mem.auto : SAVE.mem.slots.find(x => !n || x.label.toLowerCase() === n); if (!s) { conPrint('No such save. Saves: ' + (SAVE.mem.slots.map(x => x.label).join(', ') || 'none'), 'err'); return; } closeConsole(); loadSnap(s); }],
  quicksave: ['same as save', () => COMMANDS.save[1]([])], quickload: ['load the quicksave', () => COMMANDS.load[1](['quicksave'])],
  kill: ['suicide', () => { if (!world || PL.dead) return; PL.god = false; playerDie(); conPrint('You died.', 'dim'); }],
  fov: ['[degrees] show or set the field of view', a => {
    if (!a.length) return cvarShow('fov', S.fov);
    const v = Math.max(10, Math.min(170, +a[0] || 90)); S.fov = v; saveS(); $('fov').value = v; $('fovV').textContent = v + '°'; conPrint(`fov ${v}`, 'ok');
  }],
  showviewmodel: ['[0|1] hide or show the first-person weapon', a => {
    S.viewmodel = a.length ? !!+a[0] : S.viewmodel === false; saveS(); conPrint(`showviewmodel ${S.viewmodel ? 1 : 0}`, 'ok');
  }],
  cg_drawgun: ['same as showviewmodel', a => COMMANDS.showviewmodel[1](a)],
  r_drawviewmodel: ['same as showviewmodel', a => COMMANDS.showviewmodel[1](a)],
  sensitivity: ['[n] mouse sensitivity', a => { if (!a.length) return cvarShow('sensitivity', S.sens); S.sens = Math.max(.1, +a[0] || S.sens); saveS(); $('sens').value = S.sens; $('sensV').textContent = S.sens.toFixed(1); conPrint(`sensitivity ${S.sens}`, 'ok'); }],
  cg_thirdperson: ['[0|1] third-person camera', a => { if (!a.length) return cvarShow('cg_thirdperson', S.third ? 1 : 0); if (!!+a[0] !== S.third) toggleThird(); conPrint(`cg_thirdperson ${S.third ? 1 : 0}`, 'ok'); }],
  maps: ['list the maps you have loaded', () => { const m = [...VFS.keys()].filter(k => /^maps\/.*\.bsp$/.test(k)).map(k => k.slice(5, -4)); conPrint(m.length ? m.join('  ') : 'No maps loaded. Drop a .pak or .pk3 on the page.', m.length ? '' : 'dim'); }],
  map: ['<name> load a map', a => {
    if (!a.length) { conPrint('usage: map <name>   (try "maps")', 'dim'); return; }
    if (BUILTIN_MAPS[a[0].toLowerCase()]) { const id = a[0].toLowerCase(); closeConsole(); startBuiltin(id, BUILTIN_MAPS[id].campaign); return; } // built-in: test, kappa
    const path = 'maps/' + a[0].toLowerCase().replace(/\.bsp$/, '') + '.bsp'; if (!VFS.has(path)) { conPrint(`Can't find ${path}`, 'err'); return; }
    conPrint(`Loading ${path}…`, 'dim'); closeConsole(); loadMap(path);
  }],
  botmatch: ['botmatch [bots] [map] [dm|coop] — a bot match (1-7 bots) on the last map or any map you name', a => {
    let p = null, n = 0, mode = null;
    for (const t of a) { if (/^\d+$/.test(t)) n = +t; else if (/^(dm|deathmatch)$/i.test(t)) mode = 'dm'; else if (/^coop$/i.test(t)) mode = 'coop'; else if (BUILTIN_MAPS[t.toLowerCase()]) p = t.toLowerCase(); else { p = 'maps/' + t.toLowerCase().replace(/\.bsp$/, '') + '.bsp'; if (!VFS.has(p)) { conPrint(`Can't find ${p}`, 'err'); return; } } }
    closeConsole(); startBotMatch(n || BOT.count, p, mode || $('matchMode').value, { frag: +$('mpFrag').value, time: +$('mpTime').value });
  }],
  coop: ['coop [bots] [map] — bots fight beside you against the level\'s monsters', a => runCommand('botmatch ' + a.join(' ') + ' coop')],
  deathmatch: ['deathmatch [bots] [map] — free-for-all against bots', a => runCommand('botmatch ' + a.join(' ') + ' dm')],
  addbot: ['add a bot to the match', () => { if (!BOT.on) { conPrint('No bot match running — use botmatch.', 'err'); return; } if (BOT.bots.length >= 7) { conPrint('Too many bots.', 'err'); return; } spawnBot(); conPrint(`Added ${BOT.bots[BOT.bots.length - 1].name}.`, 'ok'); }],
  kickbots: ['remove every bot', () => { for (const b of BOT.bots) { b.hidden = true; b.takedamage = false; b.box.active = false; b.dead = true; b.respawnAt = 1e18; } E.monsters = E.monsters.filter(m => !m.bot); E.damageables = E.damageables.filter(m => !m.bot); BOT.bots = []; conPrint('Bots removed.', 'ok'); }],
  infammo: ['infammo [0|1] — unlimited ammo', a => { if (a.length) { S.infAmmo = a[0] !== '0'; saveS(); } conPrint(`"infammo" is "${S.infAmmo ? 1 : 0}"`); updateWeaponHud(false); }],
  disconnect: ['back to the title screen', () => { closeConsole(); if (running) pauseGame(); }],
};
function runCommand(line) {
  const raw = line.trim().replace(/^[/\\]+/, ''); if (!raw) return;
  conPrint('] ' + raw, 'cmd');
  for (const part of raw.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean); if (!toks.length) continue;
    const c = COMMANDS[toks[0].toLowerCase()];
    if (!c) { conPrint(`Unknown command "${toks[0]}". Type help.`, 'err'); continue; }
    try { c[1](toks.slice(1)); } catch (e) { conPrint(String(e && e.message || e), 'err'); }
  }
}
function completeLine(v) {
  const m = v.replace(/^[/\\]+/, ''), sp = m.indexOf(' ');
  if (sp < 0) { const c = Object.keys(COMMANDS).filter(k => k.startsWith(m.toLowerCase())); if (c.length === 1) return c[0] + ' '; if (c.length) conPrint(c.join('  '), 'dim'); return v; }
  const cmd = m.slice(0, sp).toLowerCase(), rest = m.slice(sp + 1);
  if (cmd === 'give') { const opts = ['all', 'health', 'armor', 'weapons', ...giveTargets().map(t => t.name.toLowerCase())], c = [...new Set(opts.filter(o => o.startsWith(rest.toLowerCase())))]; if (c.length === 1) return 'give ' + c[0]; if (c.length) conPrint(c.slice(0, 30).join(' · '), 'dim'); }
  if (cmd === 'map') { const c = [...VFS.keys()].filter(k => /^maps\/.*\.bsp$/.test(k)).map(k => k.slice(5, -4)).filter(k => k.startsWith(rest.toLowerCase())); if (c.length === 1) return 'map ' + c[0]; if (c.length) conPrint(c.slice(0, 40).join('  '), 'dim'); }
  return v;
}
conIn.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Backquote' || e.code === 'Escape') { e.preventDefault(); closeConsole(); return; }
  if (e.key === 'Enter') { const v = conIn.value; if (v.trim()) { CON.hist.push(v); if (CON.hist.length > 50) CON.hist.shift(); } CON.hi = -1; conIn.value = ''; runCommand(v); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!CON.hist.length) return; CON.hi = CON.hi < 0 ? CON.hist.length : CON.hi; CON.hi = Math.max(0, Math.min(CON.hist.length, CON.hi + (e.key === 'ArrowUp' ? -1 : 1))); conIn.value = CON.hist[CON.hi] || ''; return; }
  if (e.key === 'Tab') { e.preventDefault(); conIn.value = completeLine(conIn.value); }
});
conIn.addEventListener('keyup', e => e.stopPropagation());
$('conClose').onclick = () => closeConsole();
$('conBtn').onclick = () => openConsole();
for (const c of ['sv_cheats 1', 'give all', 'give quad', 'god', 'noclip', 'showviewmodel', 'fov 110', 'fov 90', 'help', 'clear']) {
  const b = document.createElement('button'); b.textContent = c; b.onclick = () => { runCommand(c); if (!isTouch) conIn.focus(); }; $('conChips').appendChild(b);
}
$('tCon').addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); openConsole(); }, { passive: false });
conPrint('CROSSOVER QUAKE console. Type help for commands. Cheats need sv_cheats 1.', 'hd');

if (gl) mainCtx = makeCtx(gl);
let attractPos = [0, 0, 0], attractYaw = 0;
if (gl) try { // the title screen floats over a live fly-around of the test map
  demoCache = buildDemoWorld(); demoCache.ents = demoEnts(); setWorld(demoCache);
  const o = ps.origin.map(v => v / 8), up = Q.trace(o, [-16, -16, -16], [16, 16, 16], [o[0], o[1], o[2] + 70], Q.MASK_SOLID, true).endpos;
  attractPos = up; attractYaw = yaw; attract = true;
} catch (e) { console.error(e); attract = false; }
renderCharUI([], []);
requestAnimationFrame(frame);
})();
