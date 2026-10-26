import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createBuildings, createFlatPolygons, createRibbons, createTrees, KIND } from './city.js';
import { createEnvironment } from './environment.js';
import { fromScene, toScene } from './geo.js';
import { createCNTower } from './landmarks/cnTower.js';
import { LANDMARKS } from './landmarks/info.js';
import { createRogersCentre } from './landmarks/rogersCentre.js';
import { createTraffic } from './traffic.js';
import {
  bindTimeSlider, createLabel, hideCard, hideLoader, setCoords, setLoaderText, showCard,
} from './ui.js';
import { nightUniform } from './windows.js';

const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();

// Opening view: high over the harbour, looking north across the waterfront
// toward the CN Tower and the Financial District.
const HOME = {
  position: new THREE.Vector3(-260, 1180, 1250),
  target: new THREE.Vector3(120, 0, -420),
};
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 5, 40000);
camera.position.copy(HOME.position);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 120;
controls.maxDistance = 6000;
controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
controls.screenSpacePanning = false;
controls.zoomSpeed = 0.8;
controls.autoRotateSpeed = 0.7;

const env = createEnvironment(scene, renderer, new THREE.Vector3(200, 0, -300));

const cnTower = createCNTower();
const rogers = createRogersCentre();
scene.add(cnTower.object, rogers.object);

// ---------- camera flights ----------

let flight = null;
const sph = new THREE.Spherical();

function flyTo(target, distance, polar = THREE.MathUtils.degToRad(52)) {
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = new THREE.Spherical(distance, polar, from.theta);
  flight = {
    t0: performance.now(),
    duration: 1700,
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    from,
    to,
  };
  controls.enabled = false;
  controls.autoRotate = false;
}

function updateFlight(now) {
  if (!flight) return;
  const k = Math.min((now - flight.t0) / flight.duration, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const { from, to } = flight;
  let dTheta = to.theta - from.theta;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  sph.set(
    Math.exp(THREE.MathUtils.lerp(Math.log(from.radius), Math.log(to.radius), e)),
    THREE.MathUtils.lerp(from.phi, to.phi, e),
    from.theta + dTheta * e,
  );
  controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
  camera.position.setFromSpherical(sph).add(controls.target);
  camera.lookAt(controls.target);
  if (k === 1) {
    flight = null;
    controls.enabled = true;
  }
}

// ---------- landmark selection ----------

const highlight = new THREE.Mesh(
  new THREE.RingGeometry(0.86, 1, 64),
  new THREE.MeshBasicMaterial({ color: 0xf2a45f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
);
highlight.rotation.x = -Math.PI / 2;
highlight.visible = false;
scene.add(highlight);

const labels = [];
let selected = null;

function select(entry) {
  selected = entry;
  for (const l of labels) {
    l.el.classList.toggle('active', l === entry);
    l.el.classList.toggle('dim', l !== entry);
  }
  const { landmark, anchor } = entry;
  highlight.visible = true;
  highlight.position.set(anchor.position.x, 1.2, anchor.position.z);
  highlight.scale.setScalar(landmark.id === 'rogers-centre' ? 130 : landmark.id === 'toronto-islands' ? 400 : 55);

  const actions = [];
  if (landmark.action === 'roof') {
    actions.push({
      label: rogers.roofOpen ? 'Close the roof' : 'Open the roof',
      primary: true,
      onClick(b) {
        rogers.setRoofOpen(!rogers.roofOpen);
        b.textContent = rogers.roofOpen ? 'Close the roof' : 'Open the roof';
      },
    });
  }
  actions.push({
    label: 'Orbit',
    pressed: false,
    onClick(b) {
      controls.autoRotate = !controls.autoRotate;
      b.setAttribute('aria-pressed', String(controls.autoRotate));
    },
  });
  showCard(landmark, { actions, onClose: deselect });

  const focus = anchor.position.clone();
  focus.y = Math.min(anchor.userData.top * 0.4, 160);
  flyTo(focus, landmark.view);
}

function deselect() {
  selected = null;
  highlight.visible = false;
  controls.autoRotate = false;
  for (const l of labels) l.el.classList.remove('active', 'dim');
  hideCard();
}

// A user drag stops any auto-orbit.
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  document.querySelector('.actions [aria-pressed]')?.setAttribute('aria-pressed', 'false');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected) deselect();
});

document.getElementById('reset').addEventListener('click', () => {
  deselect();
  const offset = HOME.position.clone().sub(HOME.target);
  const s = new THREE.Spherical().setFromVector3(offset);
  flyTo(HOME.target, s.radius, s.phi);
  // Return to the opening azimuth too.
  flight.to.theta = s.theta;
});

// Measures the roof height under a landmark from the rendered buildings.
function measureHeight(x, z, objects) {
  const ray = new THREE.Raycaster();
  let top = 0;
  for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) {
    ray.set(new THREE.Vector3(x + dx, 1000, z + dz), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(objects, true)[0];
    if (hit) top = Math.max(top, hit.point.y);
  }
  return top;
}

function addLabels(buildingMeshes) {
  for (const landmark of LANDMARKS) {
    const { x, z } = toScene(landmark.lat, landmark.lon);
    const top = landmark.height ?? measureHeight(x, z, buildingMeshes) + 28;
    const anchor = new THREE.Object3D();
    anchor.position.set(x, top, z);
    anchor.userData.top = top;
    const entry = { landmark, anchor };
    const { el, object } = createLabel(landmark.name, () => (selected === entry ? deselect() : select(entry)));
    entry.el = el;
    anchor.add(object);
    scene.add(anchor);
    labels.push(entry);
  }
}

// ---------- city ----------

let traffic = null;
const frame = () => new Promise((r) => requestAnimationFrame(r));

async function loadCity() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/city.json`);
  const city = await res.json();
  const { minX, maxX, minY, maxY } = city.bounds;

  // Wide lake plane under everything; land polygons sit on top of it.
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), env.materials.water);
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = -0.6;
  lake.receiveShadow = true;
  scene.add(lake);

  scene.add(createFlatPolygons(city.land, env.materials.land, 0));
  scene.add(createFlatPolygons(city.parks, env.materials.park, 0.15));
  scene.add(createFlatPolygons(city.water, env.materials.water, 0.3));
  scene.add(createFlatPolygons(city.piers.filter((p) => !p.line), env.materials.land, 0.5));

  const features = [
    ...city.roads.map((r, i) => ({ ...r, kind: r.k ? KIND.expressway : KIND.street, y: 0.4 + (i % 7) * 0.008 })),
    ...city.rails.map((r) => (r.k ? { ...r, w: 1.6, kind: KIND.tram, y: 0.47 } : { ...r, w: 3.4, kind: KIND.rail, y: 0.35 })),
    ...city.piers.filter((p) => p.line).map((p) => ({ ...p, w: 4, kind: KIND.plain, y: 0.55 })),
  ];
  scene.add(createRibbons(features, env.materials.road));

  setLoaderText(`Raising ${city.buildings.length.toLocaleString()} buildings…`);
  await frame();
  const buildings = createBuildings(city.buildings);
  scene.add(buildings.object);
  env.addReflective(buildings.glass);

  setLoaderText(`Planting ${(city.trees.length / 2).toLocaleString()} trees…`);
  await frame();
  scene.add(createTrees(city.trees));

  traffic = createTraffic(city);
  scene.add(traffic.object);

  addLabels([...buildings.object.children.filter((c) => c.isMesh && !c.isInstancedMesh), rogers.object, cnTower.object]);

  // Keep panning within the mapped area.
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, minX, maxX);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -maxY, -minY);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 300);
  });
}

bindTimeSlider((t) => env.setTime(t));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// Hides labels that overlap a higher-priority one (list order, selection first).
function declutterLabels() {
  const shown = [];
  const ordered = selected ? [selected, ...labels.filter((l) => l !== selected)] : labels;
  for (const l of ordered) {
    const r = l.el.getBoundingClientRect();
    const onScreen = l.el.style.display !== 'none' && r.width > 0;
    const hit = onScreen && shown.some((s) => r.left < s.right + 4 && r.right > s.left - 4 && r.top < s.bottom + 2 && r.bottom > s.top - 2);
    l.el.classList.toggle('hidden', hit);
    if (onScreen && !hit) shown.push(r);
  }
}

if (import.meta.env.DEV) window.__toronto = { camera, controls, scene, renderer, flyTo };

// Live performance readout: frames per second, draw calls and triangles.
const statsEl = document.getElementById('stats');
let statsFrames = 0;
let statsSince = performance.now();
function updateStats(now) {
  statsFrames++;
  if (now - statsSince < 500) return;
  const fps = (statsFrames * 1000) / (now - statsSince);
  const { calls, triangles } = renderer.info.render;
  statsEl.textContent = `${Math.round(fps)} fps · ${calls} calls · ${(triangles / 1e6).toFixed(2)}M tris`;
  statsFrames = 0;
  statsSince = now;
}

const clock = new THREE.Clock();
let frameCount = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;
  const night = nightUniform.value;
  updateFlight(now);
  if (!flight) controls.update();
  // Never dip below street level when orbiting low.
  camera.position.y = Math.max(camera.position.y, 25);
  cnTower.update(time, night);
  rogers.update(time, night, dt);
  traffic?.update(dt, night, time);
  env.update(camera, time);
  if (highlight.visible) highlight.material.opacity = 0.45 + 0.35 * Math.sin(time * 3);
  if (frameCount++ % 10 === 0) {
    const { lat, lon } = fromScene(controls.target.x, controls.target.z);
    setCoords(lat, lon);
  }
  renderer.render(scene, camera);
  updateStats(now);
  labelRenderer.render(scene, camera);
  if (frameCount % 6 === 0) declutterLabels();
});

loadCity()
  .catch((err) => console.error('Failed to load city data', err))
  .finally(hideLoader);
