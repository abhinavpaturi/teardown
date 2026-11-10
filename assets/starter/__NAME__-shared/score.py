"""Score for __TITLE__: a quiet bed at one level the whole way, a click on every operator move, air under the throttle.

    python3 run_sfx.py __NAME__-shared/score.py

Every time comes from __NAME__-film/timeline.json, the same file the film reads, so sound can't drift from the picture.
"""

import os

from sfx.score_kit import airy, bed, chords, hz
from sfx.synth import click

TIMELINE = "../__NAME__-film/timeline.json"
OUT = os.path.join(os.environ.get("TEARDOWN_OUT", "teardown-out"), "__NAME__-score.wav")
TARGET_LUFS = -14.0
SEED = 13

CHORDS = chords("Am9:A2 E3 G3 B3 C4/A1", "Fmaj7:F2 C3 E3 A3/F1", "Cmaj7:C3 E3 G3 B3/C2", "G6:G2 D3 E3 B3/G1")
MOTIF = [(0.5, hz("E5")), (1.5, hz("C5")), (2.5, hz("B4"))]
MOVES = ("glassOn", "front", "explode", "assemble", "hero", "glassOff")


def score(mix, tl):
    dur = tl["duration"]
    left, right, low, drums = bed(dur, 92, CHORDS, MOTIF, motif_voice="epiano", kicks=(0, 2.5), snares=(), hats=8, swing=0.0, keys_vel=0.7, keys_lp=3600)
    mix.put_stereo(0, left, right, 0.12)
    mix.put(0, low, 0.12)
    mix.put(0, drums, 0.04)
    for key in MOVES:
        mix.put(tl[key], click(2400, 0.025), 0.055)
    mix.put(tl["spoolUp"], airy(3.0, 400, 1600, 0.6), 0.03)
    mix.put(tl["spoolDown"], airy(3.0, 1600, 400, 0.6), 0.03)
