// P: every number the ODM-E1 simulator uses, in SI units, with where it comes from. The research notes behind each
// value are in research/*.md; the design rationale and hand checks are in research/SPEC.md. Physics, geometry,
// panels and labels all read from here, so nothing on screen can disagree with the model.
const deg = Math.PI / 180;

export const P = Object.freeze({
  name: 'ODM-E1',
  title: 'Omni-Directional Mobility Gear',
  g0: 9.81,
  rho: 1.2, // air density, kg/m3

  // ------------------------------------------------------------ the rider and the body frame (pelvis origin, x right, y up, z forward)
  rider: {mass: 70, stature: 1.75},
  body: {
    hipY: 0.91, // origin (midpoint of the hip joints) above the soles when standing
    hipX: 0.085, // hip joint lateral offset
    pelvis: {y: 0.0, rx: 0.175, rz: 0.12}, // buttock/hip ellipse half-width, half-depth
    waist: {y: 0.13, rx: 0.15, rz: 0.11}, // belt line ellipse (waist breadth 0.30, depth 0.22)
    chest: {y: 0.36, rx: 0.165, rz: 0.115},
    shoulder: {y: 0.52, x: 0.19}, // shoulder joint centres (biacromial 0.40)
    neck: {y: 0.585, r: 0.058},
    head: {y: 0.725, rx: 0.075, ry: 0.115, rz: 0.095}, // head centre; top at 0.84 -> stature 1.75
    upperArm: 0.3, forearm: 0.255, gripFromWrist: 0.085,
    upperArmR: 0.045, forearmR: 0.037,
    thigh: {len: 0.43, rTop: 0.088, rKnee: 0.055},
    shank: {len: 0.42, rTop: 0.058, rAnkle: 0.034},
    foot: {len: 0.26, heel: 0.06, h: 0.075},
  },

  // ------------------------------------------------------------ mass budget, kg (research/power.md, blade.md, tether.md)
  mass: {
    motor: 4.1, // axial-flux motor-generator with inverter (H3X HPDM-30 class)
    gearbox: 2.0, // 5:1 planetary, two electromagnetic clutch-brakes, bevel output shafts
    drums: 0.7, // two level-wound drums
    tether: 1.56, // 2 x 60 m of 4.5 mm SK99 at 13 g/m
    frame: 1.8, // pelvic girdle, lumbar plate, reel arms, fairlead rails
    battery: 3.6, // 20s2p Molicel P50B, 720 Wh
    supercap: 2.5, // 53 kJ buffer for the 2 s pull peaks and regeneration
    dcdc: 1.0,
    gas: 2.84, // two 2.0 L Type IV bottles at 300 bar, filled
    launchers: 1.2, // two gas-piston launchers
    anchors: 0.7, // two 0.35 kg titanium helical spikes
    handles: 0.7,
    blades: 2.46, // 6 blades (2 mounted + 2 spares per box) of 0.41 kg
    magazines: 1.0,
    harness: 1.6, // girdle padding, straps, anti-G cuffs and G-valve
    cables: 0.3,
  },
  get rigMass() {
    return Object.values(this.mass).reduce((a, b) => a + b, 0);
  },
  get m() {
    return this.rider.mass + this.rigMass;
  },

  // ------------------------------------------------------------ power train (research/power.md)
  motor: {
    pCont: 33e3, // W continuous
    pPeak: 45e3, // W for <= 10 s (assumed 1.35x continuous)
    tauPeak: 40, // N m at the motor shaft
    rpmMax: 20000,
    eta: 0.94, // motor + inverter, either direction
    rotorI: 0.0021, // kg m2 rotor + impeller
  },
  gear: {ratio: 5.0, eta: 0.97}, // one planetary stage: 194 N m at the drum, 2.8 kN on a full drum, 6.5 kN on the core
  bus: {
    pMax: 40e3, // W the bus can deliver (battery 7 kW + supercap 26 kW + margin at the 2 s peaks)
    regen: 0.75, // fraction of braking power recovered
    battWh: 720,
    capJ: 53e3,
    battKW: 7,
  },

  // ------------------------------------------------------------ reels and tether (research/tether.md, dynamics.md)
  reel: {
    coreR: 0.03, // drum core radius
    flangeR: 0.08, // flange radius (canon spool 0.16 m)
    width: 0.09,
    fillR: 0.069, // wound radius with all 60 m on
    vMax: 20, // m/s line speed (reel in or powered pay-out)
    aMax: 150, // m/s2 line acceleration limit
    slip: 5500, // N clutch slip: the drum pays out above this
    hard: 6000, // N absolute
    pre: 80, // N slack take-up tension
    drumI: 0.0014, // kg m2 one loaded drum
  },
  tether: {
    d: 0.0045,
    len: 60,
    mbs: 30.4e3, // N, Dyneema SK99 12-strand
    lin: 0.013, // kg/m
    EA: 0.94e6, // N, HMPE at 30 % of break
    kHarness: 30e3, // N/m harness and body compliance in series with the line
    zeta: 0.3,
    jacket: 3, // m of aramid forerunner behind the anchor
  },

  // ------------------------------------------------------------ anchors and launchers (research/tether.md, power.md)
  anchor: {
    mass: 0.35, // Ti-6Al-4V helical spike with a hardened steel tip
    d: 0.012,
    len: 0.165,
    v0: 85, // m/s muzzle, gas piston
    bore: 0.025,
    barrel: 0.4,
    gas: 0.035, // kg of air per shot
    cdA: 0.00012, // m2 spike drag area
    hold: 12e3, // N design holding in thin-barked green softwood
    depth: 0.12, // m typical bite at ~75 m/s
    retract: 25, // m/s free retrieval
  },

  // ------------------------------------------------------------ gas: anchors, trim jets, anti-G cuffs (research/power.md, human.md)
  gas: {
    bottles: 2,
    vol: 0.002, // m3 each
    p0: 300e5, // Pa fill
    air: 0.66, // kg per bottle at 300 bar, 15 C
    bottleMass: 0.76,
    reg: 30e5, // regulated Pa
    isp: 55, // s cold air, 0.95 nozzle
    jet: 110, // N trim jet thrust
  },
  antiG: {gain: 1.5, kPaMax: 35, onset: 2.0}, // +g tolerance, cuff pressure, g where the G-valve opens

  // ------------------------------------------------------------ the human limits the controller enforces (research/human.md)
  limits: {
    GzSus: 3.0, Gz3s: 5.0, Gz15: 7.0, GzNever: 8.3,
    GxSus: 6.0, Gx2s: 8.0,
    GyMax: 1.5,
    tensionSus: 3500, // N
    jerk: 20, // g/s nominal
    spinNom: 1.25, // rev/s with blades out
    spinMax: 2.0, // rev/s for <= 1 s
    touchdown: 3.0, // m/s
    glocG: 4.7, glocBudget: 5.0, // +Gz above which the 5 s oxygen budget drains
    recline: [30 * deg, 65 * deg], // spine-to-load angle range used by the posture law
  },

  // ------------------------------------------------------------ drag areas by posture, m2 (research/dynamics.md)
  cdA: {hang: 0.38, stream: 0.12, tuck: 0.25, flare: 0.5},

  // ------------------------------------------------------------ the fairlead shuttle that makes the spin (SPEC 2.4)
  shuttle: {
    // the rail sits just under the belt, 6 cm above the hip joints, so the thighs clear it when the hips flex in a swing
    park: [0.0, 0.06, 0.165], // body-frame exit point when parked: the master fairlead at the buckle, on the centreline (no spin torque)
    hip: [0.205, 0.05, 0.13], // exit point at the hip end of the rail
    spinI: [2.0, 5.5], // kg m2 about the spine, tucked / blades out
  },

  // ------------------------------------------------------------ blades and handles (research/blade.md, canon.md)
  blade: {
    len: 0.8, width: 0.04, spine: 0.0016, edge: 18 * deg, tip: 35 * deg,
    mass: 0.41, steel: 'AerMet 100', hrc: 53.5,
    root: 0.14, scores: 6, pitch: 0.11, scoreDepth: 0.3,
    cutR: 1.3, // m spin tip radius that gives a 1.0 m chord at 0.10 m depth
  },
  handle: {grip: 0.12, height: 0.18, cant: 17 * deg, leverMax: 49, latch: 2200},
  magazine: {len: 0.7, h: 0.1, w: 0.062, spares: 2},

  // ------------------------------------------------------------ the arena (research/canon.md, visual.md); physics may tune tree positions
  world: {
    seed: 850,
    trunk: [[0, 4.6], [3, 3.0], [18, 2.45], [50, 2.0], [72, 1.4], [86, 0.5]], // [height, radius] profile, scaled per tree
    trees: [
      // id, x, z, scale, height, branches [height, azimuth (rad, 0 = +z; direction (sin az, 0, cos az)), length from
      // the trunk axis, root radius]. The flight corridor runs along x = 1.8: each tree's first branch reaches out over
      // it, so every swing hangs from a branch above the path instead of from a trunk beside it.
      {id: 'T0', x: -6, z: 0, s: 1.0, h: 84, branches: [[30, 1.5708, 13, 0.85], [46, 2.6, 11, 0.7], [60, -1.4, 10, 0.6]]}, // the launch branch runs across the corridor: the rider steps off its side
      {id: 'T1', x: 12, z: 40, s: 0.95, h: 80, branches: [[47, -1.5708, 15, 0.9], [30, 1.2, 10, 0.7]]},
      {id: 'T2', x: -12, z: 92, s: 1.05, h: 86, branches: [[49, 1.5708, 17, 0.9], [32, -2.0, 10, 0.7]]},
      {id: 'T3', x: 12, z: 146, s: 0.9, h: 78, branches: [[45, -1.5708, 15, 0.85], [62, 2.0, 9, 0.6]]},
      {id: 'T4', x: 14, z: 210, s: 1.0, h: 82, branches: [[35, -1.5708, 16, 0.8], [52, 0.9, 9, 0.6]]}, // its branch hangs over the dummy's back: the cut swing
      {id: 'T5', x: -12, z: 262, s: 1.1, h: 88, branches: [[50, 1.5708, 16, 0.9], [30, -2.4, 10, 0.7]]}, // the catch: a high branch over the corridor
      {id: 'T6', x: 1.71, z: 311.64, s: 1.0, h: 84, branches: [[40.14, 3.1416, 6.64, 0.85], [58, 1.2, 9, 0.6]]}, // the landing branch: its top sits 0.3 m under the rider's feet at the top of the final swing
    ],
    corridor: [[1.8, -12], [1.8, 40], [1.8, 92], [1.8, 146], [1.8, 210], [1.6, 262], [1.7, 306]], // the flight path the fill trees keep clear of
    corridorW: 24, // full width
    landing: {tree: 'T6', branch: 0, along: 4.64}, // where the sortie ends: a short thick limb that stops clear of the final climb
    clearing: {x: 0, z: 210, r: 34},
    fill: {count: 70, spacing: 32, extent: 320},
    // the dummy stands side-on to the flight path (facing -x) so the rider passes behind its neck travelling along it;
    // nape.back is the distance from the dummy's vertical axis to the nape surface
    dummy: {x: 0, z: 210, face: -Math.PI / 2, h: 15, shoulderY: 12.3, shoulderW: 3.9, hipY: 8.0, head: 1.95, nape: {y: 13.3, h: 1.0, w: 0.1, depth: 0.1, back: 0.6}},
  },
});
