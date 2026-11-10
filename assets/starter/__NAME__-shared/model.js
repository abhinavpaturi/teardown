// The math, with no three.js, so node can test it. One input (the crank angle) poses every part and fills every readout.
// Replace this with your machine's real numbers, and record where each comes from in sources.json: the test holds the two together.
export const P = Object.freeze({
  title: '__TITLE__',
  r: 0.045, // crank radius, m
  l: 0.145, // connecting rod, m
  bore: 0.082, // m
  rpmIdle: 900,
  rpmMax: 4200,
  playback: 0.1, // how fast the crank is shown against real time; the page says so. Too fast and it strobes: 7 rev/s is 42 degrees a frame at 60 fps.
});

/** Slider-crank at angle th (radians from top dead centre). y is measured up from the crank axis. */
export function pose(th) {
  const s = Math.sin(th);
  const c = Math.cos(th);
  const pinX = P.r * s;
  const pinY = P.r * c;
  const y = pinY + Math.sqrt(P.l * P.l - pinX * pinX);
  return {th, pinX, pinY, y, rod: Math.atan2(pinX, y - pinY), stroke: (y - (P.l - P.r)) / (2 * P.r)};
}
