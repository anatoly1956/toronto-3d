import * as THREE from 'three';
import { nightUniform } from './windows.js';

// Time-of-day keyframes along the slider (0 = afternoon, 1 = night).
// `elev`/`azim` are degrees for the key light (sun, then moon).
const KEYS = [
  {
    t: 0, label: 'Midday', elev: 58, azim: 190, light: 0xfff6e8, lightI: 2.8,
    hemiSky: 0xd4e8ff, hemiGround: 0xd9cdb8, hemiI: 1.2,
    top: 0x2a74d6, horizon: 0xd2e7f6, glow: 0xfff3d6, glowI: 0.25,
    land: 0xece6d8, park: 0xb9d79c, water: 0x5fa3d6, road: 0xd2ccc0,
    night: 0, exposure: 1.0, stars: 0,
  },
  {
    t: 0.3, label: 'Afternoon', elev: 34, azim: 235, light: 0xfff0d8, lightI: 2.7,
    hemiSky: 0xcfe2fa, hemiGround: 0xd8cab2, hemiI: 1.1,
    top: 0x3479d0, horizon: 0xdbe6ee, glow: 0xffe9c4, glowI: 0.35,
    land: 0xebe4d4, park: 0xb4d395, water: 0x5a9ccf, road: 0xd0c9bb,
    night: 0, exposure: 1.0, stars: 0,
  },
  {
    t: 0.55, label: 'Golden hour', elev: 9, azim: 262, light: 0xffbf80, lightI: 2.4,
    hemiSky: 0xb9c6e6, hemiGround: 0xd6b796, hemiI: 0.75,
    top: 0x4f73b8, horizon: 0xffcf9a, glow: 0xffb070, glowI: 0.9,
    land: 0xeadbc4, park: 0xb3c98a, water: 0x6a90bf, road: 0xcfbfa9,
    night: 0.05, exposure: 1.0, stars: 0,
  },
  {
    t: 0.7, label: 'Sunset', elev: 1.5, azim: 270, light: 0xff7a45, lightI: 1.5,
    hemiSky: 0x7f7fb6, hemiGround: 0x8f6e70, hemiI: 0.55,
    top: 0x2d3f7c, horizon: 0xff8d5c, glow: 0xff6a3a, glowI: 1.2,
    land: 0xc9b6ad, park: 0x8f9c79, water: 0x4f6694, road: 0xb2a39d,
    night: 0.35, exposure: 1.05, stars: 0,
  },
  {
    t: 0.84, label: 'Dusk', elev: 14, azim: 120, light: 0x7d8fd6, lightI: 0.35,
    hemiSky: 0x3e4a85, hemiGround: 0x2a2540, hemiI: 0.4,
    top: 0x111a45, horizon: 0x5c4475, glow: 0x9a5a7a, glowI: 0.5,
    land: 0x6e6b80, park: 0x4e5e5a, water: 0x26355e, road: 0x5c5a6c,
    night: 0.8, exposure: 1.1, stars: 0.4,
  },
  {
    t: 1, label: 'Night', elev: 40, azim: 140, light: 0x8ea2ff, lightI: 0.3,
    hemiSky: 0x26325e, hemiGround: 0x101320, hemiI: 0.32,
    top: 0x040714, horizon: 0x16203e, glow: 0x2a3560, glowI: 0.2,
    land: 0x3b3f52, park: 0x2c3a3a, water: 0x1a2a52, road: 0x2e3040,
    night: 1, exposure: 1.15, stars: 1,
  },
];

const COLOR_KEYS = ['light', 'hemiSky', 'hemiGround', 'top', 'horizon', 'glow', 'land', 'park', 'water', 'road'];
const NUM_KEYS = ['elev', 'azim', 'lightI', 'hemiI', 'glowI', 'night', 'exposure', 'stars'];

function sample(t) {
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = THREE.MathUtils.smoothstep(t, a.t, b.t);
  const out = { label: (t - a.t < b.t - t ? a : b).label };
  for (const key of NUM_KEYS) out[key] = THREE.MathUtils.lerp(a[key], b[key], k);
  for (const key of COLOR_KEYS) out[key] = new THREE.Color(a[key]).lerp(new THREE.Color(b[key]), k);
  return out;
}

function createSky() {
  const uniforms = {
    topColor: { value: new THREE.Color() },
    horizonColor: { value: new THREE.Color() },
    glowColor: { value: new THREE.Color() },
    glowIntensity: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    stars: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 topColor, horizonColor, glowColor, sunDir;
      uniform float glowIntensity, stars;
      varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.99, 78.23, 37.72))) * 43758.55); }
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(horizonColor, topColor, pow(up, 0.45));
        float sun = max(dot(d, normalize(sunDir)), 0.0);
        col += glowColor * glowIntensity * (pow(sun, 8.0) * 0.8 + pow(sun, 600.0) * 3.0) * (1.0 - up * 0.5);
        vec3 cell = floor(d * 280.0);
        float star = step(0.9975, h(cell)) * smoothstep(0.05, 0.35, d.y);
        col += vec3(star) * stars * (0.5 + 0.5 * h(cell + 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.scale.setScalar(15000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  // A copy of the sky in its own scene, rendered into an environment map so
  // the water can reflect the current sky gradient.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(mesh.geometry, material));
  return { mesh, uniforms, envScene };
}

export function createEnvironment(scene, renderer, center) {
  const sky = createSky();
  scene.add(sky.mesh);

  scene.fog = new THREE.Fog(0xffffff, 2800, 9500);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const S = 2600;
  Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 100, far: 9000 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 1.5;
  key.shadow.radius = 3;
  key.target.position.copy(center);
  scene.add(key, key.target);

  const materials = {
    land: new THREE.MeshStandardMaterial({ roughness: 1 }),
    park: new THREE.MeshStandardMaterial({ roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, envMapIntensity: 1 }),
    road: new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }),
  };

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  let envDirty = false;
  function refreshEnvMap() {
    envDirty = false;
    const next = pmrem.fromScene(sky.envScene, 0, 0.1, 100);
    materials.water.envMap = next.texture;
    if (!envTarget) materials.water.needsUpdate = true;
    envTarget?.dispose();
    envTarget = next;
  }

  const dir = new THREE.Vector3();
  let current = null;

  function setTime(t) {
    const s = sample(t);
    current = s;
    const elev = THREE.MathUtils.degToRad(s.elev);
    const azim = THREE.MathUtils.degToRad(s.azim);
    // Azimuth is clockwise from north; north is -z in the scene.
    dir.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev));
    key.position.copy(center).addScaledVector(dir, 5000);
    key.color.copy(s.light);
    key.intensity = s.lightI;
    hemi.color.copy(s.hemiSky);
    hemi.groundColor.copy(s.hemiGround);
    hemi.intensity = s.hemiI;

    sky.uniforms.topColor.value.copy(s.top);
    sky.uniforms.horizonColor.value.copy(s.horizon);
    sky.uniforms.glowColor.value.copy(s.glow);
    sky.uniforms.glowIntensity.value = s.glowI;
    sky.uniforms.stars.value = s.stars;
    // Before dusk the glow tracks the sun; afterwards hold it on the western horizon.
    if (t < 0.75) sky.uniforms.sunDir.value.copy(dir);
    else sky.uniforms.sunDir.value.set(-1, 0.02, 0).normalize();

    scene.fog.color.copy(s.horizon);
    renderer.toneMappingExposure = s.exposure;

    materials.land.color.copy(s.land);
    materials.park.color.copy(s.park);
    materials.water.color.copy(s.water);
    materials.road.color.copy(s.road);
    materials.road.emissive.setRGB(0.55, 0.42, 0.25).multiplyScalar(s.night * 0.18);

    nightUniform.value = s.night;
    // Re-render the reflection at most once per frame while the slider moves.
    if (!envDirty) {
      envDirty = true;
      requestAnimationFrame(refreshEnvMap);
    }
    return s;
  }

  return {
    materials,
    setTime,
    get state() {
      return current;
    },
    followCamera(camera) {
      sky.mesh.position.copy(camera.position);
    },
  };
}
