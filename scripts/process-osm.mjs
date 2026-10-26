// Converts raw Overpass JSON into public/data/city.json in local metres
// (x east, y north, origin at the CN Tower). See src/geo.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { project } from '../src/geo.js';
import { BBOX } from './fetch-osm.mjs';

// Ground tile clipped out of the coastline, in local metres.
const LAND_RECT = { minX: -11000, maxX: 11000, minY: -9000, maxY: 7500 };

// Hand-modelled landmarks: drop any OSM footprints near them.
const EXCLUDE = [
  { at: project(43.6426, -79.3871), r: 50 }, // CN Tower
  { at: project(43.6414, -79.3894), r: 112 }, // Rogers Centre
];

const LEVEL_HEIGHT = 3.4;
const ROAD_WIDTH = {
  motorway: 22, trunk: 16, primary: 13, secondary: 11, tertiary: 9,
  motorway_link: 8,
};

const r1 = (v) => Math.round(v * 10) / 10;

// ---------- geometry helpers ----------

function toXY(geometry) {
  return geometry.filter(Boolean).map((g) => project(g.lat, g.lon));
}

const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || !samePt(out[out.length - 1], p)) out.push(p);
  if (out.length > 1 && samePt(out[0], out[out.length - 1])) out.pop();
  return out;
}

function area(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return a / 2; // positive = counter-clockwise (y up)
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Douglas–Peucker simplification.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Joins open polylines that share endpoints into longer chains. Multipolygon
// member ways have arbitrary direction, so pieces may be reversed.
function stitch(lines) {
  const chains = lines.map((l) => l.slice()).filter((l) => l.length > 1);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      const a = chains[i];
      if (samePt(a[0], a[a.length - 1])) continue;
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const b = chains[j];
        const aEnd = a[a.length - 1];
        const bEnd = b[b.length - 1];
        if (samePt(aEnd, b[0])) chains[i] = a.concat(b.slice(1));
        else if (samePt(aEnd, bEnd)) chains[i] = a.concat(b.slice(0, -1).reverse());
        else if (samePt(bEnd, a[0])) chains[i] = b.concat(a.slice(1));
        else if (samePt(b[0], a[0])) chains[i] = b.slice(1).reverse().concat(a);
        else continue;
        chains.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return chains;
}

// Rings from multipolygon members (stitching split ways, ignoring direction).
function ringsFromMembers(members, role) {
  const lines = members
    .filter((m) => m.type === 'way' && m.role === role && m.geometry)
    .map((m) => toXY(m.geometry));
  const rings = [];
  const pool = lines.filter((l) => l.length > 1);
  while (pool.length) {
    let ring = pool.shift();
    let grown = true;
    while (!samePt(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const end = ring[ring.length - 1];
        if (samePt(end, l[0])) ring = ring.concat(l.slice(1));
        else if (samePt(end, l[l.length - 1])) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    ring = dedupe(ring);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// Each OSM area element -> list of { outer, holes } polygons.
function polygonsOf(el) {
  if (el.type === 'way') {
    const ring = dedupe(toXY(el.geometry ?? []));
    return ring.length >= 3 ? [{ outer: ring, holes: [] }] : [];
  }
  const outers = ringsFromMembers(el.members ?? [], 'outer');
  const inners = ringsFromMembers(el.members ?? [], 'inner');
  return outers.map((outer) => ({
    outer,
    holes: inners.filter((h) => pointInRing(h[0], outer)),
  }));
}

const flat = (pts) => pts.flatMap(([x, y]) => [r1(x), r1(y)]);

function encodePoly({ outer, holes }) {
  const out = { p: flat(outer) };
  if (holes.length) out.h = holes.map(flat);
  return out;
}

// ---------- building colours & materials ----------

// Deterministic 0..1 from an integer id.
function rand(id, salt = 0) {
  const s = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const pick = (arr, id, salt) => arr[Math.floor(rand(id, salt) * arr.length)];

const PALETTES = {
  brick: [0x9a5a45, 0xa66a50, 0x8c4f3e, 0xae7a5e, 0x96604c],
  stone: [0xcfc5b2, 0xc2b8a5, 0xd8cfbe, 0xbfb4a0],
  concrete: [0xb9b5ad, 0xc7c3bb, 0xaaa69e, 0xd2cec6],
  glass: [0x3d4b5c, 0x4a5b6e, 0x34404f, 0x56697d, 0x5d7186, 0x445466],
  stucco: [0xe2d6c2, 0xd9cbb4, 0xe8dfcf],
  metal: [0x8f969c, 0x9da3a8],
};

const NAMED = {
  red: 0x9a4b3c, darkred: 0x7a2e26, beige: 0xd8c8a6, black: 0x3a3e45, white: 0xebe9e3,
  brown: 0x7c5846, grey: 0x9b9da1, gray: 0x9b9da1, lightgrey: 0xc8c9cb, lightgray: 0xc8c9cb,
  darkgrey: 0x606368, darkgray: 0x606368, orange: 0xc77c4c, yellow: 0xd9c070, blue: 0x4f6f96,
  green: 0x6f8a6a, silver: 0xb7bcc1, tan: 0xc8ad86, cream: 0xeee3c9, maroon: 0x6e2f2a,
};

// Some well-known buildings whose OSM colour is missing or unflattering.
const NAME_OVERRIDES = [
  [/^Scotia Plaza$/, { c: 0x7d3027, k: 0 }],
  [/^Royal Bank Plaza/, { c: 0xc9a14a, k: 1 }],
  [/^First Canadian Place$/, { c: 0xe8e7e2, k: 1 }],
  [/^Toronto City Hall$/, { c: 0xd9d6cf, k: 0 }],
  [/^Union Station$/, { c: 0xcbbf9f, k: 0 }],
];

function parseColour(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (NAMED[s] != null) return NAMED[s];
  const m = /^#?([0-9a-f]{6})$/.exec(s) ?? /^#?([0-9a-f]{3})$/.exec(s);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  // Pull mapper-chosen colours toward a warm neutral so they sit together.
  const n = parseInt(hex, 16);
  const mix = (a, b) => Math.round(a * 0.6 + b * 0.4);
  return (mix(n >> 16, 0xb4) << 16) | (mix((n >> 8) & 255, 0xae) << 8) | mix(n & 255, 0xa4);
}

const HOUSE_TYPES = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'residential', 'garage', 'shed']);

// Returns { c: wall colour, k: 0 matte | 1 glass, r: roof colour }.
function lookOf(tags, id, height) {
  for (const [re, look] of NAME_OVERRIDES) {
    if (re.test(tags.name ?? '')) return { ...look, r: 0x8d8a84 };
  }
  const material = (tags['building:material'] ?? '').toLowerCase();
  const type = tags.building ?? tags['building:part'] ?? 'yes';
  const isHouse = HOUSE_TYPES.has(type);
  let family = {
    brick: 'brick', glass: 'glass', stone: 'stone', limestone: 'stone', sandstone: 'stone',
    concrete: 'concrete', cement_block: 'concrete', metal: 'metal', steel: 'metal',
    plaster: 'stucco', stucco: 'stucco', wood: 'brick',
  }[material];
  if (!family) {
    const r = rand(id, 1);
    if (isHouse) family = r < 0.72 ? 'brick' : 'stucco';
    else if (height > 60) family = r < 0.68 ? 'glass' : r < 0.85 ? 'concrete' : 'stone';
    else if (height > 25) family = r < 0.35 ? 'glass' : r < 0.6 ? 'concrete' : r < 0.82 ? 'brick' : 'stone';
    else family = r < 0.45 ? 'brick' : r < 0.7 ? 'concrete' : r < 0.88 ? 'stone' : 'stucco';
  }
  const c = parseColour(tags['building:colour']) ?? pick(PALETTES[family], id, 2);
  const roofTagged = parseColour(tags['roof:colour']);
  const pitched = isHouse || /gabled|hipped|pyramidal/.test(tags['roof:shape'] ?? '');
  const r = roofTagged ?? (pitched ? pick([0x5f5853, 0x6b625b, 0x544e4b], id, 3) : family === 'glass' ? 0x6e737a : pick([0xa39e95, 0x9a958c, 0xaea99f], id, 4));
  return { c, k: family === 'glass' ? 1 : 0, r };
}

// ---------- buildings ----------

function parseMetres(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return /ft|'/.test(String(v)) ? n * 0.3048 : n;
}

function heightOf(tags, seed) {
  const h = parseMetres(tags.height);
  if (h) return h;
  const levels = parseFloat(tags['building:levels']);
  if (levels > 0) return levels * LEVEL_HEIGHT + 1.5;
  const type = tags.building ?? tags['building:part'];
  if (['house', 'detached', 'semidetached_house', 'terrace', 'garage', 'shed', 'roof'].includes(type)) {
    return 7 + (seed % 4);
  }
  return 9 + (seed % 7);
}

function minHeightOf(tags) {
  const h = parseMetres(tags.min_height);
  if (h != null) return h;
  const lvl = parseFloat(tags['building:min_level']);
  return lvl > 0 ? lvl * LEVEL_HEIGHT : 0;
}

function isExcluded(pts) {
  const c = centroid(pts);
  return EXCLUDE.some(({ at, r }) => Math.hypot(c[0] - at[0], c[1] - at[1]) < r);
}

function processBuildings(raw) {
  const parts = [];
  const outlines = [];
  for (const el of raw.elements) {
    const tags = el.tags ?? {};
    if (tags.building === 'no' && !tags['building:part']) continue;
    if (tags.location === 'underground' || tags.layer?.startsWith('-')) continue;
    for (const poly of polygonsOf(el)) {
      if (isExcluded(poly.outer)) continue;
      const item = { poly, tags, id: el.id };
      (tags['building:part'] ? parts : outlines).push(item);
    }
  }

  // Simple 3D Buildings rule: an outline that contains parts is not drawn.
  // Parts inherit the outline's tags (colour, material) and colour seed, so
  // one tower doesn't come out patchwork.
  const keptOutlines = [];
  for (const outline of outlines) {
    const ring = outline.poly.outer;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let hasParts = false;
    for (const part of parts) {
      if (part.parent) continue;
      const c = part.c ?? (part.c = centroid(part.poly.outer));
      if (c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1 && pointInRing(c, ring)) {
        part.parent = outline;
        hasParts = true;
      }
    }
    if (!hasParts) keptOutlines.push(outline);
  }

  const out = [];
  for (const { poly, tags, id, parent } of [...keptOutlines, ...parts]) {
    if (Math.abs(area(poly.outer)) < 6) continue;
    const t = heightOf(tags, id);
    const m = Math.min(minHeightOf(tags), t - 1);
    const b = encodePoly({ outer: simplify(poly.outer, 0.15), holes: poly.holes });
    b.t = r1(t);
    if (m > 0) b.m = r1(m);
    const lookTags = parent ? { ...parent.tags, ...tags, name: parent.tags.name ?? tags.name } : tags;
    Object.assign(b, lookOf(lookTags, parent?.id ?? id, Math.max(t, parent ? heightOf(parent.tags, parent.id) : 0)));
    out.push(b);
  }
  console.log(`buildings: ${keptOutlines.length} outlines + ${parts.length} parts -> ${out.length}`);
  return out;
}

// ---------- coastline -> land polygons ----------

function clipChainToRect(chain, R) {
  const inside = ([x, y]) => x >= R.minX && x <= R.maxX && y >= R.minY && y <= R.maxY;
  const pieces = [];
  let cur = null;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    // Liang–Barsky clip of segment a-b.
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - R.minX, R.maxX - a[0], a[1] - R.minY, R.maxY - a[1]];
    let visible = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) { visible = false; break; }
      } else {
        const t = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!visible || t0 > t1) continue;
    const s = [a[0] + dx * t0, a[1] + dy * t0];
    const e = [a[0] + dx * t1, a[1] + dy * t1];
    if (!cur) cur = { pts: [s], entersOnEdge: t0 > 0 || !inside(a) };
    cur.pts.push(e);
    if (t1 < 1) {
      pieces.push(cur);
      cur = null;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

function perimeterPos([x, y], R) {
  const W = R.maxX - R.minX, H = R.maxY - R.minY;
  const eps = 1e-6;
  if (Math.abs(y - R.minY) < eps) return x - R.minX;
  if (Math.abs(x - R.maxX) < eps) return W + (y - R.minY);
  if (Math.abs(y - R.maxY) < eps) return W + H + (R.maxX - x);
  return 2 * W + H + (R.maxY - y);
}

// Builds land polygons inside rect R from the lake's shore. Shore chains are
// oriented so land is on their left: open mainland chains run west to east
// (Toronto's shore has the lake to the south), closed island rings run
// counter-clockwise.
function landFromLake(outerRaw, innerRaw, R) {
  const lines = (raw) => raw.elements.filter((e) => e.type === 'way').map((e) => toXY(e.geometry));
  const chains = [
    ...stitch(lines(outerRaw)).map((c) => (c[0][0] > c[c.length - 1][0] ? c.reverse() : c)),
    ...stitch(lines(innerRaw)).map((c) => (samePt(c[0], c[c.length - 1]) && area(c) < 0 ? c.reverse() : c)),
  ];
  const W = R.maxX - R.minX, H = R.maxY - R.minY, PER = 2 * (W + H);
  const corners = [
    [W, [R.maxX, R.minY]],
    [W + H, [R.maxX, R.maxY]],
    [2 * W + H, [R.minX, R.maxY]],
    [PER, [R.minX, R.minY]],
  ];

  const islands = [];
  const pieces = [];
  for (let chain of chains) {
    const closed = samePt(chain[0], chain[chain.length - 1]);
    const allInside = chain.every(
      ([x, y]) => x > R.minX && x < R.maxX && y > R.minY && y < R.maxY,
    );
    if (closed && allInside) {
      const ring = dedupe(chain);
      if (area(ring) > 0) islands.push(ring);
      continue;
    }
    if (closed) {
      // Rotate so the walk starts outside the rect, keeping pieces whole.
      const k = chain.findIndex(([x, y]) => x < R.minX || x > R.maxX || y < R.minY || y > R.maxY);
      if (k > 0) chain = chain.slice(k).concat(chain.slice(1, k + 1));
    }
    for (const piece of clipChainToRect(chain, R)) {
      if (piece.pts.length < 2) continue;
      pieces.push(piece.pts);
    }
  }

  // Walk: piece exit -> counter-clockwise along the rect edge -> next entry.
  const entries = pieces.map((p) => perimeterPos(p[0], R));
  const used = new Array(pieces.length).fill(false);
  const land = [];
  for (let start = 0; start < pieces.length; start++) {
    if (used[start]) continue;
    const ring = [];
    let i = start;
    for (let guard = 0; guard < pieces.length + 1; guard++) {
      used[i] = true;
      ring.push(...pieces[i]);
      const exitPos = perimeterPos(pieces[i][pieces[i].length - 1], R);
      let best = -1, bestD = Infinity;
      for (let j = 0; j < pieces.length; j++) {
        const d = (entries[j] - exitPos + PER) % PER;
        if (d < bestD && (!used[j] || j === start)) { bestD = d; best = j; }
      }
      // Corners passed between exit and next entry.
      for (const [pos, pt] of [...corners, ...corners.map(([p, c]) => [p + PER, c])]) {
        const rel = pos - exitPos;
        if (rel > 0 && rel < bestD) ring.push(pt);
      }
      if (best === start || best === -1) break;
      i = best;
    }
    const clean = dedupe(ring);
    if (clean.length >= 3) land.push(clean);
  }

  const polys = [...land, ...islands].map((ring) => ({ outer: simplify(ring, 0.6), holes: [] }));
  console.log(`lake shore: ${chains.length} chains, ${pieces.length} pieces -> ${land.length} land + ${islands.length} islands`);
  return polys;
}

// ---------- roads ----------

const GARDINER_DECK = 13;
const BRIDGE_HUMP = 6;

// Distance along a polyline at each vertex.
function cumulative(pts) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return d;
}

// Each road: { p: flat xy, w: width, k: 0 street | 1 expressway, e?: elevation per vertex,
// o?: 1 if one-way (traffic follows point order) }.
function processRoads(raw) {
  const ways = raw.elements.filter((e) => e.type === 'way' && e.geometry && e.tags?.tunnel !== 'yes');
  const key = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const deckNodes = new Set();
  for (const w of ways) {
    if (w.tags.highway === 'motorway' && w.tags.bridge) for (const p of toXY(w.geometry)) deckNodes.add(key(p));
  }

  return ways.map((w) => {
    const hw = w.tags.highway;
    const pts = simplify(toXY(w.geometry), 0.5);
    const road = { p: flat(pts), w: ROAD_WIDTH[hw] ?? 8, k: hw.startsWith('motorway') ? 1 : 0 };
    if (w.tags.oneway === 'yes' || hw === 'motorway') road.o = 1;
    if (!w.tags.bridge) return road;

    const d = cumulative(pts);
    const len = d[d.length - 1];
    let e;
    if (hw === 'motorway') {
      e = pts.map(() => GARDINER_DECK);
    } else if (hw === 'motorway_link') {
      // Ramp from the deck end down to street level at the other end.
      const startOnDeck = deckNodes.has(key(pts[0]));
      const endOnDeck = deckNodes.has(key(pts[pts.length - 1]));
      e = d.map((s) => {
        if (startOnDeck && endOnDeck) return GARDINER_DECK;
        const f = startOnDeck ? 1 - s / len : endOnDeck ? s / len : 0.5;
        return GARDINER_DECK * f;
      });
    } else {
      // Short bridges over the rail corridor: a gentle hump.
      e = d.map((s) => BRIDGE_HUMP * Math.min(1, s / 40, (len - s) / 40));
    }
    road.e = e.map(r1);
    return road;
  });
}

// ---------- extras: rail, trees, ferry, piers ----------

function processExtras(raw, parkPolys) {
  const rails = [];
  const ferries = [];
  const piers = [];
  const trees = [];
  for (const e of raw.elements) {
    const t = e.tags ?? {};
    if (e.type === 'node' && t.natural === 'tree') {
      const [x, y] = project(e.lat, e.lon);
      trees.push(r1(x), r1(y));
      continue;
    }
    if (e.type !== 'way' || !e.geometry) continue;
    const pts = toXY(e.geometry);
    if (t.railway) {
      if (t.tunnel === 'yes' || t.location === 'underground' || t.service === 'yard' && pts.length < 3) continue;
      rails.push({ p: flat(simplify(pts, 0.4)), k: t.railway === 'rail' ? 0 : 1 });
    } else if (t.route === 'ferry') {
      ferries.push({ p: flat(simplify(pts, 2)) });
    } else if (t.man_made === 'pier') {
      const closed = samePt(pts[0], pts[pts.length - 1]);
      if (closed) piers.push(encodePoly({ outer: dedupe(pts), holes: [] }));
      else piers.push({ p: flat(pts), line: 1 });
    }
  }

  // Fill parks with trees on a jittered grid (OSM only has some street trees).
  let seed = 1;
  for (const park of parkPolys) {
    const ring = park.outer;
    if (Math.abs(area(ring)) < 400) continue;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const step = 15;
    for (let x = Math.min(...xs); x < Math.max(...xs); x += step) {
      for (let y = Math.min(...ys); y < Math.max(...ys); y += step) {
        seed++;
        if (rand(seed, 5) < 0.35) continue; // leave clearings
        const px = x + (rand(seed, 6) - 0.5) * step;
        const py = y + (rand(seed, 7) - 0.5) * step;
        if (pointInRing([px, py], ring) && !park.holes.some((h) => pointInRing([px, py], h))) {
          trees.push(r1(px), r1(py));
        }
      }
    }
  }
  console.log(`extras: ${rails.length} rail, ${ferries.length} ferry, ${piers.length} piers, ${trees.length / 2} trees`);
  return { rails, ferries, piers, trees };
}

// ---------- assemble ----------

export async function processAll(raw, outDir) {
  const [minX, minY] = project(BBOX.s, BBOX.w);
  const [maxX, maxY] = project(BBOX.n, BBOX.e);

  const buildings = processBuildings(raw.buildings);
  const land = landFromLake(raw.lakeOuter, raw.lakeInner, LAND_RECT);

  // Extend the land far past the tile to the north so it fades into fog.
  const R = LAND_RECT;
  land.push({ outer: [[R.minX - 30000, R.maxY], [R.maxX + 30000, R.maxY], [R.maxX + 30000, R.maxY + 30000], [R.minX - 30000, R.maxY + 30000]], holes: [] });

  const areas = (rawSet) =>
    rawSet.elements
      .flatMap(polygonsOf)
      .filter((p) => Math.abs(area(p.outer)) > 40)
      .map((p) => encodePoly({ outer: simplify(p.outer, 0.4), holes: p.holes.map((h) => simplify(h, 0.4)) }));

  const roads = processRoads(raw.roads);

  // Parks only count for tree planting when they're green (not paved plazas).
  const greenParks = raw.parks.elements
    .filter((e) => e.tags?.leisure === 'park' || e.tags?.landuse === 'grass')
    .flatMap(polygonsOf);
  const extras = processExtras(raw.extras, greenParks);

  const city = {
    bounds: { minX: r1(minX), maxX: r1(maxX), minY: r1(minY), maxY: r1(maxY) },
    land: land.map(encodePoly),
    water: areas(raw.water),
    parks: areas(raw.parks),
    roads,
    buildings,
    ...extras,
  };

  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, 'city.json');
  await fs.writeFile(file, JSON.stringify(city));
  const { size } = await fs.stat(file);
  console.log(
    `wrote ${file} (${(size / 1e6).toFixed(1)} MB): ${buildings.length} buildings, ` +
      `${city.land.length} land, ${city.water.length} water, ${city.parks.length} parks, ${roads.length} roads`,
  );
}
