// The one reader of timeline.json, shared by capture, sheet, wave and smoke, so a typo can't pass in one tool and fail in another.
// Two shapes:
//   a cue map:   {"duration": 16, "explode": 8.5, "clicks": [1, 3.2], "data": {"motor": [[3, 6, 9000]]}}
//                every number is a time in seconds, except under "data", which is for the score and never read as time
//   event list:  {"schemaVersion": 1, "duration": 16, "events": [{"id": "explode", "t": 8.5, "rpm": 1200}]}    only t is a time
// A stray number outside the film is an error, not a tile at the last frame: that's how a typo or a misplaced rpm gets caught.
export function timelineTimes(tl, fallbackDuration) {
  if (!tl || typeof tl !== 'object' || Array.isArray(tl)) throw new Error('timeline must be an object');
  const duration = tl.duration ?? fallbackDuration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('timeline duration must be positive seconds');
  if (tl.fps !== undefined && (!Number.isFinite(tl.fps) || tl.fps <= 0)) throw new Error('timeline fps must be positive');
  const times = [];
  const add = (t, where) => {
    if (!Number.isFinite(t) || t < 0 || t > duration) throw new Error(`timeline: ${where} = ${t} is outside the film (0 to ${duration} s). If it isn't a time, move it under "data".`);
    times.push(t);
  };
  if (tl.schemaVersion !== undefined || tl.events !== undefined) {
    if (tl.schemaVersion !== 1 || !Array.isArray(tl.events)) throw new Error('timeline: use schemaVersion 1 with an events array');
    const ids = new Set();
    let previous = -Infinity;
    for (const e of tl.events) {
      if (!e || typeof e.id !== 'string' || !e.id.trim() || ids.has(e.id)) throw new Error('timeline: events need unique, nonempty ids');
      ids.add(e.id);
      add(e.t, e.id);
      if (e.t < previous) throw new Error(`timeline: event ${e.id} is out of order`);
      previous = e.t;
    }
  } else {
    const walk = (v, where) => {
      if (where === 'duration' || where === 'fps' || where === 'data') return;
      if (typeof v === 'number') add(v, where);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, where ? `${where}.${k}` : k));
    };
    walk(tl, '');
  }
  return [...new Set([0, ...times])].sort((a, b) => a - b);
}

/** What a review sheet should show: the beats, or one tile every `step` seconds when the file holds nothing but a duration. */
export function reviewTimes(tl, duration, step = 2) {
  const times = timelineTimes(tl, duration);
  if (times.length > 1) return {times, fallback: false};
  const end = tl.duration ?? duration;
  const out = [];
  for (let t = 0; t < end; t += step) out.push(t);
  return {times: out, fallback: true};
}
