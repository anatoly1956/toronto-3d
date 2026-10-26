import * as THREE from 'three';
import { toScene } from '../geo.js';

// Real dimensions (metres): main pod ~342–368, SkyPod ~447, tip 553.3.
const POSITION = toScene(43.6426, -79.3871);

const concrete = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.85 });
const podWhite = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.6 });
const mastMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.5, metalness: 0.3 });
const glass = new THREE.MeshStandardMaterial({
  color: 0x2c3e55,
  roughness: 0.15,
  metalness: 0.6,
  emissive: 0xffc77a,
  emissiveIntensity: 0,
});
const led = new THREE.MeshBasicMaterial({ color: 0xff3366, transparent: true, opacity: 0 });
const beacon = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0 });

function lathe(points, mat, segments = 48) {
  const geo = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// One of the three tapering legs that give the tower its Y-shaped footprint.
function leg() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(30, 0);
  s.lineTo(28, 8);
  s.quadraticCurveTo(14, 120, 9, 330);
  s.lineTo(0, 336);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 7, bevelEnabled: false, curveSegments: 16 });
  geo.translate(0, 0, -3.5);
  return geo;
}

// Thin glowing strip that follows the outer edge of a leg (night LEDs).
function ledStrip() {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(28.6, 8, 0),
    new THREE.Vector3(14.6, 120, 0),
    new THREE.Vector3(9.6, 330, 0),
  );
  return new THREE.TubeGeometry(curve, 48, 0.9, 6, false);
}

export function createCNTower() {
  const group = new THREE.Group();
  group.position.set(POSITION.x, 0, POSITION.z);

  // Hexagonal-ish core from ground to the SkyPod.
  group.add(lathe([[0, 0], [9, 0], [8, 200], [7, 335], [6.2, 368], [5, 444], [0, 444]], concrete, 6));

  const legGeo = leg();
  const stripGeo = ledStrip();
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + Math.PI / 6;
    const l = new THREE.Mesh(legGeo, concrete);
    l.rotation.y = angle;
    l.castShadow = l.receiveShadow = true;
    group.add(l);
    const strip = new THREE.Mesh(stripGeo, led);
    strip.rotation.y = angle;
    group.add(strip);
  }

  // Main pod: white radome ring underneath, glass observation band, upper deck.
  group.add(lathe([[7, 326], [15, 330], [19, 334], [19.5, 338], [16, 341], [7, 341]], podWhite));
  group.add(lathe([[7, 341], [21, 342], [22.5, 346]], podWhite));
  group.add(lathe([[22.5, 346], [23, 351], [22.5, 356]], glass));
  group.add(lathe([[22.5, 356], [20, 361], [14, 365], [6.2, 368]], podWhite));

  // SkyPod.
  group.add(lathe([[5, 441], [9, 444], [9.5, 448], [9, 452], [3.2, 454]], podWhite));
  group.add(lathe([[9.6, 446.5], [9.8, 448], [9.6, 449.5]], glass));

  // Antenna mast in tapering steps.
  const steps = [[3.2, 454, 2.6, 490], [2.4, 490, 1.8, 520], [1.6, 520, 0.9, 545], [0.7, 545, 0.3, 553]];
  for (const [r0, y0, r1, y1] of steps) {
    const geo = new THREE.CylinderGeometry(r1, r0, y1 - y0, 12);
    const m = new THREE.Mesh(geo, mastMat);
    m.position.y = (y0 + y1) / 2;
    m.castShadow = true;
    group.add(m);
  }

  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), beacon);
  tip.position.y = 554;
  group.add(tip);

  // Night lighting: a ring of LEDs around the pod plus the shaft strips.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(19.8, 0.7, 6, 64), led);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 336;
  group.add(ring);

  const glow = new THREE.PointLight(0xff3366, 0, 260, 1.6);
  glow.position.y = 180;
  group.add(glow);

  const hsl = new THREE.Color();
  function update(time, night) {
    hsl.setHSL((time * 0.03) % 1, 0.85, 0.55);
    led.color.copy(hsl);
    led.opacity = night;
    glow.color.copy(hsl);
    glow.intensity = night * 40000;
    glass.emissiveIntensity = night * 1.2;
    beacon.opacity = night * (0.55 + 0.45 * Math.sin(time * 2.5));
  }

  return { object: group, update, labelHeight: 575 };
}
