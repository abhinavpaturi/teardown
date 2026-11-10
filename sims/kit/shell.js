// Everything a live page needs that is not the machine: a fixed layout scaled to the window, quality tiers that step down when
// frames run long, the auto tour that any input interrupts and 25 s of quiet resumes, orbit and zoom, sliders, the tour chip and
// the frame loop with its shader warm-up. Used with kit/studio.js:
//
//   const shell = createShell({app, canvas, st, root: ui.root, duration: DURATION});
//   shell.onTakeOver((cyc) => { /* copy the tour's state at film time cyc into the visitor's state */ });
//   shell.run(({dt, T, tour, cyc}) => { /* tour ? draw film time cyc : draw the visitor's state with shell.orbit */ });
//
// Every control can be reached by keyboard, and the canvas orbits with the arrow keys. With reduced motion on, the page starts still
// in the visitor's hands (shell.still) and the tour only runs if they ask for it. Pass compact: true if your console has a layout
// for small screens: below a usable scale the shell stops shrinking the 1600 x 900 layout, makes the stage the size of the screen
// and sets #app.compact, and shell.onLayout(({compact, w, h}) => ...) tells you. Without it, a phone gets the whole console, small.
import {enableKeyboard, prefersStill} from './access.js';
import {warmComposer} from './warm.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const COMPACT_BELOW = 0.62; // past this the layout's small print can't be read, whatever the screen
const TIERS = [
  {samples: 8, ao: true, shadow: 4096, pr: 2},
  {samples: 4, ao: false, shadow: 2048, pr: 1.5},
  {samples: 2, ao: false, shadow: 1024, pr: 1},
  {samples: 0, ao: false, shadow: 1024, pr: 0.8},
];

export function createShell({app, canvas, st, root, duration, W = 1600, H = 900, idle = 25, bg = '#eef1f2', accent = '#e3562a', tiers = TIERS, compact = false}) {
  const style = document.createElement('style');
  style.textContent = `
html,body{background:${bg};overflow:hidden}
#app{position:fixed!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.bt{pointer-events:auto;cursor:pointer}
.bt:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:ew-resize}
.tourchip{position:absolute;left:${W / 2}px;top:146px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:22px;padding:0 11px;border:1px solid #e3e5e8;border-radius:4px;background:rgba(250,250,248,.95);color:#22252b;font:700 9px 'JetBrains Mono',monospace;letter-spacing:1.3px;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:${accent}}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
@keyframes blink{50%{opacity:.15}}
@media (prefers-reduced-motion:reduce){.tourchip.on i{animation:none}}
.tourchip .short{display:none}
#gl:focus-visible{outline:2px solid ${accent};outline-offset:-3px}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 'JetBrains Mono',monospace;letter-spacing:1px;color:#868b93;text-transform:uppercase;display:none}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}`;
  document.head.appendChild(style);

  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = light ? Math.min(2, tiers.length - 1) : 0;
  let scale = 1;
  let isCompact = false;
  let onLayout = () => {};
  const fit = () => {
    const whole = Math.min(innerWidth / W, innerHeight / H);
    isCompact = compact && whole < COMPACT_BELOW;
    app.classList.toggle('compact', isCompact);
    if (isCompact) {
      scale = 1;
      Object.assign(app.style, {width: `${innerWidth}px`, height: `${innerHeight}px`, transform: 'none'});
      // a phone-sized stage has about a quarter of the desktop's pixels, so it can afford a sharper picture at the same tier
      st.resize(innerWidth, innerHeight, clamp(devicePixelRatio || 1, 0.6, tiers[tier].pr * 1.5));
    } else {
      scale = whole;
      Object.assign(app.style, {width: '', height: '', transform: `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`});
      st.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.6, tiers[tier].pr));
    }
    onLayout({compact: isCompact, w: isCompact ? innerWidth : W, h: isCompact ? innerHeight : H});
  };
  const applyTier = () => {
    const {pr, ...q} = tiers[tier];
    st.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };

  if (!compact) {
    const note = document.createElement('div');
    note.className = 'turn';
    note.textContent = 'Turn your phone sideways for the full console';
    document.body.appendChild(note);
  }
  const chip = document.createElement('div');
  chip.className = 'tourchip';
  root.appendChild(chip);

  const orbit = {az: 0, el: 0, k: 1};
  let T = 0;
  let lastInput = 0;
  const still = prefersStill();
  let tourOn = !still;
  let t0 = 0;
  let onTake = () => {};
  let held = () => false;
  const shell = {
    orbit,
    toStage,
    still,
    get compact() {
      return isCompact;
    },
    onLayout(fn) {
      onLayout = fn;
      fn({compact: isCompact, w: isCompact ? innerWidth : W, h: isCompact ? innerHeight : H});
    },
    get T() {
      return T;
    },
    get tier() {
      return tier;
    },
    get tour() {
      return tourOn;
    },
    onTakeOver: (fn) => (onTake = fn),
    /** While fn() is true, quiet doesn't hand the page back to the tour: a visitor who paused meant it. */
    holdWhile: (fn) => (held = fn),
    touch: () => (lastInput = T),
    startTour() {
      tourOn = true;
      t0 = T;
      Object.assign(orbit, {az: 0, el: 0, k: 1});
    },
    takeOver() {
      lastInput = T;
      if (!tourOn) return;
      tourOn = false;
      onTake((T - t0) % duration);
    },
    /** A slider over a track at x0..x0+w, y in layout pixels: apply(0..1) while dragging. */
    slider(x0, w, y, apply) {
      const d = document.createElement('div');
      d.className = 'hit';
      Object.assign(d.style, {left: `${x0 - 8}px`, top: `${y - 11}px`, width: `${w + 16}px`, height: '22px'});
      const move = (e) => {
        apply(clamp((toStage(e.clientX, e.clientY)[0] - x0) / w, 0, 1));
        lastInput = T;
      };
      d.addEventListener('pointerdown', (e) => {
        shell.takeOver();
        d.setPointerCapture(e.pointerId);
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        move(e);
      });
      root.appendChild(d);
    },
    run(frame) {
      let last = performance.now();
      const perf = {n: 0, sum: 0, slow: 0, age: 0};
      const tick = (now) => {
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        T += dt;
        if (tier < tiers.length - 1) {
          perf.age += dt;
          if (perf.age > 0.8) {
            perf.sum += dt;
            perf.n++;
            if (perf.sum >= 0.5 && perf.n >= 6) {
              perf.slow = perf.sum / perf.n > 0.022 ? perf.slow + 1 : 0;
              perf.sum = 0;
              perf.n = 0;
              if (perf.slow >= (perf.age < 6 ? 1 : 2)) {
                tier++;
                applyTier();
                Object.assign(perf, {age: 0, slow: 0});
              }
            }
          }
        }
        if (!tourOn && !still && !held() && T - lastInput > idle) shell.startTour();
        frame({dt, T, tour: tourOn, cyc: (T - t0) % duration});
        if (chip.classList.contains('on') !== tourOn || !chip.firstChild) {
          chip.classList.toggle('on', tourOn);
          chip.innerHTML = tourOn ? '<i></i><span class="long">AUTO TOUR · CLICK TO TAKE OVER</span><span class="short">TAKE OVER</span>' : `▶ <span class="long">${still ? 'PLAY THE' : 'RESUME'} TOUR</span><span class="short">TOUR</span>`;
        }
        if (!window.SIM_SHOWN) {
          window.SIM_SHOWN = true;
          dispatchEvent(new Event('simframe'));
        }
        requestAnimationFrame(tick);
      };
      warmComposer(st.renderer, st.composer, st.scene, st.camera).then(() => requestAnimationFrame(tick));
    },
  };
  chip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (tourOn) shell.takeOver();
    else shell.startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== chip) shell.takeOver();
  });
  let drag = null;
  let pinch = null;
  const touches = new Map();
  const spread = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    canvas.setPointerCapture(e.pointerId);
    if (touches.size === 2) {
      drag = null;
      pinch = {d: spread(), k: orbit.k};
      return;
    }
    drag = {x: e.clientX, y: e.clientY};
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pinch && touches.size === 2) {
      orbit.k = clamp((pinch.k * pinch.d) / Math.max(1, spread()), 0.3, 3);
      lastInput = T;
      return;
    }
    if (!drag) return;
    orbit.az -= ((e.clientX - drag.x) / scale) * 0.006;
    orbit.el = clamp(orbit.el + ((e.clientY - drag.y) / scale) * 0.004, -0.5, 1.2);
    drag = {x: e.clientX, y: e.clientY};
    lastInput = T;
  });
  const endDrag = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size) return;
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.tabIndex = 0;
  if (!canvas.getAttribute('aria-label')) canvas.setAttribute('aria-label', 'The machine. Drag or use the arrow keys to orbit; plus and minus to zoom.');
  canvas.addEventListener('keydown', (e) => {
    const move = {ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08]}[e.key];
    const zoom = {'+': 0.9, '=': 0.9, '-': 1.1}[e.key];
    if (!move && !zoom) return;
    e.preventDefault();
    e.stopPropagation();
    shell.takeOver();
    if (move) {
      orbit.az += move[0];
      orbit.el = clamp(orbit.el + move[1], -0.5, 1.2);
    } else orbit.k = clamp(orbit.k * zoom, 0.3, 3);
  });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      shell.takeOver();
      orbit.k = clamp(orbit.k * Math.exp(e.deltaY * 0.0012), 0.3, 3);
    },
    {passive: false},
  );
  enableKeyboard(root);
  return shell;
}
