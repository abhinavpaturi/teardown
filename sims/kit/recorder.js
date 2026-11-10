// A machine that moves by its own rules (anything swung, flung or towed, where no single input can pose it) is simulated
// once at load and only read afterwards, so render(t) stays pure. simulate() runs fixed steps and records named channels on
// an exact grid: a whole number of steps per record, so a stored index always means the same moment. (A step of 0.5 ms
// recorded "at 240 Hz" really records at 250 Hz, and every sample drifts: half a second late by 13 s.)
//
//   const sim = simulate({
//     channels: ['y', 'v'],
//     step(t, dt) { v -= 9.81 * dt; y += v * dt; return y < 0; },   // truthy ends the run at the next record
//     record(put) { put.y = y; put.v = v; },
//   });
//   sim.dur; sim.series.y; sim.value('y', 1.5); sim.read(1.5, out);   // read() fills a reused object, no allocation
export function simulate({channels, rate = 240, substeps = 10, maxSeconds = 120, step, record}) {
  const dt = 1 / (rate * substeps);
  const cap = Math.ceil(maxSeconds * rate) + 1;
  const data = Object.fromEntries(channels.map((k) => [k, new Float32Array(cap)]));
  const put = {};
  let n = 0;
  const take = () => {
    record(put);
    for (const k of channels) data[k][n] = put[k] ?? 0;
    n++;
  };
  take();
  let it = 0;
  let stopping = false;
  while (n < cap) {
    if (step(it * dt, dt)) stopping = true;
    it++;
    if (it % substeps === 0) {
      take();
      if (stopping) break;
    }
  }
  const dur = (n - 1) / rate;
  const series = Object.fromEntries(channels.map((k) => [k, data[k].subarray(0, n)]));
  const at = (tau) => {
    const u = Math.min(dur, Math.max(0, tau)) * rate;
    const i = Math.min(n - 1, Math.floor(u));
    return [i, Math.min(n - 1, i + 1), u - i];
  };
  return {
    dur, dt, rate, steps: it, n, series,
    value(k, tau) {
      const [i, j, f] = at(tau);
      return data[k][i] + (data[k][j] - data[k][i]) * f;
    },
    read(tau, out = {}) {
      const [i, j, f] = at(tau);
      for (const k of channels) out[k] = data[k][i] + (data[k][j] - data[k][i]) * f;
      return out;
    },
  };
}
