// The operator's cursor for a film or an auto tour: it walks to each button, presses it, and rests between clicks.
// makeCursor(events) is a pure function of time. events: [{t, spot: [x, y]}] in layout pixels.
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

export function makeCursor(events, {start = [900, 620], rest = [[860, 600], [760, 660], [920, 640], [820, 700]]} = {}) {
  const EV = events.filter((e) => e.spot).sort((a, b) => a.t - b.t);
  const WP = [[0, ...start]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.18, ...e.spot], [e.t + 0.2, ...e.spot]);
    const nxt = EV[i + 1];
    if (!nxt || nxt.t - e.t > 1.6) WP.push([e.t + 1.4, ...rest[i % rest.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  if (WP.length < 2) WP.push([1, ...start]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const k = smoother((t - t0) / Math.max(1e-6, t1 - t0));
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let ringX = 0;
    let ringY = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + 0.09) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [ringX, ringY] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX, ringY};
  };
}

/** The pointer and its click ring as DOM over the layout. update(cursor) from makeCursor, or {x: -99, ...} to hide. */
export function createCursorLayer(root, {accent = '#e3562a', ink = '#22252b'} = {}) {
  const ring = document.createElement('div');
  ring.style.cssText = `position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${accent};opacity:0;z-index:49;pointer-events:none`;
  const cur = document.createElement('div');
  cur.style.cssText = 'position:absolute;left:0;top:0;z-index:50;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))';
  cur.innerHTML = `<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L13.6 22.6 L10.2 15.2 L17 15 Z" fill="#fff" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  root.append(ring, cur);
  return (c) => {
    cur.style.transform = `translate(${c.x - 2}px, ${c.y - 2}px) scale(${c.press ? 0.88 : 1})`;
    cur.style.opacity = c.x < 0 ? 0 : 1;
    ring.style.opacity = c.ring * 0.9;
    ring.style.left = `${c.ringX}px`;
    ring.style.top = `${c.ringY}px`;
    ring.style.transform = `scale(${1 + (1 - c.ring) * 0.8})`;
  };
}
