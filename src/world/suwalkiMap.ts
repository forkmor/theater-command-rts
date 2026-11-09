import type { Bridge, InfraSpline, LandcoverType, Point2D, StrategicNode } from '../core/types';
import { SeededRNG } from '../core/rng';
import {
  projectLatLon,
  REAL_WORLD_SECTOR_PRESETS,
  unprojectWorldToLatLon,
  type OsmAeroway,
  type OsmSectorData,
} from './osmBrowserLoader';

export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2400;
export const HM_STEP = 8;
export const HM_COLS = Math.floor(WORLD_WIDTH / HM_STEP) + 1; // 401
export const HM_ROWS = Math.floor(WORLD_HEIGHT / HM_STEP) + 1; // 301

let activeOsmSector: OsmSectorData | null = null;

export function setActiveOsmSector(sector: OsmSectorData): void {
  activeOsmSector = sector;
}

export function getActiveOsmSector(): OsmSectorData | null {
  return activeOsmSector;
}

export function latLonToWorld(lat: number, lon: number): Point2D {
  const b = activeOsmSector ? activeOsmSector.bounds : REAL_WORLD_SECTOR_PRESETS[0];
  return projectLatLon(lat, lon, b, WORLD_WIDTH, WORLD_HEIGHT);
}

export function worldToLatLon(x: number, y: number): { lat: number; lon: number } {
  const b = activeOsmSector ? activeOsmSector.bounds : REAL_WORLD_SECTOR_PRESETS[0];
  return unprojectWorldToLatLon(x, y, b, WORLD_WIDTH, WORLD_HEIGHT);
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
  readonly isLiveOsm = true;
  readonly tileCanvas: HTMLCanvasElement;

  constructor(seed = 541022) {
    this.elevations = new Float32Array(HM_COLS * HM_ROWS);
    this.landcover = new Uint8Array(HM_COLS * HM_ROWS);
    this.roadMask = new Uint8Array(HM_COLS * HM_ROWS);

    if (!activeOsmSector) {
      throw new Error('Real-world OpenStreetMap sector must be loaded before creating SuwalkiMap.');
    }

    this.tileCanvas = activeOsmSector.tileCanvas;
    this.setupFromLiveOsmSector(activeOsmSector, seed);
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

    // Rasterize real OSM water polygons, rivers, coastlines, piers, forests + sample real OSM tile pixels
    let waterPixels: Uint8ClampedArray | null = null;
    let pierPixels: Uint8ClampedArray | null = null;
    let forestPixels: Uint8ClampedArray | null = null;
    let osmTilePixels: Uint8ClampedArray | null = null;

    if (typeof document !== 'undefined') {
      // Sample the stitched OpenStreetMap raster tiles at grid resolution (401x301)
      if (sector.tileCanvas) {
        try {
          const tc = document.createElement('canvas');
          tc.width = HM_COLS;
          tc.height = HM_ROWS;
          const tctx = tc.getContext('2d')!;
          tctx.drawImage(sector.tileCanvas, 0, 0, HM_COLS, HM_ROWS);
          osmTilePixels = tctx.getImageData(0, 0, HM_COLS, HM_ROWS).data;
        } catch {
          osmTilePixels = null;
        }
      }

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

        for (const way of sector.coastlineWays) {
          if (way.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(way[0].x, way[0].y);
          for (let i = 1; i < way.length; i++) {
            ctx.lineTo(way[i].x, way[i].y);
          }
          const first = way[0];
          const last = way[way.length - 1];
          const dx = last.x - first.x;
          const dy = last.y - first.y;
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

        // Detect water & forest from both Overpass vectors AND real OpenStreetMap tile colors (#aad3df water)
        let tileWater = false;
        let tileForest = false;
        if (osmTilePixels) {
          const tr = osmTilePixels[pIdx];
          const tg = osmTilePixels[pIdx + 1];
          const tb = osmTilePixels[pIdx + 2];
          // Standard OSM water (#aad3df) or Carto Voyager water (#d4ebff / #aadaff)
          if (tb > tr + 22 && tb > tg + 6 && tb > 165) {
            tileWater = true;
          } else if (tg > tr + 14 && tg > tb + 12 && tg > 140) {
            tileForest = true;
          }
        }

        const isPier = pierPixels ? pierPixels[pIdx] > 90 : false;
        const isWater =
          !isPier && ((waterPixels ? waterPixels[pIdx] > 90 : false) || tileWater);
        const isForest =
          !isWater && !isPier && ((forestPixels ? forestPixels[pIdx] > 90 : false) || tileForest);

        if (isWater) {
          this.elevations[idx] = -6.5;
          this.landcover[idx] = 0;
        } else if (isPier) {
          this.elevations[idx] = 3.5;
          this.landcover[idx] = 6;
        } else {
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

    for (let r = 2; r < HM_ROWS - 2; r += 2) {
      for (let c = 2; c < HM_COLS - 2; c += 2) {
        const idx = r * HM_COLS + c;
        if (this.landcover[idx] === 4 && this.roadMask[idx] === 0 && rng.next() < 0.55) {
          this.treePositions.push({
            x: c * HM_STEP + rng.range(-4, 4),
            y: r * HM_STEP + rng.range(-4, 4),
            kind: rng.int(0, 2),
          });
        }
      }
    }
  }

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
    for (let rad = 25; rad <= 360; rad += 18) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
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
