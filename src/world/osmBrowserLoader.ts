import type { Bridge, Faction, InfraSpline, Point2D, StrategicNode } from '../core/types';

export interface GisBoundingBox {
  id: string;
  title: string;
  subtitle: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export const REAL_WORLD_SECTOR_PRESETS: GisBoundingBox[] = [
  {
    id: 'suwalki_city',
    title: 'SUWAŁKI CITY & RAIL BALTICA (54.10°N, 22.93°E)',
    subtitle:
      'Real Suwałki street network, PKP Rail Baltica station, Czarna Hańcza river bridges, Arkadia Lake & ~3,500 real OSM buildings (5.2 km × 3.9 km)',
    minLat: 54.084,
    maxLat: 54.119,
    minLon: 22.901,
    maxLon: 22.961,
  },
  {
    id: 'klaipeda_port',
    title: 'KLAIPĖDA SEAPORT & MEMEL STRAIT (55.71°N, 21.13°E)',
    subtitle:
      'Real Baltic Sea & Curonian Spit strait, Klaipėda naval & container piers, Danė River bridges, rail yards & ~4,200 real OSM buildings (5.2 km × 3.9 km)',
    minLat: 55.691,
    maxLat: 55.726,
    minLon: 21.102,
    maxLon: 21.166,
  },
  {
    id: 'baltiysk_naval',
    title: 'BALTIYSK NAVAL BASE & SEA CANAL (54.64°N, 19.90°E)',
    subtitle:
      'Real Russian Baltic Fleet naval basins, Pillau 5-point star citadel, Vistula Spit sea canal, rail terminal & dockyard buildings (5.2 km × 3.9 km)',
    minLat: 54.629,
    maxLat: 54.664,
    minLon: 19.872,
    maxLon: 19.934,
  },
  {
    id: 'kaunas_bridges',
    title: 'KAUNAS NEMAN CONFLUENCE & BRIDGES (54.89°N, 23.91°E)',
    subtitle:
      'Real Neman & Neris river confluence, Vytautas & Čiurlionis highway/rail bridges, Aleksotas runway (EYKS) & dense urban blocks (5.2 km × 3.9 km)',
    minLat: 54.878,
    maxLat: 54.913,
    minLon: 23.876,
    maxLon: 23.941,
  },
];

export interface OsmBuildingFootprint {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  tall: boolean;
  kind: 'civic' | 'residential' | 'industrial' | 'warehouse' | 'hangar' | 'silo';
  polygon?: Point2D[];
  name?: string;
}

export interface OsmStreetPolyline {
  points: Point2D[];
  width: number;
  highwayClass: string;
  name?: string;
}

export interface OsmRiverWay {
  points: Point2D[];
  width: number;
  name?: string;
}

export interface OsmAeroway {
  points: Point2D[];
  kind: 'runway' | 'taxiway' | 'apron' | 'helipad';
  width: number;
}

export interface OsmSectorData {
  bounds: GisBoundingBox;
  fetchedFromOverpass: boolean;
  stats: {
    buildings: number;
    roads: number;
    railways: number;
    bridges: number;
    waterways: number;
  };
  demGrid?: {
    rows: number;
    cols: number;
    values: number[];
  };
  splines: InfraSpline[];
  cityStreets: OsmStreetPolyline[];
  bridges: Bridge[];
  buildings: OsmBuildingFootprint[];
  waterPolygons: Point2D[][];
  coastlineWays: Point2D[][];
  riverWays: OsmRiverWay[];
  pierPolygons: Point2D[][];
  pierWays: Array<{ points: Point2D[]; width: number }>;
  forestPolygons: Point2D[][];
  aeroways: OsmAeroway[];
  initialNodes: StrategicNode[];
}

interface OverpassGeomPt {
  lat: number;
  lon: number;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeomPt[];
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: OverpassGeomPt[];
  }>;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const memoryCache = new Map<string, OsmSectorData>();

export function projectLatLon(
  lat: number,
  lon: number,
  bounds: GisBoundingBox,
  worldW: number,
  worldH: number,
): Point2D {
  const nx = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon);
  const ny = (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat);
  return {
    x: nx * worldW,
    y: ny * worldH,
  };
}

export function unprojectWorldToLatLon(
  x: number,
  y: number,
  bounds: GisBoundingBox,
  worldW: number,
  worldH: number,
): { lat: number; lon: number } {
  const lon = bounds.minLon + (x / worldW) * (bounds.maxLon - bounds.minLon);
  const lat = bounds.maxLat - (y / worldH) * (bounds.maxLat - bounds.minLat);
  return { lat, lon };
}

/**
 * Geocode any place name on Earth using OpenStreetMap Nominatim in the user's browser,
 * or parse direct "lat, lon" coordinates.
 */
export async function geocodeLocationBrowser(query: string): Promise<GisBoundingBox> {
  const trimmed = query.trim();
  const coordMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lon = Number(coordMatch[2]);
    const dLat = 0.0175; // ~3.9 km N-S
    const dLon = dLat / Math.max(0.25, Math.cos((lat * Math.PI) / 180)) * (3200 / 2400) * 0.5;
    return {
      id: `custom_${lat.toFixed(4)}_${lon.toFixed(4)}`,
      title: `CUSTOM SECTOR // ${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`,
      subtitle: `Live OpenStreetMap tactical sector centered on ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      minLat: lat - dLat,
      maxLat: lat + dLat,
      minLon: lon - dLon,
      maxLon: lon + dLon,
    };
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Nominatim geocoder returned HTTP ${res.status}`);
  }
  const results = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    name?: string;
  }>;
  if (!results || results.length === 0) {
    throw new Error(`No OpenStreetMap location found for "${trimmed}"`);
  }

  const top = results[0];
  const lat = Number(top.lat);
  const lon = Number(top.lon);
  const dLat = 0.0175; // ~3.9 km N-S
  const dLon = (dLat / Math.max(0.25, Math.cos((lat * Math.PI) / 180))) * (3200 / 2400);
  const shortName = (top.name || top.display_name.split(',')[0] || trimmed).toUpperCase();

  return {
    id: `osm_${lat.toFixed(4)}_${lon.toFixed(4)}`,
    title: `${shortName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`,
    subtitle: top.display_name,
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLon: lon - dLon * 0.5,
    maxLon: lon + dLon * 0.5,
  };
}

async function fetchRealDemGrid(
  bounds: GisBoundingBox,
  rows = 8,
  cols = 8,
): Promise<{ rows: number; cols: number; values: number[] } | undefined> {
  try {
    const lats: string[] = [];
    const lons: string[] = [];
    for (let r = 0; r < rows; r++) {
      const lat = bounds.maxLat - (r / (rows - 1)) * (bounds.maxLat - bounds.minLat);
      for (let c = 0; c < cols; c++) {
        const lon = bounds.minLon + (c / (cols - 1)) * (bounds.maxLon - bounds.minLon);
        lats.push(lat.toFixed(4));
        lons.push(lon.toFixed(4));
      }
    }
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (!res.ok) return undefined;
    const json = (await res.json()) as { elevation?: number[] };
    if (Array.isArray(json.elevation) && json.elevation.length === rows * cols) {
      return { rows, cols, values: json.elevation };
    }
  } catch {
    // Fall back to OSM hydrography + local relief if Open-Meteo is unreachable
  }
  return undefined;
}

/**
 * Fetches real roads, bridges, railways, waterways, coastlines, piers, landuse,
 * and every building polygon directly from OpenStreetMap Overpass API in the user's browser.
 */
export async function fetchLiveOsmSector(
  bounds: GisBoundingBox,
  worldW: number,
  worldH: number,
  onProgress?: (status: string) => void,
): Promise<OsmSectorData> {
  const cacheKey = `${bounds.minLat.toFixed(4)},${bounds.minLon.toFixed(4)},${bounds.maxLat.toFixed(4)},${bounds.maxLon.toFixed(4)}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    onProgress?.(
      `OSM LIVE READY: ${cached.stats.buildings.toLocaleString()} buildings • ${cached.stats.roads} roads • ${cached.stats.bridges} bridges`,
    );
    return cached;
  }

  const bboxStr = `${bounds.minLat.toFixed(5)},${bounds.minLon.toFixed(5)},${bounds.maxLat.toFixed(5)},${bounds.maxLon.toFixed(5)}`;
  const query = `[out:json][timeout:25][bbox:${bboxStr}];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service|pedestrian)$"];
  way["railway"~"^(rail|light_rail|narrow_gauge|tram)$"];
  way["waterway"~"^(river|canal|dock|fairway|stream|riverbank)$"];
  way["natural"~"^(water|coastline|bay|strait|wood|scrub)$"];
  relation["natural"="water"];
  relation["waterway"="riverbank"];
  way["landuse"~"^(reservoir|basin|harbour|port|industrial|military|forest)$"];
  way["aeroway"~"^(runway|taxiway|apron|hangar|helipad)$"];
  way["man_made"~"^(pier|breakwater|quay|bridge|storage_tank|silo)$"];
  way["building"];
  node["place"~"^(city|town|suburb|quarter|neighbourhood|village)$"];
  node["railway"~"^(station|halt|yard)$"];
);
out body geom qt;`;

  onProgress?.(`Querying OpenStreetMap Overpass API (${bounds.title})...`);

  let elements: OverpassElement[] | null = null;
  let lastErr = '';

  const demPromise = fetchRealDemGrid(bounds, 8, 8);

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const host = new URL(endpoint).hostname;
      onProgress?.(`Streaming real GIS vectors from ${host}...`);
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), 18000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      window.clearTimeout(timeoutId);
      if (!res.ok) {
        lastErr = `${host} HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as { elements?: OverpassElement[] };
      if (data && Array.isArray(data.elements) && data.elements.length > 0) {
        elements = data.elements;
        break;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  const demGrid = await demPromise;

  if (!elements) {
    throw new Error(`Overpass API unreachable (${lastErr || 'network blocked'})`);
  }

  onProgress?.(`Parsing ${elements.length.toLocaleString()} real OpenStreetMap features...`);
  const parsed = parseOverpassElementsToSector(elements, bounds, worldW, worldH, demGrid);
  memoryCache.set(cacheKey, parsed);
  onProgress?.(
    `OSM LIVE: ${parsed.stats.buildings.toLocaleString()} real buildings • ${parsed.stats.roads} streets/highways • ${parsed.stats.railways} rails • ${parsed.stats.bridges} bridges`,
  );
  return parsed;
}

function simplifyPolyline(pts: Point2D[], minStepPx: number): Point2D[] {
  if (pts.length <= 2) return pts;
  const out: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) >= minStepPx) {
      out.push(pts[i]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function parseOverpassElementsToSector(
  elements: OverpassElement[],
  bounds: GisBoundingBox,
  worldW: number,
  worldH: number,
  demGrid?: { rows: number; cols: number; values: number[] },
): OsmSectorData {
  const splines: InfraSpline[] = [];
  const cityStreets: OsmStreetPolyline[] = [];
  const bridges: Bridge[] = [];
  const buildings: OsmBuildingFootprint[] = [];
  const waterPolygons: Point2D[][] = [];
  const coastlineWays: Point2D[][] = [];
  const riverWays: OsmRiverWay[] = [];
  const pierPolygons: Point2D[][] = [];
  const pierWays: Array<{ points: Point2D[]; width: number }> = [];
  const forestPolygons: Point2D[][] = [];
  const aeroways: OsmAeroway[] = [];

  const placeNodes: Array<{ name: string; x: number; y: number; place: string }> = [];
  const railStations: Array<{ name: string; x: number; y: number }> = [];
  const harbourCenters: Array<{ name: string; x: number; y: number }> = [];
  const industrialCenters: Array<{ name: string; x: number; y: number }> = [];
  const militaryCenters: Array<{ name: string; x: number; y: number }> = [];

  const metersPerPixel =
    ((bounds.maxLat - bounds.minLat) * 111320) / worldH; // ~1.6m per pixel at 3.9km height

  for (const el of elements) {
    const tags = el.tags || {};

    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      const p = projectLatLon(el.lat, el.lon, bounds, worldW, worldH);
      if (p.x < 40 || p.x > worldW - 40 || p.y < 40 || p.y > worldH - 40) continue;
      if (tags.place && tags.name) {
        placeNodes.push({ name: tags.name, x: p.x, y: p.y, place: tags.place });
      }
      if (tags.railway === 'station' || tags.railway === 'halt' || tags.railway === 'yard') {
        railStations.push({ name: tags.name || 'Rail Station', x: p.x, y: p.y });
      }
      continue;
    }

    if (el.type === 'relation' && el.members) {
      if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir') {
        for (const m of el.members) {
          if ((m.role === 'outer' || m.role === '') && m.geometry && m.geometry.length >= 3) {
            const poly = m.geometry.map((g) => projectLatLon(g.lat, g.lon, bounds, worldW, worldH));
            waterPolygons.push(simplifyPolyline(poly, 2.5));
          }
        }
      }
      continue;
    }

    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const pts = el.geometry.map((g) => projectLatLon(g.lat, g.lon, bounds, worldW, worldH));
    const first = pts[0];
    const last = pts[pts.length - 1];
    const isClosed =
      pts.length >= 4 && Math.hypot(first.x - last.x, first.y - last.y) < 6;

    // 1. Real Buildings, Hangars & Storage Silos
    if (
      tags.building ||
      tags.aeroway === 'hangar' ||
      tags.man_made === 'storage_tank' ||
      tags.man_made === 'silo'
    ) {
      if (pts.length < 3) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let cx = 0;
      let cy = 0;
      const n = pts.length > 1 && isClosed ? pts.length - 1 : pts.length;
      const poly: Point2D[] = [];
      for (let i = 0; i < n; i++) {
        const pt = pts[i];
        poly.push(pt);
        cx += pt.x;
        cy += pt.y;
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      cx /= n;
      cy /= n;
      const w = Math.max(4, maxX - minX);
      const h = Math.max(4, maxY - minY);
      // Skip tiny sheds (< 2.5px) or huge non-building boundary boxes (> 450px)
      if ((w < 3 && h < 3) || w > 450 || h > 450) continue;

      // Principal edge angle from longest polygon edge
      let bestLen = 0;
      let angle = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > bestLen) {
          bestLen = d;
          angle = Math.atan2(b.y - a.y, b.x - a.x);
        }
      }

      const bType = tags.building || '';
      const levels = Number(tags['building:levels'] || 0);
      let kind: OsmBuildingFootprint['kind'] = 'residential';
      if (tags.man_made === 'storage_tank' || tags.man_made === 'silo' || bType === 'storage_tank') {
        kind = 'silo';
      } else if (tags.aeroway === 'hangar' || bType === 'hangar' || bType === 'military') {
        kind = 'hangar';
      } else if (bType === 'warehouse' || bType === 'depot') {
        kind = 'warehouse';
      } else if (bType === 'industrial' || bType === 'manufacture' || bType === 'factory') {
        kind = 'industrial';
      } else if (
        bType === 'civic' ||
        bType === 'public' ||
        bType === 'government' ||
        bType === 'hospital' ||
        bType === 'train_station' ||
        bType === 'commercial' ||
        bType === 'office' ||
        bType === 'retail' ||
        bType === 'university' ||
        bType === 'school' ||
        levels >= 5
      ) {
        kind = 'civic';
      }

      const tall =
        levels >= 4 ||
        kind === 'civic' ||
        kind === 'industrial' ||
        kind === 'silo' ||
        bType === 'apartments' ||
        bType === 'church' ||
        bType === 'cathedral';

      buildings.push({
        x: cx,
        y: cy,
        w,
        h,
        angle,
        tall,
        kind,
        polygon: poly,
        name: tags.name,
      });
      continue;
    }

    // 2. Real Coastlines, Water Polygons, Rivers & Canals
    if (tags.natural === 'coastline') {
      coastlineWays.push(simplifyPolyline(pts, 3));
      continue;
    }

    if (
      tags.natural === 'water' ||
      tags.natural === 'bay' ||
      tags.waterway === 'riverbank' ||
      tags.waterway === 'dock' ||
      tags.landuse === 'reservoir' ||
      tags.landuse === 'basin' ||
      tags.landuse === 'harbour'
    ) {
      if (pts.length >= 3) {
        waterPolygons.push(simplifyPolyline(pts, 2.5));
        if (tags.landuse === 'harbour' || tags.waterway === 'dock') {
          harbourCenters.push({
            name: tags.name || 'Seaport Terminal',
            x: pts[0].x,
            y: pts[0].y,
          });
        }
      }
      continue;
    }

    if (tags.waterway === 'river' || tags.waterway === 'canal' || tags.waterway === 'stream') {
      const defaultMeters =
        tags.waterway === 'river' ? 32 : tags.waterway === 'canal' ? 20 : 8;
      const parsedW = parseFloat(tags.width || '') || defaultMeters;
      const pxWidth = Math.max(4, Math.min(90, parsedW / metersPerPixel));
      riverWays.push({
        points: simplifyPolyline(pts, 3),
        width: pxWidth,
        name: tags.name,
      });
      continue;
    }

    // 3. Real Piers, Quays & Breakwaters
    if (
      tags.man_made === 'pier' ||
      tags.man_made === 'quay' ||
      tags.man_made === 'breakwater' ||
      tags.landuse === 'port'
    ) {
      if (isClosed && pts.length >= 4) {
        pierPolygons.push(simplifyPolyline(pts, 2));
      } else {
        pierWays.push({ points: simplifyPolyline(pts, 2), width: 10 });
      }
      harbourCenters.push({
        name: tags.name || 'Port Pier',
        x: pts[Math.floor(pts.length / 2)].x,
        y: pts[Math.floor(pts.length / 2)].y,
      });
      continue;
    }

    // 4. Real Forests & Landuse Zones
    if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.landuse === 'forest') {
      if (pts.length >= 3) {
        forestPolygons.push(simplifyPolyline(pts, 4));
      }
      continue;
    }

    if (tags.landuse === 'industrial') {
      const mid = pts[Math.floor(pts.length / 2)];
      if (mid.x > 80 && mid.x < worldW - 80 && mid.y > 80 && mid.y < worldH - 80) {
        industrialCenters.push({ name: tags.name || 'Industrial Complex', x: mid.x, y: mid.y });
      }
    } else if (tags.landuse === 'military') {
      const mid = pts[Math.floor(pts.length / 2)];
      if (mid.x > 80 && mid.x < worldW - 80 && mid.y > 80 && mid.y < worldH - 80) {
        militaryCenters.push({ name: tags.name || 'Military Garrison', x: mid.x, y: mid.y });
      }
    }

    // 5. Real Runways, Taxiways & Helipads
    if (
      tags.aeroway === 'runway' ||
      tags.aeroway === 'taxiway' ||
      tags.aeroway === 'apron' ||
      tags.aeroway === 'helipad'
    ) {
      const kind = tags.aeroway as OsmAeroway['kind'];
      const widthPx =
        kind === 'runway' ? 24 : kind === 'apron' ? 32 : kind === 'taxiway' ? 10 : 16;
      aeroways.push({
        points: simplifyPolyline(pts, 3),
        kind,
        width: widthPx,
      });
      continue;
    }

    // 6. Real Railways
    if (tags.railway && /^(rail|light_rail|narrow_gauge|tram)$/.test(tags.railway)) {
      // Skip service/spur tracks shorter than 50px unless main rail
      let totalLen = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        totalLen += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      if (tags.service && totalLen < 110) continue;

      const simp = simplifyPolyline(pts, 6);
      const splineId = `osm_rail_${el.id}`;
      splines.push({
        id: splineId,
        kind: 'railroad',
        name: tags.name || tags.operator || 'Rail Line',
        points: simp,
        damagedSegments: new Set(),
      });

      if (tags.bridge && tags.bridge !== 'no' && totalLen >= 18) {
        const midIdx = Math.floor((simp.length - 1) / 2);
        const a = simp[midIdx];
        const b = simp[Math.min(simp.length - 1, midIdx + 1)];
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        if (
          !bridges.some((br) => Math.hypot(br.x - midX, br.y - midY) < 42) &&
          midX > 40 &&
          midX < worldW - 40 &&
          midY > 40 &&
          midY < worldH - 40
        ) {
          bridges.push({
            id: `br_rail_${el.id}`,
            name: tags.name || 'Rail Bridge',
            kind: 'railroad',
            x: midX,
            y: midY,
            angle: Math.atan2(b.y - a.y, b.x - a.x),
            length: Math.max(44, Math.min(130, totalLen)),
            hp: 750,
            maxHp: 750,
            destroyed: false,
            splineId,
            segmentIndex: midIdx,
          });
        }
      }
      continue;
    }

    // 7. Real Highways & City Streets
    if (tags.highway) {
      const hClass = tags.highway;
      const isMajor =
        /^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary)$/.test(
          hClass,
        );
      const simp = simplifyPolyline(pts, isMajor ? 5 : 4);
      let totalLen = 0;
      for (let i = 0; i < simp.length - 1; i++) {
        totalLen += Math.hypot(simp[i + 1].x - simp[i].x, simp[i + 1].y - simp[i].y);
      }

      const widthPx =
        hClass.startsWith('motorway') || hClass.startsWith('trunk')
          ? 12
          : hClass.startsWith('primary')
            ? 10
            : hClass.startsWith('secondary')
              ? 8
              : hClass.startsWith('tertiary')
                ? 6.5
                : 4.5;

      cityStreets.push({
        points: simp,
        width: widthPx,
        highwayClass: hClass,
        name: tags.name || tags.ref,
      });

      if (isMajor && totalLen >= 45) {
        const splineId = `osm_hwy_${el.id}`;
        splines.push({
          id: splineId,
          kind: 'highway',
          name: tags.name || tags.ref || 'Arterial Road',
          points: simp,
          damagedSegments: new Set(),
        });

        if (tags.bridge && tags.bridge !== 'no' && totalLen >= 18) {
          const midIdx = Math.floor((simp.length - 1) / 2);
          const a = simp[midIdx];
          const b = simp[Math.min(simp.length - 1, midIdx + 1)];
          const midX = (a.x + b.x) * 0.5;
          const midY = (a.y + b.y) * 0.5;
          if (
            !bridges.some((br) => Math.hypot(br.x - midX, br.y - midY) < 42) &&
            midX > 40 &&
            midX < worldW - 40 &&
            midY > 40 &&
            midY < worldH - 40
          ) {
            bridges.push({
              id: `br_hwy_${el.id}`,
              name: tags.name || tags.ref || 'Road Bridge',
              kind: 'highway',
              x: midX,
              y: midY,
              angle: Math.atan2(b.y - a.y, b.x - a.x),
              length: Math.max(44, Math.min(130, totalLen)),
              hp: 750,
              maxHp: 750,
              destroyed: false,
              splineId,
              segmentIndex: midIdx,
            });
          }
        }
      }
    }
  }

  // Build real strategic nodes anchored to the actual OpenStreetMap infrastructure
  const initialNodes = buildStrategicNodesFromRealOsm(
    bounds,
    worldW,
    worldH,
    splines,
    cityStreets,
    buildings,
    placeNodes,
    railStations,
    harbourCenters,
    industrialCenters,
    militaryCenters,
    aeroways,
  );

  return {
    bounds,
    fetchedFromOverpass: true,
    stats: {
      buildings: buildings.length,
      roads: cityStreets.length,
      railways: splines.filter((s) => s.kind === 'railroad').length,
      bridges: bridges.length,
      waterways: waterPolygons.length + riverWays.length + coastlineWays.length,
    },
    demGrid,
    splines,
    cityStreets,
    bridges,
    buildings,
    waterPolygons,
    coastlineWays,
    riverWays,
    pierPolygons,
    pierWays,
    forestPolygons,
    aeroways,
    initialNodes,
  };
}

function buildStrategicNodesFromRealOsm(
  bounds: GisBoundingBox,
  worldW: number,
  worldH: number,
  splines: InfraSpline[],
  cityStreets: OsmStreetPolyline[],
  buildings: OsmBuildingFootprint[],
  placeNodes: Array<{ name: string; x: number; y: number; place: string }>,
  railStations: Array<{ name: string; x: number; y: number }>,
  harbourCenters: Array<{ name: string; x: number; y: number }>,
  industrialCenters: Array<{ name: string; x: number; y: number }>,
  militaryCenters: Array<{ name: string; x: number; y: number }>,
  aeroways: OsmAeroway[],
): StrategicNode[] {
  const nodes: StrategicNode[] = [];
  let nextId = 1;

  const isFarEnough = (x: number, y: number, minDist = 230) =>
    x >= 130 &&
    x <= worldW - 130 &&
    y >= 130 &&
    y <= worldH - 130 &&
    nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= minDist);

  const snapToNearestRoadOrBuilding = (targetX: number, targetY: number): Point2D => {
    let bestPt = { x: targetX, y: targetY };
    let bestD = Infinity;
    for (const st of cityStreets) {
      for (const pt of st.points) {
        if (pt.x < 140 || pt.x > worldW - 140 || pt.y < 140 || pt.y > worldH - 140) continue;
        const d = Math.hypot(pt.x - targetX, pt.y - targetY);
        if (d < bestD) {
          bestD = d;
          bestPt = { x: Math.round(pt.x), y: Math.round(pt.y) };
        }
      }
    }
    if (bestD < 450) return bestPt;
    for (const b of buildings) {
      if (b.x < 140 || b.x > worldW - 140 || b.y < 140 || b.y > worldH - 140) continue;
      const d = Math.hypot(b.x - targetX, b.y - targetY);
      if (d < bestD) {
        bestD = d;
        bestPt = { x: Math.round(b.x), y: Math.round(b.y) };
      }
    }
    return bestPt;
  };

  const pushNode = (
    name: string,
    type: StrategicNode['type'],
    faction: Faction,
    x: number,
    y: number,
    incomeMoney: number,
    incomeFuel: number,
    incomeAmmo: number,
    runwayAngle?: number,
  ) => {
    nodes.push({
      id: nextId++,
      name,
      type,
      faction,
      captureProgress: faction === 'blue' ? 100 : faction === 'red' ? -100 : 0,
      capturingFaction: faction,
      x: Math.round(x),
      y: Math.round(y),
      radius: type === 'hq' ? 95 : type === 'city' ? 88 : 76,
      hp: type === 'hq' ? 1600 : 900,
      maxHp: type === 'hq' ? 1600 : 900,
      destroyed: false,
      supplied: true,
      incomeMoney,
      incomeFuel,
      incomeAmmo,
      radarRange:
        type === 'radar_station'
          ? 760
          : type === 'airfield' || type === 'hq'
            ? 460
            : type === 'seaport'
              ? 360
              : 240,
      runwayAngle,
    });
  };

  // 1. Place Blue HQ (South-East / East) & Red HQ (North-West / West) snapped to real road network
  const blueHqPos = snapToNearestRoadOrBuilding(worldW * 0.76, worldH * 0.74);
  const redHqPos = snapToNearestRoadOrBuilding(worldW * 0.24, worldH * 0.26);
  const sectorShort = bounds.title.split('(')[0].trim();

  pushNode(`${sectorShort} South-East HQ`, 'hq', 'blue', blueHqPos.x, blueHqPos.y, 18, 12, 12);
  pushNode(`${sectorShort} North-West HQ`, 'hq', 'red', redHqPos.x, redHqPos.y, 18, 12, 12);

  // 2. Real Railheads (from actual OSM railway stations or railway tracks)
  const railSplines = splines.filter((s) => s.kind === 'railroad');
  let blueRailPt: Point2D | null = null;
  let redRailPt: Point2D | null = null;
  for (const rs of railStations) {
    if (Math.hypot(rs.x - blueHqPos.x, rs.y - blueHqPos.y) < Math.hypot(rs.x - redHqPos.x, rs.y - redHqPos.y)) {
      if (!blueRailPt && isFarEnough(rs.x, rs.y, 180)) blueRailPt = rs;
    } else {
      if (!redRailPt && isFarEnough(rs.x, rs.y, 180)) redRailPt = rs;
    }
  }
  if (!blueRailPt && railSplines.length > 0) {
    const sp = railSplines[0];
    const pt = sp.points[sp.points.length - 1];
    blueRailPt = {
      x: Math.max(150, Math.min(worldW - 150, pt.x)),
      y: Math.max(150, Math.min(worldH - 150, pt.y)),
    };
  }
  if (!redRailPt && railSplines.length > 0) {
    const sp = railSplines[0];
    const pt = sp.points[0];
    redRailPt = {
      x: Math.max(150, Math.min(worldW - 150, pt.x)),
      y: Math.max(150, Math.min(worldH - 150, pt.y)),
    };
  }
  const bRail = blueRailPt || snapToNearestRoadOrBuilding(worldW * 0.84, worldH * 0.84);
  const rRail = redRailPt || snapToNearestRoadOrBuilding(worldW * 0.16, worldH * 0.16);
  pushNode(
    railStations[0]?.name || 'South Railhead Terminal',
    'railhead',
    'blue',
    bRail.x,
    bRail.y,
    8,
    6,
    12,
  );
  pushNode(
    railStations[1]?.name || 'North Railhead Terminal',
    'railhead',
    'red',
    rRail.x,
    rRail.y,
    8,
    6,
    12,
  );

  // 3. Real Airfields (from OSM aeroway=runway/helipad/apron, or forward air strips)
  const runway = aeroways.find((a) => a.kind === 'runway' && a.points.length >= 2);
  if (runway) {
    const a = runway.points[0];
    const b = runway.points[runway.points.length - 1];
    const rAngle = Math.atan2(b.y - a.y, b.x - a.x);
    const rx = Math.max(160, Math.min(worldW - 160, (a.x + b.x) * 0.5));
    const ry = Math.max(160, Math.min(worldH - 160, (a.y + b.y) * 0.5));
    pushNode('Municipal Airfield Runway', 'airfield', 'blue', rx, ry, 8, 8, 10, rAngle);
  } else {
    const bAir = snapToNearestRoadOrBuilding(worldW * 0.82, worldH * 0.55);
    pushNode('East Tactical Airbase', 'airfield', 'blue', bAir.x, bAir.y, 8, 8, 10, -0.2);
  }
  const rAir = snapToNearestRoadOrBuilding(worldW * 0.18, worldH * 0.48);
  pushNode('West Tactical Airbase', 'airfield', 'red', rAir.x, rAir.y, 8, 8, 10, 0.15);

  // 4. Real Seaports / Harbours (if harbour/pier features exist)
  if (harbourCenters.length > 0) {
    const hc1 = harbourCenters[0];
    const bx = Math.max(140, Math.min(worldW - 140, hc1.x));
    const by = Math.max(140, Math.min(worldH - 140, hc1.y));
    if (isFarEnough(bx, by, 170)) {
      pushNode(hc1.name, 'seaport', 'blue', bx, by, 12, 12, 6);
    }
    const hc2 = harbourCenters[Math.min(1, harbourCenters.length - 1)];
    const rx = Math.max(140, Math.min(worldW - 140, hc2.x));
    const ry = Math.max(140, Math.min(worldH - 140, hc2.y + 220));
    if (isFarEnough(rx, ry, 170)) {
      pushNode(`${hc2.name} Berth`, 'seaport', 'red', rx, ry, 12, 12, 6);
    }
  }

  // 5. Real OSM Neighbourhoods, Towns & Districts (`place=*`)
  for (const pl of placeNodes) {
    if (nodes.length >= 16) break;
    if (isFarEnough(pl.x, pl.y, 240)) {
      pushNode(pl.name, 'city', 'neutral', pl.x, pl.y, 16, 4, 4);
    }
  }

  // 6. Real Industrial / Fuel / Munitions Complexes (`landuse=industrial|military` or warehouse clusters)
  for (const ind of industrialCenters) {
    if (nodes.length >= 19) break;
    if (isFarEnough(ind.x, ind.y, 240)) {
      const isFuel = nodes.filter((n) => n.type === 'oil_depot').length < 2;
      pushNode(
        ind.name,
        isFuel ? 'oil_depot' : 'ammo_plant',
        'neutral',
        ind.x,
        ind.y,
        6,
        isFuel ? 18 : 4,
        isFuel ? 4 : 18,
      );
    }
  }

  for (const mil of militaryCenters) {
    if (nodes.length >= 20) break;
    if (isFarEnough(mil.x, mil.y, 240)) {
      pushNode(mil.name, 'ammo_plant', 'neutral', mil.x, mil.y, 8, 6, 18);
    }
  }

  // 7. Fill remaining tactical sectors at real road/building intersections so every map has ~14-16 rich objectives
  const candidateTargets: Array<{ x: number; y: number; type: StrategicNode['type']; label: string }> = [
    { x: worldW * 0.5, y: worldH * 0.5, type: 'city', label: 'Central District Junction' },
    { x: worldW * 0.52, y: worldH * 0.28, type: 'radar_station', label: 'North Ridge Overwatch Radar' },
    { x: worldW * 0.36, y: worldH * 0.64, type: 'oil_depot', label: 'Fuel Storage Terminal' },
    { x: worldW * 0.64, y: worldH * 0.36, type: 'ammo_plant', label: 'Logistics Munitions Depot' },
    { x: worldW * 0.35, y: worldH * 0.38, type: 'city', label: 'West Crossroad Sector' },
    { x: worldW * 0.65, y: worldH * 0.62, type: 'city', label: 'East Crossroad Sector' },
  ];

  for (const cand of candidateTargets) {
    if (nodes.length >= 16) break;
    const snapped = snapToNearestRoadOrBuilding(cand.x, cand.y);
    if (isFarEnough(snapped.x, snapped.y, 220)) {
      const namedBldg = buildings.find(
        (b) => b.name && Math.hypot(b.x - snapped.x, b.y - snapped.y) < 180,
      );
      pushNode(
        namedBldg?.name || cand.label,
        cand.type,
        'neutral',
        snapped.x,
        snapped.y,
        cand.type === 'city' ? 16 : 6,
        cand.type === 'oil_depot' ? 18 : 4,
        cand.type === 'ammo_plant' ? 18 : 4,
      );
    }
  }

  return nodes;
}
