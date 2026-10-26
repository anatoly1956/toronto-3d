import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- paths ----------

// A polyline in scene space with arc-length sampling.
class Path {
  constructor(points) {
    this.points = points; // THREE.Vector3[]
    this.dist = [0];
    for (let i = 1; i < points.length; i++) this.dist.push(this.dist[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.dist[this.dist.length - 1];
    this.cursor = 0;
  }

  // Writes position and unit direction at distance d (clamped).
  sample(d, pos, dir) {
    d = THREE.MathUtils.clamp(d, 0, this.length);
    let i = this.cursor;
    while (i > 0 && this.dist[i] > d) i--;
    while (i < this.dist.length - 2 && this.dist[i + 1] < d) i++;
    this.cursor = i;
    const a = this.points[i];
    const b = this.points[i + 1];
    const span = this.dist[i + 1] - this.dist[i] || 1;
    pos.lerpVectors(a, b, (d - this.dist[i]) / span);
    dir.subVectors(b, a).normalize();
  }
}

// Joins features end to end into longer chains. Directed features only join
// head-to-tail; undirected ones may be reversed.
function stitch(features, directed) {
  const key = (v) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`;
  const items = features.map((pts) => ({ pts, used: false }));
  const byEnd = new Map();
  const add = (k, item) => {
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k).push(item);
  };
  for (const it of items) {
    add(key(it.pts[0]), it);
    add(key(it.pts[it.pts.length - 1]), it);
  }
  const take = (k, wantStart) => {
    for (const it of byEnd.get(k) ?? []) {
      if (it.used) continue;
      const startMatch = key(it.pts[0]) === k;
      if (directed && startMatch !== wantStart) continue;
      it.used = true;
      // Return points oriented so the chain continues from k.
      const pts = startMatch === wantStart ? it.pts : it.pts.slice().reverse();
      return pts;
    }
    return null;
  };
  const chains = [];
  for (const it of items) {
    if (it.used) continue;
    it.used = true;
    let chain = it.pts.slice();
    for (let next; (next = take(key(chain[chain.length - 1]), true)); ) chain = chain.concat(next.slice(1));
    for (let prev; (prev = take(key(chain[0]), false)); ) chain = prev.slice(0, -1).concat(chain);
    chains.push(chain);
  }
  return chains;
}

function featurePoints(f, baseY) {
  const pts = [];
  for (let i = 0; i < f.p.length; i += 2) {
    pts.push(new THREE.Vector3(f.p[i], baseY + (f.e ? f.e[i / 2] : 0), -f.p[i + 1]));
  }
  return pts;
}

function hash(n) {
  const s = Math.sin(n * 91.7) * 43758.5453;
  return s - Math.floor(s);
}

const tmpPos = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function placeInstance(mesh, i, pos, dir, lift = 0) {
  tmpQ.setFromAxisAngle(UP, Math.atan2(dir.x, dir.z));
  tmpPos.copy(pos);
  tmpPos.y += lift;
  tmpM.compose(tmpPos, tmpQ, ONE);
  mesh.setMatrixAt(i, tmpM);
}

// Box mesh whose parts carry their own vertex colours.
function coloredBoxes(parts) {
  const geos = parts.map(([w, h, l, x, y, z, color]) => {
    const g = new THREE.BoxGeometry(w, h, l).translate(x, y, z);
    const c = new THREE.Color(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(geos);
}

// ---------- cars ----------

const CAR_COLORS = [0xf2f2f0, 0x1d1f24, 0x9ea3a8, 0x7d1f22, 0x24456e, 0xc9c4b8, 0x3b3f45, 0xb8432f];

function createCars(roads) {
  const directed = [];
  const twoWay = [];
  for (const r of roads) {
    const busy = r.k === 1 || r.w >= 13;
    if (!busy) continue;
    const pts = featurePoints(r, 0.4);
    (r.o ? directed : twoWay).push({ pts, w: r.w, fast: r.k === 1 });
  }
  const lanes = [];
  // Expressway carriageways: cars follow the way direction.
  for (const pts of stitch(directed.map((d) => d.pts), true)) {
    const path = new Path(pts);
    if (path.length > 200) lanes.push({ path, dir: 1, offsets: [-3.3, 0, 3.3], speed: 24, density: 1 / 28 });
  }
  for (const pts of stitch(twoWay.map((d) => d.pts), false)) {
    const path = new Path(pts);
    if (path.length > 200) {
      lanes.push({ path, dir: 1, offsets: [3.2], speed: 12, density: 1 / 75 });
      lanes.push({ path, dir: -1, offsets: [3.2], speed: 12, density: 1 / 75 });
    }
  }

  const cars = [];
  lanes.forEach((lane, li) => {
    const n = Math.floor(lane.path.length * lane.density * lane.offsets.length);
    for (let i = 0; i < n; i++) {
      cars.push({
        lane,
        d: hash(li * 31 + i) * lane.path.length,
        offset: lane.offsets[i % lane.offsets.length],
        speed: lane.speed * (0.8 + hash(li + i * 7) * 0.4),
      });
    }
  });

  const geo = mergeGeometries([
    new THREE.BoxGeometry(1.9, 0.9, 4.4).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.7, 0.7, 2.4).translate(0, 1.25, -0.2),
  ]);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 });
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(cars.length, 1));
  mesh.count = cars.length;
  const c = new THREE.Color();
  cars.forEach((car, i) => mesh.setColorAt(i, c.setHex(CAR_COLORS[Math.floor(hash(i * 3.7) * CAR_COLORS.length)])));
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const right = new THREE.Vector3();
  function update(dt, night) {
    material.emissive.setRGB(1, 0.82, 0.55).multiplyScalar(night * 0.55);
    cars.forEach((car, i) => {
      const { path, dir } = car.lane;
      car.d = (car.d + car.speed * dt * dir + path.length) % path.length;
      path.sample(car.d, tmpPos, tmpDir);
      if (dir < 0) tmpDir.negate();
      right.set(-tmpDir.z, 0, tmpDir.x);
      tmpPos.addScaledVector(right, car.offset);
      placeInstance(mesh, i, tmpPos, tmpDir, 0.05);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { object: mesh, update };
}

// ---------- GO trains ----------

const TRAIN_CARS = 7;
const CAR_LEN = 26;

function createTrains(rails) {
  const lines = rails.filter((r) => r.k === 0).map((r) => featurePoints(r, 0.4));
  const paths = stitch(lines, false)
    .map((pts) => new Path(pts))
    .filter((p) => p.length > 1500)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);

  // GO Transit bilevel coaches: white with a green lower band.
  const geo = coloredBoxes([
    [3.1, 1.7, CAR_LEN - 1, 0, 1.25, 0, 0x1f7a44],
    [3.1, 2.9, CAR_LEN - 1, 0, 3.55, 0, 0xeceae4],
  ]);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(paths.length * TRAIN_CARS, 1));
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const trains = paths.map((path, i) => ({
    path,
    d: path.length * (0.2 + 0.6 * hash(i + 4)),
    dir: i % 2 ? 1 : -1,
    wait: 0,
  }));
  mesh.count = trains.length * TRAIN_CARS;

  function update(dt, night) {
    material.emissive.setRGB(1, 0.9, 0.7).multiplyScalar(night * 0.25);
    trains.forEach((t, ti) => {
      const span = TRAIN_CARS * CAR_LEN;
      if (t.wait > 0) {
        t.wait -= dt;
      } else {
        t.d += 16 * dt * t.dir;
        // Stop at the ends of the line, dwell, then head back.
        if (t.d > t.path.length - 5 || t.d < span + 5) {
          t.d = THREE.MathUtils.clamp(t.d, span + 5, t.path.length - 5);
          t.dir *= -1;
          t.wait = 6;
        }
      }
      for (let k = 0; k < TRAIN_CARS; k++) {
        t.path.sample(t.d - k * CAR_LEN - CAR_LEN / 2, tmpPos, tmpDir);
        placeInstance(mesh, ti * TRAIN_CARS + k, tmpPos, tmpDir);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { object: mesh, update };
}

// ---------- boats ----------

function ferryMesh() {
  const g = new THREE.Group();
  const geo = coloredBoxes([
    [10, 2.4, 36, 0, 1.2, 0, 0xf1efe9],
    [10.1, 0.7, 36.1, 0, 1.6, 0, 0x2f5d8c],
    [8, 2.6, 22, 0, 3.7, 0, 0xf6f5f1],
    [5, 1.8, 6, 0, 5.9, 4, 0xe9e7e1],
  ]);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

function sailboatMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6, side: THREE.DoubleSide });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 8).translate(0, 0.5, 0), white);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 11).translate(0, 6.5, -0.5), white);
  const sailShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 10), new THREE.Vector2(4.2, 0)]);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), white);
  sail.rotation.y = -Math.PI / 2;
  sail.position.set(0, 1.4, -0.4);
  hull.castShadow = sail.castShadow = true;
  g.add(hull, mast, sail);
  return g;
}

function pointInFlatRing(x, y, flat) {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function createBoats(ferries, land) {
  const group = new THREE.Group();

  const ferryPaths = ferries
    .map((f) => new Path(featurePoints(f, 0.3)))
    .filter((p) => p.length > 300);
  const boats = ferryPaths.map((path, i) => {
    const mesh = ferryMesh();
    group.add(mesh);
    return { mesh, path, d: path.length * hash(i + 2), dir: 1, wait: 0 };
  });

  // Sailboats scattered across open water south of the waterfront.
  const isLand = (x, y) => land.some((poly) => pointInFlatRing(x, y, poly.p));
  const sailboats = [];
  for (let i = 0, tries = 0; i < 26 && tries < 400; tries++) {
    const x = -2600 + hash(tries * 1.3) * 5200;
    const y = -400 - hash(tries * 2.9) * 2400;
    if (isLand(x, y) || isLand(x + 40, y) || isLand(x - 40, y) || isLand(x, y + 40) || isLand(x, y - 40)) continue;
    const mesh = sailboatMesh();
    group.add(mesh);
    sailboats.push({ mesh, x, z: -y, r: 30 + hash(i) * 90, a: hash(i * 5) * Math.PI * 2, w: (0.012 + hash(i * 3) * 0.02) * (i % 2 ? 1 : -1) });
    i++;
  }

  function update(dt, night, time) {
    for (const b of boats) {
      if (b.wait > 0) {
        b.wait -= dt;
      } else {
        b.d += 5 * dt * b.dir;
        if (b.d > b.path.length || b.d < 0) {
          b.d = THREE.MathUtils.clamp(b.d, 0, b.path.length);
          b.dir *= -1;
          b.wait = 10;
        }
      }
      b.path.sample(b.d, tmpPos, tmpDir);
      if (b.dir < 0) tmpDir.negate();
      b.mesh.position.copy(tmpPos);
      b.mesh.rotation.y = Math.atan2(tmpDir.x, tmpDir.z);
    }
    for (const s of sailboats) {
      s.a += s.w * dt;
      s.mesh.position.set(s.x + Math.cos(s.a) * s.r, 0.2 + Math.sin(time * 1.3 + s.r) * 0.15, s.z + Math.sin(s.a) * s.r);
      // Heading along the circle, heeled slightly.
      s.mesh.rotation.set(0, Math.atan2(-Math.sin(s.a) * Math.sign(s.w), Math.cos(s.a) * Math.sign(s.w)), 0.12 * Math.sign(s.w));
    }
  }
  return { object: group, update };
}

export function createTraffic(city) {
  const parts = [createCars(city.roads), createTrains(city.rails ?? []), createBoats(city.ferries ?? [], city.land)];
  const group = new THREE.Group();
  for (const p of parts) group.add(p.object);
  return {
    object: group,
    update(dt, night, time) {
      for (const p of parts) p.update(dt, night, time);
    },
  };
}
