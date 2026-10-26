import * as THREE from 'three';
import { toScene } from '../geo.js';

// Roughly 210 m across, 86 m to the top of the retractable dome.
const POSITION = toScene(43.6414, -79.3894);
const RADIUS = 105;
const WALL = 34;
const TOP = 86;
const RISE = TOP - WALL;
const SPHERE_R = (RADIUS * RADIUS + RISE * RISE) / (2 * RISE);
const THETA = Math.asin(RADIUS / SPHERE_R);
const PANEL_LIFT = 0.9; // each roof panel rides a little above the one below

const wallMat = new THREE.MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.9, side: THREE.DoubleSide });
const finMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.8 });
const roofMat = new THREE.MeshStandardMaterial({
  color: 0xc9ced5, roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide,
});
const ribMat = new THREE.MeshStandardMaterial({ color: 0x8e96a1, roughness: 0.5, metalness: 0.4 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x2c4f8f, roughness: 0.85, side: THREE.DoubleSide });
const concourseMat = new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.9, side: THREE.DoubleSide });
const bandMat = new THREE.MeshStandardMaterial({
  color: 0x30445e, roughness: 0.3, emissive: 0x9fd0ff, emissiveIntensity: 0,
});
const lightRingMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0 });

// Baseball field painted on a canvas: mowing stripes, dirt infield, lines.
function fieldTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2;
  g.fillStyle = '#3f7a3a';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    g.fillRect((i * size) / 16, 0, size / 16, size);
  }
  // Home plate toward the bottom; the diamond opens up toward the top.
  const home = [cx, size * 0.8];
  const base = size * 0.2;
  const dirt = '#a8774c';
  g.fillStyle = dirt;
  g.beginPath();
  g.moveTo(home[0], home[1] + 30);
  g.arc(home[0], home[1], base * 1.45, -Math.PI * 0.75, -Math.PI * 0.25);
  g.closePath();
  g.fill();
  g.fillStyle = '#3f7a3a';
  g.save();
  g.translate(home[0], home[1] - base * 0.7);
  g.rotate(Math.PI / 4);
  g.fillRect(-base * 0.42, -base * 0.42, base * 0.84, base * 0.84);
  g.restore();
  g.fillStyle = dirt;
  g.beginPath();
  g.arc(home[0], home[1] - base * 0.7, 18, 0, Math.PI * 2);
  g.arc(home[0], home[1], 26, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(home[0], home[1]);
  g.lineTo(0, home[1] - home[0]);
  g.moveTo(home[0], home[1]);
  g.lineTo(size, home[1] - home[0]);
  g.stroke();
  // Warning track around the edge.
  const r = size / 2;
  const grad = g.createRadialGradient(cx, cx, r * 0.9, cx, cx, r);
  grad.addColorStop(0, 'rgba(168,119,76,0)');
  grad.addColorStop(0.01, 'rgba(168,119,76,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function lathe(points, mat, segments = 96) {
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments),
    mat,
  );
  mesh.receiveShadow = true;
  return mesh;
}

// One quarter of the dome, with ribs along its two edges.
function roofPanel(index) {
  const panel = new THREE.Group();
  const phi0 = (index * Math.PI) / 2;
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(SPHERE_R, 32, 20, phi0, Math.PI / 2, 0, THETA),
    roofMat,
  );
  shell.castShadow = shell.receiveShadow = true;
  panel.add(shell);
  for (const phi of [phi0, phi0 + Math.PI / 2]) {
    const holder = new THREE.Group();
    const rib = new THREE.Mesh(new THREE.TorusGeometry(SPHERE_R + 0.4, 1.1, 6, 40, THETA), ribMat);
    rib.rotation.z = Math.PI / 2 - THETA;
    holder.add(rib);
    holder.rotation.y = Math.PI + phi;
    panel.add(holder);
  }
  // Panels sit stacked: the higher the index, the higher it rides.
  panel.position.y = WALL - SPHERE_R * Math.cos(THETA) + index * PANEL_LIFT;
  return panel;
}

export function createRogersCentre() {
  const group = new THREE.Group();
  group.position.set(POSITION.x, 0, POSITION.z);

  // Field and seating bowl.
  const field = new THREE.Mesh(
    new THREE.CircleGeometry(74, 64),
    new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.95 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.6;
  field.receiveShadow = true;
  group.add(field);
  group.add(lathe([[74, 1], [86, 11]], seatMat));
  group.add(lathe([[86, 11], [88, 11.5]], concourseMat));
  group.add(lathe([[88, 12.5], [96, 21]], seatMat));
  group.add(lathe([[96, 21], [98, 21.5]], concourseMat));
  group.add(lathe([[98, 22.5], [104, 31]], seatMat));

  const wall = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS + 3, WALL, 96, 1, true), wallMat);
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

  const rim = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 1.6, 8, 96), finMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = WALL;
  group.add(rim);

  // Ring of field lights just under the roof line.
  const lightRing = new THREE.Mesh(new THREE.TorusGeometry(RADIUS - 4, 0.8, 6, 96), lightRingMat);
  lightRing.rotation.x = Math.PI / 2;
  lightRing.position.y = WALL + 1;
  group.add(lightRing);
  const fieldLight = new THREE.PointLight(0xfff1d6, 0, 260, 1.4);
  fieldLight.position.y = 45;
  group.add(fieldLight);

  // Retractable roof: panel 0 stays put; the others swing round to stack on it.
  const panels = [0, 1, 2, 3].map((i) => {
    const p = roofPanel(i);
    group.add(p);
    return p;
  });

  // The stadium sits at a slight angle to the street grid.
  group.rotation.y = 0.35;

  let open = 0;
  let openTarget = 0;

  function update(time, night, dt = 1 / 60) {
    bandMat.emissiveIntensity = night * 1.4;
    lightRingMat.opacity = Math.max(night, 0.15 * open);
    fieldLight.intensity = night * 90000 * (0.25 + 0.75 * open);

    // Ease toward the target; a full open/close takes ~6 s.
    const step = dt / 6;
    open += THREE.MathUtils.clamp(openTarget - open, -step, step);
    const e = open * open * (3 - 2 * open);
    panels.forEach((p, i) => {
      p.rotation.y = -i * (Math.PI / 2) * e;
    });
  }

  return {
    object: group,
    update,
    labelHeight: TOP + 40,
    get roofOpen() {
      return openTarget === 1;
    },
    setRoofOpen(v) {
      openTarget = v ? 1 : 0;
    },
  };
}
