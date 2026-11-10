// The console, laid out at 1600 x 900 around a clear centre: the title, the live number, a chart that moves with the machine, the
// buttons, and a speed slider. update(u) redraws everything from the frame's state; no number here is typed in.
// On a small screen the shell sets #app.compact and the same elements rearrange, because a shrunken desktop layout isn't a phone
// layout. The buttons are real buttons and the throttle a real slider, so the keyboard and a screen reader get them for free.
const C = {ink: '#22252b', mute: '#5f646c', line: '#e3e5e8', acc: '#e3562a', panel: 'rgba(250,250,248,.95)'};
export const VIEWS = ['hero', 'front'];
export const TOGGLES = ['glass', 'explode'];
const speedText = (k) => {
  if (k === 1) return 'SHOWN AT FULL SPEED';
  const n = 1 / k;
  return k < 1 && Math.abs(n - Math.round(n)) < 1e-6 ? `SHOWN AT 1/${Math.round(n)} SPEED` : `SHOWN AT ${k}× SPEED`;
};

export function createConsole(app, P, pose, labels, project, sources) {
  const style = document.createElement('style');
  style.textContent = `#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}.sm{font:500 11px 'JetBrains Mono',monospace;letter-spacing:1.1px;color:${C.mute}}
.cp{position:absolute;background:${C.panel};border:1px solid ${C.line};border-radius:6px}
.btns{position:absolute;inset:0;pointer-events:none}
.bt{position:absolute;height:28px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid #c6cacf;border-radius:4px;background:#fcfcfb;color:${C.ink};font:700 11px 'JetBrains Mono',monospace;letter-spacing:1px;box-sizing:border-box;pointer-events:auto;cursor:pointer}
.bt.on{background:${C.ink};border-color:${C.ink};color:#fff}
.throttle{position:absolute;margin:0;height:20px;accent-color:${C.acc};pointer-events:auto;cursor:pointer}
.src{position:absolute;left:28px;top:422px;width:282px;max-height:450px;overflow-y:auto;box-sizing:border-box;padding:9px 16px;background:${C.panel};border:1px solid ${C.line};border-radius:6px;pointer-events:auto}
.src summary{cursor:pointer}.src p{margin:8px 0 0;font:400 12px/1.45 Inter,system-ui,sans-serif;color:${C.ink}}
.sheet{display:none;position:absolute;background:${C.panel};border:0 solid ${C.line}}
.title,.sub,.rpm,.rpmCap,.speed,.chart,.chartCap,.thrCap{position:absolute}
.title{left:40px;top:28px;font-size:34px;font-weight:700;letter-spacing:-.6px;white-space:nowrap}
.sub{left:42px;top:76px}
.rpm{left:44px;top:128px;font-size:44px;font-weight:700;color:${C.acc};line-height:1}
.rpmCap{left:46px;top:178px}.speed{left:46px;top:194px}
.chart{left:44px;top:216px;width:250px;height:176px}.chartCap{left:52px;top:222px}
#app.compact .cp,#app.compact .leaders,#app.compact .call,#app.compact .chartCap{display:none}
#app.compact .sheet{display:block}
#app.compact .title{left:14px;top:9px;font-size:20px;max-width:58%;overflow:hidden;text-overflow:ellipsis}
#app.compact .sub{display:none}
#app.compact .rpm{left:auto;right:14px;top:9px;font-size:28px}
#app.compact .rpmCap{left:auto;right:14px;top:39px;font-size:10px;letter-spacing:.6px}
#app.compact .speed{left:auto;right:14px;top:54px;font-size:10px;letter-spacing:.6px}
#app.compact .src{left:6px;top:36px;width:auto;max-width:calc(100% - 180px);padding:0 8px;background:none;border:0;z-index:5}
#app.compact .src summary{min-height:36px;display:flex;align-items:center;font-size:10px;letter-spacing:.6px}
#app.compact .src[open]{background:${C.panel};border:1px solid ${C.line};padding-bottom:8px;max-width:calc(100% - 20px);max-height:calc(100% - 50px);overflow-y:auto}
#app.compact .sub.note{display:block;left:15px;top:72px;max-width:calc(100% - 30px);white-space:normal;font-size:10px;letter-spacing:.6px;z-index:2}
#app.compact .btns{display:grid;gap:8px;inset:auto}
#app.compact .bt{position:static;width:auto!important;height:44px}
#app.compact .tourchip{position:absolute;transform:none;height:44px;justify-content:center;box-sizing:border-box;padding:0 4px;font-size:11px;border-color:#c6cacf;z-index:3}
#app.compact .tourchip .long{display:none}#app.compact .tourchip .short{display:inline}
@media (orientation:portrait){
#app.compact .sheet{left:0;right:0;bottom:0;height:238px;border-top-width:1px}
#app.compact .chart{left:12px;width:calc(100% - 24px);top:auto;bottom:172px;height:58px}
#app.compact .thrCap{left:14px!important;top:auto!important;bottom:146px;font-size:10px}
#app.compact .throttle{left:96px!important;right:14px;top:auto!important;bottom:138px;width:calc(100% - 110px)!important;height:32px}
#app.compact .btns{left:12px;right:12px;bottom:12px;grid-template-columns:repeat(3,1fr)}
#app.compact .tourchip{left:auto;right:12px;top:auto;bottom:12px;width:calc((100% - 40px)/3)}}
@media (orientation:landscape){
#app.compact .sheet{top:0;right:0;bottom:0;width:276px;border-left-width:1px}
#app.compact .chart{display:none}
#app.compact .rpm{left:14px;right:auto;top:42px}
#app.compact .rpmCap{left:14px;right:auto;top:72px}
#app.compact .speed{left:14px;right:auto;top:87px}
#app.compact .src{left:6px;top:100px;max-width:240px}
#app.compact .sub.note{top:138px;max-width:calc(100% - 300px)}
#app.compact .btns{right:12px;top:12px;width:252px;grid-template-columns:repeat(2,1fr)}
#app.compact .bt{height:40px}
#app.compact .thrCap{left:auto!important;right:204px;top:172px!important;font-size:10px}
#app.compact .throttle{left:auto!important;right:12px;top:188px!important;width:252px!important;height:32px}
#app.compact .tourchip{left:auto;right:12px;top:108px;width:122px;height:40px}}`;
  document.head.appendChild(style);
  const ui = document.createElement('div');
  ui.className = 'ui';
  app.appendChild(ui);
  const add = (h, parent = ui) => {
    const d = document.createElement('div');
    d.innerHTML = h.trim();
    return parent.appendChild(d.firstElementChild);
  };
  add('<div class="sheet"></div>');
  const title = add('<div class="title"></div>');
  title.textContent = `${P.title} `;
  add(`<span style="color:${C.acc};font-weight:400">/</span>`, title);
  const sub = add('<div class="sm sub"></div>');
  add('<div class="cp" style="left:28px;top:112px;width:282px;height:296px"></div>');
  const rpm = add('<div class="rpm"></div>');
  add('<div class="sm rpmCap">ENGINE SPEED · RPM</div>');
  add(`<div class="sm speed">${speedText(P.playback)}</div>`);
  const cv = add('<canvas class="chart" aria-hidden="true"></canvas>');
  const g = cv.getContext('2d');
  add('<div class="sm chartCap">PISTON HEIGHT, ONE TURN</div>');
  // where the numbers came from, on the page: a visitor can tell a measured value from a demo one
  const src = add('<details class="src"><summary class="sm">SOURCES AND LIMITS</summary></details>');
  for (const line of [...sources.parameters.map((p) => `${p.id} = ${p.value} ${p.unit}: ${p.basis}. ${p.limitations ?? ''}`), ...sources.limitations]) {
    const para = document.createElement('p');
    para.textContent = line;
    src.appendChild(para);
  }
  // callouts sit in fixed places clear of the machine; only the leader follows the part
  const leaders = add('<svg class="leaders" width="1600" height="900" style="position:absolute;left:0;top:0"></svg>');
  const callouts = labels.map((l, i) => {
    const y = 300 + i * 92;
    add(`<div class="call" style="position:absolute;left:1306px;top:${y}px;font-size:18px;font-weight:700">${l.name}</div>`);
    add(`<div class="call sm" style="position:absolute;left:1306px;top:${y + 25}px">${l.sub}</div>`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', C.ink);
    line.setAttribute('stroke-width', '1');
    leaders.appendChild(line);
    return {l, line, y: y + 12};
  });
  add('<div class="cp" style="left:1290px;top:112px;width:282px;height:130px"></div>');
  add('<div class="call sm" style="position:absolute;left:1306px;top:126px">VIEWS</div>');
  add('<div class="call sm" style="position:absolute;left:1306px;top:184px">DISPLAY</div>');
  add('<div class="cp" style="left:500px;top:812px;width:600px;height:62px"></div>');
  const btns = add('<div class="btns"></div>');
  const btn = {};
  const spots = {};
  const button = (k, label, x, y, w) => {
    btn[k] = add(`<button type="button" id="bt-${k}" class="bt" aria-pressed="false" style="left:${x}px;top:${y}px;width:${w}px">${label}</button>`, btns);
    spots[k] = [x + w / 2, y + 14];
  };
  VIEWS.forEach((k, i) => button(k, k.toUpperCase(), 1306 + i * 96, 146, 90));
  TOGGLES.forEach((k, i) => button(k, k.toUpperCase(), 1306 + i * 96, 204, 90));
  button('play', 'PLAY', 516, 831, 70);
  btn.play.removeAttribute('aria-pressed');
  const SP = {x: 620, w: 400, y: 843};
  add(`<div class="sm thrCap" style="left:${SP.x}px;top:${SP.y - 22}px">THROTTLE</div>`);
  const throttle = add(`<input id="throttle" class="throttle" type="range" min="0" max="1000" step="1" aria-label="Engine speed" style="left:${SP.x}px;top:${SP.y - 8}px;width:${SP.w}px">`);
  // the projection centre and distance the machine needs to sit clear of the panels: the desktop layout was framed for it already
  // and free is the part of the stage no panel covers, which is where the checks expect to find the machine
  const frame = {sx: 0, sy: 0, k: 1, free: {x0: 0, y0: 0, x1: 1600, y1: 900}};
  const layout = ({compact, w, h}) => {
    if (!compact) Object.assign(frame, {sx: 0, sy: 0, k: 1, free: {x0: 0, y0: 0, x1: w, y1: h}});
    else if (h >= w) Object.assign(frame, {sx: 0, sy: -84, k: 1.55, free: {x0: 0, y0: 0, x1: w, y1: h - 238}});
    else Object.assign(frame, {sx: -138, sy: 0, k: 1.05, free: {x0: 0, y0: 0, x1: w - 276, y1: h}});
  };
  const update = (u) => {
    rpm.textContent = Math.round(u.rpm);
    // not while a hand is on it, unless the tour has taken the machine back
    if (u.tour || document.activeElement !== throttle) throttle.value = String(Math.round(((u.rpm - P.rpmIdle) / (P.rpmMax - P.rpmIdle)) * 1000));
    throttle.setAttribute('aria-valuetext', `${Math.round(u.rpm)} rpm`);
    for (const k of VIEWS) {
      btn[k].classList.toggle('on', u.view === k);
      btn[k].setAttribute('aria-pressed', String(u.view === k));
    }
    for (const k of TOGGLES) {
      btn[k].classList.toggle('on', !!u.on?.[k]);
      btn[k].setAttribute('aria-pressed', String(!!u.on?.[k]));
    }
    btn.play.textContent = u.paused ? 'PLAY' : 'PAUSE';
    const pulledApart = (u.display?.explode ?? 0) > 0.5;
    sub.textContent = pulledApart ? 'AN ILLUSTRATIVE LAYOUT, NOT A SERVICE PROCEDURE' : 'ONE CRANK ANGLE POSES EVERYTHING';
    sub.classList.toggle('note', pulledApart);
    if (!app.classList.contains('compact'))
      for (const c of callouts) {
        const p = c.l.at();
        const q = project(p.x, p.y, p.z);
        if (q) c.line.setAttribute('points', `1296,${c.y} 1250,${c.y} ${q[0].toFixed(1)},${q[1].toFixed(1)}`);
      }
    // the piston's height over one turn, with a dot where it is now: redrawn from the model every frame
    const w = cv.clientWidth || 250;
    const h = cv.clientHeight || 176;
    if (cv.width !== w * 2 || cv.height !== h * 2) {
      cv.width = w * 2;
      cv.height = h * 2;
    }
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = C.line;
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
    const X = (th) => (th / (2 * Math.PI)) * w;
    const Y = (k) => h - h * 0.07 - k * (h - h * 0.22);
    g.strokeStyle = C.ink;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const th = (i / 120) * 2 * Math.PI;
      if (i) g.lineTo(X(th), Y(pose(th).stroke));
      else g.moveTo(X(th), Y(pose(th).stroke));
    }
    g.stroke();
    const th = ((u.th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    g.fillStyle = C.acc;
    g.beginPath();
    g.arc(X(th), Y(pose(th).stroke), 4, 0, 7);
    g.fill();
  };
  return {root: ui, btn, throttle, spots, frame, layout, update, shownRpm: () => Number(rpm.textContent)};
}
