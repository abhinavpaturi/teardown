# ODM rig simulator — build contract

> The contract ODM-E1's parallel build ran on, kept as a worked example (see references/building-with-agents.md). Paths are as they
> were in that project: `refs/` held the owner's reference images (not shipped) and `research/` the notes behind the spec.

Read this whole file before writing code. The numbers live in `research/SPEC.md` and, as code, in
`odm-shared/params.js` (`P`). If SPEC.md and params.js disagree, params.js wins; tell the integrator.

The simulator is a Teardown sim (see `~/.claude/skills/teardown/SKILL.md`). Study the closest example before you
write anything: `~/.claude/skills/teardown/sims/cessna-shared/` (film.js, live.js, stage.js, console.js, gear.js) and
`v8-shared/` (engine.js for lathed parts and cutaways, console.js for live charts). Match their style: a header
comment that says what the file does, 2-space indent, semicolons, single quotes, small pure helpers, comments that
explain *why*. Everything is built from code (no model files). The finished page must stay under 1 MB.

## Layout and ownership

```
odm-gear/
  CONTRACT.md            this file
  research/              SPEC.md + research notes (read-only for builders)
  refs/                  the user's reference images (sheet.png = contact sheet)
  odm-shared/
    stage.js             DONE  renderer, lights, shadow, GTAO, camera. frame(cam), project(x,y,z), setQuality
    materials.js         DONE  palette (HEX), mat(key), MAT, accent(obj,k), fade(obj,a), ghost(), shadows()
    preview.js           DONE  runPreview(build) bench for one module + capture.mjs stills
    params.js            P: every number (integrator writes it from SPEC.md)
    physics.js           OWNER physics      sortie simulation at load, sample(t), series, events
    rig.js               OWNER rig          the gear's geometry and its update
    rider.js             OWNER rider        mannequin, harness straps, anti-G bladders, pose
    world.js             OWNER world        forest, ground, branches, titan training dummy, nape slice
    fx.js                OWNER fx           tethers, anchors in flight, gas plumes, trail, force arrows, slash arc
    console.js           OWNER console      the 1600 x 900 overlay
    film.js live.js      OWNER integrator   tour script, cameras, cursor, labels, the live page
    score.py             OWNER integrator   sound on the film timeline
  odm-film/main.js, odm-film/timeline.json, odm-live/main.js
  dev/<module>/main.js   each owner's bench entry (runPreview)
```

Only edit files you own (plus your own `dev/<module>/`). Need something from another module? Code against the API
below; if the API is missing something, add a clearly marked `// CONTRACT-REQUEST:` comment at the top of your file
and work around it locally.

## Conventions

- SI units everywhere: metres, seconds, kilograms, newtons, pascals (bar only in UI strings), radians.
- **World frame**: y up, ground at y = 0. Origin at the launch tree's base. Trees, dummy and anchors are in world.
- **Body frame** (rider, rig): origin at the midpoint of the two hip joints; **x = rider's right, y = up the spine,
  z = forward (chest)**. The rig's `root` is a child of the rider's `pelvis` object, so rig geometry is authored in
  the body frame. Body landmarks are in `P.body` (hip joints, waist ellipse, thighs, shoulders...). The rig must fit
  those landmarks and the rider must match them: the belt hugs the waist ellipse, blade boxes sit on the outer
  thighs, the central unit sits on the lower back.
- Quaternions as `[x, y, z, w]`, world from body.
- G convention (human factors): specific force f = (a − g_vec) / 9.81 in g, expressed in the body frame:
  `Gz = f·y_body` (headward acceleration, blood to the feet, the dangerous axis), `Gx = f·z_body` (eyeballs-in),
  `Gy = f·x_body` (lateral). `net = |f|`.
- **Pure render**: everything visible is a function of the state passed in. No Math.random (use `rng(seed)` from
  `teardown-kit/util.js` at build time), no Date, no state carried between frames, no per-frame allocation in hot
  paths (reuse Vector3s).
- Import the kit as `teardown-kit/util.js` etc.; three as `three` and `three/addons/...`.
- Looks: light studio, one accent (`HEX.accent`) on the part that is working right now; dark parts glossy with
  roughness ≥ 0.45; near-white parts get an ink outline or a darker ground. Every mesh casts and receives shadows
  unless it is a ghost or a line.

## The physics state  (physics.js → everyone)

```js
const ph = buildSortie(P);        // runs the whole sortie at load into typed arrays (target < 400 ms)
ph.dur                            // seconds of sortie
ph.sample(tau) -> S               // interpolated state at sortie time tau (0..dur); returns a reused object
ph.series                         // {t: Float32Array, Gz, Gx, net, tensionL, tensionR, gas, pTank, speed, alt, power, ...}
ph.events                         // [{tau, key, label, sub}] maneuver beats (anchor fired, hit, reel, release, thrust, cut, land)
ph.track                          // Float32Array xyz of the pelvis at series.t (for the trail and the minimap)
ph.check                          // {energyClosure, maxNet, maxGz, minTension, ...} self-test results
```

`S` (all world-frame unless noted):

```js
{
  tau, phase: {i, key, label, sub},
  pos: [x,y,z], vel: [..], acc: [..], speed, alt,
  q: [x,y,z,w],                    // world-from-body orientation; the spin for the cut is already inside q
  spin,                            // cumulative spin angle about the spine (rad), for the console
  G: {Gz, Gx, Gy, net, limit},     // body-frame specific force (g) and the controller's current limit
  wires: [L, R], each {
    state,                         // 'stowed' | 'flight' | 'anchored' | 'release' | 'retract'
    tip: [x,y,z],                  // anchor (in flight or set) position
    exit: [x,y,z],                 // where the tether leaves the reel (fairlead), from pose + P.rig.fairlead
    length, tension, lineSpeed,    // m deployed, N, m/s (+ = reeling in)
    slip, brake,                   // clutch slipping (bool), brake 0..1
    spool, rpm,                    // drum angle (rad) and rpm
    target,                        // tree index or null
    slack,                         // m of slack (0 when taut) for the sag drawing
    shuttle,                       // fairlead position on its rail: 0 parked at the buckle .. 1 at the hip (SPEC 2.4)
    aim,                           // launcher elevation (rad) for the rig's trunnion
  },
  gas: {mass, p, pReg, flow},      // kg left, tank bar, regulated bar, kg/s
  drive: {rpm, angle, power},      // the turbine / motor that drives the spools
  thrust: {on, N, dir: [x,y,z]},   // 0..1, newtons, world direction of the exhaust jet (opposite the push)
  antiG,                           // bladder pressure, kPa
  E: {kin, pot, store, reel, thrust, drag},   // J; store = energy left in the tanks/battery
  blade: {out, swing, cut, contact},           // 0..1 drawn, 0..1 swing arc, 0..1 nape slice progress, bool
  pose: {w: {stand, hang, stream, cut, land}, tuck, arms, look: [x,y,z]},  // hints for the rider (below)
  onBranch,                        // bool, standing
}
```

**Pose hints.** `pose.w` are blend weights (sum 1) over five stances the rider defines in the body frame; the
physics eases them so a pure per-frame blend of joint angles is smooth. `tuck` (0..1) adds hip and knee flexion,
`arms` (0..1) raises the blades from rest to attack-ready, `look` is a world point for the head.
- `stand`: upright, knees soft, hands by the hips holding the handles, blades pointing back and down (the canon rest).
- `hang`: the recline swing posture (SPEC 2.3): hips flexed ~80°, knees ~60°, thighs forward like sitting, hands in
  front of the hips, blades trailing back. The physics has already tilted the pelvis frame; this is relative to it.
- `stream`: ballistic, legs together and nearly straight, arms along the body, blades trailing.
- `cut`: legs together, knees slightly bent, arms out to the sides (along ±x), blades continuing radially outward,
  edges leading; with S.spin the whole body turns about y.
- `land`: hips and knees flexed to absorb, arms forward for balance.

**Hand frames.** `rider.hands.L/R` are Object3Ds at the grip centre (middle of the fist): +x along the blade (out past
the index finger, roughly along the forearm), +y the pistol's "up" (toward the blade socket on top of the grip),
+z = x × y. The same rule for both hands (the left frame is not mirrored). The rig parents each handle to these
frames: the grip runs down through the fist from the socket block, canted 17° back from −y; the blade root sits about
(+0.03, +0.07, 0) from the origin.

## Module APIs

```js
// rig.js
buildRig(P) -> {
  root,                             // THREE.Group in the body frame (attach to rider.pelvis)
  groups: {tanks, drive, reels, anchors, handles, blades, harness},  // arrays of Object3D per subsystem (isolate)
  fairlead: {L: V3, R: V3},         // body frame, where each tether leaves
  nozzle: {pos: V3, dir: V3},       // body frame
  labels: [{key, name, sub, group, at: () => V3}],   // body-frame anchor points for callouts
  update(S, D, hands),              // hands: {L: Matrix4, R: Matrix4} world grip transforms from rider
}
// rider.js
buildRider(P) -> {root, pelvis, hands: {L, R} /* Object3D at the grip centre, x along the blade */,
                  harness /* group for isolate */, update(S, D)}   // root placed at S.pos/S.q by update
// world.js
buildWorld(P) -> {root, trees, dummy: {root, nape: {centre: V3, size: V3}}, update(S, D)}
// fx.js
buildFx(P, ph) -> {root, update(S, D, rig, rider, camera)}  // tethers, anchors, plumes, trail, forces, slash
// console.js
createConsole(app, P, ph) -> {root, btn: {...}, spots: {key: [x, y]}, TL, SP, update(u)}
```

`D` (display, from film/live) — every field optional, default 0/null:

```js
{explode, cutaway, xray, labels, forces, trail, isolate /* subsystem key or null */, isolateK, working /* key */}
```

Isolate: the isolated subsystem stays solid and accented; everything else (other rig parts, rider) fades to
~0.12 opacity; the world dims. Explode: rig parts move apart along their own explode vectors (rig defines them),
eased by `D.explode`. Cutaway: section the central unit and reels (clipping planes) to show the drive, gearbox,
clutch and spools turning. X-ray: the rider becomes `ghost()`, harness straps stay solid and show load paths.

## Verify your module before you finish

1. Bench it: `dev/<module>/main.js` with `runPreview` (see odm-shared/preview.js), then
   `node ~/.claude/skills/teardown/sims/build.mjs ./dev/<module>` and
   `node ~/.claude/skills/teardown/sims/capture.mjs <module> --size 1600x900 --dpr 0.8 --stills 0,2,4,6 --cols 2 --out teardown-out/<module>-sheet.png`
   from the odm-gear folder. Run build and capture with the Bash sandbox disabled (headless Chromium needs the GPU).
2. Read the PNG. Check against refs/ and the checklist in the Teardown SKILL.md (nothing passes through anything,
   parts touch where they should, readable silhouettes, no white blow-out, no NaN black frames).
3. Fix and repeat until a full pass is clean. Physics: also a node test (`node dev/physics/test.mjs`) printing
   `ph.check` and the peak values next to the SPEC's expected values.
4. Return what you built, the API you actually expose, and anything the integrator must know.
