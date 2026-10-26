import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addWindows } from './windows.js';

function ring(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return pts;
}

function toShape(poly) {
  const shape = new THREE.Shape(ring(poly.p));
  for (const hole of poly.h ?? []) shape.holes.push(new THREE.Path(ring(hole)));
  return shape;
}

// Shapes are drawn in the XY plane with y = north; rotate so they lie on the
// ground with north pointing to -z.
function layFlat(geo, y) {
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function pointInRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- buildings ----------

// Walls take the building colour and roofs the roof colour. ExtrudeGeometry
// puts the caps in group 0 and the walls in group 1.
function paintBuilding(geo, wall, roof) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const [caps] = geo.groups;
  for (let i = 0; i < count; i++) {
    const c = i < caps.start + caps.count ? roof : wall;
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.clearGroups();
}

export function createBuildings(buildings, envMap) {
  const geos = [[], []];
  const wall = new THREE.Color();
  const roof = new THREE.Color();
  const units = [];

  buildings.forEach((b, i) => {
    const base = b.m ?? 0;
    const depth = b.t - base;
    if (depth <= 0.5) return;
    const shape = toShape(b);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    layFlat(geo, base);
    wall.setHex(b.c).offsetHSL(0, 0, (hash(i) - 0.5) * 0.03);
    roof.setHex(b.r);
    paintBuilding(geo, wall, roof);
    geo.deleteAttribute('uv');
    geos[b.k ?? 0].push(geo);

    // Rooftop mechanical units on larger flat roofs.
    const pitched = (b.r & 0xff) < 0x60 && ((b.r >> 16) & 0xff) < 0x70;
    if (b.t > 12 && !pitched) {
      const pts = ring(b.p);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const area = (maxX - minX) * (maxY - minY);
      const n = area > 3000 ? 4 : area > 800 ? 2 : area > 250 ? 1 : 0;
      for (let k = 0, tries = 0; k < n && tries < 12; tries++) {
        const x = minX + hash(i * 7 + tries) * (maxX - minX);
        const y = minY + hash(i * 13 + tries + 0.3) * (maxY - minY);
        if (!pointInRing(x, y, pts)) continue;
        const s = 2 + hash(i + k * 3.1) * 5;
        units.push({ x, z: -y, y: b.t, sx: s, sz: s * (0.6 + hash(i + k) * 0.8), sy: 1.4 + hash(i * 3 + k) * 2.4 });
        k++;
      }
    }
  });

  const matte = addWindows(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 }),
  );
  const glass = addWindows(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.3, envMapIntensity: 0.8 }),
    { glass: true },
  );

  // Merge in chunks so frustum culling still helps and no buffer gets huge.
  const group = new THREE.Group();
  const CHUNK = 1500;
  [matte, glass].forEach((material, k) => {
    for (let i = 0; i < geos[k].length; i += CHUNK) {
      const mesh = new THREE.Mesh(mergeGeometries(geos[k].slice(i, i + CHUNK)), material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    geos[k].forEach((g) => g.dispose());
  });

  const unitMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x9e9a94, roughness: 0.8 }),
    units.length,
  );
  const m = new THREE.Matrix4();
  units.forEach((u, i) => {
    m.makeScale(u.sx, u.sy, u.sz).setPosition(u.x, u.y, u.z);
    unitMesh.setMatrixAt(i, m);
  });
  unitMesh.castShadow = unitMesh.receiveShadow = true;
  group.add(unitMesh);

  return { object: group, glass, setEnvMap: (tex) => { glass.envMap = tex; glass.needsUpdate = true; } };
}

// ---------- flat areas ----------

export function createFlatPolygons(polys, material, y) {
  if (!polys.length) return new THREE.Group();
  const geos = polys.map((p) => {
    const g = layFlat(new THREE.ShapeGeometry(toShape(p)), y);
    g.deleteAttribute('uv');
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), material);
  mesh.receiveShadow = true;
  geos.forEach((g) => g.dispose());
  return mesh;
}

// ---------- linear features: roads, rails, piers ----------

// Feature kinds, read by the ribbon shader.
export const KIND = { street: 0, expressway: 1, rail: 2, tram: 3, plain: 4 };
const TINT = {
  0: new THREE.Color(1, 1, 1),
  1: new THREE.Color(0.86, 0.86, 0.9),
  2: new THREE.Color(0.78, 0.67, 0.57),
  3: new THREE.Color(0.92, 0.92, 0.92),
  4: new THREE.Color(1.25, 1.1, 0.95),
};

// Lane markings and rails drawn procedurally from (across 0..1, along metres, kind).
function addLaneMarkings(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLane;\nvarying vec3 vLane;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLane = aLane;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLane;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float acr = vLane.x;
          float kind = vLane.z;
          float aa = fwidth(acr);
          float mark = 0.0;
          vec3 markColor = vec3(0.86, 0.84, 0.79);
          if (kind < 0.5) {
            mark = 0.55 * (1.0 - smoothstep(0.012, 0.012 + aa, abs(acr - 0.5)));
            markColor = vec3(0.86, 0.74, 0.42);
          } else if (kind < 1.5) {
            float dash = step(0.5, fract(vLane.y / 10.0));
            float lanes = (1.0 - smoothstep(0.012, 0.012 + aa, abs(acr - 0.333)))
                        + (1.0 - smoothstep(0.012, 0.012 + aa, abs(acr - 0.667)));
            float edge = 1.0 - smoothstep(0.014, 0.014 + aa, abs(min(acr, 1.0 - acr) - 0.05));
            mark = max(lanes * dash, edge);
          } else if (kind < 3.5) {
            mark = 1.0 - smoothstep(0.035, 0.035 + aa, min(abs(acr - 0.3), abs(acr - 0.7)));
            markColor = vec3(0.58, 0.57, 0.56);
          }
          // Fade markings once they're thinner than a pixel.
          mark *= 1.0 - smoothstep(0.06, 0.2, aa);
          diffuseColor.rgb = mix(diffuseColor.rgb, markColor, mark);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'lane-markings';
  return material;
}

// Builds one ribbon mesh plus, for elevated parts, deck skirts and pillars.
// features: [{ p: flat xy, w, kind, y (base height), e?: per-vertex elevation }]
export function createRibbons(features, material) {
  addLaneMarkings(material);
  const pos = [], lane = [], col = [], idx = [];
  const skirt = [];
  const pillars = [];

  for (const f of features) {
    const pts = ring(f.p);
    if (pts.length < 2) continue;
    const half = f.w / 2;
    const tint = TINT[f.kind];
    const base = pos.length / 3;
    let along = 0;
    const edges = [];
    let sincePillar = 15;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      if (i > 0) {
        const step = pts[i].distanceTo(pts[i - 1]);
        along += step;
        sincePillar += step;
      }
      const y = f.y + (f.e ? f.e[i] : 0);
      const L = [pts[i].x + nx * half, y, -(pts[i].y + ny * half)];
      const R = [pts[i].x - nx * half, y, -(pts[i].y - ny * half)];
      pos.push(...L, ...R);
      lane.push(0, along, f.kind, 1, along, f.kind);
      col.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      edges.push([L, R, y]);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      if (f.e && f.e[i] > 3 && sincePillar >= 32) {
        pillars.push([pts[i].x, -pts[i].y, f.e[i] - 1, f.w]);
        sincePillar = 0;
      }
    }
    // Deck sides for elevated stretches.
    if (f.e) {
      for (let i = 1; i < edges.length; i++) {
        if (f.e[i] < 1.5 && f.e[i - 1] < 1.5) continue;
        for (const side of [0, 1]) {
          const a = edges[i - 1][side];
          const b = edges[i][side];
          skirt.push(...a, ...b, b[0], b[1] - 1.4, b[2], ...a, b[0], b[1] - 1.4, b[2], a[0], a[1] - 1.4, a[2]);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aLane', new THREE.Float32BufferAttribute(lane, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(idx);

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  group.add(mesh);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a948b, roughness: 0.9, side: THREE.DoubleSide });
  if (skirt.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
    sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, concrete);
    sm.castShadow = sm.receiveShadow = true;
    group.add(sm);
  }
  if (pillars.length) {
    const pg = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, concrete, pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach(([x, z, h, w], i) => {
      const r = Math.min(1.6, w * 0.09);
      m.makeScale(r, h, r).setPosition(x, 0, z);
      pm.setMatrixAt(i, m);
    });
    pm.castShadow = pm.receiveShadow = true;
    group.add(pm);
  }
  // Elevated decks should cast shadows on the street below.
  mesh.castShadow = features.some((f) => f.e);
  return group;
}

// ---------- trees ----------

const GREENS = [0x5d7a3e, 0x6b8945, 0x4e6c39, 0x7a9150, 0x58733f];
const AUTUMN = [0xc8742f, 0xd9a13b, 0xa8412e, 0xe0b443, 0x9c5a2a, 0xb85b2c];

export function createTrees(flat) {
  const count = flat.length / 2;
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0).scale(3.6, 3.2, 3.6).translate(0, 5.4, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0);
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    count,
  );
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 }),
    count,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const k = 0.65 + hash(i * 1.7) * 0.7;
    p.set(flat[i * 2], 0.3, -flat[i * 2 + 1]);
    q.setFromAxisAngle(up, hash(i * 3.3) * Math.PI * 2);
    s.set(k, k * (0.85 + hash(i * 5.1) * 0.35), k);
    m.compose(p, q, s);
    canopy.setMatrixAt(i, m);
    trunks.setMatrixAt(i, m);
    // Late-October Toronto: a good share of the canopy has turned.
    const palette = hash(i * 9.7) < 0.42 ? AUTUMN : GREENS;
    c.setHex(palette[Math.floor(hash(i * 2.9) * palette.length)]).offsetHSL(0, 0, (hash(i) - 0.5) * 0.06);
    canopy.setColorAt(i, c);
  }
  canopy.castShadow = canopy.receiveShadow = true;
  trunks.castShadow = true;
  const group = new THREE.Group();
  group.add(trunks, canopy);
  return group;
}
