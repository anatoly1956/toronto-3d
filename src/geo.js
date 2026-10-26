// Local equirectangular projection centred on the CN Tower. Accurate to well
// under a metre across a few kilometres, which is all downtown needs.
// x = metres east, y = metres north. In the scene, north maps to -z.
export const ORIGIN = { lat: 43.6426, lon: -79.3871 };

const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function project(lat, lon) {
  return [(lon - ORIGIN.lon) * M_PER_DEG_LON, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

// Scene position (x, z) for a lat/lon.
export function toScene(lat, lon) {
  const [x, y] = project(lat, lon);
  return { x, z: -y };
}
