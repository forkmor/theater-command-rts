import type { Bridge, InfraSpline, LandcoverType, Point2D, StrategicNode } from '../core/types';
import { SeededRNG } from '../core/rng';
import type { OsmAeroway, OsmSectorData } from './osmBrowserLoader';
import {
  BALTIC_COASTLINE_LON_BY_LAT,
  GIS_BOUNDS,
  REAL_BORDERS,
  REAL_BRIDGES,
  REAL_ELEVATION_FEATURES,
  REAL_RIVERS,
  REAL_ROUTES,
  REAL_SETTLEMENTS,
  SPIT_POLYGONS,
  WATER_POLYGONS,
} from './suwalkiGeoData';

export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2400;
export const HM_STEP = 8;
export const HM_COLS = Math.floor(WORLD_WIDTH / HM_STEP) + 1; // 401
export const HM_ROWS = Math.floor(WORLD_HEIGHT / HM_STEP) + 1; // 301

let activeOsmSector: OsmSectorData | null = null;

export function setActiveOsmSector(sector: OsmSectorData | null): void {
  activeOsmSector = sector;
}

export function getActiveOsmSector(): OsmSectorData | null {
  return activeOsmSector;
}

export function latLonToWorld(lat: number, lon: number): Point2D {
  const b = activeOsmSector ? activeOsmSector.bounds : GIS_BOUNDS;
  const nx = (lon - b.minLon) / (b.maxLon - b.minLon);
  const ny = (b.maxLat - lat) / (b.maxLat - b.minLat);
  return {
    x: Math.round(nx * WORLD_WIDTH),
    y: Math.round(ny * WORLD_HEIGHT),
  };
}

export function worldToLatLon(x: number, y: number): { lat: number; lon: number } {
  const b = activeOsmSector ? activeOsmSector.bounds : GIS_BOUNDS;
  const lon = b.minLon + (x / WORLD_WIDTH) * (b.maxLon - b.minLon);
  const lat = b.maxLat - (y / WORLD_HEIGHT) * (b.maxLat - b.minLat);
  return { lat, lon };
}

function pointInPolygon(lat: number, lon: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0];
    const xi = poly[i][1];
    const yj = poly[j][0];
    const xj = poly[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-4) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function interpolateCoastlineLon(lat: number): number {
  const pts = BALTIC_COASTLINE_LON_BY_LAT;
  if (lat <= pts[0][0]) return pts[0][1];
  if (lat >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [lat0, lon0] = pts[i];
    const [lat1, lon1] = pts[i + 1];
    if (lat >= lat0 && lat <= lat1) {
      const t = (lat - lat0) / (lat1 - lat0);
      return lon0 + (lon1 - lon0) * t;
    }
  }
  return 20.0;
}

export interface UrbanBuildingBlock {
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

export class SuwalkiMap {
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;
  readonly elevations: Float32Array;
  readonly landcover: Uint8Array; // 0=deep_water, 1=coastal_water, 2=beach, 3=plains, 4=forest, 5=urban, 6=paved
  readonly roadMask: Uint8Array; // 0=none, 1=highway, 2=railroad, 3=both
  readonly splines: InfraSpline[] = [];
  readonly bridges: Bridge[] = [];
  readonly initialNodes: StrategicNode[] = [];
  readonly borders: Array<{ name: string; points: Point2D[] }> = [];
  readonly cityStreets: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width?: number;
    highwayClass?: string;
  }> = [];
  readonly aeroways: OsmAeroway[] = [];
  readonly treePositions: Array<{ x: number; y: number; kind: number }> = [];
  readonly urbanBlocks: UrbanBuildingBlock[] = [];
  readonly isLiveOsm: boolean;

  constructor(seed = 541022) {
    this.elevations = new Float32Array(HM_COLS * HM_ROWS);
    this.landcover = new Uint8Array(HM_COLS * HM_ROWS);
    this.roadMask = new Uint8Array(HM_COLS * HM_ROWS);

    if (activeOsmSector) {
      this.isLiveOsm = true;
      this.setupFromLiveOsmSector(activeOsmSector, seed);
    } else {
      this.isLiveOsm = false;
      this.setupRealGisVectors();
      this.generateRealGisTerrain(seed);
    }
  }

  private setupFromLiveOsmSector(sector: OsmSectorData, seed: number): void {
    const rng = new SeededRNG(seed);

    for (const sp of sector.splines) {
      this.splines.push({
        id: sp.id,
        kind: sp.kind,
        name: sp.name,
        points: sp.points.map((p) => ({ x: p.x, y: p.y })),
        damagedSegments: new Set(),
      });
    }

    for (const br of sector.bridges) {
      this.bridges.push({ ...br });
    }

    for (const nd of sector.initialNodes) {
      this.initialNodes.push({ ...nd });
    }

    for (const b of sector.buildings) {
      this.urbanBlocks.push({ ...b });
    }

    for (const aw of sector.aeroways) {
      this.aeroways.push(aw);
    }

    for (const st of sector.cityStreets) {
      for (let i = 0; i < st.points.length - 1; i++) {
        const a = st.points[i];
        const b = st.points[i + 1];
        this.cityStreets.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          width: st.width,
          highwayClass: st.highwayClass,
        });
      }
    }

    // Rasterize real OSM water polygons, rivers, coastlines, piers, and forests at grid resolution (401x301)
    let waterPixels: Uint8ClampedArray | null = null;
    let pierPixels: Uint8ClampedArray | null = null;
    let forestPixels: Uint8ClampedArray | null = null;

    if (typeof document !== 'undefined') {
      const makeLayer = (draw: (ctx: CanvasRenderingContext2D) => void) => {
        const c = document.createElement('canvas');
        c.width = HM_COLS;
        c.height = HM_ROWS;
        const ctx = c.getContext('2d')!;
        ctx.scale(1 / HM_STEP, 1 / HM_STEP);
        draw(ctx);
        return ctx.getImageData(0, 0, HM_COLS, HM_ROWS).data;
      };

      waterPixels = makeLayer((ctx) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 1. Coastline polygons (in OSM, sea is on the right-hand side of directed coastline ways)
        for (const way of sector.coastlineWays) {
          if (way.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(way[0].x, way[0].y);
          for (let i = 1; i < way.length; i++) {
            ctx.lineTo(way[i].x, way[i].y);
          }
          // Extend to the right-hand side of the coastline vector to close the sea basin
          const first = way[0];
          const last = way[way.length - 1];
          const dx = last.x - first.x;
          const dy = last.y - first.y;
          // Right-hand normal in screen coordinates (x right, y down) is (-dy, dx)
          const rx = -dy;
          const ry = dx;
          const cornerX = rx >= 0 ? WORLD_WIDTH + 200 : -200;
          const cornerY = ry >= 0 ? WORLD_HEIGHT + 200 : -200;
          ctx.lineTo(last.x + (rx >= 0 ? 400 : -400), last.y);
          ctx.lineTo(cornerX, cornerY);
          ctx.lineTo(first.x + (rx >= 0 ? 400 : -400), first.y);
          ctx.closePath();
          ctx.fill();
        }

        // 2. Water polygons (lakes, lagoons, riverbanks, harbours)
        for (const poly of sector.waterPolygons) {
          if (poly.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x, poly[i].y);
          }
          ctx.closePath();
          ctx.fill();
        }

        // 3. Rivers & canals stroked at their real meter width
        for (const rv of sector.riverWays) {
          if (rv.points.length < 2) continue;
          ctx.lineWidth = Math.max(10, rv.width);
          ctx.beginPath();
          ctx.moveTo(rv.points[0].x, rv.points[0].y);
          for (let i = 1; i < rv.points.length; i++) {
            ctx.lineTo(rv.points[i].x, rv.points[i].y);
          }
          ctx.stroke();
        }
      });

      pierPixels = makeLayer((ctx) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        for (const poly of sector.pierPolygons) {
          if (poly.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
          ctx.closePath();
          ctx.fill();
        }
        for (const pw of sector.pierWays) {
          if (pw.points.length < 2) continue;
          ctx.lineWidth = Math.max(12, pw.width);
          ctx.beginPath();
          ctx.moveTo(pw.points[0].x, pw.points[0].y);
          for (let i = 1; i < pw.points.length; i++) ctx.lineTo(pw.points[i].x, pw.points[i].y);
          ctx.stroke();
        }
      });

      forestPixels = makeLayer((ctx) => {
        ctx.fillStyle = '#ffffff';
        for (const poly of sector.forestPolygons) {
          if (poly.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
          ctx.closePath();
          ctx.fill();
        }
      });
    }

    // Evaluate elevation & landcover across the heightmap grid
    const dem = sector.demGrid;
    let minDem = 0;
    if (dem && dem.values.length > 0) {
      minDem = Math.min(...dem.values);
    }

    for (let r = 0; r < HM_ROWS; r++) {
      const wy = r * HM_STEP;
      for (let c = 0; c < HM_COLS; c++) {
        const wx = c * HM_STEP;
        const idx = r * HM_COLS + c;
        const pIdx = idx * 4;

        const isPier = pierPixels ? pierPixels[pIdx] > 90 : false;
        const isWater = !isPier && (waterPixels ? waterPixels[pIdx] > 90 : false);
        const isForest = !isWater && !isPier && (forestPixels ? forestPixels[pIdx] > 90 : false);

        if (isWater) {
          // Check if adjacent to land for coastal water vs deep water
          let nearShore = false;
          if (waterPixels) {
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const nr = Math.max(0, Math.min(HM_ROWS - 1, r + dr));
                const nc = Math.max(0, Math.min(HM_COLS - 1, c + dc));
                if (waterPixels[(nr * HM_COLS + nc) * 4] <= 90) {
                  nearShore = true;
                  break;
                }
              }
              if (nearShore) break;
            }
          }
          this.elevations[idx] = nearShore ? -3.5 : -9.5;
          this.landcover[idx] = nearShore ? 1 : 0;
        } else if (isPier) {
          this.elevations[idx] = 3.5;
          this.landcover[idx] = 6;
        } else {
          // Bilinearly interpolate real DEM grid (relative to sector base + 8m above water)
          let elev = 12 + Math.sin(wx * 0.0025) * 4 + Math.cos(wy * 0.0025) * 4;
          if (dem && dem.values.length === dem.rows * dem.cols) {
            const gx = (c / (HM_COLS - 1)) * (dem.cols - 1);
            const gy = (r / (HM_ROWS - 1)) * (dem.rows - 1);
            const x0 = Math.floor(gx);
            const y0 = Math.floor(gy);
            const x1 = Math.min(dem.cols - 1, x0 + 1);
            const y1 = Math.min(dem.rows - 1, y0 + 1);
            const fx = gx - x0;
            const fy = gy - y0;
            const v00 = dem.values[y0 * dem.cols + x0];
            const v10 = dem.values[y0 * dem.cols + x1];
            const v01 = dem.values[y1 * dem.cols + x0];
            const v11 = dem.values[y1 * dem.cols + x1];
            const rawElev =
              (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy;
            elev = Math.max(3, rawElev - Math.max(0, minDem - 8));
          }
          this.elevations[idx] = elev;
          this.landcover[idx] = isForest ? 4 : 3;
        }
      }
    }

    // Stamp urban landcover under real OSM buildings
    for (const b of this.urbanBlocks) {
      const c = Math.max(0, Math.min(HM_COLS - 1, Math.round(b.x / HM_STEP)));
      const r = Math.max(0, Math.min(HM_ROWS - 1, Math.round(b.y / HM_STEP)));
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = Math.max(0, Math.min(HM_ROWS - 1, r + dr));
          const nc = Math.max(0, Math.min(HM_COLS - 1, c + dc));
          const idx = nr * HM_COLS + nc;
          if (this.elevations[idx] >= 0) {
            this.landcover[idx] = 5;
          }
        }
      }
    }

    // Stamp roadMask along all major highways, railroads, and local streets
    for (const sp of this.splines) {
      const bit = sp.kind === 'highway' ? 1 : 2;
      for (let i = 0; i < sp.points.length - 1; i++) {
        const a = sp.points[i];
        const b = sp.points[i + 1];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.ceil(dist / 4);
        for (let s = 0; s <= steps; s++) {
          const t = steps > 0 ? s / steps : 0;
          const sx = a.x + (b.x - a.x) * t;
          const sy = a.y + (b.y - a.y) * t;
          const gc = Math.max(0, Math.min(HM_COLS - 1, Math.round(sx / HM_STEP)));
          const gr = Math.max(0, Math.min(HM_ROWS - 1, Math.round(sy / HM_STEP)));
          this.roadMask[gr * HM_COLS + gc] |= bit;
        }
      }
    }

    for (const st of this.cityStreets) {
      const dist = Math.hypot(st.x2 - st.x1, st.y2 - st.y1);
      const steps = Math.ceil(dist / 5);
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const sx = st.x1 + (st.x2 - st.x1) * t;
        const sy = st.y1 + (st.y2 - st.y1) * t;
        const gc = Math.max(0, Math.min(HM_COLS - 1, Math.round(sx / HM_STEP)));
        const gr = Math.max(0, Math.min(HM_ROWS - 1, Math.round(sy / HM_STEP)));
        this.roadMask[gr * HM_COLS + gc] |= 1;
      }
    }

    // Scatter pixel trees in real OSM forest/park polygons
    for (let r = 2; r < HM_ROWS - 2; r += 2) {
      for (let c = 2; c < HM_COLS - 2; c += 2) {
        const idx = r * HM_COLS + c;
        if (this.landcover[idx] === 4 && this.roadMask[idx] === 0 && rng.next() < 0.62) {
          this.treePositions.push({
            x: c * HM_STEP + rng.range(-4, 4),
            y: r * HM_STEP + rng.range(-4, 4),
            kind: rng.int(0, 2),
          });
        }
      }
    }
  }

  private setupRealGisVectors(): void {
    // 1. Project International Borders
    for (const b of REAL_BORDERS) {
      this.borders.push({
        name: b.name,
        points: b.points.map(([lat, lon]) => latLonToWorld(lat, lon)),
      });
    }

    // 2. Project Real Highways & Railroads (subdividing long legs into ~130px tactical segments)
    for (const route of REAL_ROUTES) {
      const rawPts = route.points.map(([lat, lon]) => latLonToWorld(lat, lon));
      const subdivided: Point2D[] = [rawPts[0]];
      for (let i = 0; i < rawPts.length - 1; i++) {
        const a = rawPts[i];
        const b = rawPts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(len / 135));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          subdivided.push({
            x: Math.round(a.x + (b.x - a.x) * t),
            y: Math.round(a.y + (b.y - a.y) * t),
          });
        }
      }
      this.splines.push({
        id: route.id,
        kind: route.kind,
        name: route.name,
        points: subdivided,
        damagedSegments: new Set(),
      });
    }

    // 3. Project Real River Bridges & snap each bridge to its route's nearest segment
    for (const brDef of REAL_BRIDGES) {
      const pos = latLonToWorld(brDef.lat, brDef.lon);
      const sp = this.splines.find((s) => s.id === brDef.routeId) ?? this.splines[0];
      let bestSeg = 0;
      let bestD = Infinity;
      let segAngle = 0;
      for (let i = 0; i < sp.points.length - 1; i++) {
        const a = sp.points[i];
        const b = sp.points[i + 1];
        const d = distToSegment(pos.x, pos.y, a.x, a.y, b.x, b.y);
        if (d < bestD) {
          bestD = d;
          bestSeg = i;
          segAngle = Math.atan2(b.y - a.y, b.x - a.x);
        }
      }

      // Snap bridge center onto the route segment midpoint so road/rail aligns seamlessly
      const sa = sp.points[bestSeg];
      const sb = sp.points[bestSeg + 1];
      const bx = Math.round((sa.x + sb.x) * 0.5);
      const by = Math.round((sa.y + sb.y) * 0.5);

      this.bridges.push({
        id: brDef.id,
        name: brDef.name,
        kind: brDef.kind,
        x: bx,
        y: by,
        angle: segAngle,
        length: brDef.length,
        hp: brDef.kind === 'railroad' ? 650 : 550,
        maxHp: brDef.kind === 'railroad' ? 650 : 550,
        destroyed: false,
        splineId: sp.id,
        segmentIndex: bestSeg,
      });
    }

    // 4. Project Real Cities, Military Bases, Seaports, Airbases & Depots
    let nid = 1;
    for (const s of REAL_SETTLEMENTS) {
      const pos = latLonToWorld(s.lat, s.lon);
      const radius =
        s.type === 'airfield' || s.type === 'seaport'
          ? 62
          : s.populationRank === 1
            ? 56
            : s.populationRank === 2
              ? 48
              : 42;

      this.initialNodes.push({
        id: nid++,
        name: s.name,
        type: s.type,
        faction: s.faction,
        captureProgress: s.faction === 'blue' ? 100 : s.faction === 'red' ? -100 : 0,
        capturingFaction: 'neutral',
        x: pos.x,
        y: pos.y,
        radius,
        hp: s.type === 'hq' ? 1850 : s.populationRank === 1 ? 1150 : 880,
        maxHp: s.type === 'hq' ? 1850 : s.populationRank === 1 ? 1150 : 880,
        destroyed: false,
        supplied: s.faction !== 'neutral',
        incomeMoney: s.incomeMoney,
        incomeFuel: s.incomeFuel,
        incomeAmmo: s.incomeAmmo,
        radarRange: s.radarRange,
        runwayAngle:
          s.runwayHeadingDeg !== undefined ? ((s.runwayHeadingDeg - 90) * Math.PI) / 180 : undefined,
      });
    }
  }

  private generateRealGisTerrain(seed: number): void {
    const rng = new SeededRNG(seed);

    // Pre-project river polylines into world space for fast distance queries
    const projectedRivers = REAL_RIVERS.map((rv) => ({
      name: rv.name,
      halfWidth: rv.widthMeters * 0.5,
      depth: rv.depthMeters,
      pts: rv.points.map(([lat, lon]) => latLonToWorld(lat, lon)),
    }));

    // 1. Evaluate GIS Bathymetry & SRTM Elevation across the grid
    for (let r = 0; r < HM_ROWS; r++) {
      const wy = r * HM_STEP;
      for (let c = 0; c < HM_COLS; c++) {
        const wx = c * HM_STEP;
        const idx = r * HM_COLS + c;
        const { lat, lon } = worldToLatLon(wx, wy);

        const coastLon = interpolateCoastlineLon(lat);
        let elev = 16;

        // Check if on Curonian Spit or Vistula Spit barrier islands
        const onSpit = SPIT_POLYGONS.find((sp) => pointInPolygon(lat, lon, sp.polygon));

        if (onSpit) {
          elev = onSpit.elevMeters;
        } else if (lon < coastLon) {
          // Open Baltic Sea / Gdansk Bay bathymetry
          const seaDistDeg = coastLon - lon;
          elev = -Math.min(28, 3.5 + seaDistDeg * 75);
        } else {
          // Check Lagoons & Major Lakes (Curonian Lagoon, Vistula Lagoon, Wigry, Vistytis, Mamry, Kaunas Reservoir)
          const inWaterPoly = WATER_POLYGONS.find((wp) => pointInPolygon(lat, lon, wp.polygon));
          if (inWaterPoly) {
            elev = inWaterPoly.depthMeters;
          } else {
            // Base continental elevation + SRTM moraine ridges & highlands
            elev =
              12 +
              (lat - 53.55) * 2.5 +
              (lon - 20.0) * 4.2 +
              Math.sin(wx * 0.006 + wy * 0.005) * 6 +
              Math.cos(wx * 0.014 - wy * 0.012) * 4;

            for (const feat of REAL_ELEVATION_FEATURES) {
              const dLat = (lat - feat.lat) / feat.radiusLat;
              const dLon = (lon - feat.lon) / feat.radiusLon;
              const d2 = dLat * dLat + dLon * dLon;
              if (d2 < 3.4) {
                elev += (feat.peakMeters - 18) * Math.exp(-d2 * 1.2);
              }
            }
          }
        }

        // Carve Real Rivers (Neman, Pregolya, Sesupe, Augustow Canal, Minija)
        if (elev > -8) {
          for (const rv of projectedRivers) {
            for (let i = 0; i < rv.pts.length - 1; i++) {
              const a = rv.pts[i];
              const b = rv.pts[i + 1];
              const d = distToSegment(wx, wy, a.x, a.y, b.x, b.y);
              if (d < rv.halfWidth + 26) {
                const t = Math.max(0, 1 - d / (rv.halfWidth + 26));
                const riverElev = d <= rv.halfWidth ? rv.depth : rv.depth * (1 - (d - rv.halfWidth) / 26);
                elev = Math.min(elev, elev * (1 - t) + riverElev * t);
              }
            }
          }
        }

        // Ensure Seaports (Klaipeda & Baltiysk) have a dry dock apron AND deepwater harbor channel on their west/seaward side
        for (const node of this.initialNodes) {
          const d = Math.hypot(wx - node.x, wy - node.y);
          if (node.type === 'seaport') {
            if (d < 46 && wx >= node.x - 12) {
              elev = 4.5; // Seaport dockyard apron
            } else if (d < 130 && wx < node.x - 12) {
              elev = -14; // Deepwater naval channel
            }
          } else if (d < node.radius + 26) {
            const targetFlat =
              node.type === 'radar_station' ? Math.max(96, elev) : Math.max(9, Math.min(54, elev));
            const blend = Math.max(0, Math.min(1, (node.radius + 26 - d) / 26));
            elev = elev * (1 - blend) + targetFlat * blend;
          }
        }

        this.elevations[idx] = elev;

        // Classify Landcover (with real forest belts: Augustow Primeval Forest, Rominta/Romincka Forest, Kazlu Ruda Forest, Dzukija National Park)
        if (elev < -10) {
          this.landcover[idx] = 0; // deep_water
        } else if (elev < 0) {
          this.landcover[idx] = 1; // coastal_water / lagoon / river
        } else if (elev < 3.0) {
          this.landcover[idx] = 2; // beach / spit dunes / riverbank
        } else {
          // Real major forest zones + natural boreal/mixed patches
          const inAugustowForest =
            lat > 53.78 && lat < 54.08 && lon > 22.95 && lon < 23.65;
          const inRominckaForest =
            lat > 54.31 && lat < 54.48 && lon > 22.35 && lon < 22.72;
          const inKazluRudaForest =
            lat > 54.68 && lat < 54.88 && lon > 23.32 && lon < 23.75;
          const inDzukijaForest =
            lat > 53.95 && lat < 54.28 && lon > 23.8 && lon < 24.28;

          const forestNoise =
            Math.sin(wx * 0.015 + 1.1) * Math.cos(wy * 0.015 - 0.6) +
            0.5 * Math.sin(wx * 0.033 - wy * 0.029);

          const isForest =
            inAugustowForest ||
            inRominckaForest ||
            inKazluRudaForest ||
            inDzukijaForest ||
            (forestNoise > 0.28 && elev < 95);

          this.landcover[idx] = isForest ? 4 : 3;
        }
      }
    }

    // 2. Stamp Real Highway & Railroad Corridors into roadMask
    for (const spline of this.splines) {
      const bit = spline.kind === 'highway' ? 1 : 2;
      for (let i = 0; i < spline.points.length - 1; i++) {
        const a = spline.points[i];
        const b = spline.points[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.ceil(segLen / 4);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t;
          const gc = Math.round(px / HM_STEP);
          const gr = Math.round(py / HM_STEP);
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const rr = gr + dr;
              const cc = gc + dc;
              if (rr >= 0 && rr < HM_ROWS && cc >= 0 && cc < HM_COLS) {
                const idx = rr * HM_COLS + cc;
                if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) {
                  this.roadMask[idx] |= bit;
                }
                if (this.landcover[idx] === 4) {
                  this.landcover[idx] = 3; // Clear forest along real highways & railroads
                }
              }
            }
          }
        }
      }
    }

    // 3. Generate Real Urban Street Grids & Building Footprints at Every Real City, Port, Airbase & Town
    for (const s of REAL_SETTLEMENTS) {
      const center = latLonToWorld(s.lat, s.lon);
      const cityRng = new SeededRNG(s.buildingClusterSeed);
      const urbanSpread = s.populationRank === 1 ? 92 : s.populationRank === 2 ? 64 : 44;

      // Stamp urban / industrial pavement
      const gr = Math.round(center.y / HM_STEP);
      const gc = Math.round(center.x / HM_STEP);
      const radCells = Math.ceil(urbanSpread / HM_STEP);
      for (let dr = -radCells; dr <= radCells; dr++) {
        for (let dc = -radCells; dc <= radCells; dc++) {
          const rr = gr + dr;
          const cc = gc + dc;
          if (rr >= 0 && rr < HM_ROWS && cc >= 0 && cc < HM_COLS) {
            if (dr * dr + dc * dc <= radCells * radCells) {
              const idx = rr * HM_COLS + cc;
              if (this.elevations[idx] >= 0.5) {
                this.landcover[idx] = s.type === 'city' || s.type === 'hq' ? 5 : 6;
              }
            }
          }
        }
      }

      // Generate secondary city street grid lines
      const streetCount = s.populationRank === 1 ? 4 : s.populationRank === 2 ? 3 : 2;
      const gridStep = 26;
      for (let i = -streetCount; i <= streetCount; i++) {
        const offset = i * gridStep;
        const halfSpan = streetCount * gridStep;
        if (this.getElevation(center.x + offset, center.y) > 1) {
          this.cityStreets.push({
            x1: center.x + offset,
            y1: center.y - halfSpan,
            x2: center.x + offset,
            y2: center.y + halfSpan,
          });
        }
        if (this.getElevation(center.x, center.y + offset) > 1) {
          this.cityStreets.push({
            x1: center.x - halfSpan,
            y1: center.y + offset,
            x2: center.x + halfSpan,
            y2: center.y + offset,
          });
        }
      }

      // Generate real urban & industrial building footprints in city blocks
      for (let bxIdx = -streetCount; bxIdx < streetCount; bxIdx++) {
        for (let byIdx = -streetCount; byIdx < streetCount; byIdx++) {
          // Leave central plaza clear for the Strategic Node icon itself
          if (bxIdx >= -1 && bxIdx <= 0 && byIdx >= -1 && byIdx <= 0) continue;

          const blockCenterX = center.x + (bxIdx + 0.5) * gridStep + cityRng.range(-3, 3);
          const blockCenterY = center.y + (byIdx + 0.5) * gridStep + cityRng.range(-3, 3);
          const distFromNode = Math.hypot(blockCenterX - center.x, blockCenterY - center.y);
          if (distFromNode > urbanSpread + 12) continue;
          if (this.getElevation(blockCenterX, blockCenterY) < 1.5) continue;

          let kind: UrbanBuildingBlock['kind'] = 'residential';
          if (s.type === 'oil_depot') kind = cityRng.next() > 0.4 ? 'silo' : 'industrial';
          else if (s.type === 'ammo_plant' || s.type === 'railhead') kind = 'warehouse';
          else if (s.type === 'airfield') kind = 'hangar';
          else if (s.type === 'seaport') kind = 'warehouse';
          else if (distFromNode < 46) kind = 'civic';
          else if (cityRng.next() > 0.72) kind = 'industrial';

          this.urbanBlocks.push({
            x: blockCenterX,
            y: blockCenterY,
            w: cityRng.int(12, 20),
            h: cityRng.int(10, 18),
            angle: cityRng.next() > 0.5 ? 0 : Math.PI * 0.5,
            tall: s.populationRank === 1 && distFromNode < 58 && cityRng.next() > 0.35,
            kind,
          });
        }
      }
    }

    // Also add dense urban district for Kaliningrad City Proper (54.71°N, 20.50°E) along the Pregolya River!
    const kgd = latLonToWorld(54.71, 20.5);
    const kgdRng = new SeededRNG(777);
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const bx = kgd.x + i * 24;
        const by = kgd.y + j * 24;
        if (this.getElevation(bx, by) > 1.5) {
          this.urbanBlocks.push({
            x: bx,
            y: by,
            w: kgdRng.int(13, 21),
            h: kgdRng.int(11, 18),
            angle: 0,
            tall: Math.hypot(i, j) <= 2,
            kind: Math.hypot(i, j) <= 1 ? 'civic' : 'residential',
          });
        }
      }
    }

    // 4. Scatter Pixel Trees across Forest Belts
    for (let r = 2; r < HM_ROWS - 2; r += 2) {
      for (let c = 2; c < HM_COLS - 2; c += 2) {
        const idx = r * HM_COLS + c;
        if (this.landcover[idx] === 4 && this.roadMask[idx] === 0 && rng.next() < 0.65) {
          const tx = c * HM_STEP + rng.range(-5, 5);
          const ty = r * HM_STEP + rng.range(-5, 5);
          this.treePositions.push({
            x: tx,
            y: ty,
            kind: rng.int(0, 2),
          });
        }
      }
    }
  }

  /** Smooth bilinearly-interpolated terrain height in meters at continuous (x, y) */
  getElevation(x: number, y: number): number {
    const cx = Math.max(0, Math.min(WORLD_WIDTH - 0.01, x)) / HM_STEP;
    const cy = Math.max(0, Math.min(WORLD_HEIGHT - 0.01, y)) / HM_STEP;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(HM_COLS - 1, x0 + 1);
    const y1 = Math.min(HM_ROWS - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;

    const h00 = this.elevations[y0 * HM_COLS + x0];
    const h10 = this.elevations[y0 * HM_COLS + x1];
    const h01 = this.elevations[y1 * HM_COLS + x0];
    const h11 = this.elevations[y1 * HM_COLS + x1];

    const top = h00 + (h10 - h00) * fx;
    const bot = h01 + (h11 - h01) * fx;
    return top + (bot - top) * fy;
  }

  getSlope(x: number, y: number): number {
    const d = 8;
    const hx = this.getElevation(x + d, y) - this.getElevation(x - d, y);
    const hy = this.getElevation(x, y + d) - this.getElevation(x, y - d);
    return Math.hypot(hx, hy) / (2 * d);
  }

  getLandcover(x: number, y: number): LandcoverType {
    const c = Math.max(0, Math.min(HM_COLS - 1, Math.round(x / HM_STEP)));
    const r = Math.max(0, Math.min(HM_ROWS - 1, Math.round(y / HM_STEP)));
    const code = this.landcover[r * HM_COLS + c];
    switch (code) {
      case 0:
        return 'deep_water';
      case 1:
        return 'coastal_water';
      case 2:
        return 'beach';
      case 4:
        return 'forest';
      case 5:
        return 'urban';
      case 6:
        return 'paved';
      default:
        return 'plains';
    }
  }

  getRoadMaskAt(x: number, y: number): number {
    const c = Math.max(0, Math.min(HM_COLS - 1, Math.round(x / HM_STEP)));
    const r = Math.max(0, Math.min(HM_ROWS - 1, Math.round(y / HM_STEP)));
    return this.roadMask[r * HM_COLS + c];
  }

  /** Checks if (x, y) lies on an intact rotated bridge deck over a river */
  getIntactBridgeAt(x: number, y: number, bridges: Bridge[]): Bridge | null {
    for (const br of bridges) {
      if (br.destroyed) continue;
      const dx = x - br.x;
      const dy = y - br.y;
      const cos = Math.cos(-br.angle);
      const sin = Math.sin(-br.angle);
      const localX = Math.abs(dx * cos - dy * sin);
      const localY = Math.abs(dx * sin + dy * cos);
      if (localX <= br.length * 0.58 && localY <= 22) {
        return br;
      }
    }
    return null;
  }

  isPassableForLand(x: number, y: number, bridges: Bridge[], amphibious: boolean): boolean {
    if (x < 24 || x > WORLD_WIDTH - 24 || y < 24 || y > WORLD_HEIGHT - 24) return false;
    if (this.getIntactBridgeAt(x, y, bridges)) return true;
    // Allow transit along intact causeways/bridges where roadMask is present over minor rivers
    if (this.getRoadMaskAt(x, y) > 0 && this.getElevation(x, y) > -9.5) {
      const nearDestroyedBridge = bridges.some(
        (b) => b.destroyed && Math.hypot(x - b.x, y - b.y) < b.length * 0.55,
      );
      if (!nearDestroyedBridge) return true;
    }
    const elev = this.getElevation(x, y);
    if (amphibious) {
      return elev > -11.5;
    }
    return elev >= -0.4;
  }

  isPassableForShip(x: number, y: number): boolean {
    if (x < 24 || x > WORLD_WIDTH - 24 || y < 24 || y > WORLD_HEIGHT - 24) return false;
    return this.getElevation(x, y) <= -2.0;
  }

  findNearestDeepWater(x: number, y: number): Point2D {
    for (let rad = 25; rad <= 220; rad += 18) {
      for (let a = 0; a < 16; a++) {
        const ang = Math.PI + ((a - 8) / 16) * Math.PI * 1.5; // prefer West/Baltic side first
        const tx = Math.max(40, Math.min(WORLD_WIDTH - 40, x + Math.cos(ang) * rad));
        const ty = Math.max(40, Math.min(WORLD_HEIGHT - 40, y + Math.sin(ang) * rad));
        if (this.isPassableForShip(tx, ty)) {
          return { x: tx, y: ty };
        }
      }
    }
    return { x: Math.max(60, x - 75), y };
  }

  checkLineOfSight3D(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    clearance = 2.0,
  ): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 16) return true;
    const steps = Math.min(48, Math.max(6, Math.ceil(dist / 22)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = x1 + (x2 - x1) * t;
      const sy = y1 + (y2 - y1) * t;
      const rayZ = z1 + (z2 - z1) * t;
      const terrZ = Math.max(0, this.getElevation(sx, sy));
      if (terrZ + clearance > rayZ) {
        return false;
      }
    }
    return true;
  }

  sampleSplineByDistance(
    spline: InfraSpline,
    dist: number,
    reverse: boolean,
  ): { x: number; y: number; angle: number; totalLength: number; blocked: boolean } {
    const pts: Point2D[] = reverse ? [...spline.points].reverse() : spline.points;
    let total = 0;
    const segLens: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segLens.push(l);
      total += l;
    }

    const clamped = Math.max(0, Math.min(total, dist));
    let acc = 0;
    for (let i = 0; i < segLens.length; i++) {
      const origSegIdx = reverse ? pts.length - 2 - i : i;
      const blocked = spline.damagedSegments.has(origSegIdx);
      if (clamped <= acc + segLens[i] || i === segLens.length - 1) {
        const localT = segLens[i] > 0 ? (clamped - acc) / segLens[i] : 0;
        const a = pts[i];
        const b = pts[i + 1];
        return {
          x: a.x + (b.x - a.x) * localT,
          y: a.y + (b.y - a.y) * localT,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
          totalLength: total,
          blocked,
        };
      }
      acc += segLens[i];
    }

    return { x: pts[0].x, y: pts[0].y, angle: 0, totalLength: total, blocked: false };
  }
}
