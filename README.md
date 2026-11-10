# teardown

A Claude Code skill that turns any machine into a 3D simulator you can take apart.

This is version 1.2.0, a modified copy of [elvarofficial/teardown](https://github.com/elvarofficial/teardown) (MIT). See [What changed](#what-changed) below.

Ask how something works. Claude builds it as one offline HTML page: the machine runs in the middle, every panel around it reads the real numbers, a button opens the part doing the work, and when nobody touches it the page tours itself.

![Mellis HB-7 robotic bee simulator](docs/bee.gif)

| Telson SC-8 robotic scorpion | Pelagos OC-8 robotic octopus |
|---|---|
| ![Telson SC-8 robotic scorpion](docs/scorpion.gif) | ![Pelagos OC-8 robotic octopus](docs/octopus.gif) |

## Install

Unzip this into your Claude Code skills folder, so that you have `~/.claude/skills/teardown/SKILL.md`. Then, once:

```
cd ~/.claude/skills/teardown
npm ci
npx playwright install chromium
npm run doctor
```

If you already have a `teardown` skill there, move it somewhere else first. You need Node.js 20 or newer. For the video you also need `ffmpeg`, and for the sound Python 3. In Claude Code's Bash tool, browser steps need the sandbox off, because it blocks the GPU.

## Use

Ask Claude Code in plain words:

> Build me a simulator of a 4-stroke motorcycle engine I can take apart.

> How does a mechanical watch keep time? Show me as a simulator.

> Make a teardown of a hydraulic excavator arm and record a 20-second video of it.

Or open one of the 4 examples first:

```
node sims/build.mjs v8-live          # teardown-out/dist/v8-live.html
node sims/build.mjs cessna-live
node sims/build.mjs strandbeest-live
node sims/build.mjs odm-live
```

## What is inside

| | |
|---|---|
| `SKILL.md` | What Claude reads: how a machine is built, the rules that make it look right, the review loop. |
| `sims/kit/` | Runtime, studio, live-page shell, tour, physics recorder, bench, effects, shader warm-up. |
| `sims/v8-*`, `sims/cessna-*`, `sims/strandbeest-*`, `sims/odm-*` | 4 complete machines. `-shared` is the machine, `-live` the page you drive, `-film` the recorded tour. |
| `scripts/` | `doctor` (can this machine build and record?), `new-machine` (a working starter project), `smoke` (does this page really work?), `package-artifact`. |
| `references/` | Research and sources, checks and review, film and sound, simulated machines, building with parallel agents, sharing what you built. |
| `tests/` | `npm test` and `npm run test:browser`. |
| `sims/build.mjs` | Bundles a machine into one HTML file, three.js and fonts inlined. |
| `sims/capture.mjs` | Renders the film frame by frame to a 60 fps mp4, or to review sheets of stills. A failure fails the run and leaves any earlier video alone. |
| `timeline.mjs` | The one reader of a film's timeline, so a typo fails everywhere. |
| `sfx/`, `run_sfx.py` | Procedural sound on the film's timeline, mastered to −14 LUFS. |

## What changed

Compared with upstream at commit a91262a:

- **Fixes.** macOS: headless Chromium now gets WebGL (`--use-angle=metal`). `sfx/synth.py` had one person's Windows path to ffmpeg hard-coded, which broke `sample()` for everyone else. `sheet.mjs` picks a font that exists on each platform.
- **Tools.** A preflight check, a starter project that runs on day one, and a page test that fails on impure frames, NaN, network requests, broken joints, unwired and dead controls, a stopped loop, and pages a keyboard or a phone can't use. It looks at the scene with the panels hidden, and it can run a plan of what each click should do, tapping on a phone with a real finger. An Artifact packager. The build reports a page's size, hash and what takes the room.
- **Recording that fails honestly.** A page error, a dead encoder, audio that's too short or an impossible video size now fails the run, and a failed run can't destroy an earlier video. `--score` adds a synced score. Every run leaves a report.
- **Every visitor.** The starter uses real buttons and works from the keyboard, holds still for reduced motion, and has a real phone layout. The kit gives every example keyboard access and reduced motion, and pages no longer go blank on a phone.
- **Sources.** Each number is recorded as published, measured, estimated or calibrated, and the page shows it.
- **Simulated machines.** A recorder with an exact time grid, a written recipe, and a fourth example, ODM-E1, solved under real forces.
- **Reusable kit modules.** The studio, shell, tour, bench and effects that used to be rewritten per machine.
- **More traps,** each from a real failure.

Two changes can affect a project from an earlier version. A timeline's numbers that aren't times now have to sit under `data`, or the tools reject them. And `capture.mjs` now defaults to `--size 1600x900 --dpr 1.2`.

Tested on macOS on Apple silicon only, with phones emulated in Chromium rather than real ones. The Windows and Linux paths were kept and improved, but have not been run. The older examples still fit their whole console to a phone, small, with a note to turn it sideways.

## About ODM-E1

ODM-E1 is an unofficial engineering study of the omni-directional mobility gear from *Attack on Titan* by Hajime Isayama. It isn't affiliated with or endorsed by the creators or rights holders. Its geometry is built entirely from code, and no art from the series is included. The reference images it was built against aren't shipped.

## Credits

The recording, timeline, test-plan and sourcing work is merged from a Codex adaptation of Teardown. Built on [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT): the runtime, frame capture, sound engine and review rules come from there. Recorded samples are CC0 from Freesound, prepared by [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics); sources in `sfx/samples/SOURCES.md`.

MIT licence.
