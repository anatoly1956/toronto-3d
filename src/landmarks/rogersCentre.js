import * as THREE from 'three';
import { toScene } from '../geo.js';

// Roughly 210 m across, 86 m to the top of the retractable dome.
const POSITION = toScene(43.6414, -79.3894);
const RADIUS = 105;
const WALL = 34;
const TOP = 86;

const wallMat = new THREE.MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.9 });
const finMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd3, roughness: 0.45, metalness: 0.35 });
const seamMat = new THREE.MeshStandardMaterial({ color: 0x8e96a1, roughness: 0.5, metalness: 0.4 });
const bandMat = new THREE.MeshStandardMaterial({
  color: 0x30445e,
  roughness: 0.3,
  emissive: 0x9fd0ff,
  emissiveIntensity: 0,
});

export function createRogersCentre() {
  const group = new THREE.Group();
  group.position.set(POSITION.x, 0, POSITION.z);

  const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS + 3, WALL, 96, 1), wallMat);
  wall.position.y = WALL / 2;
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);

  // Glazed band near the top of the wall, lit from inside at night.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.4, RADIUS + 0.6, 4, 96, 1, true), bandMat);
  band.position.y = WALL - 6;
  group.add(band);

  // Vertical structural fins around the perimeter.
  const finCount = 56;
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, WALL + 2, 5), finMat, finCount);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < finCount; i++) {
    const a = (i / finCount) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(
      new THREE.Vector3(Math.cos(a) * (RADIUS + 2), (WALL + 2) / 2, Math.sin(a) * (RADIUS + 2)),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    fins.setMatrixAt(i, m);
  }
  fins.castShadow = true;
  group.add(fins);

  // Dome: spherical cap from the wall top up to TOP.
  const rise = TOP - WALL;
  const sphereR = (RADIUS * RADIUS + rise * rise) / (2 * rise);
  const theta = Math.asin(RADIUS / sphereR);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(sphereR, 96, 32, 0, Math.PI * 2, 0, theta),
    roofMat,
  );
  dome.position.y = TOP - sphereR;
  dome.castShadow = dome.receiveShadow = true;
  group.add(dome);

  // Panel seams: parallel arcs across the dome where the roof sections overlap.
  for (const offset of [-52, -18, 18, 52]) {
    const r = Math.sqrt(sphereR * sphereR - offset * offset);
    const half = Math.acos((sphereR - rise) / r);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.3, 0.9, 6, 64, half * 2),
      seamMat,
    );
    arc.rotation.z = Math.PI / 2 - half;
    arc.position.set(offset, TOP - sphereR, 0);
    arc.rotation.y = Math.PI / 2;
    group.add(arc);
  }

  // Roof rim.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 1.6, 8, 96), finMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = WALL;
  group.add(rim);

  // The stadium sits at a slight angle to the street grid.
  group.rotation.y = 0.35;

  function update(time, night) {
    bandMat.emissiveIntensity = night * 1.4;
  }

  return { object: group, update, labelHeight: TOP + 40 };
}
