// The ODM-E1 console, laid out at 1600 x 900 around a clear centre for the rider: the header, G-LOAD (the felt load by
// axis against the human limits, the G-LOC oxygen budget, a scrolling chart with tolerance bands), TETHERS (each line's
// state, tension against the clutch, line out, speed, drum rpm, the fairlead shuttle), POWER & GAS (motor rpm, the bus
// that also regenerates, supercap and battery, the bottles and how cold they get), FLIGHT (speed, height, the current
// maneuver, a top-view map), the subsystem, view and display buttons, the sortie timeline, a note on why the current
// moment works, the callouts with leaders and the operator's cursor. update(u) redraws everything from the frame's
// state; nothing on it is typed in.
import {HEX} from './materials.js';

export const C = {ink: '#22252b', mute: '#868b93', faint: '#d3d6da', line: '#e3e5e8', panel: 'rgba(250,250,248,.95)', acc: HEX.accent, green: '#2fa36b', blue: '#3c79a8', amber: '#d9902a', red: '#c8352b', track: '#eceef0'};
export const SUBSYS = ['tanks', 'drive', 'reels', 'anchors', 'handles', 'blades', 'harness'];
export const SUBSYS_LABEL = {tanks: 'GAS', drive: 'DRIVE', reels: 'REELS', anchors: 'ANCHORS', handles: 'HANDLES', blades: 'BLADES', harness: 'HARNESS'};
export const VIEWS = ['hero', 'chase', 'side', 'core', 'reel', 'hands', 'nape', 'map'];
export const VIEW_LABEL = {hero: 'HERO', chase: 'CHASE', side: 'SIDE', core: 'CORE', reel: 'REEL', hands: 'HANDS', nape: 'NAPE', map: 'MAP'};
export const DISPLAY = ['labels', 'cutaway', 'xray', 'exploded', 'forces', 'trail'];
export const DISPLAY_LABEL = {labels: 'LABELS', cutaway: 'CUTAWAY', xray: 'X-RAY', exploded: 'EXPLODED', forces: 'FORCES', trail: 'TRAIL'};

const CSS = `
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}
.ui canvas{position:absolute}
.mo{font-family:'JetBrains Mono',ui-monospace,monospace}
.cp{position:absolute;background:${C.panel};border:1px solid ${C.line};border-radius:6px;box-shadow:0 2px 12px rgba(40,44,52,.07)}
.ph{position:absolute;display:flex;align-items:center;gap:9px;font:700 10.5px 'JetBrains Mono',monospace;letter-spacing:1.8px}
.ph i{display:block;width:3px;height:13px;background:${C.acc}}
.pn{position:absolute;font:500 9.5px 'JetBrains Mono',monospace;color:${C.mute};letter-spacing:1px}
.sm{font:500 9px 'JetBrains Mono',monospace;letter-spacing:1.5px;color:${C.mute};text-transform:uppercase;white-space:nowrap}
.v{font:600 11px 'JetBrains Mono',monospace;color:${C.ink};white-space:nowrap}
.bt{position:absolute;height:22px;padding:0 9px;display:flex;align-items:center;justify-content:center;border:1px solid ${C.faint};border-radius:4px;background:#fcfcfb;font:700 9.2px 'JetBrains Mono',monospace;letter-spacing:1.2px;color:${C.ink};white-space:nowrap;box-sizing:border-box}
.bt.on{background:${C.ink};border-color:${C.ink};color:#fff}
.bt.iso{background:${C.acc};border-color:${C.acc};color:#fff}
.bar{position:absolute;height:5px;background:${C.track};border-radius:3px;overflow:hidden}
.bar b{position:absolute;left:0;top:0;bottom:0;background:${C.acc};border-radius:3px}
.mk{position:absolute;width:1.5px;background:${C.ink};opacity:.55}
.chip{position:absolute;height:17px;padding:0 7px;border-radius:3px;display:flex;align-items:center;font:700 8.4px 'JetBrains Mono',monospace;letter-spacing:1.2px;color:#fff;white-space:nowrap}
.call{position:absolute;white-space:nowrap}
.call b{display:flex;align-items:center;gap:6px;font:700 9.4px 'JetBrains Mono',monospace;letter-spacing:1.3px;color:${C.ink}}
.call b i{display:block;width:6px;height:6px;background:${C.acc}}
.call span{display:block;font:500 7.8px 'JetBrains Mono',monospace;letter-spacing:1.2px;color:${C.mute};margin-top:2px}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${C.acc};opacity:0;z-index:49}
.note{position:absolute;font:500 10.2px/1.62 Inter,sans-serif;color:#4a4e56}
.note b{font-weight:700;color:${C.ink}}
`;
const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const STATE = {stowed: ['STOWED', C.mute], flight: ['IN FLIGHT', C.blue], anchored: ['SET', C.green], release: ['RELEASE', C.amber], retract: ['RETRIEVE', C.amber]};

export function createConsole(app, P, ph) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h) => {
    const n = el(h);
    ui.appendChild(n);
    return n;
  };
  const panel = (x, y, w, h, title, n) => {
    add(`<div class="cp" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
    add(`<div class="ph" style="left:${x + 14}px;top:${y + 12}px"><i></i>${title}</div>`);
    add(`<div class="pn" style="right:${1600 - x - w + 14}px;top:${y + 14}px">${n}</div>`);
  };
  const canvas = (x, y, w, h) => {
    const c = add(`<canvas style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></canvas>`);
    const k = 2;
    c.width = w * k;
    c.height = h * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    return {c, g, w, h};
  };
  const bar = (x, y, w, color = C.acc) => {
    const b = add(`<div class="bar" style="left:${x}px;top:${y}px;width:${w}px"><b style="background:${color}"></b></div>`);
    return {b: b.firstChild, w};
  };
  const setBar = (b, k) => (b.b.style.width = `${clamp(k, 0, 1) * b.w}px`);

  // ------------------------------------------------------------ header
  add(`<div style="position:absolute;left:0;top:0;width:150px;height:84px;background:${C.ink}"></div>`);
  add(`<svg style="position:absolute;left:24px;top:24px" width="40" height="36" viewBox="0 0 40 36"><g fill="none" stroke="#fff" stroke-width="2.2"><circle cx="9" cy="24" r="7"/><circle cx="31" cy="24" r="7"/><path d="M9 17 L20 6 L31 17"/></g><circle cx="20" cy="6" r="2.6" fill="${C.acc}"/></svg>`);
  add(`<div class="mo" style="position:absolute;left:74px;top:33px;color:#fff;font-size:14px;font-weight:700;letter-spacing:2px">E1</div>`);
  add(`<div class="sm" style="position:absolute;left:170px;top:20px;letter-spacing:2.4px">${P.name} · ENGINEERED · NOT CANON</div>`);
  add(`<div style="position:absolute;left:169px;top:34px;font-size:30px;font-weight:700;letter-spacing:-.6px;line-height:1">${P.title} <span style="color:${C.acc};font-weight:400">/</span></div>`);
  add(`<div class="mo" style="position:absolute;left:170px;top:70px;font-size:10.6px;letter-spacing:2px;color:#5b6068">ELECTRIC TWIN-REEL TETHER RIG · DYNEEMA SK99 · COLD-GAS ANCHORS</div>`);
  const hdr = [[`${fmt(P.rigMass, 1)}`, 'KG RIG'], [`${fmt(P.m, 0)}`, 'KG FLYING'], ['2 × 60', 'M OF LINE'], [`${fmt(P.tether.mbs / 1000, 1)}`, 'KN BREAK']];
  hdr.forEach(([v, n], i) => {
    const x = 1110 + i * 118;
    if (i) add(`<div style="position:absolute;left:${x - 12}px;top:26px;width:1px;height:36px;background:${C.faint}"></div>`);
    add(`<div style="position:absolute;left:${x}px;top:24px;font-size:20px;font-weight:700">${v}</div>`);
    add(`<div class="sm" style="position:absolute;left:${x}px;top:50px">${n}</div>`);
  });

  // the maneuver chip, top centre
  const phase = add(`<div style="position:absolute;left:800px;top:104px;transform:translateX(-50%);text-align:center"></div>`);
  const phTitle = el(`<div class="mo" style="font-size:12.5px;font-weight:700;letter-spacing:2.4px;color:${C.ink}"></div>`);
  const phSub = el(`<div class="mo" style="font-size:9.4px;letter-spacing:1.6px;color:${C.acc};margin-top:4px"></div>`);
  phase.append(phTitle, phSub);

  // ------------------------------------------------------------ 01 G-LOAD
  panel(28, 104, 282, 316, 'G-LOAD', '01');
  const gBig = add(`<div style="position:absolute;left:42px;top:132px;font-size:46px;font-weight:700;letter-spacing:-1.5px;line-height:1"></div>`);
  add(`<div class="sm" style="position:absolute;left:44px;top:182px">FELT LOAD · NET</div>`);
  const gLim = add(`<div class="sm" style="position:absolute;right:${1600 - 296}px;top:182px"></div>`);
  const gAx = ['+Gz HEAD→FOOT', '+Gx CHEST→BACK', 'Gy SIDEWAYS'].map((n, i) => {
    const y = 204 + i * 25;
    add(`<div class="sm" style="position:absolute;left:42px;top:${y}px">${n}</div>`);
    const b = bar(42, y + 13, 186);
    const mk = add(`<div class="mk" style="top:${y + 10}px;height:11px"></div>`);
    const v = add(`<div class="v" style="position:absolute;right:${1600 - 296}px;top:${y + 6}px"></div>`);
    return {b, mk, v};
  });
  add(`<div class="sm" style="position:absolute;left:42px;top:282px">G-LOC O₂ BUDGET</div>`);
  const glocBar = bar(150, 286, 108, C.green);
  const glocV = add(`<div class="v" style="position:absolute;right:${1600 - 296}px;top:280px"></div>`);
  const gChart = canvas(42, 302, 254, 108);

  // ------------------------------------------------------------ 02 TETHERS
  panel(28, 432, 282, 214, 'TETHERS', '02');
  const lines = [0, 1].map((i) => {
    const x = 42 + i * 134;
    // wire 0 runs on -x, the rider's right (y up, z forward); wire 1 on +x, the left
    add(`<div class="mo" style="position:absolute;left:${x}px;top:462px;font-size:11px;font-weight:700;letter-spacing:1.5px">${i ? 'LEFT' : 'RIGHT'}</div>`);
    const chip = add(`<div class="chip" style="left:${x + 50}px;top:460px"></div>`);
    const T = add(`<div style="position:absolute;left:${x}px;top:484px;font-size:22px;font-weight:700"></div>`);
    add(`<div class="sm" style="position:absolute;left:${x}px;top:512px">KN · SLIP ${fmt(P.reel.slip / 1000, 1)}</div>`);
    const tb = bar(x, 528, 118);
    add(`<div class="mk" style="left:${x + (P.reel.slip / 6000) * 118}px;top:525px;height:11px;background:${C.red};opacity:.8"></div>`);
    const rows = ['LINE OUT', 'SPEED', 'DRUM'].map((n, k) => {
      const y = 544 + k * 20;
      add(`<div class="sm" style="position:absolute;left:${x}px;top:${y}px">${n}</div>`);
      return add(`<div class="v" style="position:absolute;left:${x + 118}px;top:${y - 2}px;transform:translateX(-100%)"></div>`);
    });
    add(`<div class="sm" style="position:absolute;left:${x}px;top:606px">FAIRLEAD</div>`);
    const rail = add(`<svg style="position:absolute;left:${x + 58}px;top:604px" width="60" height="14"><path d="M2 3 Q30 13 58 3" stroke="${C.faint}" stroke-width="2.5" fill="none"/><circle r="3.6" fill="${C.ink}"/></svg>`);
    return {chip, T, tb, rows, dot: rail.querySelector('circle')};
  });

  // ------------------------------------------------------------ 08 DISPLAY (left, below tethers) and the note
  const btn = {};
  const btnRow = (keys, labels, x0, y, wmax) => {
    let x = x0;
    let yy = y;
    for (const k of keys) {
      const w = Math.round(labels[k].length * 6.9 + 20);
      if (x + w > x0 + wmax) {
        x = x0;
        yy += 28;
      }
      btn[k] = add(`<div class="bt" style="left:${x}px;top:${yy}px;width:${w}px">${labels[k]}</div>`);
      x += w + 5;
    }
  };
  panel(28, 658, 282, 92, 'DISPLAY', '08');
  btnRow(DISPLAY, DISPLAY_LABEL, 42, 688, 256);
  panel(28, 762, 282, 112, 'WHY IT WORKS', '09');
  const note = add(`<div class="note" style="left:42px;top:788px;width:254px"></div>`);

  // ------------------------------------------------------------ 03 POWER & GAS
  panel(1290, 104, 282, 236, 'POWER & GAS', '03');
  const rpm = add(`<div style="position:absolute;left:1304px;top:132px;font-size:30px;font-weight:700;letter-spacing:-.8px;line-height:1"></div>`);
  add(`<div class="sm" style="position:absolute;left:1304px;top:166px">MOTOR RPM · 5:1 TO THE DRUMS</div>`);
  add(`<div class="sm" style="position:absolute;left:1304px;top:186px">BUS</div>`);
  add(`<div style="position:absolute;left:1340px;top:190px;width:156px;height:5px;background:${C.track};border-radius:3px"></div>`);
  add(`<div style="position:absolute;left:1378px;top:186px;width:1px;height:13px;background:${C.mute}"></div>`);
  const busFill = add(`<div style="position:absolute;top:190px;height:5px;border-radius:3px"></div>`);
  const busV = add(`<div class="v" style="position:absolute;right:${1600 - 1558}px;top:184px"></div>`);
  add(`<div class="sm" style="position:absolute;left:1340px;top:200px;font-size:7.6px">REGEN ◂ · ▸ DRIVE · 40 KW</div>`);
  const pwr = [['SUPERCAP', C.blue], ['BATTERY', C.green], ['GAS', C.ink]].map(([n, col], i) => {
    const y = 220 + i * 26;
    add(`<div class="sm" style="position:absolute;left:1304px;top:${y}px">${n}</div>`);
    const b = bar(1378, y + 4, 92, col);
    const v = add(`<div class="v" style="position:absolute;right:${1600 - 1558}px;top:${y - 2}px"></div>`);
    return {b, v};
  });
  add(`<div class="sm" style="position:absolute;left:1304px;top:300px">BOTTLES</div>`);
  const bottle = add(`<div class="v" style="position:absolute;right:${1600 - 1558}px;top:298px"></div>`);
  add(`<div class="sm" style="position:absolute;left:1304px;top:318px">ANTI-G CUFFS</div>`);
  const cuff = add(`<div class="v" style="position:absolute;right:${1600 - 1558}px;top:316px"></div>`);

  // ------------------------------------------------------------ 04 FLIGHT with the map
  panel(1290, 352, 282, 232, 'FLIGHT', '04');
  const spd = add(`<div style="position:absolute;left:1304px;top:380px;font-size:30px;font-weight:700;letter-spacing:-.8px;line-height:1"></div>`);
  add(`<div class="sm" style="position:absolute;left:1304px;top:414px">SPEED · M/S</div>`);
  const kmh = add(`<div class="v" style="position:absolute;left:1304px;top:428px;color:${C.mute}"></div>`);
  const alt = add(`<div style="position:absolute;left:1436px;top:380px;font-size:30px;font-weight:700;letter-spacing:-.8px;line-height:1"></div>`);
  add(`<div class="sm" style="position:absolute;left:1436px;top:414px">HEIGHT · M</div>`);
  const spin = add(`<div class="v" style="position:absolute;left:1436px;top:428px;color:${C.mute}"></div>`);
  const map = canvas(1304, 448, 254, 126);

  // ------------------------------------------------------------ 05 SUBSYSTEMS, 06 VIEWS
  panel(1290, 596, 282, 96, 'ISOLATE', '05');
  btnRow(SUBSYS, SUBSYS_LABEL, 1304, 626, 256);
  panel(1290, 704, 282, 98, 'VIEWS', '06');
  btnRow(VIEWS, VIEW_LABEL, 1304, 734, 256);

  // ------------------------------------------------------------ 07 SORTIE timeline (bottom centre)
  panel(330, 812, 940, 62, 'SORTIE', '07');
  btn.play = add(`<div class="bt" style="left:432px;top:828px;width:32px;height:32px;border-radius:50%;border:none;background:${C.acc};color:#fff;font-size:12px"></div>`);
  btn.teardown = add(`<div class="bt" style="left:1290px;top:814px;width:136px;height:28px">TEARDOWN</div>`);
  btn.sortie = add(`<div class="bt" style="left:1436px;top:814px;width:136px;height:28px">FLY THE SORTIE</div>`);
  btn.slow = add(`<div class="bt" style="left:1290px;top:848px;width:282px;height:26px">SLOW-MO THE CUT · 1/8</div>`);
  const TL = {x: 480, w: 640};
  add(`<div style="position:absolute;left:${TL.x}px;top:842px;width:${TL.w}px;height:3px;background:${C.track};border-radius:2px"></div>`);
  const tlFill = add(`<div style="position:absolute;left:${TL.x}px;top:842px;height:3px;background:${C.acc};border-radius:2px"></div>`);
  for (const e of ph.events.filter((x) => ['fire', 'cut', 'land', 'jet', 'kick', 'hover'].includes(x.key))) {
    const x = TL.x + (e.tau / ph.dur) * TL.w;
    const c = e.key === 'cut' ? C.acc : e.key === 'land' ? C.green : e.key === 'jet' ? C.blue : C.ink;
    add(`<div style="position:absolute;left:${x - 1}px;top:${e.key === 'cut' ? 834 : 837}px;width:2px;height:${e.key === 'cut' ? 18 : 12}px;background:${c};opacity:.75"></div>`);
  }
  const cutE = ph.events.find((x) => x.key === 'cut');
  if (cutE) add(`<div class="sm" style="position:absolute;left:${TL.x + (cutE.tau / ph.dur) * TL.w - 13}px;top:822px;color:${C.acc}">CUT</div>`);
  const tlKnob = add(`<div style="position:absolute;top:836px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#fff;border:2px solid ${C.acc};box-sizing:border-box"></div>`);
  const tlTime = add(`<div class="mo" style="position:absolute;left:${TL.x}px;top:852px;font-size:9.6px;color:${C.mute};letter-spacing:1px"></div>`);
  const tlMode = add(`<div class="mo" style="position:absolute;right:${1600 - TL.x - TL.w}px;top:852px;font-size:9.6px;color:${C.mute};letter-spacing:1px"></div>`);
  add(`<div class="sm" style="position:absolute;left:1138px;top:826px">SPEED</div>`);
  const SP = {x: 1140, w: 110};
  add(`<div style="position:absolute;left:${SP.x}px;top:846px;width:${SP.w}px;height:3px;background:${C.track};border-radius:2px"></div>`);
  const spKnob = add(`<div style="position:absolute;top:841px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:${C.ink}"></div>`);
  const spV = add(`<div class="mo" style="position:absolute;left:1190px;top:824px;font-size:9.6px;font-weight:700"></div>`);

  // ------------------------------------------------------------ callouts, cursor
  const callLayer = add(`<svg style="position:absolute;left:0;top:0;overflow:visible" width="1600" height="900"></svg>`);
  const calls = [];
  const callPool = (i) => {
    while (calls.length <= i) {
      const d = add(`<div class="call"><b><i></i><em style="font-style:normal"></em></b><span></span></div>`);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      ln.setAttribute('fill', 'none');
      ln.setAttribute('stroke', C.ink);
      ln.setAttribute('stroke-width', '0.8');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2.4');
      dot.setAttribute('fill', C.acc);
      callLayer.append(ln, dot);
      calls.push({d, name: d.querySelector('em'), sub: d.querySelector('span'), ln, dot});
    }
    return calls[i];
  };
  const ring = add(`<div class="ring"></div>`);
  const cur = add(`<svg class="cur" width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L13.6 22.6 L10.2 15.2 L17 15 Z" fill="#fff" stroke="${C.ink}" stroke-width="1.4" stroke-linejoin="round"/></svg>`);

  // the spots the operator's cursor clicks
  const spots = {};
  const spotOf = (n) => {
    const r = {x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width) || 30, h: parseFloat(n.style.height) || 22};
    return [r.x + r.w / 2, r.y + r.h / 2];
  };
  for (const k of Object.keys(btn)) spots[k] = spotOf(btn[k]);

  // ------------------------------------------------------------ charts
  const T = ph.series.t;
  const drawG = (tau, lim) => {
    const {g, w, h} = gChart;
    g.clearRect(0, 0, w, h);
    const span = 6;
    const t0 = tau - span;
    const yOf = (v) => h - 12 - (clamp(v, -1, 7) / 7) * (h - 18);
    // tolerance bands (+Gz): sustained 3 g, 5 g for 3 s, 7 g only with cuffs and straining
    const band = (a, b, col) => {
      g.fillStyle = col;
      g.fillRect(0, yOf(b), w, yOf(a) - yOf(b));
    };
    band(0, P.limits.GzSus, 'rgba(47,163,107,.07)');
    band(P.limits.GzSus, P.limits.Gz3s, 'rgba(217,144,42,.09)');
    band(P.limits.Gz3s, 7, 'rgba(200,53,43,.08)');
    g.strokeStyle = C.line;
    g.lineWidth = 1;
    g.font = "500 7.5px 'JetBrains Mono'";
    g.fillStyle = C.mute;
    for (const v of [0, 1, 3, 5]) {
      g.beginPath();
      g.moveTo(16, yOf(v));
      g.lineTo(w, yOf(v));
      g.stroke();
      g.fillText(`${v}`, 2, yOf(v) + 3);
    }
    // the controller's limit
    g.setLineDash([3, 3]);
    g.strokeStyle = C.red;
    g.beginPath();
    g.moveTo(16, yOf(lim));
    g.lineTo(w, yOf(lim));
    g.stroke();
    g.setLineDash([]);
    const plot = (arr, col, lw) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      let started = false;
      const i0 = Math.max(0, Math.floor(t0 * ph.REC));
      const i1 = Math.min(T.length - 1, Math.floor(tau * ph.REC));
      for (let i = i0; i <= i1; i += 2) {
        const x = 16 + ((T[i] - t0) / span) * (w - 16);
        const y = yOf(arr[i]);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
    };
    plot(ph.series.Gz, C.blue, 1.3);
    plot(ph.series.net, C.acc, 1.8);
    g.fillStyle = C.acc;
    g.fillText('NET', w - 54, 9);
    g.fillStyle = C.blue;
    g.fillText('+Gz', w - 26, 9);
  };
  // the map: x across, z along; the corridor runs up the panel
  const trees = P.world.trees;
  const zs = [-15, ph.track[ph.track.length - 1] + 15];
  const drawMap = (S, tau) => {
    const {g, w, h} = map;
    g.clearRect(0, 0, w, h);
    const sx = w / (zs[1] - zs[0]);
    const px = (z) => (z - zs[0]) * sx;
    // sideways is drawn 3x so the weave between the trees reads
    const py = (x) => h / 2 + x * sx * 3;
    g.fillStyle = '#f2f3f1';
    g.fillRect(0, 0, w, h);
    for (const t of trees) {
      g.fillStyle = '#b9ad9c';
      g.beginPath();
      g.arc(px(t.z), py(t.x), Math.max(2.4, 2.4 * t.s * sx * 1.6), 0, Math.PI * 2);
      g.fill();
    }
    // the dummy
    const D = P.world.dummy;
    g.fillStyle = '#c8a97e';
    g.fillRect(px(D.z) - 2.5, py(D.x) - 4, 5, 8);
    g.fillStyle = C.acc;
    g.fillRect(px(D.z) - 1, py(D.x + D.nape.back) - 1, 2.5, 2);
    // the whole track faint, flown part solid
    const N = ph.track.length / 3;
    const iNow = Math.min(N - 1, Math.floor(tau * ph.REC));
    g.lineWidth = 1.1;
    g.strokeStyle = C.faint;
    g.beginPath();
    for (let i = 0; i < N; i += 6) {
      const x = px(ph.track[i * 3 + 2]);
      const y = py(ph.track[i * 3]);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    g.strokeStyle = C.acc;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= iNow; i += 3) {
      const x = px(ph.track[i * 3 + 2]);
      const y = py(ph.track[i * 3]);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    // lines to set anchors
    for (const wr of S.wires) {
      if (wr.state !== 'anchored' && wr.state !== 'flight') continue;
      g.strokeStyle = C.ink;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(px(S.pos[2]), py(S.pos[0]));
      g.lineTo(px(wr.tip[2]), py(wr.tip[0]));
      g.stroke();
    }
    g.fillStyle = C.ink;
    g.beginPath();
    g.arc(px(S.pos[2]), py(S.pos[0]), 3.2, 0, Math.PI * 2);
    g.fill();
    g.font = "500 7.5px 'JetBrains Mono'";
    g.fillStyle = C.mute;
    g.fillText(`${Math.round(zs[1] - zs[0])} M OF FOREST · TOP VIEW · SIDEWAYS ×3`, 4, h - 5);
  };

  // ------------------------------------------------------------ update
  const gCol = (v, a, b) => (v < a ? C.green : v < b ? C.amber : C.red);
  const update = (u) => {
    const S = u.S;
    const d = u.display || {};
    phTitle.textContent = u.phase?.label ?? S.phase.label;
    phSub.textContent = u.phase?.sub ?? S.phase.sub;
    // g-load
    gBig.textContent = `${fmt(S.G.net, 2)}g`;
    gBig.style.color = gCol(S.G.net, 3, 5);
    gLim.textContent = `LIMIT ${fmt(S.G.limit, 1)} G`;
    const ax = [[S.G.Gz, P.limits.Gz3s], [S.G.Gx, P.limits.Gx2s], [Math.abs(S.G.Gy), P.limits.GyMax * 2]];
    ax.forEach(([v, lim], i) => {
      setBar(gAx[i].b, v / 8);
      gAx[i].b.b.style.background = v > lim ? C.red : v > lim * 0.6 ? C.amber : C.acc;
      gAx[i].mk.style.left = `${42 + (lim / 8) * 186}px`;
      gAx[i].v.textContent = `${fmt(v, 2)} / ${lim}`;
    });
    setBar(glocBar, S.G.gloc / P.limits.glocBudget);
    glocV.textContent = `${fmt(S.G.gloc, 1)} S`;
    drawG(u.tau, S.G.limit);
    // tethers
    S.wires.forEach((w, i) => {
      const L = lines[i];
      const [txt, col] = STATE[w.state] || STATE.stowed;
      L.chip.textContent = w.slip ? 'SLIPPING' : txt;
      L.chip.style.background = w.slip ? C.red : col;
      L.T.textContent = fmt(w.tension / 1000, 2);
      setBar(L.tb, w.tension / 6000);
      L.tb.b.style.background = w.tension > P.reel.slip * 0.95 ? C.red : w.tension > P.limits.tensionSus ? C.amber : C.acc;
      L.rows[0].textContent = `${fmt(w.length, 1)} M`;
      L.rows[1].textContent = `${w.lineSpeed > 0.05 ? 'IN ' : w.lineSpeed < -0.05 ? 'OUT ' : ''}${fmt(Math.abs(w.lineSpeed), 1)} M/S`;
      L.rows[2].textContent = `${fmt(w.rpm, 0)} RPM`;
      const k = clamp(w.shuttle, -1, 1) * (i ? 1 : -1);
      const x = 30 + k * 27;
      L.dot.setAttribute('cx', x);
      L.dot.setAttribute('cy', 3 + 10 * (1 - (k * k)) * 0.5 + 2);
      L.dot.setAttribute('fill', Math.abs(w.shuttle) > 0.1 ? C.acc : C.ink);
    });
    // power and gas
    rpm.textContent = fmt(S.drive.rpm, 0);
    const busK = clamp(S.bus.power / 40000, -0.6, 1);
    // drive fills right of the zero mark (118 px = 40 kW), regeneration fills left (38 px = 24 kW)
    busFill.style.left = `${busK >= 0 ? 1378 : 1378 + busK * (38 / 0.6)}px`;
    busFill.style.width = `${busK >= 0 ? busK * 118 : -busK * (38 / 0.6)}px`;
    busFill.style.background = busK >= 0 ? C.acc : C.green;
    busV.textContent = `${S.bus.power >= 0 ? '' : '−'}${fmt(Math.abs(S.bus.power) / 1000, 1)} KW`;
    setBar(pwr[0].b, S.bus.cap / P.bus.capJ);
    pwr[0].v.textContent = `${fmt(S.bus.cap / 1000, 1)} KJ`;
    setBar(pwr[1].b, S.bus.batt / (P.bus.battWh * 3600));
    pwr[1].v.textContent = `${fmt(S.bus.batt / 3600, 0)} WH`;
    setBar(pwr[2].b, S.gas.mass / (P.gas.bottles * P.gas.air));
    pwr[2].v.textContent = `${fmt(S.gas.mass * 1000, 0)} G`;
    bottle.textContent = `${fmt(S.gas.p / 1e5, 0)} BAR · ${fmt(S.gas.T - 273.15, 0)} °C`;
    cuff.textContent = `${fmt(S.antiG, 0)} KPA`;
    // flight
    spd.textContent = fmt(S.speed, 1);
    kmh.textContent = `${fmt(S.speed * 3.6, 0)} KM/H`;
    alt.textContent = fmt(S.alt - P.body.hipY, 1);
    spin.textContent = `SPIN ${fmt(Math.abs(S.omega) / (2 * Math.PI), 2)} REV/S`;
    drawMap(S, u.tau);
    // buttons
    for (const k of DISPLAY) btn[k].classList.toggle('on', !!d[k]);
    for (const k of SUBSYS) btn[k].classList.toggle('iso', u.isolate === k);
    for (const k of VIEWS) btn[k].classList.toggle('on', u.view === k);
    btn.teardown.classList.toggle('on', u.mode === 'teardown');
    btn.sortie.classList.toggle('on', u.mode === 'sortie');
    btn.slow.classList.toggle('on', !!u.slow);
    btn.play.textContent = u.paused ? '▶' : '❚❚';
    // timeline
    const k = clamp(u.tau / ph.dur, 0, 1);
    tlFill.style.width = `${k * TL.w}px`;
    tlKnob.style.left = `${TL.x + k * TL.w}px`;
    tlTime.textContent = `T+${fmt(u.tau, 2)} S / ${fmt(ph.dur, 1)} S`;
    tlMode.textContent = u.mode === 'teardown' ? 'TEARDOWN · ON THE BRANCH' : `${fmt(u.speed ?? 1, 2)}× ${u.slow ? '· SLOW-MO' : ''}`;
    spKnob.style.left = `${SP.x + clamp(u.speedK ?? 0.45, 0, 1) * SP.w}px`;
    spV.textContent = `${fmt(u.speed ?? 1, 2)}×`;
    // note
    if (u.note) note.innerHTML = u.note;
    // callouts
    const cs = u.callouts || [];
    for (let i = 0; i < Math.max(cs.length, calls.length); i++) {
      const c = callPool(i);
      const v = cs[i];
      if (!v) {
        c.d.style.opacity = 0;
        c.ln.setAttribute('opacity', 0);
        c.dot.setAttribute('opacity', 0);
        continue;
      }
      c.d.style.opacity = v.o;
      c.d.style.left = `${v.label[0]}px`;
      c.d.style.top = `${v.label[1] - 7}px`;
      c.d.style.transform = v.right ? 'translateX(-100%)' : 'none';
      c.d.style.textAlign = v.right ? 'right' : 'left';
      c.name.textContent = v.name;
      c.sub.textContent = v.sub;
      const lx = v.right ? v.label[0] + 6 : v.label[0] - 6;
      c.ln.setAttribute('points', `${v.at[0]},${v.at[1]} ${lx},${v.label[1]} ${v.right ? lx + 2 : lx - 2},${v.label[1]}`);
      c.ln.setAttribute('opacity', v.o * 0.7);
      c.dot.setAttribute('cx', v.at[0]);
      c.dot.setAttribute('cy', v.at[1]);
      c.dot.setAttribute('opacity', v.o);
    }
    // cursor
    const cu = u.cursor;
    if (cu) {
      cur.style.transform = `translate(${cu.x - 2}px, ${cu.y - 2}px) scale(${cu.press ? 0.88 : 1})`;
      cur.style.opacity = cu.x < 0 ? 0 : 1;
      ring.style.opacity = cu.ring * 0.9;
      ring.style.left = `${cu.ringX}px`;
      ring.style.top = `${cu.ringY}px`;
      ring.style.transform = `scale(${1 + (1 - cu.ring) * 0.8})`;
    }
  };

  return {root: ui, btn, spots, TL, SP, update};
}
