# Checks and review

`scripts/smoke.mjs` opens a built page from disk with the network blocked and checks it the way a visitor would. A nonzero exit means a check failed, so never pipe its output through `tail` and read only the last line. Every run leaves `report.json` and screenshots in `teardown-out/smoke/<page>/`.

## What a page gets with no setup

**Film** (`--timeline` adds every beat to the samples): frames aren't blank, shuffled re-renders match within 0.1 % of pixels, and `SIM.state(t)`, if you expose it, gives the same finite numbers each time. Determinism doesn't prove correctness: a mechanism that's wrong in the same way every time passes this.

**Live:** the scene draws (the canvas alone, with every panel hidden), it moves or at least reacts, every control is found, wired and pressed, no click stops the frame loop, Tab reaches every control and Enter presses, reduced motion holds it still, and a phone can see the scene and touch every control, upright and sideways. If the page exposes `SIM.qa.state()`, a control that changes no state fails too. Taking over from the tour doesn't count as a control's effect.

Both also fail on a network request or a page error, and both read `window.SIM_CHECK`.

## Machine truths: SIM_CHECK

Tests on the math can't see a drawing error: the model is right and the rod is attached to the wrong end. `window.SIM_CHECK = () => [{name, ok, detail, value}]` measures the real scene, in world space, after every frame smoke renders. The starter has six, in `machine.js` and `film.js`: the rod sits on the crank pin, the rod reaches the piston, the piston stays in its liner, the crank is at the model's angle (even mid-explode), the machine is in frame and clear of the panels, and the readout shows the model's number. Write one for every joint and every number that matters. A joint without a check isn't checked: nothing catches the mistake you didn't write a check for, and smoke can't tell by itself what part of a picture is the machine.

## A plan: what a click should do

Without a plan, smoke knows that a click did something. Only a plan can say it did the right thing. Expose the visitor's state and write the outcomes down:

```js
window.SIM = {qa: {state: () => ({view, paused, rpm, th, explode})}};
```

```json
{
  "schemaVersion": 1,
  "viewports": [{"width": 1600, "height": 900}, {"width": 390, "height": 844}],
  "steps": [
    {"name": "cutaway", "action": "click", "selector": "#bt-cutaway", "expect": {"mode": {"equals": "cutaway"}, "tour": {"equals": false}}},
    {"name": "speed", "action": "fill", "selector": "#rpm", "value": "1200", "expect": {"rpm": {"equals": 1200}}},
    {"name": "still moving", "action": "wait", "waitMs": 200, "expect": {"th": {"changed": true}}},
    {"name": "orbit", "action": "drag", "selector": "#gl", "delta": [70, 0], "expect": {"az": {"changed": true}}}
  ]
}
```

```
node "$SKILL_DIR/scripts/smoke.mjs" teardown-out/dist/my-machine-live.html --qa my-machine-shared/qa.json
```

Actions: `click`, `fill` (sliders too), `press`, `drag`, `pinch` (with `scale`), `wait`. `only: "phone"` or `"desktop"` limits a step to that kind of viewport. Expected values: `equals`, `min`, `max`, `near` with `tolerance`, and `changed`, relative to the state just before the step. `waitMs` allows for a transition before looking, and `withinMs` (default 2000) is how long an outcome has to appear. A step with no `expect` is rejected, because a click with no expected outcome proves nothing. `stateGlobal: "LIVE.state"` reads a page's own global instead of `SIM.qa`. `reducedMotion: "reduce"` runs the whole plan that way.

`changed` compares with the moment before the step, so "the machine is still moving after this click" needs its own `wait` step: during the click itself, it had already moved. A viewport under 600 px runs as a phone: clicks are taps and drags are a real finger, so a canvas that lets the browser take the gesture can fail. A browser taking over lets the first couple of moves through and then cancels, so ask for the size of the movement, as the starter's plan does (`"az": {"max": -0.2}`), not just that it `changed`.

Cover takeover, pause and resume, an input change, one subsystem, explode and reassemble, reset and return to tour, wherever those exist. Replace the starter's plan when you replace its machine. Keep the state honest: expose what the page really uses, and never add a test-only path that makes a broken control look fine.

## Useful mechanical checks

- Slider-crank: top and bottom endpoints, rod length over 720 degrees, finite solutions across the dimensions you support.
- Gears: tooth ratio and pitch-centre distance; check direction and phase separately from speed.
- Suspension: rigid-link residual, travel limits, motion-ratio trend, impossible triangles.
- Braking: count drag, rolling, engine and brake forces once each; use consistent units in load transfer; state what you assumed about traction.
- Explode: zero restores every assembly, and it changes no mechanical reading.

## What no check can see

Whether the machine looks like the reference, whether a valve opens at the right phase, whether a label hides what it names, whether a view explains anything. Read the images. A narrow browser window isn't a phone, and phone emulation isn't a real phone either. A frame rate in headless Chromium on one GPU says nothing about someone's laptop.

## Saying what you checked

Name it precisely: automated checks, sheets of sampled frames, the encoded file, or real playback. A saved mp4, a contact sheet and watching a video are three different things. Say which viewports and which renderer. A check that was skipped was not passed. After any change to the code or timeline, rebuild everything that depends on it: `<name>.build.json` and `<video>.capture.json` hold the hashes, so an old video can't be mistaken for the new model.

Stop when the agreed scope passes a fresh review. "Impress me" isn't a licence for endless cosmetic churn.
