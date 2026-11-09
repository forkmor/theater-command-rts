import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { DOCTRINES, UNIT_DEFS } from '../core/definitions';
import type { PlayableFaction, StrategicNode, Unit } from '../core/types';
import { FOG_COLS, FOG_ROWS, type GameSimulation } from '../sim/simulation';
import { WORLD_HEIGHT, WORLD_WIDTH, type SuwalkiMap } from '../world/suwalkiMap';
import { PixelSpriteAtlas } from './pixelSprites';

interface UnitRenderPoolItem {
  root: Container;
  shadow: Sprite;
  hull: Sprite;
  turret?: Sprite;
  rotor?: Sprite;
}

interface NodeRenderPoolItem {
  root: Container;
  base: Sprite;
  radarDish?: Sprite;
  label: Text;
}

export class WorldRenderer {
  readonly app: Application;
  readonly worldContainer = new Container();
  readonly atlas: PixelSpriteAtlas;

  private terrainSprite: Sprite | null = null;
  private topoSprite: Sprite | null = null;
  private infraGraphics = new Graphics();
  private nodeContainer = new Container();
  private treeContainer = new Container();
  private overlayGraphics = new Graphics();
  private groundUnitContainer = new Container();
  private airUnitContainer = new Container();
  private fxGraphics = new Graphics();
  private fogSprite: Sprite | null = null;

  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImageData: ImageData;
  private fogSource: CanvasSource;

  // Cached terrain minimap base image
  minimapBaseCanvas: HTMLCanvasElement;

  private unitPool = new Map<number, UnitRenderPoolItem>();
  private nodePool = new Map<number, NodeRenderPoolItem>();
  private trainPool = new Map<number, { loco: Sprite; cars: Sprite[] }>();

  // Camera state
  camX = 720;
  camY = 1620;
  zoom = 1.0;

  // Overlay toggles
  showRadarOverlay = true;
  showSupplyOverlay = true;
  showTopoOverlay = false;

  constructor(app: Application) {
    this.app = app;
    this.atlas = new PixelSpriteAtlas();

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = FOG_COLS;
    this.fogCanvas.height = FOG_ROWS;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImageData = this.fogCtx.createImageData(FOG_COLS, FOG_ROWS);
    this.fogSource = new CanvasSource({
      resource: this.fogCanvas,
      scaleMode: 'linear', // Smoothly blended pixel shroud edge
    });

    this.minimapBaseCanvas = document.createElement('canvas');
    this.minimapBaseCanvas.width = 256;
    this.minimapBaseCanvas.height = 192;

    this.app.stage.addChild(this.worldContainer);
  }

  bindSimulation(sim: GameSimulation, viewerFaction: PlayableFaction): void {
    // Clear previous scene
    this.worldContainer.removeChildren();
    this.nodeContainer.removeChildren();
    this.treeContainer.removeChildren();
    this.groundUnitContainer.removeChildren();
    this.airUnitContainer.removeChildren();
    this.unitPool.clear();
    this.nodePool.clear();
    this.trainPool.clear();

    // Bake full 1:1 native resolution (3200x2400) vector GIS terrain, spline roads & building sprites
    const { terrainTex, topoTex } = this.bakeTerrainTextures(sim.map);
    this.terrainSprite = new Sprite(terrainTex);
    this.terrainSprite.scale.set(1);

    this.topoSprite = new Sprite(topoTex);
    this.topoSprite.scale.set(1);
    this.topoSprite.visible = this.showTopoOverlay;

    // Populate pixel forest canopy trees (scaled to 1px = 0.5m)
    for (const tr of sim.map.treePositions) {
      const sp = new Sprite(this.atlas.treeTextures[tr.kind % this.atlas.treeTextures.length]);
      sp.anchor.set(0.5);
      sp.scale.set(0.65);
      sp.x = Math.round(tr.x);
      sp.y = Math.round(tr.y);
      this.treeContainer.addChild(sp);
    }

    // Fog of War overlay sprite
    const fogTex = new Texture({ source: this.fogSource });
    this.fogSprite = new Sprite(fogTex);
    this.fogSprite.width = WORLD_WIDTH;
    this.fogSprite.height = WORLD_HEIGHT;

    this.worldContainer.addChild(
      this.terrainSprite,
      this.topoSprite,
      this.infraGraphics,
      this.nodeContainer,
      this.treeContainer,
      this.overlayGraphics,
      this.groundUnitContainer,
      this.airUnitContainer,
      this.fxGraphics,
      this.fogSprite,
    );

    // Center camera on player's starting HQ
    const myHq = sim.nodes.find((n) => n.type === 'hq' && n.faction === viewerFaction);
    if (myHq) {
      this.camX = myHq.x;
      this.camY = myHq.y - 60;
    }
    this.zoom = 1.0;
  }

  private bakeTerrainTextures(map: SuwalkiMap): { terrainTex: Texture; topoTex: Texture } {
    const bw = WORLD_WIDTH; // 3200 (full 1:1 native resolution, 1px = 0.50m)
    const bh = WORLD_HEIGHT; // 2400

    const canvas = document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(bw, bh);
    const data = img.data;

    const topoCanvas = document.createElement('canvas');
    topoCanvas.width = bw;
    topoCanvas.height = bh;
    const topoCtx = topoCanvas.getContext('2d')!;
    const topoImg = topoCtx.createImageData(bw, bh);
    const topoData = topoImg.data;

    // 1. Full-Resolution Pixel-Art Terrain, Bathymetry & Open-Meteo DEM Hillshading
    for (let py = 0; py < bh; py++) {
      const wy = py;
      for (let px = 0; px < bw; px++) {
        const wx = px;
        const elev = map.getElevation(wx, wy);
        const lc = map.getLandcover(wx, wy);

        const eNW = map.getElevation(wx - 6, wy - 6);
        const shade = Math.max(-18, Math.min(20, (elev - eNW) * 3.2));
        const dither = ((px + py) & 1) === 0 ? 2 : -2;

        let r = 54;
        let g = 72;
        let b = 47;

        if (elev < -6) {
          // Deep river channel / harbour basin / Baltic sea
          r = 18;
          g = 42;
          b = 60;
        } else if (elev < 0) {
          // Shallow coastal / riverbank water
          r = 28;
          g = 62;
          b = 84;
        } else if (elev < 2.3) {
          // Sandy / gravel riverbank shoreline
          r = 122;
          g = 114;
          b = 86;
        } else if (lc === 'urban' || lc === 'paved') {
          // Urban block courtyard / concrete lot beneath buildings
          r = 64;
          g = 70;
          b = 74;
        } else if (lc === 'forest') {
          // Woodland & park ground
          r = 40;
          g = 60;
          b = 39;
        } else if (elev > 55) {
          r = 96;
          g = 102;
          b = 72;
        } else if (elev > 30) {
          r = 72;
          g = 88;
          b = 56;
        }

        const idx = (py * bw + px) * 4;
        data[idx] = Math.max(0, Math.min(255, Math.round(r + shade + dither)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(g + shade + dither)));
        data[idx + 2] = Math.max(
          0,
          Math.min(255, Math.round(b + (elev < 0 ? dither : shade * 0.7))),
        );
        data[idx + 3] = 255;

        // Topographic Contour Check (every 12m above sea level)
        if (elev > 2.5) {
          const band = Math.floor(elev / 12);
          const bandR = Math.floor(map.getElevation(wx + 2, wy) / 12);
          const bandD = Math.floor(map.getElevation(wx, wy + 2) / 12);
          if (band !== bandR || band !== bandD) {
            data[idx] = Math.min(255, data[idx] + 10);
            data[idx + 1] = Math.min(255, data[idx + 1] + 10);

            topoData[idx] = 245;
            topoData[idx + 1] = 194;
            topoData[idx + 2] = 66;
            topoData[idx + 3] = band % 2 === 0 ? 190 : 110;
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    topoCtx.putImageData(topoImg, 0, 0);

    // 2. Concrete Seaport Piers, Quays & Breakwaters
    ctx.save();
    ctx.fillStyle = '#525b61';
    ctx.strokeStyle = '#78858d';
    ctx.lineWidth = 2;
    for (const poly of map.pierPolygons) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const pw of map.pierWays) {
      if (pw.points.length < 2) continue;
      ctx.strokeStyle = '#262c30';
      ctx.lineWidth = pw.width + 4;
      ctx.beginPath();
      pw.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = '#586269';
      ctx.lineWidth = pw.width;
      ctx.stroke();
    }
    ctx.restore();

    // 3. Multi-Pass Continuous Vector Road Splines (Curbs -> Asphalt Surface -> Lane Markings)
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pass 3A: Dark Asphalt Curbs / Roadbed Casing (merges all intersections seamlessly)
    ctx.strokeStyle = '#1a1f22';
    for (const st of map.streetPolylines) {
      if (st.points.length < 2) continue;
      ctx.lineWidth = st.width + 3;
      ctx.beginPath();
      st.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    for (const sp of map.splines) {
      if (sp.kind !== 'highway' || sp.points.length < 2) continue;
      ctx.lineWidth = 24;
      ctx.beginPath();
      sp.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }

    // Pass 3B: Continuous Paved Asphalt Roadway Surface
    for (const st of map.streetPolylines) {
      if (st.points.length < 2) continue;
      const isArterial = /^(motorway|trunk|primary|secondary)/.test(st.highwayClass);
      ctx.strokeStyle = isArterial ? '#3d464d' : '#31383d';
      ctx.lineWidth = st.width;
      ctx.beginPath();
      st.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    for (const sp of map.splines) {
      if (sp.kind !== 'highway' || sp.points.length < 2) continue;
      ctx.strokeStyle = '#434d54';
      ctx.lineWidth = 20;
      ctx.beginPath();
      sp.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }

    // Pass 3C: Crisp Centerline & Lane Dividers
    for (const st of map.streetPolylines) {
      if (st.points.length < 2 || st.width < 13) continue;
      const isPrimary = /^(motorway|trunk|primary)/.test(st.highwayClass);
      ctx.strokeStyle = isPrimary ? '#e6b83a' : 'rgba(207, 216, 220, 0.55)';
      ctx.lineWidth = isPrimary ? 1.5 : 1.0;
      ctx.setLineDash(isPrimary ? [8, 6] : [5, 6]);
      ctx.beginPath();
      st.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 4. Real 1:1 Scale Vector Railway Splines (Gravel Ballast, Wooden Sleepers & Twin Steel Rails)
    for (const sp of map.splines) {
      if (sp.kind !== 'railroad' || sp.points.length < 2) continue;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';

      // Crushed granite ballast bed (12px = 6m wide)
      ctx.strokeStyle = '#4a4137';
      ctx.lineWidth = 12;
      ctx.beginPath();
      sp.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // Timber / concrete crossties (sleepers)
      ctx.strokeStyle = '#221c17';
      ctx.lineWidth = 9.5;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Twin parallel steel rails (outer steel stroke + inner dark center gauge)
      ctx.strokeStyle = '#b0bec5';
      ctx.lineWidth = 5.5;
      ctx.stroke();

      ctx.strokeStyle = '#2e2721';
      ctx.lineWidth = 2.8;
      ctx.stroke();
      ctx.restore();
    }

    // 5. Real OSM Aeroways (Runways, Taxiways, Aprons)
    for (const aw of map.aeroways) {
      if (aw.points.length < 2) continue;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#202629';
      ctx.lineWidth = aw.width + 4;
      ctx.beginPath();
      aw.points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = '#374046';
      ctx.lineWidth = aw.width;
      ctx.stroke();

      if (aw.kind === 'runway') {
        ctx.strokeStyle = '#eceff1';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([10, 8]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. Individual Real-Scale Pixel-Art Building Sprites & Structures (1px = 0.50m)
    for (const b of map.urbanBlocks) {
      let wallColor = '#2b201c';
      let roofOuter = '#4d352c';
      let roofInner = '#8c5846'; // Pitched European terracotta roof
      if (b.kind === 'civic' || b.tall) {
        wallColor = '#222b30';
        roofOuter = '#3b4a54';
        roofInner = '#5d7280';
      } else if (b.kind === 'industrial' || b.kind === 'warehouse') {
        wallColor = '#212629';
        roofOuter = '#373e42';
        roofInner = '#545e63';
      } else if (b.kind === 'hangar') {
        wallColor = '#1e2720';
        roofOuter = '#314033';
        roofInner = '#495c4b';
      } else if (b.kind === 'silo') {
        wallColor = '#455a64';
        roofOuter = '#78909c';
        roofInner = '#cfd8dc';
      }

      if (b.kind === 'silo') {
        const rad = Math.max(6, Math.min(b.w, b.h) * 0.48);
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
        ctx.beginPath();
        ctx.arc(b.x + 5, b.y + 5, rad, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = wallColor;
        ctx.beginPath();
        ctx.arc(b.x + 2, b.y + 2, rad, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = roofInner;
        ctx.strokeStyle = roofOuter;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Specular dome highlight & top inspection bridge
        ctx.fillStyle = '#eceff1';
        ctx.beginPath();
        ctx.arc(b.x - rad * 0.25, b.y - rad * 0.25, rad * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#546e7a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - rad * 0.8, b.y);
        ctx.lineTo(b.x + rad * 0.8, b.y);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (b.polygon && b.polygon.length >= 3) {
        const shadowOff = b.tall ? 7 : 4;
        const wallOff = b.tall ? 3.5 : 2.0;

        // 6A. 3D Sun Drop Shadow (SE cast)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.moveTo(b.polygon[0].x + shadowOff, b.polygon[0].y + shadowOff);
        for (let i = 1; i < b.polygon.length; i++) {
          ctx.lineTo(b.polygon[i].x + shadowOff, b.polygon[i].y + shadowOff);
        }
        ctx.closePath();
        ctx.fill();

        // 6B. 3D Extruded Masonry / Concrete Facade Wall
        ctx.fillStyle = wallColor;
        ctx.beginPath();
        ctx.moveTo(b.polygon[0].x + wallOff, b.polygon[0].y + wallOff);
        for (let i = 1; i < b.polygon.length; i++) {
          ctx.lineTo(b.polygon[i].x + wallOff, b.polygon[i].y + wallOff);
        }
        ctx.closePath();
        ctx.fill();

        // 6C. Exact Building Roof Polygon + Clipped Pixel-Art Rooftop Architecture
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(b.polygon[0].x, b.polygon[0].y);
        for (let i = 1; i < b.polygon.length; i++) {
          ctx.lineTo(b.polygon[i].x, b.polygon[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = roofInner;
        ctx.fill();

        // Clip interior rooftop details to the exact OpenStreetMap building polygon
        ctx.clip();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        const hw = b.w * 0.5;
        const hh = b.h * 0.5;

        if (b.kind === 'industrial' || b.kind === 'warehouse' || b.kind === 'hangar') {
          // Corrugated steel roof ribs + skylights
          ctx.strokeStyle = 'rgba(25, 32, 36, 0.45)';
          ctx.lineWidth = 1;
          for (let rx = -hw; rx <= hw; rx += 6) {
            ctx.beginPath();
            ctx.moveTo(rx, -hh - 10);
            ctx.lineTo(rx, hh + 10);
            ctx.stroke();
          }
          if (b.w >= 24 && b.h >= 14) {
            ctx.fillStyle = '#33424a';
            ctx.fillRect(-hw * 0.65, -hh * 0.22, hw * 1.3, Math.max(3, hh * 0.44));
            ctx.fillStyle = '#809ba8';
            for (let sx = -hw * 0.58; sx < hw * 0.52; sx += 10) {
              ctx.fillRect(sx, -hh * 0.14, 6, Math.max(2, hh * 0.28));
            }
          }
        } else if (b.kind === 'civic' || b.tall) {
          // Multi-story flat concrete/bitumen roof with parapet border, elevator housing & HVAC units
          ctx.strokeStyle = 'rgba(30, 40, 46, 0.65)';
          ctx.lineWidth = 4;
          ctx.strokeRect(-hw + 2, -hh + 2, b.w - 4, b.h - 4);

          if (b.w >= 22 && b.h >= 14) {
            // Elevator / Stairwell penthouse
            const pw = Math.min(14, b.w * 0.24);
            const ph = Math.min(10, b.h * 0.35);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
            ctx.fillRect(-pw * 0.5 + 2, -ph * 0.5 + 2, pw, ph);
            ctx.fillStyle = '#738996';
            ctx.fillRect(-pw * 0.5, -ph * 0.5, pw, ph);

            // Pixel HVAC units along roof deck
            ctx.fillStyle = '#90a4ae';
            const step = 12;
            for (let ux = -hw + 8; ux < hw - 8; ux += step) {
              if (Math.abs(ux) < pw * 0.7) continue;
              ctx.fillRect(ux, -2, 5, 5);
              ctx.fillStyle = '#263238';
              ctx.fillRect(ux + 1, -1, 3, 3);
              ctx.fillStyle = '#90a4ae';
            }
          }
        } else {
          // Pitched Residential Roof: NW sunlit slope + SE shaded slope + central ridge beam & chimney
          ctx.fillStyle = 'rgba(255, 235, 215, 0.14)';
          ctx.fillRect(-hw - 10, -hh - 10, b.w + 20, hh + 10);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.fillRect(-hw - 10, 0, b.w + 20, hh + 10);

          // Central terracotta roof ridge line
          const ridgeHalf = Math.max(2, hw - Math.min(hw * 0.4, hh * 0.7));
          ctx.strokeStyle = '#c4836d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-ridgeHalf, 0);
          ctx.lineTo(ridgeHalf, 0);
          ctx.stroke();

          // Hip / gable corner rafters
          ctx.strokeStyle = 'rgba(62, 39, 32, 0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-hw, -hh);
          ctx.lineTo(-ridgeHalf, 0);
          ctx.lineTo(-hw, hh);
          ctx.moveTo(hw, -hh);
          ctx.lineTo(ridgeHalf, 0);
          ctx.lineTo(hw, hh);
          ctx.stroke();

          // Brick chimney pixel detail
          if (b.w >= 14 && b.h >= 10) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(ridgeHalf * 0.35 + 1, -4, 4, 4);
            ctx.fillStyle = '#4e2c22';
            ctx.fillRect(ridgeHalf * 0.35, -5, 4, 4);
            ctx.fillStyle = '#1c1614';
            ctx.fillRect(ridgeHalf * 0.35 + 1, -4, 2, 2);
          }
        }
        ctx.restore();

        // 6D. Crisp Outer Eaves Outline
        ctx.strokeStyle = roofOuter;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(b.polygon[0].x, b.polygon[0].y);
        for (let i = 1; i < b.polygon.length; i++) {
          ctx.lineTo(b.polygon[i].x, b.polygon[i].y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Bake Minimap Base Image from the full-scale vector GIS canvas
    const mctx = this.minimapBaseCanvas.getContext('2d')!;
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(canvas, 0, 0, this.minimapBaseCanvas.width, this.minimapBaseCanvas.height);

    return {
      terrainTex: new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }),
      }),
      topoTex: new Texture({
        source: new CanvasSource({ resource: topoCanvas, scaleMode: 'nearest' }),
      }),
    };
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const cx = this.app.screen.width * 0.5;
    const cy = this.app.screen.height * 0.5;
    return {
      x: (screenX - cx) / this.zoom + this.camX,
      y: (screenY - cy) / this.zoom + this.camY,
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const cx = this.app.screen.width * 0.5;
    const cy = this.app.screen.height * 0.5;
    return {
      x: (worldX - this.camX) * this.zoom + cx,
      y: (worldY - this.camY) * this.zoom + cy,
    };
  }

  render(sim: GameSimulation, viewerFaction: PlayableFaction, selectedIds: Set<number>): void {
    // Clamp camera
    this.camX = Math.max(120, Math.min(WORLD_WIDTH - 120, this.camX));
    this.camY = Math.max(120, Math.min(WORLD_HEIGHT - 120, this.camY));

    const cx = this.app.screen.width * 0.5;
    const cy = this.app.screen.height * 0.5;
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.x = Math.round(cx - this.camX * this.zoom);
    this.worldContainer.y = Math.round(cy - this.camY * this.zoom);

    if (this.topoSprite) {
      this.topoSprite.visible = this.showTopoOverlay;
    }

    this.renderInfrastructureAndNodes(sim, viewerFaction);
    this.renderTacticalOverlays(sim, viewerFaction, selectedIds);
    this.renderTrainsAndUnits(sim, viewerFaction, selectedIds);
    this.renderProjectilesAndEffects(sim, viewerFaction);
    this.renderFogOfWar(sim, viewerFaction);
  }

  private renderInfrastructureAndNodes(sim: GameSimulation, viewerFaction: PlayableFaction): void {
    const g = this.infraGraphics;
    g.clear();

    // 1. Blast Craters
    for (const cr of sim.craters) {
      if (!sim.isCellExplored(viewerFaction, cr.x, cr.y)) continue;
      g.circle(cr.x, cr.y, cr.r).fill({ color: 0x1d2122, alpha: 0.75 });
      g.circle(cr.x, cr.y, cr.r * 0.6).fill({ color: 0x111314, alpha: 0.85 });
    }

    // 2. Real Rotated River Bridges (Intact Steel/Concrete Deck vs Destroyed Rubble)
    for (const br of sim.bridges) {
      const halfL = br.length * 0.5;
      const cos = Math.cos(br.angle);
      const sin = Math.sin(br.angle);
      const ax = br.x - cos * halfL;
      const ay = br.y - sin * halfL;
      const bx = br.x + cos * halfL;
      const by = br.y + sin * halfL;

      if (!br.destroyed) {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 22, color: 0x90a4ae });
        g.moveTo(ax, ay)
          .lineTo(bx, by)
          .stroke({ width: 16, color: br.kind === 'railroad' ? 0x3e352f : 0x2c3338 });
        if (br.hp < br.maxHp) {
          const pct = br.hp / br.maxHp;
          g.rect(br.x - 20, br.y - 18, 40, 3.5).fill({ color: 0x111618 });
          g.rect(br.x - 20, br.y - 18, 40 * pct, 3.5).fill({ color: 0xffb300 });
        }
      } else {
        // Shattered bridge abutments + submerged gap!
        g.circle(ax, ay, 8).fill({ color: 0x37474f });
        g.circle(bx, by, 8).fill({ color: 0x37474f });
        g.circle(br.x, br.y, 14).stroke({ width: 2, color: 0xef5350, alpha: 0.9 });
      }
    }

    // 3. Severed Road/Rail Corridor Markers
    for (const sp of sim.map.splines) {
      for (const segIdx of sp.damagedSegments) {
        const a = sp.points[segIdx];
        const b = sp.points[segIdx + 1];
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        g.circle(mx, my, 9).fill({ color: 0x1a1d1e, alpha: 0.9 });
        g.moveTo(mx - 5, my - 5).lineTo(mx + 5, my + 5).stroke({ width: 2, color: 0xef5350 });
        g.moveTo(mx + 5, my - 5).lineTo(mx - 5, my + 5).stroke({ width: 2, color: 0xef5350 });
      }
    }

    // 4. Strategic Nodes
    const activeNodeIds = new Set<number>();
    for (const nd of sim.nodes) {
      activeNodeIds.add(nd.id);
      let item = this.nodePool.get(nd.id);
      if (!item) {
        item = this.createNodeRenderItem(nd);
        this.nodePool.set(nd.id, item);
        this.nodeContainer.addChild(item.root);
      }

      item.root.x = nd.x;
      item.root.y = nd.y;
      item.base.texture = this.atlas.getNodeTexture(nd.type, nd.faction);
      item.base.tint = nd.destroyed ? 0x555555 : 0xffffff;

      if (item.radarDish) {
        item.radarDish.visible = !nd.destroyed;
        item.radarDish.rotation = sim.elapsedSec * 2.1;
      }

      // Territory Capture Ring & Health Bar
      const fColor =
        nd.faction === 'blue' ? 0x42b0ff : nd.faction === 'red' ? 0xef5350 : 0xb0bec5;
      g.circle(nd.x, nd.y, nd.radius).stroke({
        width: 1.5,
        color: fColor,
        alpha: nd.supplied ? 0.5 : 0.25,
      });

      if (Math.abs(nd.captureProgress) > 1 && Math.abs(nd.captureProgress) < 100) {
        const capColor = nd.captureProgress > 0 ? 0x42b0ff : 0xef5350;
        const arcEnd = -Math.PI * 0.5 + (Math.abs(nd.captureProgress) / 100) * Math.PI * 2;
        g.arc(nd.x, nd.y, nd.radius + 4, -Math.PI * 0.5, arcEnd).stroke({
          width: 3,
          color: capColor,
          alpha: 0.9,
        });
      }

      if (nd.hp < nd.maxHp || nd.destroyed) {
        const pct = Math.max(0, nd.hp / nd.maxHp);
        g.rect(nd.x - 20, nd.y - 28, 40, 3.5).fill({ color: 0x101416 });
        g.rect(nd.x - 20, nd.y - 28, 40 * pct, 3.5).fill({
          color: nd.destroyed ? 0xef5350 : 0x66bb6a,
        });
      }
    }

    for (const [id, item] of this.nodePool.entries()) {
      if (!activeNodeIds.has(id)) {
        item.root.destroy({ children: true });
        this.nodePool.delete(id);
      }
    }
  }

  private createNodeRenderItem(nd: StrategicNode): NodeRenderPoolItem {
    const root = new Container();
    const base = new Sprite(this.atlas.getNodeTexture(nd.type, nd.faction));
    base.anchor.set(0.5);
    base.scale.set(0.68);
    root.addChild(base);

    let radarDish: Sprite | undefined;
    if (nd.type === 'radar_station' || nd.type === 'airfield' || nd.type === 'hq') {
      radarDish = new Sprite(this.atlas.radarDishTexture);
      radarDish.anchor.set(0.5);
      radarDish.scale.set(0.68);
      radarDish.x = nd.type === 'radar_station' ? 0 : 11;
      radarDish.y = nd.type === 'radar_station' ? 0 : -11;
      root.addChild(radarDish);
    }

    const badge =
      nd.incomeFuel >= 10
        ? ' [FUEL]'
        : nd.incomeAmmo >= 10
          ? ' [AMMO]'
          : nd.incomeMoney >= 12
            ? ' [$$]'
            : '';

    const label = new Text({
      text: `${nd.name.toUpperCase()}${badge}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 9,
        fontWeight: 'bold',
        fill: 0xe8f1f5,
        stroke: { color: 0x070b0d, width: 3 },
      },
    });
    label.anchor.set(0.5, 0);
    label.y = 24;

    const labelBg = new Graphics();
    const lw = label.width + 8;
    const lh = label.height + 2;
    labelBg
      .roundRect(-lw * 0.5, 23, lw, lh, 3)
      .fill({ color: 0x090e11, alpha: 0.78 })
      .stroke({ width: 1, color: 0x26353d, alpha: 0.7 });

    root.addChild(labelBg, label);

    return { root, base, radarDish, label };
  }

  private renderTacticalOverlays(
    sim: GameSimulation,
    viewerFaction: PlayableFaction,
    selectedIds: Set<number>,
  ): void {
    const g = this.overlayGraphics;
    g.clear();

    const doc = DOCTRINES[sim.economy[viewerFaction].doctrine];

    // 1. Automated Supply Lines Overlay along Connected Splines
    if (this.showSupplyOverlay) {
      const supPts = sim.suppliedPoints[viewerFaction];
      for (const sp of sim.map.splines) {
        for (let i = 0; i < sp.points.length - 1; i++) {
          if (sp.damagedSegments.has(i)) continue;
          const a = sp.points[i];
          const b = sp.points[i + 1];
          const aSup = supPts.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 55);
          const bSup = supPts.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 55);
          if (aSup && bSup) {
            const color = sp.kind === 'railroad' ? 0xffca28 : 0x4dd0e1;
            g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
              width: 2.2,
              color,
              alpha: 0.38,
            });
            const phase = (sim.elapsedSec * 0.45 + i * 0.23) % 1;
            const px = a.x + (b.x - a.x) * phase;
            const py = a.y + (b.y - a.y) * phase;
            g.circle(px, py, 2.8).fill({ color, alpha: 0.8 });
          }
        }
      }
    }

    // 2. Radar Horizon & Sensor Envelopes
    if (this.showRadarOverlay) {
      for (const nd of sim.nodes) {
        if (nd.faction !== viewerFaction || nd.destroyed || nd.radarRange < 300) continue;
        g.circle(nd.x, nd.y, nd.radarRange * doc.radarRangeMult).stroke({
          width: 1,
          color: 0x4fc3f7,
          alpha: 0.22,
        });
      }
      for (const u of sim.units) {
        if (u.faction !== viewerFaction || u.hp <= 0 || !u.radarActive) continue;
        const rr = UNIT_DEFS[u.type].radarRange;
        if (rr > 0) {
          g.circle(u.x, u.y, rr * doc.radarRangeMult).stroke({
            width: 1,
            color: 0x4fc3f7,
            alpha: 0.24,
          });
        }
      }
    }

    // 3. Selected Units Waypoints, Firing Range & Selection Rings
    for (const u of sim.units) {
      if (!selectedIds.has(u.id) || u.hp <= 0 || u.insideTransportId !== null) continue;
      const def = UNIT_DEFS[u.type];
      const visualAltOffset = Math.max(0, u.z - Math.max(0, sim.map.getElevation(u.x, u.y))) * 0.35;

      g.circle(u.x, u.y - visualAltOffset, def.radius + 3.5).stroke({
        width: 1.5,
        color: 0x69f0ae,
        alpha: 0.95,
      });

      if (selectedIds.size <= 4) {
        g.circle(u.x, u.y, def.primaryWeapon.range).stroke({
          width: 1,
          color: 0xffd54f,
          alpha: 0.22,
        });
      }

      if (u.waypoints.length > 0 && u.waypointIdx < u.waypoints.length) {
        const ord = u.orders[0];
        const lineColor =
          ord?.kind === 'attack_unit' || ord?.kind === 'attack_ground' || ord?.kind === 'attack_move'
            ? 0xff7043
            : 0x69f0ae;
        let lx = u.x;
        let ly = u.y;
        for (let w = u.waypointIdx; w < u.waypoints.length; w++) {
          const wp = u.waypoints[w];
          g.moveTo(lx, ly).lineTo(wp.x, wp.y).stroke({
            width: 1.4,
            color: lineColor,
            alpha: 0.65,
          });
          lx = wp.x;
          ly = wp.y;
        }
        g.circle(lx, ly, 3.2).fill({ color: lineColor, alpha: 0.85 });
      }
    }
  }

  private renderTrainsAndUnits(
    sim: GameSimulation,
    viewerFaction: PlayableFaction,
    selectedIds: Set<number>,
  ): void {
    const g = this.fxGraphics;
    g.clear();

    // 1. Render Military Reinforcement Trains (scaled to 1px = 0.50m rail gauge)
    const activeTrains = new Set<number>();
    for (const tr of sim.trains) {
      if (tr.faction !== viewerFaction && sim.isCellVisible(viewerFaction, tr.x, tr.y) === 0) {
        continue;
      }
      activeTrains.add(tr.id);
      let tItem = this.trainPool.get(tr.id);
      if (!tItem) {
        const loco = new Sprite(
          tr.faction === 'blue' ? this.atlas.trainLocoBlue : this.atlas.trainLocoRed,
        );
        loco.anchor.set(0.5);
        loco.scale.set(0.62);
        const car1 = new Sprite(this.atlas.trainFlatbed);
        car1.anchor.set(0.5);
        car1.scale.set(0.62);
        const car2 = new Sprite(this.atlas.trainFlatbed);
        car2.anchor.set(0.5);
        car2.scale.set(0.62);
        this.groundUnitContainer.addChild(car2, car1, loco);
        tItem = { loco, cars: [car1, car2] };
        this.trainPool.set(tr.id, tItem);
      }
      tItem.loco.x = tr.x;
      tItem.loco.y = tr.y;
      tItem.loco.rotation = tr.angle;
      tItem.cars.forEach((c, idx) => {
        const distBack = (idx + 1) * 19;
        c.x = tr.x - Math.cos(tr.angle) * distBack;
        c.y = tr.y - Math.sin(tr.angle) * distBack;
        c.rotation = tr.angle;
      });
    }
    for (const [tid, item] of this.trainPool.entries()) {
      if (!activeTrains.has(tid)) {
        item.loco.destroy();
        item.cars.forEach((c) => c.destroy());
        this.trainPool.delete(tid);
      }
    }

    // 2. Render Real-Scale Units (with 3D Altitude Shadow Offset & Turrets!)
    const activeUnitIds = new Set<number>();
    for (const u of sim.units) {
      if (u.hp <= 0 || u.insideTransportId !== null) continue;
      if (!sim.isUnitDetectedBy(u, viewerFaction)) continue;

      activeUnitIds.add(u.id);
      const def = UNIT_DEFS[u.type];
      const isAir = def.domain === 'jet' || def.domain === 'heli';

      let item = this.unitPool.get(u.id);
      if (!item) {
        item = this.createUnitRenderItem(u);
        this.unitPool.set(u.id, item);
        if (isAir) this.airUnitContainer.addChild(item.root);
        else this.groundUnitContainer.addChild(item.root);
      }

      const groundElev = Math.max(0, sim.map.getElevation(u.x, u.y));
      const altAboveGround = Math.max(0, u.z - groundElev);
      const altVisualOffset = altAboveGround * 0.35;

      item.root.x = u.x;
      item.root.y = u.y;

      item.shadow.x = isAir ? 6 : 1.8;
      item.shadow.y = isAir ? 5 : 1.8;
      item.shadow.rotation = u.angle;
      item.shadow.alpha = isAir ? 0.34 : 0.42;

      item.hull.x = 0;
      item.hull.y = -altVisualOffset;
      item.hull.rotation = u.angle;

      if (item.turret) {
        item.turret.x = 0;
        item.turret.y = -altVisualOffset;
        item.turret.rotation = u.turretAngle;
      }

      if (item.rotor) {
        item.rotor.x = 1.5;
        item.rotor.y = -altVisualOffset;
        item.rotor.rotation = sim.elapsedSec * 22;
      }

      if (def.domain === 'sea' && Math.hypot(u.vx, u.vy) > 4) {
        const wx = u.x - Math.cos(u.angle) * (def.radius + 5);
        const wy = u.y - Math.sin(u.angle) * (def.radius + 5);
        g.circle(wx, wy, 3.5).fill({ color: 0xb3e5fc, alpha: 0.4 });
      }

      // Micro Unit Status Bars (HP, Supply Warning, Garrison, Passengers)
      const showBars = selectedIds.has(u.id) || u.hp < u.maxHp || !u.supplied || u.ammo <= 1;
      if (showBars) {
        const barY = u.y - altVisualOffset - def.radius - 6;
        const barW = Math.max(12, def.radius * 1.9);
        const hpPct = Math.max(0, u.hp / u.maxHp);
        g.rect(u.x - barW * 0.5, barY, barW, 2.5).fill({ color: 0x0d1214, alpha: 0.85 });
        g.rect(u.x - barW * 0.5, barY, barW * hpPct, 2.5).fill({
          color: u.faction === viewerFaction ? 0x66bb6a : 0xef5350,
        });

        if (
          u.faction === viewerFaction &&
          (!u.supplied || u.ammo <= 0 || (u.maxFuel > 0 && u.fuel <= 5))
        ) {
          g.circle(u.x + barW * 0.5 + 3, barY + 1.25, 2.2).fill({
            color: u.ammo <= 0 || (u.maxFuel > 0 && u.fuel <= 1) ? 0xef5350 : 0xffb300,
          });
        }
      }

      if (u.garrisonNodeId !== null) {
        g.rect(u.x - 4, u.y - def.radius - 11, 8, 3).fill({ color: 0x4fc3f7 });
      }

      if (u.passengers.length > 0) {
        for (let p = 0; p < u.passengers.length; p++) {
          g.rect(u.x - 4 + p * 5, u.y + def.radius + 3, 3.5, 2.5).fill({ color: 0xfff176 });
        }
      }
    }

    for (const [uid, item] of this.unitPool.entries()) {
      if (!activeUnitIds.has(uid)) {
        item.root.destroy({ children: true });
        this.unitPool.delete(uid);
      }
    }
  }

  private createUnitRenderItem(u: Unit): UnitRenderPoolItem {
    const root = new Container();
    const def = UNIT_DEFS[u.type];
    // Scale unit sprites to true 1px = 0.50m scale (Tank = ~15x9px, Infantry = ~12x12px, Ships = ~32x12px)
    const unitScale =
      def.domain === 'sea' ? 0.65 : def.domain === 'jet' || def.domain === 'heli' ? 0.64 : 0.56;
    root.scale.set(unitScale);

    const hullTex = this.atlas.getUnitHull(u.type, u.faction);

    const shadow = new Sprite(hullTex);
    shadow.anchor.set(0.5);
    shadow.tint = 0x000000;
    root.addChild(shadow);

    const hull = new Sprite(hullTex);
    hull.anchor.set(0.5);
    root.addChild(hull);

    const turTex = this.atlas.getUnitTurret(u.type, u.faction);
    let turret: Sprite | undefined;
    if (turTex) {
      turret = new Sprite(turTex);
      turret.anchor.set(0.38, 0.5);
      root.addChild(turret);
    }

    let rotor: Sprite | undefined;
    if (u.type === 'attack_heli') {
      rotor = new Sprite(this.atlas.rotorTexture);
      rotor.anchor.set(0.5);
      root.addChild(rotor);
    }

    return { root, shadow, hull, turret, rotor };
  }

  private renderProjectilesAndEffects(sim: GameSimulation, viewerFaction: PlayableFaction): void {
    const g = this.fxGraphics;

    // 1. Smokescreens
    for (const sm of sim.smokeClouds) {
      if (!sim.isCellExplored(viewerFaction, sm.x, sm.y)) continue;
      const alpha = Math.min(0.68, sm.remainingSec * 0.15);
      g.circle(sm.x, sm.y, sm.radius).fill({ color: 0xcfd8dc, alpha });
      g.circle(sm.x - 14, sm.y - 10, sm.radius * 0.65).fill({ color: 0xeceff1, alpha: alpha * 0.85 });
      g.circle(sm.x + 15, sm.y + 8, sm.radius * 0.6).fill({ color: 0xb0bec5, alpha: alpha * 0.85 });
    }

    // 2. 3D Ballistic Projectiles + Ground Altitude Shadows!
    for (const p of sim.projectiles) {
      if (p.faction !== viewerFaction && sim.isCellVisible(viewerFaction, p.x, p.y) === 0) {
        continue;
      }
      const terrZ = Math.max(0, sim.map.getElevation(p.x, p.y));
      const heightOffset = Math.max(0, p.z - terrZ) * 0.35;
      const vyScreen = p.y - heightOffset;

      // Ground shadow for elevated shells & missiles!
      if (heightOffset > 4) {
        g.circle(p.x, p.y, 2.5).fill({ color: 0x000000, alpha: 0.35 });
      }

      const ang = Math.atan2(p.vy, p.vx);
      if (
        p.ballistic === 'cruise_missile' ||
        p.ballistic === 'sam' ||
        p.ballistic === 'sead' ||
        p.ballistic === 'atgm'
      ) {
        // Exhaust smoke trail + glowing rocket motor + missile body
        const tailX = p.x - Math.cos(ang) * 14;
        const tailY = vyScreen - Math.sin(ang) * 14;
        g.moveTo(tailX, tailY).lineTo(p.x, vyScreen).stroke({
          width: p.ballistic === 'cruise_missile' ? 3 : 2,
          color: 0xeceff1,
          alpha: 0.75,
        });
        g.circle(p.x - Math.cos(ang) * 4, vyScreen - Math.sin(ang) * 4, 2.5).fill({
          color: p.ballistic === 'sead' ? 0xff4081 : 0xff9800,
        });
        g.circle(p.x, vyScreen, p.ballistic === 'cruise_missile' ? 3.2 : 2.2).fill({
          color: 0xffffff,
        });
      } else if (p.ballistic === 'artillery' || p.ballistic === 'bomb') {
        g.circle(p.x, vyScreen, 3.5).fill({ color: 0xffb74d });
        g.circle(p.x, vyScreen, 2.0).fill({ color: 0xffffff });
      } else {
        // APFSDS / Autocannon / Small Arms high-velocity tracer
        const tracerLen = p.ballistic === 'apfsds' ? 16 : 9;
        g.moveTo(p.x - Math.cos(ang) * tracerLen, vyScreen - Math.sin(ang) * tracerLen)
          .lineTo(p.x, vyScreen)
          .stroke({
            width: p.ballistic === 'apfsds' ? 2.2 : 1.4,
            color: p.faction === 'blue' ? 0x80d8ff : 0xff8a80,
          });
      }
    }

    // 3. Explosions, Muzzle Flashes & Water Splashes
    for (const fx of sim.effects) {
      if (sim.isCellVisible(viewerFaction, fx.x, fx.y) === 0) continue;
      const t = fx.age / fx.duration;
      const alpha = Math.max(0, 1 - t);
      const rad = fx.radius * (0.45 + t * 0.75);
      const terrZ = Math.max(0, sim.map.getElevation(fx.x, fx.y));
      const fy = fx.y - Math.max(0, fx.z - terrZ) * 0.35;

      g.circle(fx.x, fy, rad).fill({ color: fx.color, alpha: alpha * 0.8 });
      if (fx.kind === 'explosion' && t < 0.5) {
        g.circle(fx.x, fy, rad * 0.5).fill({ color: 0xffffff, alpha });
      }
    }
  }

  private renderFogOfWar(sim: GameSimulation, viewerFaction: PlayableFaction): void {
    const exp = sim.explored[viewerFaction];
    const vis = sim.visible[viewerFaction];
    const d = this.fogImageData.data;

    for (let i = 0; i < FOG_COLS * FOG_ROWS; i++) {
      const p = i * 4;
      if (vis[i] === 1) {
        // Clear visual Line-of-Sight
        d[p] = 0;
        d[p + 1] = 0;
        d[p + 2] = 0;
        d[p + 3] = 0;
      } else if (vis[i] === 2) {
        // Radar Horizon Coverage (behind optical mask or extended range) — subtle radar tint
        d[p] = 8;
        d[p + 1] = 28;
        d[p + 2] = 36;
        d[p + 3] = 32;
      } else if (exp[i] === 1) {
        // Dynamic Fog (previously explored terrain, currently out of LOS)
        d[p] = 9;
        d[p + 1] = 14;
        d[p + 2] = 18;
        d[p + 3] = 52;
      } else {
        // Unobserved Satellite GIS Sector (real OpenStreetMap cartography visible, enemy units hidden)
        d[p] = 6;
        d[p + 1] = 10;
        d[p + 2] = 15;
        d[p + 3] = 78;
      }
    }

    this.fogCtx.putImageData(this.fogImageData, 0, 0);
    this.fogSource.update();
  }
}
