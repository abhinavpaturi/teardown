# ODM-E1 — the engineered Omni-Directional Mobility gear

Master spec for the simulator. Numbers live in `params.js` (`P`); this file gives the design, the
geometry, the physics model, the sortie and the hand checks. Sources and derivations were in research notes
(canon, visual, power, human, dynamics, blade, tether; not shipped with this example).

## 1. Concept

ODM-E1 keeps the canon silhouette — a butterfly-shaped central unit at the small of the back, a wire drum on each
side, anchor launchers at the hips, horizontal blade magazines with gas bottles on top, two pistol-grip handles
holding segmented blades, a full-body harness — and replaces every part that cannot work with the best real
engineering:

| Canon | Why it fails | ODM-E1 |
|---|---|---|
| Gas blown onto a fan drives the reels | Practical compressed-air shaft work is ~8 Wh/kg incl. tank vs 260 Wh/kg for Li-ion; a 30 kW air drive would need ~24,000 L/min of free air | One axial-flux motor-generator (33 kW cont., 45 kW peak, 4.1 kg) in the hub drives both drums through a 5:1 planetary and two clutch-brakes. Its cooling impeller is the visible "fan". Battery 720 Wh + 53 kJ supercap; braking regenerates 75 % |
| Gas thrust flies the soldier | Cold air Isp ~55 s: a full bottle hovers 98 kg for ~1.3 s | Gas does only small jobs: anchor launch (35 g/shot), 110 N trim jets (0.3 m/s per puff), anti-G cuffs. Wire tension does all the lifting |
| Iron wire | Steel of 30 kN MBS weighs 12.6 kg per 80 m | 4.5 mm Dyneema SK99, 30.4 kN MBS, 13 g/m (0.78 kg per 60 m), aramid forerunner on the first 3 m |
| Anchors bite anything | | 0.35 kg Ti helical spike at 85 m/s (1.26 kJ), ~0.12 m bite in thin-barked softwood, 12 kN hold; unscrew-to-release |
| Riders pull 7-10 g head-to-foot | Relaxed +Gz tolerance 3-5 g; G-LOC at 4.7 g after ≥5 s | Reel controller caps tension (3.5 kN sustained, 5.5 kN clutch slip); posture law reclines the rider so high loads arrive chest-to-back (+Gx, tolerated to 8 g for 2 s); anti-G cuffs (+1.5 g); occipital cowl supports the head |
| Spinning nape cut from nowhere | Angular momentum must come from somewhere | A fairlead shuttle slides the tether's exit point from the buckle to the hip: tension × 0.17 m offset spins the rider about the spine (no gas). Spin ≤ 1.25 rev/s blades out |

## 2. Architecture

```
 battery 720 Wh ─┐                       ┌─ clutch-brake L ─ bevel ─ drum L ─ fairlead shuttle L ─ tether L ─ anchor L
 supercap 53 kJ ─┼─ DC bus ─ inverter ─ motor-generator ─ planetary 5:1 ───┤
     (regen) <───┘        (in the hub, impeller = the "fan")              └─ clutch-brake R ─ bevel ─ drum R ─ ... ─ anchor R
 gas 2 x 2.0 L @300 bar ─ regulator 30 bar ─┬─ launcher L / R (gas piston, 35 g per shot)
                                             ├─ trim jets (hub exhaust slot, 110 N)
                                             └─ G-valve ─ anti-G cuffs (abdomen, thighs, calves)
```

2.1 **Reel**: a speed-controlled drum with force limits. Reel-in force ≤ motor torque × 5 × 0.97 / wound radius
and ≤ bus power / line speed; line speed ≤ 20 m/s, acceleration ≤ 150 m/s². Holding: the brake holds up to the
clutch slip tension (5.5 kN), above which the drum pays out (energy to the supercap at 75 %). Pay-out during an
anchor shot is powered and speed-matched. Slack take-up keeps 80 N.

2.2 **Controller**: predicts tension one step ahead and limits the commanded line speed so net load stays within
the posture-dependent limits; G-LOC budget: 5 s drained while +Gz > 4.7 g (+1.5 g with cuffs inflated).

2.3 **Posture law**: when the felt load n = |f| rises, the rider reclines so the spine sits at φ from the load:
φ = 30° at 1 g rising to 65° at ≥ 4.3 g. Then Gz = n cos φ, Gx = n sin φ. At 5 g that is Gz 2.1, Gx 4.5.

2.4 **Spin**: each tether leaves through a roller fairlead on a curved rail on the girdle's front lower edge. Parked
near the buckle (x = ±0.035 m) the line passes close to the centre of mass. Slid out to the hip (x = ±0.205 m), a
line pulling across the chest makes a torque about the spine of T × offset. At 3 kN and 0.17 m that is 510 N·m,
which spins 5.5 kg·m² (blades out) to 1.25 rev/s in ~0.09 s. Moving the shuttle to the other side stops it.

## 3. Controls (on each handle; each hand drives its own side)

| Input | Action |
|---|---|
| Upper trigger (two-stage) | Fire the anchor / release it (unscrew) |
| Squeeze lever (long, below the guard, ≤ 49 N) | Proportional reel speed; let go = brake and hold |
| Lower trigger | Trim jet puff |
| Thumb rocker | Launcher elevation |
| Thumb button | Fairlead shuttle (spin) |
| Rear hammer (guarded, two-motion) | Blade eject |
| Fold-down forearm cuff + lanyard | Carries the cut moment to the forearm |

## 4. Geometry (body frame: origin at the hip-joint midpoint, x right, y up the spine, z forward; metres)

Body landmarks are in `P.body`. Everything below is mirrored for the left side (x → −x).

**Pelvic girdle** (rigid, leather over carbon): a band 0.06 m tall centred at y = 0.13 hugging the waist ellipse
(rx 0.15, rz 0.11) offset 0.012 out. Buckle plate at the front. Side fittings at (±0.165, 0.10, 0) where the
launchers and magazine struts mount. A lower **hip arc** bar runs from each side fitting down and forward to the
front at hip height carrying the **fairlead rail**: from the hip end (±0.205, −0.01, 0.13) to the park end
(±0.035, 0.0, 0.16). The fairlead is a small roller block that slides along it (`S.wires[i].shuttle`, 0 park … 1 hip).

**Back plate** (carbon shell 0.035 thick, holds battery and supercap): contoured from the sacrum (y −0.05) to the
scapulae (y 0.45), 0.24 wide at the bottom and 0.30 at the top, its inner face on the back surface (z ≈ −0.12 at the
waist, −0.125 at the chest). At its top, the **occipital cowl**: a padded C behind the head at (0, 0.71, −0.11),
hinged so it folds flat on the plate when the load is under 2.5 g and deploys above it.

**Central unit** (the canon "core", 0.40 W × 0.32 H × 0.14 D): mounted on the back plate at (0, 0.06, −0.20).
- Hub: a domed cylinder, Ø 0.13, 0.10 deep, axis along z, dome facing back (−z). Inside: the axial-flux motor
  (Ø 0.12 × 0.05, stator with copper windings, rotor discs) and, behind a radial grille on the dome face, the cooling
  impeller (14 blades) that spins with the motor (`S.drive.angle`). Planetary stage behind the motor.
- Trim-jet nozzle: the canon rectangular exhaust slot under the hub, 0.07 × 0.015, at (0, −0.02, −0.23), pointing
  down and back.
- Bell arms flare from the hub sides to the drums. Each drum sits at (±0.155, 0.10, −0.21) with its axis tilted 35°
  up and outward from x (like wings). Drum: flange Ø 0.16, width 0.09, core Ø 0.06; wound line radius from 0.03
  (empty) to 0.069 (60 m on); clutch-brake disc on the inner side; housing with 14 vent ribs on the rim and a slot
  bar across the outer face. Drums turn with `S.wires[i].spool`.
- The line leaves each drum through a guide tube that follows the support arm around the hip to the fairlead.

**Anchor launchers**: on each side fitting, barrel axis forward and 5° outward, centre at (±0.205, −0.035, 0.08),
barrel OD 0.034 (bore 0.025), from z −0.12 to +0.28; gas reservoir and valve at the rear; elevation trunnion. The
anchor: a 12 mm × 0.165 m helical-fluted spike, Ti body, steel tip, swivel and spliced eye at the back, seated in
the muzzle when stowed.

**Blade magazines** (×2): boxes 0.70 L × 0.10 H × 0.062 W, horizontal along z, centred at (±0.22, −0.17, 0.10),
hung from the side fitting by a short strut; three slotted bracket plates at 10/47/83 % of length; a ribbed window
showing the 2 spare blades; a rear slot where the handle head plunges in to swap a blade.

**Gas bottles** (×2): Type IV, OD 0.09, 0.46 long, carbon overwrap (#1D1F21, clearcoat) with steel boss, valve and
regulator at the front end, on top of each magazine at (±0.22, −0.075, 0.08).

**Handles** (×2, in the hands; grip frame from the rider: x along the blade): overall height 0.18, grip 0.12 long
canted 17°, diamond-knurled leather; a two-window trigger guard with two triggers; the long curved squeeze lever hinged
at the front of the guard; a blade socket block on top-front; a guarded rear hammer; a fold-down forearm cuff; an end
cap with lanyard and the cable to the launcher base.

**Blades**: 0.80 × 0.040 × 1.6 mm AerMet 100, single edge (18° included), tip clipped 35°, 6 diagonal score lines at
0.14 + k·0.11 m from the root, a shinogi line; 0.41 kg.

**Harness** (rider's straps over the girdle): canon layout: Y shoulder straps to a chest strap,
flank straps to the girdle, an X over the groin, a sub-pelvic seat strap, two bands per thigh (the thigh anti-G cuffs),
straps down the calves (calf cuffs) to the boots; back: an X between the scapulae (over the back plate edges), an X
over the buttocks. Anti-G cuffs swell with `S.antiG` (0 … 35 kPa).

**World**: trees from `P.world.trees` (trunk radius profile `P.world.trunk` × scale; flared roots; vertical bark
ridges; huge horizontal branches), fill trees outside the corridor, a clearing with the 15 m training dummy facing −z
(towards the incoming rider) with its nape pad on the back of the neck at y 13.3 (1.0 m tall, 0.10 wide, 0.10 deep).

## 5. Physics model (physics.js)

- Point mass m = rider + rig (≈ 98 kg) at the pelvis; gravity, quadratic drag ½ρ CdA |v| v with CdA by posture.
- Tether i: anchor A_i, exit point E_i (from the shuttle position in the body frame), geometric distance
  d = |A − E|, unstretched length L (the reel state). Stretch s = d − L. Stiffness k = 1 / (L/EA + 1/k_harness),
  damping c = 2ζ√(k m). T = max(0, k s + c ṡ). Force on the rider T·(A − E)/d.
- Reel i: line speed u (+ = in), commanded u*; drum dynamics m_d u̇ = F_m − T with reflected mass
  m_d = J/r² and motor force F_m from a speed loop clamped to [−T_slip, F_avail(u, r)], F_avail = min(τ·G·η/r,
  P_avail/max(u, 0.5)), u limited to ±20 m/s and ±150 m/s². L̇ = −u. Wound radius r from line out.
- Anchor flight: ballistic with drag from the muzzle (fairlead exit) at 85 m/s along the aim, powered pay-out
  matched; hit = first intersection with a tree trunk (radius profile) or the dummy; then L = d at the hit.
- Energy ledger: kinetic + potential vs reel work, thrust work, drag and clutch losses; closure < 0.5 %.
- Bus: P_bus = F_m u / η when driving; −0.75 |F_m u| when braking; battery 7 kW, the rest from the supercap.
- Gas: −35 g per shot, jets ṁ = F/(Isp g0), cuffs; bottle pressure ∝ mass (isothermal display) with a cooling dip.
- Attitude: the posture law (2.3) about the load direction and the velocity heading; ballistic phases blend to a
  streamlined attitude along v; spin about the spine from the shuttle torque (2.4) with I by posture.
- Fixed step 0.5 ms, stored at 240 Hz into Float32Arrays; sample(τ) interpolates.

## 6. Sortie (the physics tunes the exact numbers; see "Physics notes")

1. Stand on T0's branch at 30 m. Fire R at T1. Step off: pendulum swing, pump-reel through the bottom.
2. Release past the bottom, fire L at T2 in the air, swing and pump.
3. Trim-jet puff to show how little gas does (0.3 m/s).
4. Release, fire R at T3, zip: reel in hard and climb; this is the high-g pull (Gx-dominant, ≤ 5 g).
5. Release, fire L into T4 behind the dummy above nape height, swing round behind the neck; shuttle to the hip,
   spin up to 1.25 rev/s, blades out (tip radius 1.30 m): the blades take a 1.0 m × 0.10 m slice off the nape pad.
6. Spin down, release, fire R at T5, brake the swing, touch down on T5's branch at ≤ 3 m/s.

## 7. Hand checks

- Pendulum from horizontal: T = 3 mg = 3 × 98 × 9.81 = 2.88 kN (3 g) — under the 3.5 kN sustained cap.
- 20 m/s on a 12 m radius: n = 1 + v²/(g r) = 1 + 400/117.7 = 4.4 g → recline 65°: Gz 1.9, Gx 4.0. OK.
- Tether stress at 5.5 kN slip: σ = 5.5 kN / (π·2.25² mm²) = 346 MPa; MBS 30.4 kN → safety factor 5.5.
- Drum rpm at 20 m/s on a half-full drum (r 0.05): 20 / (2π·0.05) × 60 = 3,820 rpm; motor 3,820 × 5 = 19,100 rpm (max 20,000). On the bare core (r 0.03) the motor limit caps the line at 12.6 m/s.
- Reel-in force at peak torque: 40 × 5 × 0.97 / 0.03 = 6.5 kN on the core (the clutch caps it at 5.5 kN); 2.8 kN on a full drum (0.069).
- Wire power at 3 kN × 12 m/s = 36 kW ≤ 40 kW bus.
- Anchor: ½ · 0.35 · 85² = 1.26 kJ; gas 35 g per shot; 6 shots = 0.21 kg of 1.32 kg.
- Trim puff: 110 N × 0.3 s = 33 N·s → Δv = 33/98 = 0.34 m/s; gas = 33 / (55 × 9.81) = 61 g.
- Spin: 510 N·m / 5.5 kg·m² = 93 rad/s²; 7.85 rad/s (1.25 rev/s) in 0.085 s. Blade centripetal at r 1.0 m:
  7.85² × 1.0 = 62 m/s² (6.3 g) on 0.7 kg blade + handle = 43 N per hand.
- Nape cut: chord 2√(2Rh − h²) = 2√(2·1.3·0.1 − 0.01) = 1.00 m. Cut energy ≈ 600 J of ~19 kJ kinetic at 20 m/s.
- Touchdown: 3 m/s ≈ a 0.46 m drop.

## 8. Caveats (shown in the teardown)

- Rig mass ≈ 28 kg: 40 % of a 70 kg rider, above NASA's 20 % assumption (the canon replica is ~10 kg).
- 45 kW from a 4.1 kg motor-inverter for 10 s and 26 kW from 2.5 kg of supercaps are at the edge of 2026 products.
- Anchors need thin-barked trees: giant sequoia bark (30-60 cm) is thicker than the spike; real trees would need a
  limb-collar target or a grapnel mode.
- The occipital cowl and recline posture are not canon; without them a 5 g swing would black the rider out.
- The training dummy's nape is a soft pad: wood across the grain is 10-100× tougher than flesh and would stall the blade.

## Physics notes (from building and tuning the sortie, sims/odm-dev/)

- **Gearbox 5:1, not 3.2:1.** With line wound out to a 56 mm radius, 40 N·m × 3.2 holds only 2.2 kN: less than a
  2.3 g swing, so the reel stalled and paid out. 5:1 gives 194 N·m at the drum: 3.5 kN at 56 mm, 6.5 kN on the core,
  still > 20 m/s of line on a full drum. Even so, at the bottom of the T3 swing the line pulls exactly the motor's stall
  force (3.3 kN), so that reel only takes up slack: the film says so.
- **Swing from branches, not trunks.** A pendulum's bottom is under its pivot; a pivot on a trunk's surface puts the
  rider against the trunk. Every swing hangs from a long branch reaching over a corridor at x = 1.8.
- **Slack take-up follows the closing speed** (+2 × slack), never faster, so the line never snatches; a slipping clutch
  disconnects the motor, so only the drum's inertia (not the rotor's ~9 kg reflected) follows the line.
- **The spin needs a kick and a release.** A body pulled by one line through a fixed point turns until the line passes
  through it (here 57° for a hip fairlead) and stops: no sustained spin, and a spin while tethered would wrap the line.
  The fairlead slides out 75 % of the way to the hip under 3.3 kN, the body spins up to 1.23 rev/s in ~0.15 s, and the
  line is released at the spin's peak: the pass behind the nape is ballistic.
- **The dummy stands side-on (facing -x)** so the rider passes 1.20 m behind the neck travelling along it; a 1.30 m tip
  radius then dips 0.10 m and cuts the 1.0 m chord. The pass was solved for: anchor 12.5 m along T4's branch, the cut
  line 0.92 m shorter than the geometric estimate, the kick 0.15 s before the bottom.
- **Soft catch:** the catch line's clutch slips at 2.5 kN for 0.4 s, ramping to full over 0.5 s, while the centred
  fairlead weathervanes the spinning body back into line (lateral load ≤ 2 g, onset ≤ 68 g/s).
- **Landing by two-line hover.** A pendulum climbs to its apex almost vertically, so a branch under the apex is in the
  way of the climb. Instead: at the apex the left line bites T6's trunk, both reels set a V 1.2 m over a short, thick
  limb that ends clear of the climb, and both pay out at 0.8 m/s: touchdown 1.31 m/s.
- **Result** (node sims/odm-dev/test.mjs): 25.65 s sortie; peak 4.55 g net, 4.30 g +Gz (0.14 s above 3 g), 3.47 g +Gx,
  1.97 g lateral, 4.71 kN, 68 g/s onset, 1.23 rev/s, 33 kW; 271 g of gas and ~15 Wh of battery; no strikes; energy
  closure 0.4 %.
