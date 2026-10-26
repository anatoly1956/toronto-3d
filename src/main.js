import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createBuildings, createFlatPolygons, createRoads } from './city.js';
import { createEnvironment } from './environment.js';
import { createCNTower } from './landmarks/cnTower.js';
import { createRogersCentre } from './landmarks/rogersCentre.js';
import { addLabel, bindTimeSlider, hideLoader } from './ui.js';
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

// The classic skyline view: from over the harbour, looking north at the
// CN Tower and the Financial District.
const target = new THREE.Vector3(250, 90, -300);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 5, 40000);
camera.position.set(-350, 520, 2100);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 150;
controls.maxDistance = 6000;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.screenSpacePanning = false;
controls.zoomSpeed = 0.8;

const env = createEnvironment(scene, renderer, new THREE.Vector3(200, 0, -300));

const landmarks = [createCNTower(), createRogersCentre()];
for (const l of landmarks) scene.add(l.object);
addLabel(landmarks[0], 'CN Tower');
addLabel(landmarks[1], 'Rogers Centre');

async function loadCity() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/city.json`);
  const city = await res.json();
  const { minX, maxX, minY, maxY } = city.bounds;

  // Land tile covering the data area, plus a wide lake plane beyond it so the
  // edges fade into fog instead of ending abruptly.
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), env.materials.water);
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = -0.6;
  lake.receiveShadow = true;
  scene.add(lake);

  scene.add(createFlatPolygons(city.land, env.materials.land, 0));
  scene.add(createFlatPolygons(city.parks, env.materials.park, 0.15));
  scene.add(createFlatPolygons(city.water, env.materials.water, 0.3));
  scene.add(createRoads(city.roads, env.materials.road, 0.4));
  scene.add(createBuildings(city.buildings));

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

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const time = clock.getElapsedTime();
  controls.update();
  for (const l of landmarks) l.update(time, nightUniform.value);
  env.followCamera(camera);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

loadCity()
  .catch((err) => console.error('Failed to load city data', err))
  .finally(hideLoader);
