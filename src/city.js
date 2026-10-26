import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addWindows } from './windows.js';

// Soft diorama palette, picked by building height.
const PALETTE = [
  { max: 20, colors: [0xe6ddd0, 0xdfd4c4, 0xe9e1d6] }, // low-rise: warm greys
  { max: 80, colors: [0xf1eee8, 0xe8e6e1, 0xece5da] }, // mid-rise: off-whites
  { max: Infinity, colors: [0xdfe7ef, 0xd5e0ea, 0xe7edf3, 0xcfdbe6] }, // towers: cool glass whites
];

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

function paint(geo, color) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function createBuildings(buildings) {
  const geos = [];
  const color = new THREE.Color();
  buildings.forEach((b, i) => {
    const depth = b.t - (b.m ?? 0);
    if (depth <= 0.5) return;
    const geo = new THREE.ExtrudeGeometry(toShape(b), { depth, bevelEnabled: false });
    layFlat(geo, b.m ?? 0);
    const bucket = PALETTE.find((p) => b.t <= p.max);
    color.setHex(bucket.colors[Math.floor(hash(i) * bucket.colors.length)]);
    color.offsetHSL(0, 0, (hash(i + 0.5) - 0.5) * 0.04);
    paint(geo, color);
    // Drop UVs: ExtrudeGeometry's UVs are unused and would block merging.
    geo.deleteAttribute('uv');
    geos.push(geo);
  });

  const material = addWindows(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 }),
  );

  // Merge in chunks so frustum culling still helps and no buffer gets huge.
  const group = new THREE.Group();
  const CHUNK = 1500;
  for (let i = 0; i < geos.length; i += CHUNK) {
    const mesh = new THREE.Mesh(mergeGeometries(geos.slice(i, i + CHUNK)), material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  geos.forEach((g) => g.dispose());
  return group;
}

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

// Roads become flat ribbons: each polyline is offset to both sides along the
// averaged segment normal.
export function createRoads(roads, material, y) {
  const positions = [];
  const indices = [];
  for (const road of roads) {
    const pts = ring(road.p);
    if (pts.length < 2) continue;
    const half = road.w / 2;
    const base = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      positions.push(pts[i].x + nx * half, y, -(pts[i].y + ny * half));
      positions.push(pts[i].x - nx * half, y, -(pts[i].y - ny * half));
      if (i > 0) {
        const a = base + (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Ribbon winding depends on direction; force normals up so lighting is even.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}
