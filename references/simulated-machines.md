# Simulated machines

Read this when a machine's state depends on its own history: anything where forces decide what happens next, such as a tether, a reel, a suspension, a walking robot under load, a crane with a swinging load. A V8 is posed from its crank angle. A person swinging on a line isn't posed from anything: they end up wherever the forces put them.

| | Kinematic | Simulated |
|---|---|---|
| Driven by | one input (crank angle, stroke) | forces, integrated over time |
| Solved | in closed form, per frame | once at load, into a record |
| You tune | dimensions | a script of actions, and the physics pushes back |
| Done when | it looks right and the numbers agree | it looks right, the numbers agree, and its self-checks pass |

`render(t)` stays pure either way: it only reads the record.

ODM-E1 (`sims/odm-*`) is the worked example: a 25 s sortie, solved at load in under a second, with every gauge read from the same record that poses the rider.

## Build order

1. **Spec first, with hand checks.** Every number with its source, then the sums a reader could do on paper (`sims/odm-shared/SPEC.md` §7). Disagreement between a hand check and the simulation means one of them is wrong; find out which.
2. **Physics with no three.js, running in node.** Print the event timeline and the peaks long before you draw anything. A bad sortie shows in a table in a fraction of a second; in a render it costs minutes. See `sims/odm-dev/test.mjs`.
3. **Geometry on a bench.** `runBench` from `kit/bench.js` lights one module for stills without the rest of the page.
4. **Then the console, the film and the live page**, all reading the record.

## The record

```js
import {simulate} from 'teardown-kit/recorder.js';

const sim = simulate({
  channels: ['y', 'v', 'tension'],
  rate: 240,        // records per second
  substeps: 10,     // physics steps per record
  maxSeconds: 60,
  step(t, dt) { /* advance the state by dt; return true to stop at the next record */ },
  record(put) { put.y = s.y; put.v = s.v; put.tension = s.tension; },
});
sim.value('tension', t);   // interpolated
sim.read(t, out);          // every channel
```

Use it, don't rewrite it. Fixed-step integration with a record every N steps is where the time base goes wrong: ODM-E1's first version stepped at 0.5 ms with a record every 8 steps, labelled that 240 Hz, and in fact recorded 250 Hz. Everything looked fine until the rider was half a second away from the action by 13 s. `simulate` makes the step an exact division of the record, and `tests/skill.test.mjs` checks it against free fall.

## Models that held up

- **A line only pulls.** Tension = max(0, k·stretch + c·stretch rate), never negative. Stiffness is the line and whatever it pulls on, in series: `k = 1 / (L/EA + 1/k_harness)`. Damping `c = 2ζ√(km)`. `k` changes as `L` does, so recompute it every step.
- **A reel has limits.** Motor torque through the gearbox and the drum's current radius gives a force limit, which changes as line winds on. A slip clutch sets a lower one. While it slips, the motor is disconnected, so only the drum's inertia follows the line, not the rotor's reflected inertia (about 9 kg in ODM-E1).
- **Take up slack at the closing speed**, plus a small gain on the slack itself, and no faster. Then the line never snatches.
- **Script steps fire on state, not on time.** "Release when the rider passes the bottom of the swing" still works after you change the mass. "Release at 8.4 s" doesn't. Times come out of the simulation, and the film's timeline reads them from there.
- **Use a tuner for parameters that interact.** A small node script searching a grid beats nudging by hand, because every run takes less than a second (`sims/odm-dev/tune-*.mjs`).
- **Check closure and limits on every run.** Energy in = energy out within a percent, peak g, onset rate, power and every collision, exiting non-zero on a broken limit. ODM-E1 closes to 0.4 %.

## Where physics overruled the plan

Your intuition is a draft. These all looked fine on paper, and all failed in the simulation:

- **The gear ratio.** 3.2:1 looked ample, but with line wound out to a 56 mm radius the reel held 2.2 kN, less than a 2.3 g swing pulls, so it stalled and paid out. It became 5:1.
- **The pivot.** A pendulum's bottom is under its pivot, so an anchor on a trunk swings the rider into the trunk. Anchors moved out along branches.
- **The landing.** A pendulum climbs to its apex almost vertically, so a branch under the apex blocks the climb. It became a two-line hover over a limb clear of the climb.
- **The spin.** A body pulled by one line through an offset point turns until the line passes through its centre, then stops, like a weathervane. It doesn't keep spinning, and if it did it would wrap the line. The answer was a kick, then a release at peak spin.

Report these in the piece. Showing a limit the model hit, or saying a reel can only take up slack at the bottom of a swing because the line pulls its stall force, is what makes the rest believable.

## When the machine can't exist

State what would have to be true, keep every other number honest, and list the caveats in the teardown itself (`SPEC.md` §8). Don't quietly change the physics to get the shot. Change the machine, the path or the rider's limits, and say so.
