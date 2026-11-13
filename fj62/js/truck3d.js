// Schematic 3D FJ62-style wagon built from primitives. Every part is tagged
// with a zone id so tapping it filters the app to that system.
// Axes: +x = front of truck, +y = up, +z = passenger (right) side.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const LEVEL_COLORS = [0x3fb950, 0xd9b42b, 0xf0883e, 0xf85149]; // ok, soon, overdue, critical
const NEUTRAL = 0x9aa4ae;
const BODY_GRAY = 0x8d949c;
const INTERNAL = new Set(['engine', 'cooling', 'fuel', 'exhaust', 'transmission', 'transfer', 'driveshafts',
  'frontaxle', 'rearaxle', 'brakes', 'steering', 'suspension', 'interior', 'electrical']);

const VIEWS = {
  iso: { pos: [5.6, 2.7, 4.8], target: [0, 0.75, 0] },
  front: { pos: [7.2, 1.3, 0.01], target: [0, 0.8, 0] },
  side: { pos: [0.01, 1.2, 7.8], target: [0, 0.8, 0] },
  rear: { pos: [-7.2, 1.5, 0.01], target: [0, 0.8, 0] },
  top: { pos: [0.3, 9.5, 0.01], target: [0, 0.5, 0] },
  under: { pos: [0.8, -6.2, 1.6], target: [0, 0.45, 0] },
  bay: { pos: [4.4, 3.9, 2.7], target: [1.35, 0.8, 0], hood: false, xray: true },
};

export function createTruck(container, { onSelect, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  camera.position.set(...VIEWS.iso.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...VIEWS.iso.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 1.0;
  controls.maxDistance = 16;
  controls.zoomSpeed = 0.9;

  scene.add(new THREE.HemisphereLight(0xe6eef7, 0x30363f, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(4, 8, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7); fill.position.set(-4, -5, -3); scene.add(fill);

  const grid = new THREE.GridHelper(14, 28, 0x5a6b7d, 0x3a4552);
  grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false;
  scene.add(grid);

  const truck = new THREE.Group();
  scene.add(truck);
  const meshes = [];      // all zone meshes
  const shell = [];       // outer body panels (go see-through in x-ray)
  const edgeLines = [];
  let hood;

  // ---------- helpers ----------
  function part(zone, geom, pos, opts = {}) {
    const material = new THREE.MeshStandardMaterial({
      color: opts.color ?? NEUTRAL, roughness: opts.rough ?? 0.65, metalness: opts.metal ?? 0.1,
      flatShading: opts.flat ?? true, side: opts.side ?? THREE.FrontSide, transparent: true, opacity: 1,
    });
    const m = new THREE.Mesh(geom, material);
    m.position.set(...pos);
    if (opts.rot) m.rotation.set(...opts.rot);
    if (opts.scale) m.scale.set(...opts.scale);
    m.userData = { zone, tone: opts.tone ?? 0.25, base: opts.color ?? null, shell: !!opts.shell, glass: !!opts.glass, keep: !!opts.keep };
    truck.add(m);
    meshes.push(m);
    if (opts.shell) shell.push(m);
    if (opts.edges) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 28),
        new THREE.LineBasicMaterial({ color: 0x1c2733, transparent: true, opacity: 0.55 }));
      lines.position.copy(m.position); lines.rotation.copy(m.rotation); lines.scale.copy(m.scale);
      lines.userData.owner = m;
      truck.add(lines); edgeLines.push(lines);
    }
    return m;
  }
  const box = (zone, w, h, d, pos, o) => part(zone, new THREE.BoxGeometry(w, h, d), pos, o);
  function cylBetween(zone, a, b, r, o = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, o.seg ?? 10);
    const m = part(zone, g, [0, 0, 0], o);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return m;
  }
  function tube(zone, pts, r, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    return part(zone, new THREE.TubeGeometry(curve, o.segs ?? 40, r, o.radial ?? 8, false), [0, 0, 0], { flat: false, ...o });
  }

  // ---------- body shell ----------
  const yb = 0.62, fx = 1.365, rx = -1.365;
  const archR = 0.47, archY = 0.40, dx = Math.sqrt(archR * archR - (yb - archY) ** 2);
  const a0 = Math.atan2(yb - archY, -dx), a1 = Math.atan2(yb - archY, dx);
  const s = new THREE.Shape();
  s.moveTo(-2.30, yb);
  s.lineTo(rx - dx, yb);
  s.absarc(rx, archY, archR, a0, a1, true);
  s.lineTo(fx - dx, yb);
  s.absarc(fx, archY, archR, a0, a1, true);
  s.lineTo(2.34, yb);
  s.lineTo(2.36, 1.11);
  s.lineTo(0.96, 1.15);
  s.lineTo(0.86, 1.29);
  s.lineTo(0.57, 1.80);
  s.lineTo(-2.22, 1.82);
  s.lineTo(-2.30, 1.76);
  s.lineTo(-2.31, yb);
  const bodyGeom = new THREE.ExtrudeGeometry(s, { depth: 1.76, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 12 });
  bodyGeom.translate(0, 0, -0.88);
  part('body', bodyGeom, [0, 0, 0], { color: BODY_GRAY, shell: true, edges: true, tone: 0, metal: 0.25, rough: 0.5 });

  hood = box('body', 1.40, 0.045, 1.66, [1.66, 1.155, 0], { color: BODY_GRAY, shell: true, edges: true, tone: 0, rot: [0, 0, 0.028], metal: 0.25, rough: 0.5 });

  // glass
  const glassOpts = { color: 0x1d2a36, shell: true, glass: true, side: THREE.DoubleSide, tone: 0, keep: true, rough: 0.2, metal: 0.4 };
  const winShapes = [
    [[0.80, 1.31], [0.535, 1.765], [-0.05, 1.765], [-0.05, 1.31]],
    [[-0.15, 1.31], [-0.15, 1.765], [-1.05, 1.765], [-1.05, 1.31]],
    [[-1.15, 1.31], [-1.15, 1.765], [-2.17, 1.765], [-2.17, 1.31]],
  ];
  for (const zs of [0.909, -0.909]) {
    for (const pts of winShapes) {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      part('body', new THREE.ShapeGeometry(sh), [0, 0, zs], glassOpts);
    }
  }
  { // windshield
    const b = [0.845, 1.30], t = [0.575, 1.775];
    const len = Math.hypot(t[0] - b[0], t[1] - b[1]);
    const n = [(t[1] - b[1]) / len, (b[0] - t[0]) / len];
    box('body', 0.012, len * 0.94, 1.56, [(b[0] + t[0]) / 2 + n[0] * 0.03, (b[1] + t[1]) / 2 + n[1] * 0.03, 0],
      { ...glassOpts, rot: [0, 0, Math.atan2(b[0] - t[0], t[1] - b[1])] });
  }
  box('body', 0.012, 0.40, 1.50, [-2.338, 1.53, 0], glassOpts);

  // trim pieces that stay solid in x-ray
  box('body', 0.03, 0.30, 1.02, [2.375, 0.93, 0], { color: 0x222a33, tone: 0, keep: true }); // grille
  box('body', 0.14, 0.15, 1.88, [2.44, 0.69, 0], { color: 0xc4cad0, tone: 0, metal: 0.6, rough: 0.3 });  // front bumper
  box('body', 0.12, 0.15, 1.86, [-2.39, 0.69, 0], { color: 0xc4cad0, tone: 0, metal: 0.6, rough: 0.3 }); // rear bumper
  for (const z of [0.865, -0.865]) box('body', 2.75, 0.035, 0.035, [-0.83, 1.84, z], { color: 0x6f7780, tone: 0 }); // roof gutters
  for (const z of [1.0, -1.0]) box('body', 0.05, 0.13, 0.11, [0.80, 1.36, z], { color: 0x2a323b, tone: 0 }); // mirrors

  // frame (rust checks live under Body)
  for (const z of [0.42, -0.42]) box('body', 4.35, 0.15, 0.075, [-0.05, 0.50, z], { color: 0x3b434c, tone: 0, keep: true });
  for (const x of [2.05, 0.95, -0.6, -2.1]) box('body', 0.07, 0.07, 0.84, [x, 0.48, 0], { color: 0x3b434c, tone: 0, keep: true });

  // ---------- electrical ----------
  for (const z of [0.58, 0.39, -0.39, -0.58]) box('electrical', 0.03, 0.115, 0.165, [2.385, 0.995, z], { color: 0xf3f0d8, tone: 0 });
  for (const z of [0.82, -0.82]) box('electrical', 0.03, 0.30, 0.11, [-2.335, 1.02, z], { color: 0xc23b3b, tone: 0 });
  box('electrical', 0.24, 0.19, 0.17, [1.97, 0.99, 0.58], { tone: 0.1 });               // battery
  cylBetween('electrical', [1.86, 0.88, 0.26], [1.98, 0.88, 0.26], 0.07, { seg: 12 });  // alternator
  cylBetween('electrical', [1.05, 0.62, -0.22], [1.25, 0.62, -0.22], 0.06, { seg: 10 }); // starter

  // ---------- engine ----------
  box('engine', 0.80, 0.36, 0.30, [1.42, 0.76, 0.02]);                  // block
  box('engine', 0.80, 0.12, 0.28, [1.42, 1.00, 0.02]);                  // head
  box('engine', 0.74, 0.065, 0.20, [1.42, 1.09, 0.02], { tone: 0 });    // valve cover
  box('engine', 0.62, 0.10, 0.24, [1.38, 0.53, 0.05]);                  // oil pan
  box('engine', 0.62, 0.13, 0.09, [1.42, 0.96, -0.20]);                 // intake manifold
  cylBetween('engine', [1.95, 0.95, -0.55], [1.95, 1.10, -0.55], 0.13, { seg: 16 }); // air cleaner
  cylBetween('engine', [1.85, 0.96, -0.24], [1.97, 0.96, -0.24], 0.06, { seg: 10 }); // P/S pump (engine-driven)

  // ---------- cooling ----------
  box('cooling', 0.06, 0.48, 0.76, [2.19, 0.86, 0]);                    // radiator
  cylBetween('cooling', [2.06, 0.84, 0], [2.09, 0.84, 0], 0.21, { seg: 18 }); // fan
  cylBetween('cooling', [1.83, 0.84, 0], [2.03, 0.84, 0], 0.05);       // water pump + clutch
  tube('cooling', [[2.16, 1.04, 0.16], [2.0, 1.06, 0.1], [1.84, 1.0, 0.02]], 0.028); // upper hose
  tube('cooling', [[2.16, 0.68, -0.16], [2.0, 0.66, -0.12], [1.85, 0.72, -0.04]], 0.028); // lower hose
  tube('cooling', [[1.2, 0.93, 0.18], [1.05, 0.98, 0.30], [0.97, 1.02, 0.38]], 0.018); // heater hoses

  // ---------- fuel & emissions ----------
  box('fuel', 0.76, 0.26, 0.36, [-0.72, 0.50, 0.66]);                  // tank (right side)
  tube('fuel', [[-0.40, 0.62, 0.72], [-0.30, 0.95, 0.86], [-0.28, 1.05, 0.89]], 0.025); // filler neck
  tube('fuel', [[-0.4, 0.42, 0.50], [0.4, 0.44, 0.50], [1.0, 0.62, 0.45], [1.25, 0.95, 0.22]], 0.012); // fuel line
  cylBetween('fuel', [0.35, 0.45, 0.52], [0.55, 0.45, 0.52], 0.035);  // fuel filter
  cylBetween('fuel', [1.22, 0.92, -0.66], [1.22, 1.08, -0.66], 0.06, { seg: 12 }); // charcoal canister

  // ---------- exhaust ----------
  box('exhaust', 0.60, 0.08, 0.08, [1.42, 0.80, -0.20]);               // manifold
  tube('exhaust', [[1.40, 0.74, -0.25], [1.15, 0.52, -0.30], [0.6, 0.42, -0.30], [0.12, 0.40, -0.30]], 0.035);
  box('exhaust', 0.45, 0.12, 0.17, [-0.13, 0.40, -0.30], { tone: 0.1 }); // catalytic converter
  tube('exhaust', [[-0.36, 0.40, -0.30], [-1.0, 0.40, -0.30], [-1.25, 0.55, -0.32], [-1.5, 0.55, -0.38], [-1.66, 0.38, -0.55]], 0.035);
  box('exhaust', 0.55, 0.15, 0.20, [-1.95, 0.36, -0.58], { tone: 0.1 }); // muffler
  tube('exhaust', [[-2.22, 0.36, -0.60], [-2.40, 0.40, -0.66]], 0.03, { segs: 6 });

  // ---------- transmission ----------
  part('transmission', new THREE.CylinderGeometry(0.21, 0.13, 0.75, 14), [0.65, 0.72, 0.02], { rot: [0, 0, -Math.PI / 2] });
  box('transmission', 0.42, 0.06, 0.26, [0.66, 0.55, 0.02]);            // pan
  tube('transmission', [[0.6, 0.62, 0.12], [1.2, 0.60, 0.25], [2.13, 0.70, 0.30]], 0.012); // cooler lines

  // ---------- transfer case & 4WD ----------
  box('transfer', 0.30, 0.34, 0.42, [0.14, 0.60, 0.08]);
  for (let i = 0; i < 3; i++) box('transfer', 0.05, 0.06, 0.06, [0.98, 1.06, -0.62 + i * 0.08], { tone: 0.1 }); // firewall vacuum solenoids

  // ---------- driveshafts ----------
  cylBetween('driveshafts', [0.28, 0.50, 0.25], [1.19, 0.38, 0.25], 0.035);   // front
  cylBetween('driveshafts', [-0.02, 0.58, 0.02], [-1.19, 0.38, 0.0], 0.04);   // rear
  for (const p of [[0.28, 0.50, 0.25], [1.19, 0.38, 0.25], [-0.02, 0.58, 0.02], [-1.19, 0.38, 0]]) box('driveshafts', 0.06, 0.09, 0.09, p, { tone: 0.1 });

  // ---------- front axle ----------
  cylBetween('frontaxle', [fx, 0.36, -0.64], [fx, 0.36, 0.64], 0.055);
  part('frontaxle', new THREE.SphereGeometry(0.17, 14, 10), [fx, 0.36, 0.25], { scale: [1, 1, 0.85] });
  for (const z of [0.64, -0.64]) part('frontaxle', new THREE.SphereGeometry(0.115, 14, 10), [fx, 0.36, z], { flat: false, metal: 0.5, rough: 0.3 });
  for (const z of [0.885, -0.885]) cylBetween('frontaxle', [fx, 0.36, z - 0.03 * Math.sign(z)], [fx, 0.36, z + 0.03 * Math.sign(z)], 0.085, { seg: 14 }); // locking hubs

  // ---------- rear axle ----------
  cylBetween('rearaxle', [rx, 0.36, -0.70], [rx, 0.36, 0.70], 0.055);
  part('rearaxle', new THREE.SphereGeometry(0.17, 14, 10), [rx, 0.36, 0.0], { scale: [1, 1, 0.85] });
  for (const z of [0.865, -0.865]) cylBetween('rearaxle', [rx, 0.36, z - 0.02 * Math.sign(z)], [rx, 0.36, z + 0.02 * Math.sign(z)], 0.07, { seg: 12 });

  // ---------- wheels & tires ----------
  for (const x of [fx, rx]) for (const z of [0.74, -0.74]) {
    part('tires', new THREE.CylinderGeometry(0.36, 0.36, 0.24, 30), [x, 0.36, z], { rot: [Math.PI / 2, 0, 0], tone: 0.62, flat: false, rough: 0.9 });
    part('tires', new THREE.CylinderGeometry(0.205, 0.205, 0.245, 20), [x, 0.36, z], { rot: [Math.PI / 2, 0, 0], tone: 0.05, flat: false, metal: 0.4 });
  }
  part('tires', new THREE.CylinderGeometry(0.36, 0.36, 0.22, 30), [-1.93, 0.29, 0], { tone: 0.62, flat: false, rough: 0.9 }); // spare under rear

  // ---------- brakes ----------
  for (const z of [0.585, -0.585]) {
    cylBetween('brakes', [fx, 0.36, z - 0.016], [fx, 0.36, z + 0.016], 0.17, { seg: 22 });      // rotor
    box('brakes', 0.10, 0.14, 0.08, [fx - 0.15, 0.46, z], { tone: 0.15 });                       // caliper
    cylBetween('brakes', [rx, 0.36, z - 0.05], [rx, 0.36, z + 0.05], 0.17, { seg: 22, tone: 0.2 }); // drum
  }
  cylBetween('brakes', [0.98, 1.02, -0.46], [1.12, 1.02, -0.46], 0.11, { seg: 16 });  // booster
  cylBetween('brakes', [1.12, 1.04, -0.46], [1.30, 1.04, -0.46], 0.035);              // master cylinder

  // ---------- steering ----------
  box('steering', 0.17, 0.15, 0.15, [1.96, 0.55, -0.50]);
  cylBetween('steering', [1.96, 0.48, -0.50], [1.42, 0.42, -0.66], 0.022);  // drag link
  cylBetween('steering', [1.17, 0.33, -0.62], [1.17, 0.33, 0.62], 0.022);   // tie rod
  cylBetween('steering', [1.90, 0.62, -0.46], [0.62, 1.30, -0.42], 0.025);  // column
  part('steering', new THREE.TorusGeometry(0.19, 0.02, 8, 26), [0.48, 1.36, -0.42], { rot: [0, Math.PI / 2, -0.5], flat: false });

  // ---------- suspension ----------
  for (const x of [fx, rx]) for (const z of [0.44, -0.44]) {
    tube('suspension', [[x - 0.62, 0.48, z], [x, 0.40, z], [x + 0.62, 0.48, z]], 0.032, { radial: 4, segs: 16 });
    cylBetween('suspension', [x + 0.14 * Math.sign(x), 0.36, z + 0.06 * Math.sign(z)], [x + 0.22 * Math.sign(x), 0.64, z + 0.04 * Math.sign(z)], 0.03);
  }

  // ---------- interior ----------
  for (const z of [0.42, -0.42]) {
    box('interior', 0.50, 0.12, 0.50, [0.05, 0.86, z]);
    box('interior', 0.12, 0.55, 0.50, [-0.24, 1.16, z], { rot: [0, 0, 0.12] });
  }
  box('interior', 0.55, 0.12, 1.42, [-1.02, 0.86, 0]);
  box('interior', 0.12, 0.50, 1.42, [-1.32, 1.12, 0], { rot: [0, 0, 0.1] });
  box('interior', 0.28, 0.22, 1.62, [0.76, 1.13, 0], { tone: 0.35 }); // dash

  // ---------- state & coloring ----------
  let levels = {}, health = true, selected = null, hovered = null, xray = false, userXray = false;
  const black = new THREE.Color(0x0b0f14);
  const tmp = new THREE.Color();

  function colorFor(m) {
    const { zone, tone, base, keep } = m.userData;
    if (keep) return tmp.set(base);
    const lvl = levels[zone] ?? 0;
    if (zone === 'body' && base != null) return tmp.set(base);
    if (base != null && !health) return tmp.set(base);
    tmp.set(health ? LEVEL_COLORS[lvl] : (base ?? NEUTRAL));
    if (base != null && health && zone === 'electrical') tmp.lerp(new THREE.Color(base), 0.55);
    return tmp.lerp(black, tone);
  }

  function restyle() {
    for (const m of meshes) {
      const u = m.userData, mat = m.material;
      mat.color.copy(colorFor(m));
      const isSel = selected && u.zone === selected;
      const isHov = hovered && u.zone === hovered && !isSel;
      mat.emissive.set(isSel ? LEVEL_COLORS[levels[u.zone] ?? 0] : 0x000000);
      mat.emissiveIntensity = isSel ? 0.45 : 0;
      if (isHov) { mat.emissive.set(0xffffff); mat.emissiveIntensity = 0.18; }
      let op = 1;
      if (u.shell) op = xray ? (u.glass ? 0.06 : 0.1) : (u.glass ? 0.85 : 1);
      else if (selected && !isSel) op = 0.16;
      mat.opacity = op;
      mat.depthWrite = op > 0.5;
      m.visible = !(m === hood && hood.userData.hidden);
    }
    for (const l of edgeLines) {
      l.material.color.set(xray ? 0x8fbbe0 : 0x1c2733);
      l.material.opacity = xray ? 0.55 : 0.5;
      l.visible = l.userData.owner.visible;
    }
    requestRender();
  }

  // ---------- render loop (on demand) ----------
  let needsRender = true, tween = null, rafId = 0, running = true;
  const requestRender = () => { needsRender = true; };
  controls.addEventListener('change', requestRender);
  const label = { el: null, zone: null };

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!running) return;
    if (tween) {
      const k = Math.min(1, (t - tween.t0) / tween.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0v, tween.t1, e);
      if (k >= 1) tween = null;
      needsRender = true;
    }
    if (controls.update()) needsRender = true;
    if (!needsRender) return;
    needsRender = false;
    grid.visible = camera.position.y > 0.05;
    renderer.render(scene, camera);
    if (label.zone) placeLabel();
  }
  rafId = requestAnimationFrame(tick);

  const fitScale = () => (camera.aspect < 1.6 ? 1 + (1.6 - camera.aspect) * 0.55 : 1);
  function viewPos(v) {
    const t = new THREE.Vector3(...v.target);
    return new THREE.Vector3(...v.pos).sub(t).multiplyScalar(fitScale()).add(t).toArray();
  }
  function flyTo(pos, target, dur = 650) {
    tween = { t0: performance.now(), dur, p0: camera.position.clone(), p1: new THREE.Vector3(...pos), t0v: controls.target.clone(), t1: new THREE.Vector3(...target) };
  }

  function zoneBox(zone) {
    const b = new THREE.Box3();
    for (const m of meshes) if (m.userData.zone === zone && !m.userData.shell) b.expandByObject(m);
    if (b.isEmpty()) for (const m of meshes) if (m.userData.zone === zone) b.expandByObject(m);
    return b;
  }

  function flyToZone(zone) {
    const b = zoneBox(zone);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (Math.abs(dir.y) < 0.2) dir.y = 0.35, dir.normalize();
    const dist = Math.min(9, Math.max(2.6, size * 1.9)) * fitScale();
    const p = c.clone().add(dir.multiplyScalar(dist));
    flyTo(p.toArray(), c.toArray());
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const cands = meshes.filter(m => m.visible && !(xray && m.userData.shell));
    const hit = ray.intersectObjects(cands, false)[0];
    return hit ? hit.object.userData.zone : null;
  }

  const dom = renderer.domElement;
  const active = new Map();
  let down = null;
  dom.addEventListener('pointerdown', e => {
    active.set(e.pointerId, true);
    down = active.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  const endPointer = e => {
    active.delete(e.pointerId);
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved < 8 && dt < 600) {
      const z = pick(e.clientX, e.clientY);
      if (z) onSelect && onSelect(z);
    }
  };
  dom.addEventListener('pointerup', endPointer);
  dom.addEventListener('pointercancel', e => { active.delete(e.pointerId); down = null; });
  let hoverT = 0;
  dom.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const now = performance.now();
    if (now - hoverT < 50) return;
    hoverT = now;
    const z = pick(e.clientX, e.clientY);
    if (z !== hovered) { hovered = z; restyle(); }
    dom.style.cursor = z ? 'pointer' : 'grab';
    onHover && onHover(z, e.clientX, e.clientY);
  });
  dom.addEventListener('pointerleave', () => { if (hovered) { hovered = null; restyle(); } onHover && onHover(null); });

  // ---------- floating label for the selected zone ----------
  function placeLabel() {
    if (!label.el || !label.zone) return;
    const b = zoneBox(label.zone);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    c.y = b.max.y + 0.08;
    c.project(camera);
    const r = dom.getBoundingClientRect();
    const x = (c.x + 1) / 2 * r.width, y = (1 - c.y) / 2 * r.height;
    const vis = c.z < 1 && x > 0 && x < r.width && y > 0 && y < r.height;
    label.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`;
    label.el.style.opacity = vis ? 1 : 0;
  }

  // ---------- resize ----------
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    dom.style.width = w + 'px'; dom.style.height = h + 'px';
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 48 : 35;
    camera.updateProjectionMatrix();
    if (!sized) { sized = true; camera.position.set(...viewPos(VIEWS.iso)); }
    requestRender();
  });
  let sized = false;
  ro.observe(container);

  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestRender(); });

  restyle();

  return {
    setLevels(lv) { levels = { ...lv }; restyle(); },
    setHealth(on) { health = on; restyle(); },
    select(zone, fly = true) {
      selected = zone;
      if (zone && INTERNAL.has(zone)) xray = true;
      else xray = userXray;
      restyle();
      if (zone && fly) flyToZone(zone);
    },
    setXray(on) { userXray = on; xray = on || (selected && INTERNAL.has(selected)); restyle(); },
    get xray() { return xray; },
    view(name) {
      const v = VIEWS[name] || VIEWS.iso;
      hood.userData.hidden = v.hood === false;
      if (v.xray) xray = true; else xray = userXray || (selected && INTERNAL.has(selected));
      restyle();
      flyTo(viewPos(v), v.target);
    },
    setLabel(el, zone) { label.el = el; label.zone = zone; requestRender(); },
    pause(p) { running = !p; if (!p) requestRender(); },
    resize() { ro.disconnect(); ro.observe(container); },
  };
}
