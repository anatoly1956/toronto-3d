// One-time download of downtown Toronto OSM data via Overpass, then conversion
// into compact local-meter JSON under public/data/. Raw responses are cached in
// scripts/cache/ so re-running only re-processes (delete the cache to refetch).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAll } from './process-osm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, 'cache');

export const BBOX = { s: 43.612, w: -79.412, n: 43.662, e: -79.358 };
export const COAST_BBOX = { s: 43.53, w: -79.56, n: 43.75, e: -79.21 };
const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERIES = {
  buildings: `[out:json][timeout:180];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  relation["building:part"](${bb});
);
out geom;`,
  // Lake Ontario is a water multipolygon: its outer ways are the mainland
  // shore, its inner ways the islands. Fetched over a wider area so the
  // ground can extend into the fog.
  lakeOuter: `[out:json][timeout:180];
rel["natural"="water"]["name"="Lake Ontario"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
way(r:"outer")(${COAST_BBOX.s},${COAST_BBOX.w},${COAST_BBOX.n},${COAST_BBOX.e});
out geom;`,
  lakeInner: `[out:json][timeout:180];
rel["natural"="water"]["name"="Lake Ontario"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
way(r:"inner")(${COAST_BBOX.s},${COAST_BBOX.w},${COAST_BBOX.n},${COAST_BBOX.e});
out geom;`,
  // Ponds, slips and channels; the lake itself comes from its shore above.
  water: `[out:json][timeout:180];
(
  way["natural"="water"](${bb});
  relation["natural"="water"]["name"!="Lake Ontario"](${bb});
);
out geom;`,
  roads: `[out:json][timeout:120];
way["highway"~"^(motorway|motorway_link|trunk|primary|secondary|tertiary)$"](${bb});
out geom;`,
  parks: `[out:json][timeout:120];
(
  way["leisure"="park"](${bb});
  relation["leisure"="park"](${bb});
  way["landuse"="grass"](${bb});
);
out geom;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(name, query) {
  let wait = 5000;
  for (let attempt = 0; attempt < 10; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'toronto-3d-learning-project/0.1',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) {
        const json = JSON.parse(text);
        console.log(`${name}: ${json.elements.length} elements from ${url}`);
        return text;
      }
      console.log(`${name}: ${res.status} from ${url}, retrying in ${wait / 1000}s`);
    } catch (err) {
      console.log(`${name}: ${err.message} from ${url}, retrying in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error(`${name}: all Overpass attempts failed`);
}

async function main() {
  await fs.mkdir(cacheDir, { recursive: true });
  const raw = {};
  for (const [name, query] of Object.entries(QUERIES)) {
    const file = path.join(cacheDir, `${name}.json`);
    try {
      raw[name] = JSON.parse(await fs.readFile(file, 'utf8'));
      console.log(`${name}: using cache`);
    } catch {
      const text = await overpass(name, query);
      await fs.writeFile(file, text);
      raw[name] = JSON.parse(text);
    }
  }
  await processAll(raw, path.join(here, '..', 'public', 'data'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
