import * as THREE from 'three';
import { nightUniform } from './windows.js';

// Time-of-day keyframes along the slider (0 = midday, 1 = night).
// `elev`/`azim` are degrees for the key light (sun, then moon).
const KEYS = [
  {
    t: 0, label: 'Midday', phrase: 'at midday', elev: 58, azim: 190, light: 0xfff6e8, lightI: 2.8,
    hemiSky: 0xd4e8ff, hemiGround: 0xc9bca6, hemiI: 1.1,
    top: 0x2a74d6, horizon: 0xd2e7f6, glow: 0xfff3d6, glowI: 0.25,
    land: 0xcdc3b0, park: 0xa9c78c, water: 0x4d86b8, road: 0x77726c,
    night: 0, exposure: 1.0, stars: 0,
  },
  {
    t: 0.3, label: 'Afternoon', phrase: 'in the afternoon', elev: 34, azim: 235, light: 0xfff0d8, lightI: 2.7,
    hemiSky: 0xcfe2fa, hemiGround: 0xc6b69e, hemiI: 1.0,
    top: 0x3479d0, horizon: 0xdbe6ee, glow: 0xffe9c4, glowI: 0.35,
    land: 0xc6baa4, park: 0xa3c184, water: 0x4a7fae, road: 0x726c66,
    night: 0, exposure: 1.0, stars: 0,
  },
  {
    t: 0.5, label: 'Golden hour', phrase: 'at golden hour', elev: 10, azim: 258, light: 0xffbb7a, lightI: 2.6,
    hemiSky: 0xb6bfd9, hemiGround: 0xb39a7e, hemiI: 0.75,
    top: 0x5a76b0, horizon: 0xffcb94, glow: 0xffad6a, glowI: 0.95,
    land: 0xb7a48a, park: 0x9fb37a, water: 0x4c6584, road: 0x5c524b,
    night: 0.04, exposure: 1.0, stars: 0,
  },
  {
    t: 0.68, label: 'Sunset', phrase: 'at sunset', elev: 1.5, azim: 268, light: 0xff7a45, lightI: 1.5,
    hemiSky: 0x7f7fb6, hemiGround: 0x7d6262, hemiI: 0.55,
    top: 0x2d3f7c, horizon: 0xff8d5c, glow: 0xff6a3a, glowI: 1.2,
    land: 0x9c887c, park: 0x7f8a68, water: 0x3d4b6c, road: 0x4b4448,
    night: 0.35, exposure: 1.05, stars: 0,
  },
  {
    t: 0.84, label: 'Dusk', phrase: 'at dusk', elev: 14, azim: 120, light: 0x7d8fd6, lightI: 0.35,
    hemiSky: 0x3e4a85, hemiGround: 0x2a2540, hemiI: 0.4,
    top: 0x111a45, horizon: 0x5c4475, glow: 0x9a5a7a, glowI: 0.5,
    land: 0x5e5a6a, park: 0x45524d, water: 0x223152, road: 0x34323e,
    night: 0.8, exposure: 1.1, stars: 0.4,
  },
  {
    t: 1, label: 'Night', phrase: 'at night', elev: 40, azim: 140, light: 0x8ea2ff, lightI: 0.3,
    hemiSky: 0x26325e, hemiGround: 0x101320, hemiI: 0.32,
    top: 0x040714, horizon: 0x16203e, glow: 0x2a3560, glowI: 0.2,
    land: 0x34374a, park: 0x283434, water: 0x15223f, road: 0x1f212c,
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
  const near = t - a.t < b.t - t ? a : b;
  const out = { label: near.label, phrase: near.phrase };
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
  // water and glass can reflect the current sky gradient.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(mesh.geometry, material));
  return { mesh, uniforms, envScene };
}

// Gentle moving ripples: perturbs the water normal from a few travelling
// waves in world space, fading out where they'd alias.
const timeUniform = { value: 0 };
function addWaves(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz;
          float t = uTime;
          vec2 g = vec2(
            cos(p.x * 0.045 + t * 0.9) * 0.5 + cos((p.x + p.y) * 0.08 - t * 1.3) * 0.35 + cos(p.y * 0.13 + t * 0.7) * 0.25,
            sin(p.y * 0.05 + t * 0.8) * 0.5 + sin((p.x - p.y) * 0.07 + t * 1.1) * 0.35 + sin(p.x * 0.12 - t * 0.6) * 0.25);
          float fade = 1.0 - smoothstep(1.5, 6.0, length(fwidth(p)));
          normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz * 0.09 * fade);
        }`,
      );
  };
  return material;
}

export function createEnvironment(scene, renderer, center) {
  const sky = createSky();
  scene.add(sky.mesh);

  scene.fog = new THREE.Fog(0xffffff, 3200, 10500);

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
    water: addWaves(new THREE.MeshStandardMaterial({ roughness: 0.1, metalness: 0, envMapIntensity: 1 })),
    road: new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide, vertexColors: true }),
  };

  // Materials that reflect the sky; refreshed whenever the time changes.
  const reflective = [materials.water];
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  let envDirty = false;
  function refreshEnvMap() {
    envDirty = false;
    const next = pmrem.fromScene(sky.envScene, 0, 0.1, 100);
    for (const m of reflective) {
      if (!m.envMap) m.needsUpdate = true;
      m.envMap = next.texture;
    }
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
    materials.road.emissive.setRGB(0.55, 0.42, 0.25).multiplyScalar(s.night * 0.12);

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
    // Adds a material that should reflect the sky (e.g. glass towers).
    addReflective(material) {
      reflective.push(material);
      if (envTarget) {
        material.envMap = envTarget.texture;
        material.needsUpdate = true;
      }
    },
    get state() {
      return current;
    },
    update(camera, time) {
      sky.mesh.position.copy(camera.position);
      timeUniform.value = time;
    },
  };
}
