"""Score for the ODM-E1 film: a low, unsettled bed (Dm9 / Bbmaj7 / Gm9 / A7sus4, 88 bpm) that runs bare through the
teardown and gains its drums when the sortie starts; a quiet click on every button the operator presses; the motor's
whine whenever the drive turns (the bench spin-ups, the reels under power); a pneumatic crack and a hiss for every
anchor shot and a wooden thunk where it bites; air that swells with the rider's speed at the bottom of each swing; the
trim jet's short hiss; a riser through the slow motion that lands on the cut with the one impact of the film; soft
thuds for the catch and the touchdown, and a chord as the map opens.

    python run_sfx.py sims/odm-shared/score.py

Every time comes from odm-film/timeline.json (written by sims/odm-dev/timeline.mjs from the film's own clock).
"""

import os

from sfx.score_kit import airy, bang, bed, chords, hiss, hz, motor, thud
from sfx.synth import chime, click, impact, riser, whoosh

TIMELINE = "../odm-film/timeline.json"
OUT = os.path.join(os.environ.get("TEARDOWN_OUT", "teardown-out"), "odm-score.wav")
TARGET_LUFS = -14.0
SEED = 850

CHORDS = chords("Dm9:D2 A2 C3 E3 F3/D1", "Bbmaj7:Bb1 F2 A2 D3/Bb0", "Gm9:G1 D2 F2 A2 Bb2/G0", "A7sus4:A1 E2 G2 D3/A0")
MOTIF = [(0.5, hz("A4")), (1.5, hz("F4")), (2.5, hz("E4"))]
BPM = 88


def peaks(speed, dt=0.1, floor=17.0):
    """Times where the rider's speed tops a local maximum above floor: the bottoms of the swings and the passes."""
    out = []
    for i in range(1, len(speed) - 1):
        if speed[i] >= floor and speed[i] >= speed[i - 1] and speed[i] > speed[i + 1]:
            if not out or i * dt - out[-1][0] > 1.2:
                out.append((i * dt, speed[i]))
    return out


def score(mix, tl):
    dur = tl["duration"]
    bar = 4 * 60 / BPM
    left, right, low, drums = bed(dur, BPM, CHORDS, MOTIF, motif_voice="epiano", kicks=(0, 2.5), snares=(3,), hats=8, swing=0.0,
                                  drums_from=int(tl["teardown"] / bar), keys_vel=0.62, keys_lp=3200)
    mix.put_stereo(0, left, right, 0.11)
    mix.put(0, low, 0.13)
    mix.put(0, drums, 0.04)

    # the operator's clicks
    for t in tl["clicks"]:
        mix.put(t, click(2300, 0.025), 0.05)

    # the drive: a whine whose pitch follows the motor's peak rpm
    for t0, t1, rpm in tl["data"]["motor"]:
        d = max(0.3, t1 - t0)
        mix.put(t0, motor(d, 140 + rpm / 60, 1500, 16), 0.022)

    # anchors: the piston's crack and its exhaust, then the bite
    for i, t in enumerate(tl["fires"]):
        mix.put(t, bang(0.7, seed=i), 0.07)
        mix.put(t + 0.01, hiss(0.35, 5200, 0.8), 0.03)
    for t in tl["hits"]:
        mix.put(t, thud(120, 0.04, 0.3), 0.09)

    # air under the rider at each fast pass
    for t, v in peaks(tl["data"]["speed"]):
        if tl["slow"]["a"] - 0.5 < t < tl["slow"]["b"] + 0.5:
            continue
        mix.put(max(0, t - 0.6), whoosh(1.4, 260, 1100 + 30 * v, 0.45), 0.02 + 0.0012 * v)

    # the trim jet's short hiss
    for t in tl["jets"]:
        mix.put(t, hiss(0.4, 3800, 1.0), 0.05)

    # the kick, the slow motion and the cut: a riser that lands exactly on the slice
    a = tl["slow"]["a"]
    mix.put(a, riser(tl["cut"] - a, 180, 3600), 0.035)
    mix.put(tl["kick"], airy(1.2, 400, 1600, 0.7), 0.025)
    mix.put(tl["cut"], impact(1.4), 0.16)
    mix.put(tl["cut"], chime([hz("A5"), hz("E6"), hz("A6")], 2.4, 0.9), 0.05)

    # the catch and the touchdown
    mix.put(tl["catch"], thud(75, 0.06, 0.45), 0.08)
    mix.put(tl["land"], thud(95, 0.05, 0.4), 0.1)
    mix.put(tl["land"] + 0.05, chime([hz("D5"), hz("F5"), hz("A5")], 2.0, 0.8), 0.035)

    # the map opens
    mix.put(tl["map"], chime([hz("D4"), hz("A4"), hz("E5"), hz("F5")], 3.2, 1.2), 0.04)
