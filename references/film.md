# Film and sound

## The timeline

Every beat lives in `<name>-film/timeline.json`, in seconds. The film, the tour, the review sheets and the score all read that one file. A number outside the film fails in the review sheets, `smoke --timeline` and the score instead of quietly landing on the last frame, and the starter's film stops at load on a missing or misspelled cue. A built page carries the timeline it was built with, so rebuild after changing it: the tools refuse a changed duration and warn about a newer file. No reader can tell a number that's in range from a time, so `"gearRatio": 3.2` would pass as a beat: keep those under `data`.

Two shapes:

```json
{"duration": 16, "explode": 8.5, "clicks": [1, 3.2], "data": {"motor": [[3.5, 5.9, 9000]]}}
```

A cue map: every number is a time, except under `data`, which is for the score and is never read as time.

```json
{"schemaVersion": 1, "duration": 18, "fps": 60, "events": [
  {"id": "hero", "t": 0, "mode": "solid"},
  {"id": "cutaway", "t": 4, "mode": "cutaway", "rpm": 1200}
]}
```

An event list: only `t` is a time. Ids must be unique and in order. Use this when cues carry numbers of their own.

## Preview, record, inspect

```
node "$SKILL_DIR/sims/capture.mjs" my-machine-film --stills beats --timeline my-machine-film/timeline.json --cols 4 --out teardown-out/beats.png
node "$SKILL_DIR/sims/capture.mjs" my-machine-film --stills every:0.2 --from 3 --to 5 --out teardown-out/transition.png
node "$SKILL_DIR/sims/capture.mjs" my-machine-film --out teardown-out/silent.mp4
node "$SKILL_DIR/sheet.mjs" --video teardown-out/silent.mp4 --timeline my-machine-film/timeline.json
```

The default is `--size 1600x900 --dpr 1.2`, which is 1920 x 1080. Size times dpr must be whole, even numbers for H.264, and capture refuses anything else before it starts.

A run fails on a page error, a dead encoder or audio that's too short, and a failed run never replaces an earlier video. Every run leaves `<out>.capture.json` with the settings, hashes and GPU. Read that, and the encoded file, before calling a render finished.

The film's play rate is independent of its frame rate. Slowing the picture must not change the RPM you claim, so show the rate on screen.

## Sound

```
python3 "$SKILL_DIR/run_sfx.py" my-machine-shared/score.py
node "$SKILL_DIR/sims/capture.mjs" my-machine-film --score teardown-out/my-machine-score.wav --out teardown-out/my-machine.mp4
node "$SKILL_DIR/wave.mjs" teardown-out/my-machine.mp4 --timeline my-machine-film/timeline.json
```

A score is a Python file with `TIMELINE`, `OUT`, `TARGET_LUFS`, `SEED` and `score(mix, tl)`, where `tl` is the parsed timeline and `mix.put(t, sound, gain)` places a sound. Start from the starter's `score.py`, and `run_sfx.py --list` shows the generators.

`--score` keeps the film's timing and the audio master, and refuses a track that's too short. `--music song.mp3` is for a film directed by a song: it analyses the beats, moves the cuts to them and normalises the track. It needs `--to` or a duration in `--config`, and can't be combined with `--score`.

Derive firing, impact and shift events from the mechanics, not by ear. If the picture is slowed down, decide whether the sound is slowed too, kept at real pitch, or purely musical, and say which.

The master aims for about −14 LUFS with true peak at or under −2 dBFS. Encoding can raise peaks, so `wave.mjs` measures the encoded file and asks only that it stays at or under −1. A loudness figure and a waveform aren't listening. If you can't listen, say so.
