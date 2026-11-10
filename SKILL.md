---
name: teardown
description: Build an interactive 3D simulator of a real machine or mechanism (an engine, a landing gear, a walking linkage, a pump, a gearbox) as one offline HTML page people can take apart, with live panels driven by the same model that moves the parts, a button for every subsystem, cutaways, camera views and an auto tour that hands control to the visitor; then record it frame by frame to a 60 fps video with a synced procedural score. Use when someone asks how a machine works, wants a "visual explainer", a "simulator", a "cutaway", an "exploded view" or an "interactive 3D lesson", or wants a 3D object shown working rather than described. Also for machines that have to be simulated under real forces (a tether rig, a crane, a suspension), and for a machine that can't exist yet, engineered as honestly as the numbers allow.
---

# Teardown

One machine, one page. The visitor sees the thing run, presses a button, and the part doing the work opens up while the gauges around it read the real numbers. Left alone, the page tours itself with a cursor. The same code records a film of the tour, frame by frame, with a score built on the same timeline.

`SKILL_DIR` below is the folder this file lives in. Builds and renders go to `./teardown-out` of the folder you run from.

## Before you start

```
node "$SKILL_DIR/scripts/doctor.mjs"            # add --video if you'll record
```

It checks Node, the dependencies, and that headless Chromium can really draw WebGL, and it gives the fix for whatever fails. If it reports missing packages: `cd "$SKILL_DIR" && npm ci && npx playwright install chromium`. The pages need nothing else. The video needs `ffmpeg` and the score needs Python 3 (standard library only). Set `FFMPEG`, `FFPROBE`, `PYTHON` or `CHROMIUM` to point at other binaries.

**In Claude Code, run `doctor.mjs`, `capture.mjs`, `smoke.mjs`, `npm run test:browser` and `npx playwright install` with the Bash sandbox disabled.** The sandbox blocks the GPU: capture times out after 60 s with no useful error, and the Chromium install can hang while unpacking.

## Start a new machine

```
node "$SKILL_DIR/scripts/new-machine.mjs" . --name my-engine --title "My Engine"
```

This writes a working slider-crank in the current folder: a model with its test, geometry that follows the model's dimensions, a console with a live chart and leader lines, real buttons and a phone layout, a film, a live page with quality tiers and an auto tour, a record of where each number came from (`sources.json`) and a test plan for the controls (`qa.json`). It runs before you change anything, so replace it piece by piece and check it still runs. Replace `sources.json`, `qa.json` and the checks along with the machine: they describe the starter until you do. Then read the closest example for the harder parts.

Decide first which kind of machine it is:

- **Kinematic:** one input poses everything (crank angle, stroke). Start from the scaffold and the rules below.
- **Simulated:** forces decide what happens next, so the motion can't be written down (a tether, a reel, a suspension). Solve it once at load into a record. **Read `references/simulated-machines.md` before writing any physics.**

A machine with many large parts: see `references/building-with-agents.md`.

## The 4 examples

Build one, open the HTML, press buttons. Copy the closest one when you start a new machine.

| | The machine | What drives it | Worth stealing |
|---|---|---|---|
| `v8-*` | A cross-plane V8 with glass liners: the charge burns inside the cylinder you track, valves lift on their cams, 8 pistons move from the exact slider-crank. | Crank angle. Firing order 1-8-4-3-6-5-7-2, a chamber pressure model for the indicator diagram. | Cutaway modes (glass, section, solid), the firing order as a cylinder picker, live charts synced to the crank. |
| `cessna-*` | The Cessna 337 main landing gear folding into the airframe on takeoff and dropping on landing. | Stroke 0..1: a 201 mm rack turns a 32-tooth pinion (module 4 mm) through exactly 180°. | One degree of freedom posing a whole mechanism, flight phases as functions of time, a runway that rolls under the model. |
| `strandbeest-*` | Theo Jansen's Strandbeest, 20 legs on one crankshaft, walking broadside over sand. | Wind. The crank speed is integrated from it; every joint follows by circle intersection from Jansen's 11 link lengths. | An exact linkage solver in 67 lines, instanced tubes, foot traces, a contact chart of all 20 feet. |
| `odm-*` | ODM-E1, an engineered tether-and-reel mobility rig: a rider swings through a forest, makes a spinning cut, and lands, with forces and g on the panels. | Forces. A 25 s sortie is simulated once at load (`odm-dev/test.mjs` runs it in node and checks every limit), and the record drives everything. | A full physics record, a script that fires on state, tuners, a rider built from code, a scrubbable timeline, a spec with hand checks, and a stated list of what isn't feasible. |

Each comes in 3 folders: `<name>-shared/` holds the machine, `<name>-film/` the recorded tour, `<name>-live/` the page you drive.

```
node "$SKILL_DIR/sims/build.mjs" v8-live          # → teardown-out/dist/v8-live.html, offline, ~800 KB
node "$SKILL_DIR/sims/build.mjs"                  # all 8
```

## How a machine is built

One folder per machine, split by job. The examples follow this exactly:

| File | Job |
|---|---|
| `kin.js` / `gear.js` / `jansen.js` | The math. Real dimensions in real units, one input (crank angle, stroke, wind) and every pose and readout as a function of it. No three.js in here. |
| `engine.js` / `gear.js` / `beast.js` | The geometry, built from code: lathed parts, tubes, instanced links. `update(input)` poses it. |
| `stage.js` | Studio, lights, shadows, post (GTAO, bloom). `frame(state, cam)` draws one frame. |
| `console.js` | The overlay: fixed 1600 x 900 CSS layout of panels, charts, toggles, callouts with leaders. `update(state)` redraws it from the frame's state. |
| `film.js` | A `SCRIPT` of operator moves (views, isolate, cutaway, throttle) and `render(t)` as a pure function of time. |
| `live.js` | The same machine in real time: buttons, sliders, orbit, zoom, keys. With no input it plays `film.js`'s script as an auto tour with a cursor; any click, drag, wheel or key hands control over, 25 s of quiet hands it back. |
| `score.py` | The sound on the film's timeline. |

A machine outside `SKILL_DIR` is a folder with a `main.js`, importing the kit by name: `import {runSim} from 'teardown-kit/runtime.js'`. Build it with `node "$SKILL_DIR/sims/build.mjs" ./my-machine`. Put `{"title": "My Machine"}` in that folder's `build.json` to name the page.

## The kit

Reach for these before writing your own. All import as `teardown-kit/<file>`.

| Module | What it gives you |
|---|---|
| `studio.js` | `createStudio({canvas, palette})`: the light studio, sun, shadows, GTAO and bloom, tuned to work together. `st.frame(cam)`, `st.project(x, y, z)`, `st.setQuality({samples, ao, shadow})`, `st.aoHide` for transparent effects. |
| `shell.js` | `createShell(...)`: the live page's plumbing. Fits 1600 x 900 to any window, adaptive quality tiers, auto tour and hand-over, orbit, wheel, pinch and keyboard zoom, sliders, shader warm-up, `window.SIM_SHOWN`. With `compact: true` a small screen gets a stage its own size and `#app.compact`, for a console with a layout for it. |
| `access.js` | `enableKeyboard(root)` and `prefersStill()`, for a page with its own loop. The shell already does both. |
| `tour.js` | `makeCursor(events)` and `createCursorLayer(root)`: the operator's cursor as a pure function of time. |
| `recorder.js` | `simulate({...})`: fixed-step physics into a record on an exact time grid. |
| `bench.js` | `runBench(build, {...})`: one module under studio light, for stills before the page exists. |
| `fx.js` | `createFatLine` for lines with a real pixel width, `createPuffs` for gas (soft point sprites), `projectedPx`. |
| `runtime.js`, `warm.js`, `util.js` | `runSim` (the film's contract), shader warm-up, `rng(seed)` and helpers. |

## Rules that decide whether it works

1. **Start from a reference, never from imagination.** A photo, a cutaway drawing from a manual, a clip of the real thing. Build against it and compare frame by frame. Machines invented from a sentence come out generic every time; the same model rebuilds a real one closely when it has something to match.
2. **Real numbers, one source.** Get the real dimensions first (bore, stroke, tooth count, link lengths). Every gauge, chart and label reads from the same function that poses the parts, so nothing on screen can disagree with the motion. Check one by hand: in the Cessna, 32 teeth × 4 mm module is a 128 mm pitch diameter, and half its circumference is the 201 mm stroke. Record each number as published, measured, estimated or calibrated, and never pass an estimate off as a spec: **read `references/research.md` when you gather specifications or match a real machine.**
3. **One input drives everything.** Pose from the crank angle, the stroke or the wind. Nothing is keyframed by hand, so the film, the live page and the score never drift.
4. **The part doing the work opens up.** Isolate it, cut it, x-ray it. A camera that goes inside is worth more than ten orbits.
5. **Light studio, one accent.** Pale backgrounds read in a feed; dark ones lose the first second. The accent marks the thing that is changing. Watch near-white parts on a pale backdrop: give them an ink outline or a darker ground.
6. **Pick the camera for the mechanism.** A planar linkage seen face-on collapses into a lattice; a 3/4 view along the spine keeps every leg readable.
7. **Fix collisions with a number.** When a part pokes through another, scale or move it in the parameter block. Never hide it with the camera. Build geometry from the parameters, so a changed dimension can't leave a part behind.
8. **An explode is a diagram.** Motion comes from the model; an exploded layout is presentation, so it must not change any mechanical reading. Say on the page that it's illustrative if the parts couldn't really come apart that way.

## Live page rules

- **A keyboard and a phone are visitors too.** Use real `<button>`s or `kit/access.js`. With reduced motion on, start still in the visitor's hands. A phone is not a narrow desktop: shrinking a 1600 x 900 console to 390 px leaves 2 px text, so lay it out for the screen, as the starter's `#app.compact` does. The older examples show the whole console small, with a note to turn the phone; don't copy that part.
- **State the play rate.** If the crank is slowed down, the page says by how much. It's also what stops it strobing: past about 60 degrees a frame the eye loses the direction.
- **Keep control where the visitor put it.** Manual input exits the tour without jumping the mechanical phase. Pause freezes the model and the tour, and quiet doesn't hand a paused page back (`shell.holdWhile`). When an input changes speed, keep the current phase and integrate forward: never `rpm * elapsed`.
- **Test on an integrated GPU.** A page that runs at 60 fps on a desktop card can drop to 15 fps on a laptop's built-in one. The examples carry quality tiers (`TIERS` in `live.js`): no AO, lower pixel ratio, smaller shadow maps, panels redrawn every other frame. Find the expensive shader first: a displacement computed 5 times per vertex costs more than every tier together.
- **Warm the shaders.** `kit/warm.js` compiles every program in parallel before the first frame, so the page never freezes on first draw.
- **Keep the page under about 1 MB if it needs a preview in a feed.** Link crawlers (X, Slack) read the share card from the HTML and give up on a 15 MB page. The build reports the size and largest modules when a page goes over. Big models go out as files next to the page: `build.json` → `{"external": {"heavy.glb": "light.glb"}}`, though the page is then no longer one file.

## render(t) contract

```js
import {runSim} from '../kit/runtime.js';

const DEFAULTS = {duration: 20, fps: 60, hud: {enabled: false}, director: {enabled: false}};

runSim(DEFAULTS, async ({cfg, canvas, capture}) => {
  // build the scene, precompute anything stateful
  return {render(t) { /* draw frame t from scratch */ return {}; }, resize() {}};
});
```

- `render(t)` is pure: no `Math.random` (use `rng(seed)` from `kit/util.js` at setup), no `Date`, no state carried between frames. Capture calls it at arbitrary times. Set every time-dependent property on every frame, including the zero and hidden states of effects you aren't using, or an arrow stays behind from the frame before.
- Update pose, then effects, then matrices, then labels and readouts, and only then draw. Anything else shows up as a one-frame delay.
- Return `state(t)` as well as `render(t)` and smoke compares the numbers and rejects a NaN: JSON would otherwise turn it into a quiet `null`.
- Anything that moves by its own rules (agents, particles) is simulated once at load into typed arrays; `render` only reads them. A quantity integrated over time (the Strandbeest's crank under a changing wind) is integrated in closed form or tabulated at load.
- Every beat goes into `<name>-film/timeline.json` in seconds. The score reads the same file. Numbers that aren't times go under `data`, or the reader rejects or misreads them: `references/film.md`. Read cues through something that stops on a missing one, like the starter's `cue()`.
- Frame 0 is the thumbnail. It must already show the machine.

## Commands

```
node "$SKILL_DIR/sims/build.mjs" v8-film
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --stills beats --cols 4 --out teardown-out/v8-beats.png
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --still 12.5 --out teardown-out/v8-12.5.png
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --out teardown-out/v8-silent.mp4
python3 "$SKILL_DIR/run_sfx.py" "$SKILL_DIR/sims/v8-shared/score.py"      # python on Windows
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --score teardown-out/v8-score.wav --out teardown-out/v8.mp4
node "$SKILL_DIR/wave.mjs" teardown-out/v8.mp4 --timeline "$SKILL_DIR/sims/v8-film/timeline.json"
```

`--size` is the CSS layout and `--dpr` multiplies it: 1600 x 900 at 1.2 gives 1920 x 1080, and those are the defaults. Capture prints the GPU it got; a software renderer means the GPU flags in `paths.mjs` did not take. A failed run exits nonzero and leaves any earlier video alone, so check the exit code. Every script takes `--help`, and `run_sfx.py` too. More in `references/film.md`.

To share the result (a link, one file, a smaller video): `references/publishing.md`. Don't promise a link you haven't opened: the page runs in a frame there.

## Review loop

You cannot watch the video; you can look at frames. Never report a machine as done without reading sheets of the current render. Passing checks are not enough: a starter machine once passed all of them with its connecting rod leaning the wrong way.

0. `node "$SKILL_DIR/scripts/smoke.mjs" teardown-out/dist/my-machine-live.html --qa my-machine-shared/qa.json`, and for the film `smoke.mjs teardown-out/dist/my-machine-film.html --timeline my-machine-film/timeline.json`. It checks that the scene draws, that frames are pure and numbers finite, that every control is found, wired and pressable, that no click stops the loop, that Tab reaches every control, that reduced motion holds still, that a phone can see the scene and touch every control, and that it needs no network. The plan says what each click should do. Give the machine its own truths with `window.SIM_CHECK = () => [{name, ok, detail}]` (parts that must stay joined, measured in world space); the scaffold's `checks()` shows how. **Read `references/quality.md` for the plan format and what no check can see.**
1. `--stills beats`: one tile per timeline beat, 0.3 s after it, each labelled `t=`. A timeline with no beats gets one tile every 2 s, so put yours in.
2. Read every tile against the checklist below.
3. Zoom in: `--stills every:0.2 --from A --to B` for a transition, `--still T` for one full frame.
4. Fix, rebuild, go back to 1. Stop when a full pass finds nothing.
5. Final: `node "$SKILL_DIR/sheet.mjs" --video <final.mp4> --timeline <timeline.json>` and read that too: it shows what the encoder wrote.
6. Report what you actually checked, and how: automated checks, sampled frames and real playback are different claims, and a sheet isn't a frame-by-frame review. State the viewports and renderer, and which numbers are estimates.

Checklist:

- **The mechanism.** Every part that should touch touches; nothing passes through anything; the numbers on the panels match the pose.
- **Composition.** One focal point per frame. Nothing important within 60 px of an edge. Labels never cover the part they name.
- **Type.** Nothing clipped. The key readout reads at phone width, and fine print stays at 11 px or more on the 1600 x 900 layout. Text carries enough contrast to read on a pale panel.
- **3D.** Bloom eats detail: keep emissive layers under 1.0. Near-white surfaces blow out. Glossy metal under a low light streaks: roughness ≥ 0.45 and envMapIntensity ≈ 0.5 on big surfaces.
- **Timing.** Each state holds long enough to read: 1 s for a short phrase plus 0.25 s per word beyond three.

## three.js traps the examples already hit

- `smoothstep(a, b, x)` with `a > b` returns 0 on Windows (ANGLE/D3D). Write `1.0 - smoothstep(b, a, x)`.
- A `ShadowMaterial` or a decal a fraction of a millimetre above the floor loses the depth test inside a post-processing render target. Give it `polygonOffset`.
- A quad laid into the ground with a mirrored mapping gets culled as a back face. Use `DoubleSide`.
- One NaN pixel blacks out the whole frame through bloom. Clamp every `pow()` base in a shader.
- GTAO on a clipped (cutaway) model needs the same clipping planes on `gtao.normalMaterial`, or the cut half returns as a pale ghost. If the clip changes per frame, just turn AO off for that shot (`cam.ao = 0` in the studio).
- GTAO draws transparent effects into its own normal and depth pass, so a gas plume or a fading shell casts a dark wedge. Add them to `st.aoHide`.
- VSM shadows band over a long depth range. Use PCF for anything bigger than a bench.
- A bright environment washes out the sun's shadow, so the studio keeps it low. Under it a metal only has its reflections to show, so `metalness 0.8` in a dark colour renders close to black. Use `envMapIntensity` near 2, a lighter colour, or `metalness` near 0.35.
- Scale the near plane with the camera distance, or a close-up clips and a far shot z-fights. `studio.js` does.
- Spheres read as rocks. For gas use soft point sprites (`createPuffs`).
- `patch` is a reserved word in GLSL. A shader that fails to compile logs an error, and capture then fails rather than recording a blank film.
- A ghost child can't draw if its parent is hidden. Hide the material, not the group, when a child has to stay visible.
- Build a spring at a meaningful rest length, and don't scale its wire thickness with its travel.
- `void THREE`, `window.THREE` or an exported namespace keeps the whole library in the bundle. `<name>.build.json` shows what takes the room.
- A reused object from your own `sample()` silently changes earlier values. Copy it if you keep it.

## Sound

`sfx/` synthesises every sound in pure Python (48 kHz, reproducible) and reads the film's timeline, so sound cannot drift out of sync. `python "$SKILL_DIR/run_sfx.py" --list` shows the generators. `sample()` adds the recorded CC0 sounds in `sfx/samples/`. `sfx/score_kit.py` has the beds and accents the 3 scores use: a chord bed, a soft thud per power stroke, a motor, air under a drag.

- Every time comes from the timeline, never a typed number.
- Mastering is automatic: −14 LUFS, true peak ≤ −2 dBFS.
- Accent, never narrate: continuous motion stays silent. One key for every tonal sound.

## Taste, with numbers

- Easing: entrances `cubic-bezier(0.16, 1, 0.3, 1)`, exits `cubic-bezier(0.6, 0, 0.9, 0.35)` at half the entrance's length, state to state `cubic-bezier(0.65, 0, 0.35, 1)`. Linear only for continuous motion.
- The machine fills 60-70% of its viewport. In a film, the key readout and the words you need read never under 34 px on a 1080 canvas; captions never under 13 px.
- One accent, and it means something: the part that is working right now.
- Nothing dead-still: one element always alive.

## Credits

The capture error handling, the timeline reader, the test plans and the sourcing and quality guidance are merged from a Codex adaptation of Teardown. ODM-E1 and the additions in `scripts/`, `references/` and the kit's `studio`, `shell`, `tour`, `recorder`, `bench`, `access` and `fx` modules were built on Teardown by [elvarofficial](https://github.com/elvarofficial/teardown). The kit, frame capture, sfx engine and review rules come from [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT). The recorded samples are CC0 from Freesound, trimmed by [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics) (MIT); sources in `sfx/samples/SOURCES.md`.
