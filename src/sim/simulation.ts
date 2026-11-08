import { DOCTRINES, UNIT_DEFS } from '../core/definitions';
import { SeededRNG } from '../core/rng';
import type {
  Bridge,
  DoctrineId,
  FactionEconomy,
  GameCommand,
  PlayableFaction,
  Point2D,
  Projectile,
  SmokeCloud,
  StrategicNode,
  TrainDelivery,
  Unit,
  UnitOrder,
  UnitType,
  VisualEffect,
} from '../core/types';
import { SuwalkiMap, WORLD_HEIGHT, WORLD_WIDTH } from '../world/suwalkiMap';

export const FOG_STEP = 25;
export const FOG_COLS = Math.ceil(WORLD_WIDTH / FOG_STEP); // 128
export const FOG_ROWS = Math.ceil(WORLD_HEIGHT / FOG_STEP); // 96

export interface RadioAlert {
  id: number;
  faction: PlayableFaction | 'all';
  text: string;
  level: 'info' | 'warn' | 'danger' | 'good';
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function stepAngle(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return normalizeAngle(current + Math.sign(diff) * maxStep);
}

export class GameSimulation {
  readonly map: SuwalkiMap;
  readonly rng: SeededRNG;

  tick = 0;
  elapsedSec = 0;
  winner: PlayableFaction | null = null;

  private nextEntityId = 1;

  readonly nodes: StrategicNode[] = [];
  readonly bridges: Bridge[] = [];
  readonly units: Unit[] = [];
  readonly trains: TrainDelivery[] = [];
  readonly projectiles: Projectile[] = [];
  readonly smokeClouds: SmokeCloud[] = [];
  readonly effects: VisualEffect[] = [];
  readonly craters: Array<{ x: number; y: number; r: number }> = [];

  readonly economy: Record<PlayableFaction, FactionEconomy>;

  // Dual-Layer Fog of War per faction: explored (0|1), visible (0=fog, 1=visual, 2=radar)
  readonly explored: Record<PlayableFaction, Uint8Array>;
  readonly visible: Record<PlayableFaction, Uint8Array>;

  // Cached supplied spline vertices per faction for HUD overlay & unit resupply
  readonly suppliedPoints: Record<PlayableFaction, Point2D[]> = {
    blue: [],
    red: [],
  };

  onAlert?: (alert: RadioAlert) => void;
  onSound?: (
    event: 'cannon' | 'autocannon' | 'missile' | 'ciws' | 'small_arms' | 'explosion' | 'heavy_explosion',
    x: number,
    y: number,
  ) => void;

  private logisticsTimer = 0;
  private fogTimer = 0;

  constructor(seed: number, blueDoctrine: DoctrineId, redDoctrine: DoctrineId) {
    this.rng = new SeededRNG(seed);
    this.map = new SuwalkiMap(seed);

    // Deep clone nodes & bridges from map template
    for (const n of this.map.initialNodes) {
      this.nodes.push({ ...n });
      this.nextEntityId = Math.max(this.nextEntityId, n.id + 1);
    }
    for (const b of this.map.bridges) {
      this.bridges.push({ ...b });
    }

    this.economy = {
      blue: {
        money: 1250,
        fuel: 800,
        ammo: 800,
        moneyRate: 0,
        fuelRate: 0,
        ammoRate: 0,
        doctrine: blueDoctrine,
        sectorsHeld: 0,
      },
      red: {
        money: 1250,
        fuel: 800,
        ammo: 800,
        moneyRate: 0,
        fuelRate: 0,
        ammoRate: 0,
        doctrine: redDoctrine,
        sectorsHeld: 0,
      },
    };

    this.explored = {
      blue: new Uint8Array(FOG_COLS * FOG_ROWS),
      red: new Uint8Array(FOG_COLS * FOG_ROWS),
    };
    this.visible = {
      blue: new Uint8Array(FOG_COLS * FOG_ROWS),
      red: new Uint8Array(FOG_COLS * FOG_ROWS),
    };

    this.spawnInitialTaskForces();
    this.updateLogisticsAndEconomy(0);
    this.updateVisibilityGrid();
  }

  private allocId(): number {
    return this.nextEntityId++;
  }

  private emitAlert(
    faction: PlayableFaction | 'all',
    text: string,
    level: 'info' | 'warn' | 'danger' | 'good',
  ): void {
    if (this.onAlert) {
      this.onAlert({ id: this.allocId(), faction, text, level });
    }
  }

  private spawnInitialTaskForces(): void {
    const blueHq = this.nodes.find((n) => n.faction === 'blue' && n.type === 'hq')!;
    const bluePort = this.nodes.find((n) => n.faction === 'blue' && n.type === 'seaport')!;
    const redHq = this.nodes.find((n) => n.faction === 'red' && n.type === 'hq')!;
    const redPort = this.nodes.find((n) => n.faction === 'red' && n.type === 'seaport')!;

    // Blue Initial Battlegroup around Suwalki (54.10N, 22.93E) & Klaipeda Port
    const bx = blueHq.x;
    const by = blueHq.y;
    this.createUnit('mbt', 'blue', bx + 44, by - 36, -0.4);
    this.createUnit('mbt', 'blue', bx + 56, by - 8, -0.4);
    this.createUnit('ifv', 'blue', bx + 20, by - 52, -0.4);
    this.createUnit('rifle_squad', 'blue', bx + 32, by - 18, -0.4);
    this.createUnit('atgm_team', 'blue', bx - 22, by - 42, -0.4);
    this.createUnit('recon_uav', 'blue', bx + 78, by - 64, -0.4);
    this.createUnit('mobile_sam', 'blue', bx - 48, by - 22, -0.4);
    this.createUnit('combat_eng', 'blue', bx - 52, by + 12, -0.4);
    const blueSea = this.map.findNearestDeepWater(bluePort.x, bluePort.y);
    this.createUnit('corvette', 'blue', blueSea.x, blueSea.y, Math.PI * 0.7);

    // Red Initial Battlegroup around Gusev / Kaliningrad (54.59N, 22.20E) & Baltiysk Port
    const rx = redHq.x;
    const ry = redHq.y;
    this.createUnit('mbt', 'red', rx + 52, ry + 26, 0.35);
    this.createUnit('mbt', 'red', rx + 36, ry + 58, 0.35);
    this.createUnit('ifv', 'red', rx + 68, ry + 8, 0.35);
    this.createUnit('rifle_squad', 'red', rx + 24, ry + 34, 0.35);
    this.createUnit('atgm_team', 'red', rx + 50, ry - 18, 0.35);
    this.createUnit('recon_uav', 'red', rx + 92, ry + 22, 0.35);
    this.createUnit('mobile_sam', 'red', rx - 46, ry - 20, 0.35);
    this.createUnit('combat_eng', 'red', rx - 36, ry + 38, 0.35);
    const redSea = this.map.findNearestDeepWater(redPort.x, redPort.y);
    this.createUnit('corvette', 'red', redSea.x, redSea.y, -Math.PI * 0.35);
  }

  createUnit(
    type: UnitType,
    faction: PlayableFaction,
    x: number,
    y: number,
    angle: number,
    homeAirfieldId: number | null = null,
  ): Unit {
    const def = UNIT_DEFS[type];
    const groundZ = Math.max(0, this.map.getElevation(x, y));
    const unit: Unit = {
      id: this.allocId(),
      type,
      faction,
      x,
      y,
      z: groundZ + def.cruiseAltitude,
      vx: 0,
      vy: 0,
      angle,
      turretAngle: angle,
      hp: def.maxHp,
      maxHp: def.maxHp,
      fuel: def.maxFuel,
      maxFuel: def.maxFuel,
      ammo: def.maxAmmo,
      maxAmmo: def.maxAmmo,
      supplied: true,
      radarActive: def.radarRange > 0,
      holdFire: false,
      smokeCooldown: 0,
      primaryCooldown: 0,
      secondaryCooldown: 0,
      passengers: [],
      insideTransportId: null,
      garrisonNodeId: null,
      homeAirfieldId,
      returningToBase: false,
      loiterAngle: angle,
      orders: [],
      waypoints: [],
      waypointIdx: 0,
    };
    this.units.push(unit);
    return unit;
  }

  /** Execute deterministic command from Local Player, AI, or WebSocket Relay */
  executeCommand(cmd: GameCommand): void {
    if (this.winner) return;

    if (cmd.kind === 'ORDER_UNITS') {
      const selected = this.units.filter(
        (u) =>
          u.faction === cmd.faction &&
          cmd.unitIds.includes(u.id) &&
          u.hp > 0 &&
          u.insideTransportId === null,
      );
      if (selected.length === 0) return;

      const n = selected.length;
      const cols = Math.ceil(Math.sqrt(n));

      selected.forEach((u, idx) => {
        // Leave garrison automatically when given movement order
        if (
          u.garrisonNodeId !== null &&
          (cmd.order.kind === 'move' ||
            cmd.order.kind === 'attack_move' ||
            cmd.order.kind === 'board_transport')
        ) {
          u.garrisonNodeId = null;
        }
        u.returningToBase = false;

        let orderCopy: UnitOrder = { ...cmd.order };
        if (
          n > 1 &&
          (orderCopy.kind === 'move' ||
            orderCopy.kind === 'attack_move' ||
            orderCopy.kind === 'patrol_air')
        ) {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const spacing = UNIT_DEFS[u.type].domain === 'sea' ? 48 : 28;
          orderCopy = {
            ...orderCopy,
            x: Math.max(40, Math.min(WORLD_WIDTH - 40, orderCopy.x + (col - (cols - 1) / 2) * spacing)),
            y: Math.max(40, Math.min(WORLD_HEIGHT - 40, orderCopy.y + (row - (cols - 1) / 2) * spacing)),
          };
        }

        if (!cmd.queue) {
          u.orders = [orderCopy];
          this.rebuildWaypointsForCurrentOrder(u);
        } else {
          u.orders.push(orderCopy);
          if (u.orders.length === 1) {
            this.rebuildWaypointsForCurrentOrder(u);
          }
        }
      });
    } else if (cmd.kind === 'DEPLOY_UNIT') {
      this.handleDeployUnit(cmd.faction, cmd.unitType, cmd.targetX, cmd.targetY);
    } else if (cmd.kind === 'UNIT_ABILITY') {
      this.handleUnitAbility(cmd);
    }
  }

  private handleDeployUnit(
    faction: PlayableFaction,
    unitType: UnitType,
    targetX?: number,
    targetY?: number,
  ): void {
    const def = UNIT_DEFS[unitType];
    const econ = this.economy[faction];
    if (econ.money < def.costMoney) return;

    if (def.deployVia === 'airfield') {
      const airfield = this.nodes.find(
        (n) => n.faction === faction && n.type === 'airfield' && !n.destroyed,
      );
      if (!airfield) {
        this.emitAlert(faction, 'No operational Airfield available!', 'warn');
        return;
      }
      econ.money -= def.costMoney;
      const ang = airfield.runwayAngle ?? (faction === 'blue' ? 0 : Math.PI);
      const u = this.createUnit(
        unitType,
        faction,
        airfield.x - Math.cos(ang) * 24,
        airfield.y - Math.sin(ang) * 24,
        ang,
        airfield.id,
      );
      const rallyX = targetX ?? airfield.x + Math.cos(ang) * 340;
      const rallyY = targetY ?? airfield.y + Math.sin(ang) * 180;
      u.orders = [
        {
          kind: def.domain === 'jet' ? 'patrol_air' : 'attack_move',
          x: Math.max(120, Math.min(WORLD_WIDTH - 120, rallyX)),
          y: Math.max(120, Math.min(WORLD_HEIGHT - 120, rallyY)),
        },
      ];
      this.rebuildWaypointsForCurrentOrder(u);
      this.emitAlert(faction, `${def.shortName} launched from ${airfield.name}.`, 'info');
      return;
    }

    if (def.deployVia === 'seaport') {
      const port = this.nodes.find(
        (n) => n.faction === faction && n.type === 'seaport' && !n.destroyed,
      );
      if (!port) {
        this.emitAlert(faction, 'No operational Seaport available!', 'warn');
        return;
      }
      econ.money -= def.costMoney;
      const seaSpot = this.map.findNearestDeepWater(port.x, port.y);
      const sx = seaSpot.x + this.rng.range(-25, 25);
      const sy = seaSpot.y + this.rng.range(-25, 25);
      const u = this.createUnit(unitType, faction, sx, sy, Math.PI * 0.5);
      u.orders = [
        {
          kind: 'attack_move',
          x: targetX ?? Math.max(80, seaSpot.x - 140),
          y: targetY ?? Math.min(WORLD_HEIGHT - 120, Math.max(140, seaSpot.y + (faction === 'blue' ? 240 : -240))),
        },
      ];
      this.rebuildWaypointsForCurrentOrder(u);
      this.emitAlert(faction, `${def.shortName} deployed from ${port.name}.`, 'info');
      return;
    }

    // Ground & Infantry Deployment via Real Railhead Train (Rail Baltica / Kaliningrad Trunk) or Highway Staging
    const railhead = this.nodes.find(
      (n) => n.faction === faction && n.type === 'railhead' && !n.destroyed,
    );
    const useTrain =
      railhead &&
      def.category === 'ground' &&
      (unitType === 'mbt' || unitType === 'spg_artillery' || unitType === 'ifv' || unitType === 'mobile_sam');

    if (useTrain && railhead) {
      const railSplines = this.map.splines.filter((s) => s.kind === 'railroad');
      let bestRail =
        this.map.splines.find(
          (s) => s.id === (faction === 'blue' ? 'rail_baltica' : 'rail_kaliningrad_trunk'),
        ) ?? null;

      if (!bestRail && railSplines.length > 0) {
        // Pick the longest railway spline near this faction's railhead
        let bestScore = -Infinity;
        for (const rs of railSplines) {
          const sample = this.map.sampleSplineByDistance(rs, 0, false);
          if (sample.totalLength < 220) continue;
          const d0 = Math.hypot(rs.points[0].x - railhead.x, rs.points[0].y - railhead.y);
          const d1 = Math.hypot(
            rs.points[rs.points.length - 1].x - railhead.x,
            rs.points[rs.points.length - 1].y - railhead.y,
          );
          const score = sample.totalLength - Math.min(d0, d1) * 0.6;
          if (score > bestScore) {
            bestScore = score;
            bestRail = rs;
          }
        }
      }

      if (bestRail) {
        econ.money -= def.costMoney;
        const doc = DOCTRINES[econ.doctrine];
        const info = this.map.sampleSplineByDistance(bestRail, 0, false);
        const startDist =
          bestRail.id === 'rail_kaliningrad_trunk' && faction === 'red' ? 860 : 0;
        const dropDist = Math.min(info.totalLength - 20, startDist + Math.max(200, Math.min(520, info.totalLength * 0.65)));
        const startSample = this.map.sampleSplineByDistance(bestRail, startDist, false);
        this.trains.push({
          id: this.allocId(),
          faction,
          splineId: bestRail.id,
          progressDist: startDist,
          totalDist: dropDist,
          dropX: targetX ?? WORLD_WIDTH * 0.5,
          dropY: targetY ?? WORLD_HEIGHT * 0.5,
          speed: 150 * doc.railSpeedMult,
          cargoTypes: [unitType],
          x: startSample.x,
          y: startSample.y,
          angle: startSample.angle,
        });
        this.emitAlert(
          faction,
          `Railhead train en route with ${def.shortName} via ${bestRail.name}.`,
          'info',
        );
        return;
      }
    }

    // Otherwise spawn via nearest supplied FOB (infantry only), Highway Entry, or HQ
    const candidateNodes = this.nodes.filter(
      (n) =>
        n.faction === faction &&
        !n.destroyed &&
        n.supplied &&
        (n.type === 'highway_entry' ||
          n.type === 'hq' ||
          n.type === 'railhead' ||
          (def.category === 'infantry' && n.type === 'fob')),
    );

    if (candidateNodes.length === 0) {
      this.emitAlert(faction, 'All ground reinforcement hubs cut off!', 'danger');
      return;
    }

    let bestHub = candidateNodes[0];
    if (targetX !== undefined && targetY !== undefined) {
      let bestD = Infinity;
      for (const hub of candidateNodes) {
        const d = Math.hypot(hub.x - targetX, hub.y - targetY);
        if (d < bestD) {
          bestD = d;
          bestHub = hub;
        }
      }
    }

    econ.money -= def.costMoney;
    const ang = faction === 'blue' ? 0 : Math.PI;
    const ox = bestHub.x + Math.cos(ang) * 42 + this.rng.range(-18, 18);
    const oy = bestHub.y + this.rng.range(-28, 28);
    const u = this.createUnit(unitType, faction, ox, oy, ang);
    const rx = targetX ?? (faction === 'blue' ? bestHub.x + 150 : bestHub.x - 150);
    const ry = targetY ?? bestHub.y;
    u.orders = [{ kind: 'attack_move', x: rx, y: ry }];
    this.rebuildWaypointsForCurrentOrder(u);
  }

  private handleUnitAbility(cmd: Extract<GameCommand, { kind: 'UNIT_ABILITY' }>): void {
    const selected = this.units.filter(
      (u) => u.faction === cmd.faction && cmd.unitIds.includes(u.id) && u.hp > 0,
    );
    if (selected.length === 0) return;

    if (cmd.ability === 'pop_smoke') {
      for (const u of selected) {
        if (UNIT_DEFS[u.type].canSmoke && u.smokeCooldown <= 0) {
          u.smokeCooldown = 18;
          const sx = u.x + Math.cos(u.angle) * 26;
          const sy = u.y + Math.sin(u.angle) * 26;
          this.smokeClouds.push({
            id: this.allocId(),
            x: sx,
            y: sy,
            z: Math.max(0, this.map.getElevation(sx, sy)),
            radius: 56,
            remainingSec: 12,
          });
        }
      }
    } else if (cmd.ability === 'toggle_radar') {
      const anyActive = selected.some((u) => u.radarActive);
      for (const u of selected) {
        if (UNIT_DEFS[u.type].radarRange > 0) {
          u.radarActive = !anyActive;
        }
      }
    } else if (cmd.ability === 'toggle_hold_fire') {
      const anyHold = selected.some((u) => u.holdFire);
      for (const u of selected) {
        u.holdFire = !anyHold;
      }
    } else if (cmd.ability === 'halt') {
      for (const u of selected) {
        u.orders = [];
        u.waypoints = [];
        u.vx = 0;
        u.vy = 0;
      }
    } else if (cmd.ability === 'rtb') {
      for (const u of selected) {
        if (UNIT_DEFS[u.type].domain === 'jet' || UNIT_DEFS[u.type].domain === 'heli') {
          u.returningToBase = true;
          u.orders = [];
        }
      }
    } else if (cmd.ability === 'unload_passengers') {
      for (const u of selected) {
        this.unloadTransport(u);
        if (u.garrisonNodeId !== null) {
          u.garrisonNodeId = null;
        }
      }
    } else if (cmd.ability === 'build_fob' || cmd.ability === 'build_sam') {
      const eng = selected.find((u) => UNIT_DEFS[u.type].canEngineer && u.insideTransportId === null);
      if (!eng) return;
      const cost = cmd.ability === 'build_fob' ? 180 : 220;
      const econ = this.economy[cmd.faction];
      if (econ.money < cost) {
        this.emitAlert(cmd.faction, `Insufficient Requisition ($${cost} needed).`, 'warn');
        return;
      }
      if (this.map.getElevation(eng.x, eng.y) < 1) {
        this.emitAlert(cmd.faction, 'Must build on solid dry ground.', 'warn');
        return;
      }
      // Prevent stacking directly on another node
      if (this.nodes.some((n) => Math.hypot(n.x - eng.x, n.y - eng.y) < 85)) {
        this.emitAlert(cmd.faction, 'Too close to existing structure.', 'warn');
        return;
      }
      econ.money -= cost;
      const isFob = cmd.ability === 'build_fob';
      this.nodes.push({
        id: this.allocId(),
        name: isFob ? 'Forward Operating Base' : 'Tactical SAM Site',
        type: isFob ? 'fob' : 'sam_site',
        faction: cmd.faction,
        captureProgress: cmd.faction === 'blue' ? 100 : -100,
        capturingFaction: 'neutral',
        x: eng.x + Math.cos(eng.angle) * 28,
        y: eng.y + Math.sin(eng.angle) * 28,
        radius: 34,
        hp: isFob ? 520 : 420,
        maxHp: isFob ? 520 : 420,
        destroyed: false,
        supplied: true,
        incomeMoney: 0,
        incomeFuel: isFob ? 2 : 0,
        incomeAmmo: isFob ? 3 : 0,
        radarRange: isFob ? 220 : 600,
        attackCooldown: 0,
      });
      this.emitAlert(
        cmd.faction,
        isFob ? 'Engineers established Forward Operating Base!' : 'Tactical SAM Battery online!',
        'good',
      );
    }
  }

  private unloadTransport(transport: Unit): void {
    if (transport.passengers.length === 0) return;
    if (this.map.getElevation(transport.x, transport.y) < -0.5) return;
    for (let i = 0; i < transport.passengers.length; i++) {
      const pid = transport.passengers[i];
      const pass = this.units.find((u) => u.id === pid);
      if (pass) {
        pass.insideTransportId = null;
        const ang = transport.angle + Math.PI + (i - 0.5) * 0.65;
        pass.x = transport.x + Math.cos(ang) * 22;
        pass.y = transport.y + Math.sin(ang) * 22;
        pass.z = Math.max(0, this.map.getElevation(pass.x, pass.y));
        pass.orders = [];
        pass.waypoints = [];
      }
    }
    transport.passengers = [];
  }

  private rebuildWaypointsForCurrentOrder(u: Unit): void {
    u.waypoints = [];
    u.waypointIdx = 0;
    if (u.orders.length === 0) return;
    const ord = u.orders[0];
    let tx = ord.x;
    let ty = ord.y;

    if (ord.kind === 'attack_unit' && ord.targetUnitId !== undefined) {
      const target = this.units.find((t) => t.id === ord.targetUnitId);
      if (target) {
        tx = target.x;
        ty = target.y;
      }
    } else if (ord.kind === 'board_transport' && ord.targetUnitId !== undefined) {
      const tr = this.units.find((t) => t.id === ord.targetUnitId);
      if (tr) {
        tx = tr.x;
        ty = tr.y;
      }
    } else if (
      (ord.kind === 'garrison_node' || ord.kind === 'repair_target') &&
      ord.targetNodeId !== undefined
    ) {
      const nd = this.nodes.find((n) => n.id === ord.targetNodeId);
      if (nd) {
        tx = nd.x;
        ty = nd.y;
      }
    } else if (ord.kind === 'repair_target' && ord.targetBridgeId !== undefined) {
      const br = this.bridges.find((b) => b.id === ord.targetBridgeId);
      if (br) {
        const perpX = Math.cos(br.angle) * 56;
        const perpY = Math.sin(br.angle) * 56;
        const d1 = Math.hypot(u.x - (br.x - perpX), u.y - (br.y - perpY));
        const d2 = Math.hypot(u.x - (br.x + perpX), u.y - (br.y + perpY));
        tx = d1 < d2 ? br.x - perpX : br.x + perpX;
        ty = d1 < d2 ? br.y - perpY : br.y + perpY;
      }
    }

    const def = UNIT_DEFS[u.type];
    // General GIS River & Bridge-aware routing for non-amphibious land units
    if (def.domain === 'land') {
      const dist = Math.hypot(tx - u.x, ty - u.y);
      const steps = Math.min(32, Math.max(4, Math.ceil(dist / 36)));
      let crossesRiver = false;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sx = u.x + (tx - u.x) * t;
        const sy = u.y + (ty - u.y) * t;
        if (!this.map.isPassableForLand(sx, sy, this.bridges, false)) {
          crossesRiver = true;
          break;
        }
      }
      if (crossesRiver) {
        const intact = this.bridges.filter((b) => !b.destroyed);
        if (intact.length > 0) {
          let bestBr = intact[0];
          let bestScore = Infinity;
          for (const br of intact) {
            const score = Math.hypot(u.x - br.x, u.y - br.y) + Math.hypot(tx - br.x, ty - br.y);
            if (score < bestScore) {
              bestScore = score;
              bestBr = br;
            }
          }
          const dxSpan = Math.cos(bestBr.angle) * (bestBr.length * 0.54);
          const dySpan = Math.sin(bestBr.angle) * (bestBr.length * 0.54);
          const sideA = { x: bestBr.x - dxSpan, y: bestBr.y - dySpan };
          const sideB = { x: bestBr.x + dxSpan, y: bestBr.y + dySpan };
          if (Math.hypot(u.x - sideA.x, u.y - sideA.y) < Math.hypot(u.x - sideB.x, u.y - sideB.y)) {
            u.waypoints.push(sideA, sideB);
          } else {
            u.waypoints.push(sideB, sideA);
          }
        }
      }
    }

    u.waypoints.push({ x: tx, y: ty });
  }

  /** Advance deterministic fixed-step simulation by dt seconds */
  step(dt: number): void {
    if (this.winner) return;

    this.tick++;
    this.elapsedSec += dt;

    this.logisticsTimer += dt;
    if (this.logisticsTimer >= 0.5) {
      this.updateLogisticsAndEconomy(this.logisticsTimer);
      this.logisticsTimer = 0;
    }

    this.updateTrains(dt);
    this.updateNodesAndCaptures(dt);
    this.updateUnits(dt);
    this.updateProjectiles(dt);
    this.updateSmokeAndEffects(dt);

    this.fogTimer += dt;
    if (this.fogTimer >= 0.15) {
      this.updateVisibilityGrid();
      this.fogTimer = 0;
    }

    this.checkVictoryConditions();
  }

  private updateLogisticsAndEconomy(dt: number): void {
    // Sync bridge destruction to spline segment blocking
    for (const spline of this.map.splines) {
      for (const br of this.bridges) {
        if (br.splineId === spline.id) {
          if (br.destroyed) {
            spline.damagedSegments.add(br.segmentIndex);
          }
        }
      }
    }

    for (const faction of ['blue', 'red'] as PlayableFaction[]) {
      const enemy: PlayableFaction = faction === 'blue' ? 'red' : 'blue';
      // Collect supply root hubs
      const roots = this.nodes.filter(
        (n) =>
          n.faction === faction &&
          !n.destroyed &&
          (n.type === 'hq' || n.type === 'railhead' || n.type === 'highway_entry' || n.type === 'seaport'),
      );

      // Build graph over all spline vertices
      const allPts: Array<{ x: number; y: number; neighbors: number[]; blocked: boolean }> = [];
      const findOrAddVertex = (x: number, y: number): number => {
        for (let i = 0; i < allPts.length; i++) {
          if (Math.hypot(allPts[i].x - x, allPts[i].y - y) < 42) return i;
        }
        const enemyBlocking = this.units.some(
          (u) =>
            u.faction === enemy &&
            u.hp > 0 &&
            UNIT_DEFS[u.type].domain !== 'jet' &&
            Math.hypot(u.x - x, u.y - y) < 55,
        );
        allPts.push({ x, y, neighbors: [], blocked: enemyBlocking });
        return allPts.length - 1;
      };

      for (const spline of this.map.splines) {
        for (let i = 0; i < spline.points.length - 1; i++) {
          const ia = findOrAddVertex(spline.points[i].x, spline.points[i].y);
          const ib = findOrAddVertex(spline.points[i + 1].x, spline.points[i + 1].y);
          if (!spline.damagedSegments.has(i)) {
            allPts[ia].neighbors.push(ib);
            allPts[ib].neighbors.push(ia);
          }
        }
      }

      const visited = new Uint8Array(allPts.length);
      const queue: number[] = [];
      for (const root of roots) {
        for (let i = 0; i < allPts.length; i++) {
          if (!visited[i] && Math.hypot(allPts[i].x - root.x, allPts[i].y - root.y) < 120) {
            visited[i] = 1;
            queue.push(i);
          }
        }
      }

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (allPts[curr].blocked) continue;
        for (const nxt of allPts[curr].neighbors) {
          if (!visited[nxt] && !allPts[nxt].blocked) {
            visited[nxt] = 1;
            queue.push(nxt);
          }
        }
      }

      const supPts: Point2D[] = roots.map((r) => ({ x: r.x, y: r.y }));
      for (let i = 0; i < allPts.length; i++) {
        if (visited[i]) {
          supPts.push({ x: allPts[i].x, y: allPts[i].y });
        }
      }
      this.suppliedPoints[faction] = supPts;

      // Update Node supply status & compute resource income
      let mRate = 6; // baseline national trickle
      let fRate = 3;
      let aRate = 3;
      let sectors = 0;

      for (const node of this.nodes) {
        if (node.faction !== faction) continue;
        sectors++;
        const connected =
          node.type === 'fob' ||
          supPts.some((p) => Math.hypot(p.x - node.x, p.y - node.y) < 150);
        node.supplied = connected && !node.destroyed;
        const mult = node.supplied ? 1.0 : 0.35;
        mRate += node.incomeMoney * mult;
        fRate += node.incomeFuel * mult;
        aRate += node.incomeAmmo * mult;

        if (node.type === 'fob' && !node.destroyed) {
          supPts.push({ x: node.x, y: node.y });
        }
      }

      const econ = this.economy[faction];
      econ.moneyRate = Math.round(mRate);
      econ.fuelRate = Math.round(fRate);
      econ.ammoRate = Math.round(aRate);
      econ.sectorsHeld = sectors;
      econ.money = Math.min(9999, econ.money + mRate * dt);
      econ.fuel = Math.min(5000, econ.fuel + fRate * dt);
      econ.ammo = Math.min(5000, econ.ammo + aRate * dt);

      // Update Unit supply status & auto-resupply along corridors
      for (const u of this.units) {
        if (u.faction !== faction || u.hp <= 0) continue;
        const def = UNIT_DEFS[u.type];
        if (def.domain === 'jet') {
          u.supplied = true;
          continue;
        }
        const nearCorridor = supPts.some((p) => Math.hypot(p.x - u.x, p.y - u.y) < 220);
        const nearPort =
          def.domain === 'sea' &&
          this.nodes.some(
            (n) =>
              n.faction === faction &&
              n.type === 'seaport' &&
              !n.destroyed &&
              Math.hypot(n.x - u.x, n.y - u.y) < 380,
          );
        u.supplied = nearCorridor || nearPort;

        if (u.supplied) {
          if (u.maxFuel > 0 && u.fuel < u.maxFuel && econ.fuel > 1) {
            const addF = Math.min(u.maxFuel - u.fuel, 8 * dt);
            u.fuel += addF;
            econ.fuel = Math.max(0, econ.fuel - addF * 0.25);
          }
          if (u.ammo < u.maxAmmo && econ.ammo > 1) {
            const addA = Math.min(u.maxAmmo - u.ammo, 2.2 * dt);
            u.ammo += addA;
            econ.ammo = Math.max(0, econ.ammo - addA * 0.4);
          }
          // Field repair near HQ / FOB / Seaport / Airfield
          const nearDepot = this.nodes.some(
            (n) =>
              n.faction === faction &&
              !n.destroyed &&
              (n.type === 'hq' || n.type === 'fob' || n.type === 'seaport' || n.type === 'airfield') &&
              Math.hypot(n.x - u.x, n.y - u.y) < 140,
          );
          if (nearDepot && u.hp < u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + 10 * dt);
          }
        }
      }
    }
  }

  private updateTrains(dt: number): void {
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const tr = this.trains[i];
      const spline = this.map.splines.find((s) => s.id === tr.splineId);
      if (!spline) {
        this.trains.splice(i, 1);
        continue;
      }
      tr.progressDist += tr.speed * dt;
      const sample = this.map.sampleSplineByDistance(spline, tr.progressDist, false);
      tr.x = sample.x;
      tr.y = sample.y;
      tr.angle = sample.angle;

      // Unload early if track ahead is bombed/damaged, or when reaching drop distance!
      if (sample.blocked || tr.progressDist >= tr.totalDist) {
        for (const ut of tr.cargoTypes) {
          const u = this.createUnit(
            ut,
            tr.faction,
            tr.x + this.rng.range(-18, 18),
            tr.y + 24 + this.rng.range(-10, 10),
            tr.faction === 'blue' ? 0 : Math.PI,
          );
          u.orders = [{ kind: 'attack_move', x: tr.dropX, y: tr.dropY }];
          this.rebuildWaypointsForCurrentOrder(u);
        }
        this.trains.splice(i, 1);
      }
    }
  }

  private updateNodesAndCaptures(dt: number): void {
    for (const node of this.nodes) {
      // Tactical SAM Site automated defense
      if (node.type === 'sam_site' && !node.destroyed && node.faction !== 'neutral') {
        node.attackCooldown = Math.max(0, (node.attackCooldown ?? 0) - dt);
        if (node.attackCooldown <= 0) {
          const f = node.faction as PlayableFaction;
          const target = this.findBestAirOrMissileTarget(
            f,
            node.x,
            node.y,
            this.map.getElevation(node.x, node.y) + 12,
            580,
            true,
          );
          if (target) {
            node.attackCooldown = 2.6;
            if ('ballistic' in target) {
              this.spawnInterceptMissile(f, 0, node.x, node.y, target);
            } else {
              this.spawnProjectileFromSpec(
                f,
                0,
                node.x,
                node.y,
                Math.max(0, this.map.getElevation(node.x, node.y)) + 10,
                UNIT_DEFS.mobile_sam.primaryWeapon,
                target.x,
                target.y,
                target.z,
                target.id,
              );
            }
          }
        }
      }

      // Territory Capture by Ground / Infantry Units
      if (node.type === 'fob' || node.type === 'sam_site') continue;

      let blueCap = 0;
      let redCap = 0;
      for (const u of this.units) {
        if (u.hp <= 0 || u.insideTransportId !== null) continue;
        const def = UNIT_DEFS[u.type];
        if (def.domain === 'jet' || def.domain === 'heli') continue;
        if (Math.hypot(u.x - node.x, u.y - node.y) <= node.radius + 26) {
          const weight = def.category === 'infantry' ? 2.2 : 1.0;
          if (u.faction === 'blue') blueCap += weight;
          else redCap += weight;
        }
      }

      const net = blueCap - redCap;
      if (Math.abs(net) > 0.01) {
        node.capturingFaction = net > 0 ? 'blue' : 'red';
        const prevFaction = node.faction;
        node.captureProgress = Math.max(
          -100,
          Math.min(100, node.captureProgress + net * 11 * dt),
        );
        if (node.captureProgress >= 100 && node.faction !== 'blue') {
          node.faction = 'blue';
          node.destroyed = false;
          node.hp = Math.max(node.hp, node.maxHp * 0.6);
          this.emitAlert('blue', `Captured ${node.name}!`, 'good');
          if (prevFaction === 'red') {
            this.emitAlert('red', `Lost ${node.name} to Blue Force!`, 'danger');
          }
        } else if (node.captureProgress <= -100 && node.faction !== 'red') {
          node.faction = 'red';
          node.destroyed = false;
          node.hp = Math.max(node.hp, node.maxHp * 0.6);
          this.emitAlert('red', `Captured ${node.name}!`, 'good');
          if (prevFaction === 'blue') {
            this.emitAlert('blue', `Lost ${node.name} to Red Coalition!`, 'danger');
          }
        } else if (Math.abs(node.captureProgress) < 15 && node.faction !== 'neutral' && node.type !== 'hq') {
          node.faction = 'neutral';
        }
      } else {
        node.capturingFaction = 'neutral';
      }
    }
  }

  private updateUnits(dt: number): void {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.hp <= 0) continue;

      u.smokeCooldown = Math.max(0, u.smokeCooldown - dt);
      u.primaryCooldown = Math.max(0, u.primaryCooldown - dt);
      u.secondaryCooldown = Math.max(0, u.secondaryCooldown - dt);

      if (u.insideTransportId !== null) {
        const tr = this.units.find((t) => t.id === u.insideTransportId);
        if (tr && tr.hp > 0) {
          u.x = tr.x;
          u.y = tr.y;
          u.z = tr.z;
          continue;
        } else {
          u.insideTransportId = null;
        }
      }

      const def = UNIT_DEFS[u.type];
      const doc = DOCTRINES[this.economy[u.faction].doctrine];

      // Fixed-wing Jet Flight & Sortie Logic
      if (def.domain === 'jet') {
        this.stepJetUnit(u, dt);
        continue;
      }

      // Garrisoned Infantry stays protected inside urban node
      if (u.garrisonNodeId !== null) {
        const gNode = this.nodes.find((n) => n.id === u.garrisonNodeId);
        if (!gNode || gNode.destroyed) {
          u.garrisonNodeId = null;
        } else {
          u.vx = 0;
          u.vy = 0;
          this.stepUnitCombat(u, dt);
          continue;
        }
      }

      // Combat Engineering Repair Task
      if (def.canEngineer) {
        this.stepEngineerRepair(u, dt, doc.repairSpeedMult);
      }

      // Movement & Orders
      this.stepUnitMovement(u, dt);

      // Weapons & Turret Targeting
      this.stepUnitCombat(u, dt);
    }

    // Soft unit separation for ground & sea units
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      if (a.hp <= 0 || a.insideTransportId !== null || a.garrisonNodeId !== null) continue;
      const da = UNIT_DEFS[a.type];
      if (da.domain === 'jet' || da.domain === 'heli') continue;

      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        if (b.hp <= 0 || b.insideTransportId !== null || b.garrisonNodeId !== null) continue;
        const db = UNIT_DEFS[b.type];
        if (da.domain !== db.domain) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = da.radius + db.radius + 3;
        if (dist > 0.01 && dist < minDist) {
          const push = (minDist - dist) * 0.32;
          const nx = dx / dist;
          const ny = dy / dist;
          if (da.domain === 'sea') {
            if (this.map.isPassableForShip(a.x - nx * push, a.y - ny * push)) {
              a.x -= nx * push;
              a.y -= ny * push;
            }
            if (this.map.isPassableForShip(b.x + nx * push, b.y + ny * push)) {
              b.x += nx * push;
              b.y += ny * push;
            }
          } else {
            if (this.map.isPassableForLand(a.x - nx * push, a.y - ny * push, this.bridges, da.domain === 'amphibious')) {
              a.x -= nx * push;
              a.y -= ny * push;
            }
            if (this.map.isPassableForLand(b.x + nx * push, b.y + ny * push, this.bridges, db.domain === 'amphibious')) {
              b.x += nx * push;
              b.y += ny * push;
            }
          }
        }
      }
    }

    // Remove dead units (eject/destroy passengers if transport dies)
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].hp <= 0) {
        const dead = this.units[i];
        for (const pid of dead.passengers) {
          const pass = this.units.find((p) => p.id === pid);
          if (pass) {
            pass.insideTransportId = null;
            pass.hp = Math.min(pass.hp, pass.maxHp * 0.35);
          }
        }
        this.units.splice(i, 1);
      }
    }
  }

  private stepJetUnit(u: Unit, dt: number): void {
    const def = UNIT_DEFS[u.type];
    const doc = DOCTRINES[this.economy[u.faction].doctrine];
    const airfield = this.nodes.find(
      (n) =>
        (n.id === u.homeAirfieldId || (n.faction === u.faction && n.type === 'airfield')) &&
        !n.destroyed,
    );

    // Check fuel / ammo Bingo RTB
    if ((u.ammo <= 0 || u.fuel <= 20) && !u.returningToBase) {
      u.returningToBase = true;
    }

    let destX = u.x + Math.cos(u.angle) * 200;
    let destY = u.y + Math.sin(u.angle) * 200;

    if (u.returningToBase && airfield) {
      destX = airfield.x;
      destY = airfield.y;
      const distBase = Math.hypot(airfield.x - u.x, airfield.y - u.y);
      if (distBase < 52) {
        // Landed / Rearming over airfield!
        const rearmRate = 1.6 / doc.airRearmMult;
        u.ammo = Math.min(u.maxAmmo, u.ammo + rearmRate * dt);
        u.fuel = Math.min(u.maxFuel, u.fuel + 65 * dt);
        u.hp = Math.min(u.maxHp, u.hp + 25 * dt);
        if (u.ammo >= u.maxAmmo && u.fuel >= u.maxFuel * 0.95) {
          u.returningToBase = false;
        }
      }
    } else if (u.orders.length > 0) {
      const ord = u.orders[0];
      if (ord.kind === 'attack_unit' && ord.targetUnitId !== undefined) {
        const tu = this.units.find((t) => t.id === ord.targetUnitId && t.hp > 0);
        if (tu) {
          destX = tu.x;
          destY = tu.y;
        } else {
          u.orders.shift();
        }
      } else {
        // Orbit around loiter point
        const distCenter = Math.hypot(ord.x - u.x, ord.y - u.y);
        if (distCenter < 170) {
          u.loiterAngle = normalizeAngle(u.loiterAngle + 1.35 * dt);
          destX = ord.x + Math.cos(u.loiterAngle) * 185;
          destY = ord.y + Math.sin(u.loiterAngle) * 185;
        } else {
          destX = ord.x;
          destY = ord.y;
        }
      }
    }

    const desiredAngle = Math.atan2(destY - u.y, destX - u.x);
    u.angle = stepAngle(u.angle, desiredAngle, def.turnRate * dt);
    u.turretAngle = u.angle;
    u.vx = Math.cos(u.angle) * def.speed;
    u.vy = Math.sin(u.angle) * def.speed;
    u.x = Math.max(40, Math.min(WORLD_WIDTH - 40, u.x + u.vx * dt));
    u.y = Math.max(40, Math.min(WORLD_HEIGHT - 40, u.y + u.vy * dt));
    u.z = Math.max(0, this.map.getElevation(u.x, u.y)) + def.cruiseAltitude;
    u.fuel = Math.max(0, u.fuel - def.fuelBurnPerSec * dt);

    if (!u.returningToBase) {
      this.stepUnitCombat(u, dt);
    }
  }

  private stepEngineerRepair(u: Unit, dt: number, repairMult: number): void {
    // Automatically repair any nearby damaged bridge, friendly/neutral node, or rail segment!
    for (const br of this.bridges) {
      if ((br.destroyed || br.hp < br.maxHp) && Math.hypot(br.x - u.x, br.y - u.y) < 95) {
        br.hp = Math.min(br.maxHp, br.hp + 65 * repairMult * dt);
        if (br.destroyed && br.hp >= br.maxHp * 0.65) {
          br.destroyed = false;
          const sp = this.map.splines.find((s) => s.id === br.splineId);
          sp?.damagedSegments.delete(br.segmentIndex);
          this.emitAlert(u.faction, `${br.name} restored to traffic!`, 'good');
        }
        return;
      }
    }

    for (const nd of this.nodes) {
      if (
        nd.faction === u.faction &&
        (nd.destroyed || nd.hp < nd.maxHp) &&
        Math.hypot(nd.x - u.x, nd.y - u.y) < nd.radius + 45
      ) {
        nd.hp = Math.min(nd.maxHp, nd.hp + 75 * repairMult * dt);
        if (nd.destroyed && nd.hp >= nd.maxHp * 0.6) {
          nd.destroyed = false;
          this.emitAlert(u.faction, `${nd.name} repaired and operational!`, 'good');
        }
        return;
      }
    }

    // Repair damaged road/rail segments nearby
    for (const sp of this.map.splines) {
      if (sp.damagedSegments.size === 0) continue;
      for (const segIdx of Array.from(sp.damagedSegments)) {
        // Don't clear bridge segment unless bridge itself is intact
        const isDestroyedBridge = this.bridges.some(
          (b) => b.splineId === sp.id && b.segmentIndex === segIdx && b.destroyed,
        );
        if (isDestroyedBridge) continue;
        const a = sp.points[segIdx];
        const b = sp.points[segIdx + 1];
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        if (Math.hypot(mx - u.x, my - u.y) < 85) {
          sp.damagedSegments.delete(segIdx);
          this.emitAlert(u.faction, `Repaired ${sp.name} corridor!`, 'good');
        }
      }
    }
  }

  private stepUnitMovement(u: Unit, dt: number): void {
    const def = UNIT_DEFS[u.type];
    const doc = DOCTRINES[this.economy[u.faction].doctrine];

    if (u.orders.length === 0) {
      u.vx = 0;
      u.vy = 0;
      u.z = Math.max(0, this.map.getElevation(u.x, u.y)) + def.cruiseAltitude;
      if (!def.hasTurret) u.turretAngle = u.angle;
      return;
    }

    const ord = u.orders[0];

    // Check contextual Boarding or Garrisoning completion
    if (ord.kind === 'board_transport' && ord.targetUnitId !== undefined) {
      const tr = this.units.find((t) => t.id === ord.targetUnitId && t.hp > 0);
      if (!tr || tr.passengers.length >= UNIT_DEFS[tr.type].transportCap) {
        u.orders.shift();
        this.rebuildWaypointsForCurrentOrder(u);
        return;
      }
      if (Math.hypot(tr.x - u.x, tr.y - u.y) < 28) {
        tr.passengers.push(u.id);
        u.insideTransportId = tr.id;
        u.orders = [];
        u.waypoints = [];
        return;
      }
      u.waypoints = [{ x: tr.x, y: tr.y }];
      u.waypointIdx = 0;
    } else if (ord.kind === 'garrison_node' && ord.targetNodeId !== undefined) {
      const nd = this.nodes.find((n) => n.id === ord.targetNodeId && !n.destroyed);
      if (!nd || (nd.type !== 'city' && nd.type !== 'hq' && nd.type !== 'fob')) {
        u.orders.shift();
        this.rebuildWaypointsForCurrentOrder(u);
        return;
      }
      if (Math.hypot(nd.x - u.x, nd.y - u.y) < nd.radius) {
        u.garrisonNodeId = nd.id;
        u.orders = [];
        u.waypoints = [];
        return;
      }
    } else if (ord.kind === 'attack_unit' && ord.targetUnitId !== undefined) {
      const target = this.units.find((t) => t.id === ord.targetUnitId && t.hp > 0);
      if (!target || !this.isUnitDetectedBy(target, u.faction)) {
        u.orders.shift();
        this.rebuildWaypointsForCurrentOrder(u);
        return;
      }
      const dist = Math.hypot(target.x - u.x, target.y - u.y);
      const maxR = def.primaryWeapon.range * 0.88;
      if (
        dist <= maxR &&
        (def.primaryWeapon.ballistic === 'artillery' ||
          def.primaryWeapon.ballistic === 'cruise_missile' ||
          this.map.checkLineOfSight3D(u.x, u.y, u.z + 4, target.x, target.y, target.z + 4))
      ) {
        // In firing range & LOS — halt to fire!
        u.vx = 0;
        u.vy = 0;
        return;
      }
      if (u.waypoints.length === 0 || Math.hypot(u.waypoints[u.waypoints.length - 1].x - target.x, u.waypoints[u.waypoints.length - 1].y - target.y) > 45) {
        this.rebuildWaypointsForCurrentOrder(u);
      }
    } else if (ord.kind === 'attack_ground') {
      const dist = Math.hypot(ord.x - u.x, ord.y - u.y);
      if (dist <= def.primaryWeapon.range * 0.94 && dist >= def.primaryWeapon.minRange) {
        u.vx = 0;
        u.vy = 0;
        return;
      }
    }

    if (u.waypointIdx >= u.waypoints.length) {
      u.orders.shift();
      this.rebuildWaypointsForCurrentOrder(u);
      return;
    }

    const wp = u.waypoints[u.waypointIdx];
    const dx = wp.x - u.x;
    const dy = wp.y - u.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 16) {
      u.waypointIdx++;
      if (u.waypointIdx >= u.waypoints.length) {
        if (ord.kind !== 'repair_target') {
          u.orders.shift();
          this.rebuildWaypointsForCurrentOrder(u);
        }
        u.vx = 0;
        u.vy = 0;
      }
      return;
    }

    const desiredAngle = Math.atan2(dy, dx);
    u.angle = stepAngle(u.angle, desiredAngle, def.turnRate * dt);

    // Calculate terrain & logistics speed modifiers
    let speed = def.speed;
    if (def.domain === 'heli') {
      speed *= doc.heliSpeedMult;
    } else if (def.domain === 'land' || def.domain === 'amphibious') {
      const roadMask = this.map.getRoadMaskAt(u.x, u.y);
      const elev = this.map.getElevation(u.x, u.y);
      if (elev < -0.4 && !this.map.getIntactBridgeAt(u.x, u.y, this.bridges)) {
        speed *= 0.48; // Amphibious swim speed
      } else if (roadMask > 0) {
        speed *= 1.45; // Highway / Rail corridor transit bonus!
      } else {
        const slope = this.map.getSlope(u.x, u.y);
        speed *= Math.max(0.55, 1.0 - slope * 0.9);
        if (this.map.getLandcover(u.x, u.y) === 'forest') {
          speed *= def.category === 'infantry' ? 0.92 : 0.72;
        }
      }
    }

    // Fuel starvation penalty
    if (u.maxFuel > 0 && u.fuel <= 0.1) {
      speed *= 0.28;
    }

    const nx = u.x + Math.cos(u.angle) * speed * dt;
    const ny = u.y + Math.sin(u.angle) * speed * dt;

    let canMove = true;
    if (def.domain === 'sea') {
      canMove = this.map.isPassableForShip(nx, ny);
    } else if (def.domain === 'land' || def.domain === 'amphibious') {
      canMove = this.map.isPassableForLand(nx, ny, this.bridges, def.domain === 'amphibious');
    }

    if (canMove) {
      u.x = Math.max(25, Math.min(WORLD_WIDTH - 25, nx));
      u.y = Math.max(25, Math.min(WORLD_HEIGHT - 25, ny));
      u.vx = Math.cos(u.angle) * speed;
      u.vy = Math.sin(u.angle) * speed;
      if (u.maxFuel > 0) {
        const roadFactor = this.map.getRoadMaskAt(u.x, u.y) > 0 ? 0.6 : 1.0;
        u.fuel = Math.max(0, u.fuel - def.fuelBurnPerSec * roadFactor * dt);
      }
    } else {
      // Try sliding along X or Y around obstacles/shorelines
      if (
        def.domain === 'sea'
          ? this.map.isPassableForShip(nx, u.y)
          : this.map.isPassableForLand(nx, u.y, this.bridges, def.domain === 'amphibious')
      ) {
        u.x = nx;
      } else if (
        def.domain === 'sea'
          ? this.map.isPassableForShip(u.x, ny)
          : this.map.isPassableForLand(u.x, ny, this.bridges, def.domain === 'amphibious')
      ) {
        u.y = ny;
      } else {
        u.vx = 0;
        u.vy = 0;
        // Re-plan if bridge was just destroyed!
        this.rebuildWaypointsForCurrentOrder(u);
      }
    }

    const groundElev = Math.max(0, this.map.getElevation(u.x, u.y));
    u.z = groundElev + def.cruiseAltitude;
  }

  private stepUnitCombat(u: Unit, dt: number): void {
    if (u.holdFire || u.ammo <= 0) return;

    const def = UNIT_DEFS[u.type];
    const doc = DOCTRINES[this.economy[u.faction].doctrine];

    // 1. Secondary Point-Defense / CIWS / Naval SAM check first
    if (def.secondaryWeapon && u.secondaryCooldown <= 0) {
      if (def.secondaryWeapon.targetsMissile || def.secondaryWeapon.targetsAir) {
        const airThreat = this.findBestAirOrMissileTarget(
          u.faction,
          u.x,
          u.y,
          u.z + 6,
          def.secondaryWeapon.range,
          def.secondaryWeapon.targetsMissile,
        );
        if (airThreat && (!def.secondaryWeapon.requiresRadar || u.radarActive)) {
          u.secondaryCooldown = def.secondaryWeapon.reloadSec;
          if ('ballistic' in airThreat) {
            this.spawnInterceptMissile(u.faction, u.id, u.x, u.y, airThreat, def.secondaryWeapon.ballistic === 'ciws');
          } else {
            this.spawnProjectileFromSpec(
              u.faction,
              u.id,
              u.x,
              u.y,
              u.z + 6,
              def.secondaryWeapon,
              airThreat.x,
              airThreat.y,
              airThreat.z,
              airThreat.id,
            );
          }
        }
      }
    }

    // 2. Manual Ground Barrage / Bridge Strike Order
    const ord = u.orders[0];
    if (ord && ord.kind === 'attack_ground') {
      const dist = Math.hypot(ord.x - u.x, ord.y - u.y);
      if (dist <= def.primaryWeapon.range && dist >= def.primaryWeapon.minRange) {
        const aimAngle = Math.atan2(ord.y - u.y, ord.x - u.x);
        if (def.hasTurret) {
          u.turretAngle = stepAngle(u.turretAngle, aimAngle, def.turretTurnRate * dt);
        } else {
          u.angle = stepAngle(u.angle, aimAngle, def.turnRate * dt);
          u.turretAngle = u.angle;
        }
        if (
          Math.abs(normalizeAngle(u.turretAngle - aimAngle)) < 0.25 &&
          u.primaryCooldown <= 0 &&
          u.ammo >= def.primaryWeapon.ammoCost
        ) {
          u.primaryCooldown = def.primaryWeapon.reloadSec;
          u.ammo -= def.primaryWeapon.ammoCost;
          const tz = Math.max(0, this.map.getElevation(ord.x, ord.y));
          this.spawnProjectileFromSpec(
            u.faction,
            u.id,
            u.x,
            u.y,
            u.z + 5,
            def.primaryWeapon,
            ord.x,
            ord.y,
            tz,
            null,
          );
          if (def.domain === 'jet' && u.ammo <= 0) {
            u.orders.shift();
          }
        }
        return;
      }
    }

    // 3. Special SEAD Anti-Radiation Targeting (locks onto Active Enemy Radars & Radar Stations!)
    if (def.primaryWeapon.ballistic === 'sead') {
      if (u.primaryCooldown <= 0 && u.ammo >= def.primaryWeapon.ammoCost) {
        const seadMaxR = def.primaryWeapon.range * doc.seadRangeMult;
        const emitter = this.findEnemyRadarEmitter(u.faction, u.x, u.y, seadMaxR);
        if (emitter) {
          u.primaryCooldown = def.primaryWeapon.reloadSec;
          u.ammo -= def.primaryWeapon.ammoCost;
          this.spawnProjectileFromSpec(
            u.faction,
            u.id,
            u.x,
            u.y,
            u.z,
            def.primaryWeapon,
            emitter.x,
            emitter.y,
            emitter.z,
            emitter.unitId,
          );
        }
      }
      return;
    }

    // 4. Anti-Air / Anti-Missile Primary (Mobile SAM, MANPADS, Fighter Jet)
    if (!def.primaryWeapon.targetsGround && (def.primaryWeapon.targetsAir || def.primaryWeapon.targetsMissile)) {
      if (def.primaryWeapon.requiresRadar && !u.radarActive) return;
      const airTarget = this.findBestAirOrMissileTarget(
        u.faction,
        u.x,
        u.y,
        u.z + 6,
        def.primaryWeapon.range,
        def.primaryWeapon.targetsMissile,
      );
      if (airTarget) {
        const aimAngle = Math.atan2(airTarget.y - u.y, airTarget.x - u.x);
        if (def.hasTurret) {
          u.turretAngle = stepAngle(u.turretAngle, aimAngle, def.turretTurnRate * dt);
        } else if (def.domain !== 'jet') {
          u.angle = stepAngle(u.angle, aimAngle, def.turnRate * dt);
          u.turretAngle = u.angle;
        }
        if (u.primaryCooldown <= 0 && u.ammo >= def.primaryWeapon.ammoCost) {
          u.primaryCooldown = def.primaryWeapon.reloadSec;
          u.ammo -= def.primaryWeapon.ammoCost;
          if ('ballistic' in airTarget) {
            this.spawnInterceptMissile(u.faction, u.id, u.x, u.y, airTarget);
          } else {
            this.spawnProjectileFromSpec(
              u.faction,
              u.id,
              u.x,
              u.y,
              u.z + 6,
              def.primaryWeapon,
              airTarget.x,
              airTarget.y,
              airTarget.z,
              airTarget.id,
            );
          }
        }
      }
      return;
    }

    // 5. Standard Combined-Arms Target Acquisition (with Elevation Range Bonus & 3D LOS!)
    const target = this.findBestCombatTarget(u);
    if (!target) {
      if (def.hasTurret) {
        u.turretAngle = stepAngle(u.turretAngle, u.angle, def.turretTurnRate * 0.5 * dt);
      } else {
        u.turretAngle = u.angle;
      }
      return;
    }

    const aimAngle = Math.atan2(target.y - u.y, target.x - u.x);
    if (def.hasTurret) {
      u.turretAngle = stepAngle(u.turretAngle, aimAngle, def.turretTurnRate * dt);
    } else if (def.domain !== 'jet') {
      if (Math.hypot(u.vx, u.vy) < 1) {
        u.angle = stepAngle(u.angle, aimAngle, def.turnRate * dt);
      }
      u.turretAngle = u.angle;
    }

    const aimTolerance = def.domain === 'jet' ? 0.65 : 0.22;
    const aligned = Math.abs(normalizeAngle(u.turretAngle - aimAngle)) <= aimTolerance;

    if (aligned && u.primaryCooldown <= 0 && u.ammo >= def.primaryWeapon.ammoCost) {
      u.primaryCooldown = def.primaryWeapon.reloadSec;
      u.ammo -= def.primaryWeapon.ammoCost;
      this.spawnProjectileFromSpec(
        u.faction,
        u.id,
        u.x + Math.cos(u.turretAngle) * 10,
        u.y + Math.sin(u.turretAngle) * 10,
        u.z + 4,
        def.primaryWeapon,
        target.x,
        target.y,
        target.z + 3,
        target.id,
      );
    }

    // Coaxial / Secondary Ground/Air Weapon (MBT MG, IFV ATGM, Heli 30mm)
    if (
      aligned &&
      def.secondaryWeapon &&
      u.secondaryCooldown <= 0 &&
      u.ammo >= def.secondaryWeapon.ammoCost &&
      def.secondaryWeapon.targetsGround
    ) {
      const dist = Math.hypot(target.x - u.x, target.y - u.y);
      if (dist <= def.secondaryWeapon.range && dist >= def.secondaryWeapon.minRange) {
        // Don't waste IFV ATGMs on soft infantry
        if (def.secondaryWeapon.ballistic === 'atgm' && UNIT_DEFS[target.type].armorClass === 'soft') {
          return;
        }
        u.secondaryCooldown = def.secondaryWeapon.reloadSec;
        u.ammo -= def.secondaryWeapon.ammoCost;
        this.spawnProjectileFromSpec(
          u.faction,
          u.id,
          u.x + Math.cos(u.turretAngle) * 8,
          u.y + Math.sin(u.turretAngle) * 8,
          u.z + 4,
          def.secondaryWeapon,
          target.x,
          target.y,
          target.z + 3,
          target.id,
        );
      }
    }
  }

  private findEnemyRadarEmitter(
    myFaction: PlayableFaction,
    x: number,
    y: number,
    maxRange: number,
  ): { x: number; y: number; z: number; unitId: number | null } | null {
    const enemy: PlayableFaction = myFaction === 'blue' ? 'red' : 'blue';
    let best: { x: number; y: number; z: number; unitId: number | null } | null = null;
    let bestDist = maxRange;

    for (const u of this.units) {
      if (u.faction !== enemy || u.hp <= 0 || !u.radarActive || UNIT_DEFS[u.type].radarRange <= 0) continue;
      if (UNIT_DEFS[u.type].domain === 'jet') continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: u.x, y: u.y, z: u.z, unitId: u.id };
      }
    }

    for (const n of this.nodes) {
      if (n.faction !== enemy || n.destroyed) continue;
      if (n.type !== 'radar_station' && n.type !== 'sam_site') continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: n.x, y: n.y, z: Math.max(0, this.map.getElevation(n.x, n.y)) + 8, unitId: null };
      }
    }

    return best;
  }

  private findBestAirOrMissileTarget(
    myFaction: PlayableFaction,
    x: number,
    y: number,
    z: number,
    maxRange: number,
    includeMissiles: boolean,
  ): Unit | Projectile | null {
    const enemy: PlayableFaction = myFaction === 'blue' ? 'red' : 'blue';

    // Prioritize incoming cruise missiles / SEAD / ATGMs!
    if (includeMissiles) {
      for (const p of this.projectiles) {
        if (p.faction !== enemy || !p.interceptable || p.hp <= 0) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= maxRange && this.map.checkLineOfSight3D(x, y, z, p.x, p.y, p.z + 2, 1.0)) {
          return p;
        }
      }
    }

    let bestUnit: Unit | null = null;
    let bestDist = maxRange;
    for (const u of this.units) {
      if (u.faction !== enemy || u.hp <= 0) continue;
      const uDef = UNIT_DEFS[u.type];
      if (uDef.domain !== 'jet' && uDef.domain !== 'heli') continue;
      if (!this.isUnitDetectedBy(u, myFaction)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestDist && this.map.checkLineOfSight3D(x, y, z, u.x, u.y, u.z, 1.5)) {
        bestDist = d;
        bestUnit = u;
      }
    }
    return bestUnit;
  }

  private findBestCombatTarget(u: Unit): Unit | null {
    const def = UNIT_DEFS[u.type];
    const enemy: PlayableFaction = u.faction === 'blue' ? 'red' : 'blue';
    const indirect =
      def.primaryWeapon.ballistic === 'artillery' ||
      def.primaryWeapon.ballistic === 'cruise_missile' ||
      def.primaryWeapon.ballistic === 'bomb';

    // Explicit attack_unit target first
    const ord = u.orders[0];
    if (ord && ord.kind === 'attack_unit' && ord.targetUnitId !== undefined) {
      const explicit = this.units.find((t) => t.id === ord.targetUnitId && t.hp > 0);
      if (explicit && this.isUnitDetectedBy(explicit, u.faction)) {
        const d = Math.hypot(explicit.x - u.x, explicit.y - u.y);
        const elevBonus = indirect ? 0 : Math.max(-25, Math.min(45, (u.z - explicit.z) * 0.85));
        if (d <= def.primaryWeapon.range + elevBonus && d >= def.primaryWeapon.minRange) {
          if (
            indirect ||
            (!this.isBlockedBySmoke(u.x, u.y, explicit.x, explicit.y) &&
              this.map.checkLineOfSight3D(u.x, u.y, u.z + 4, explicit.x, explicit.y, explicit.z + 4))
          ) {
            return explicit;
          }
        }
      }
    }

    let best: Unit | null = null;
    let bestScore = -Infinity;

    for (const cand of this.units) {
      if (cand.faction !== enemy || cand.hp <= 0 || cand.insideTransportId !== null) continue;
      if (!this.isUnitDetectedBy(cand, u.faction)) continue;

      const cDef = UNIT_DEFS[cand.type];
      const isAir = cDef.domain === 'jet' || cDef.domain === 'heli';
      if (isAir && !def.primaryWeapon.targetsAir) continue;
      if (!isAir && !def.primaryWeapon.targetsGround) continue;

      const d = Math.hypot(cand.x - u.x, cand.y - u.y);
      const elevBonus = indirect ? 0 : Math.max(-25, Math.min(45, (u.z - cand.z) * 0.85));
      if (d > def.primaryWeapon.range + elevBonus || d < def.primaryWeapon.minRange) continue;

      if (!indirect) {
        if (this.isBlockedBySmoke(u.x, u.y, cand.x, cand.y)) continue;
        if (!this.map.checkLineOfSight3D(u.x, u.y, u.z + 4, cand.x, cand.y, cand.z + 4)) continue;
      }

      // Target priority scoring (ATGM/MBT prefers heavy armor, small arms prefers soft infantry)
      let score = 1000 - d;
      if (
        (def.primaryWeapon.ballistic === 'apfsds' || def.primaryWeapon.ballistic === 'atgm') &&
        (cDef.armorClass === 'heavy' || cDef.armorClass === 'light')
      ) {
        score += 250;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return best;
  }

  private isBlockedBySmoke(x1: number, y1: number, x2: number, y2: number): boolean {
    if (this.smokeClouds.length === 0) return false;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return false;
    for (const sm of this.smokeClouds) {
      const t = Math.max(0, Math.min(1, ((sm.x - x1) * dx + (sm.y - y1) * dy) / len2));
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      if (Math.hypot(sm.x - px, sm.y - py) < sm.radius) {
        return true;
      }
    }
    return false;
  }

  private spawnInterceptMissile(
    faction: PlayableFaction,
    sourceUnitId: number,
    x: number,
    y: number,
    targetMissile: Projectile,
    isCiws = false,
  ): void {
    const z = Math.max(0, this.map.getElevation(x, y)) + 8;
    const dx = targetMissile.x - x;
    const dy = targetMissile.y - y;
    const dz = targetMissile.z - z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    const speed = isCiws ? 720 : 540;

    if (this.onSound) {
      this.onSound(isCiws ? 'ciws' : 'missile', x, y);
    }

    if (isCiws) {
      // CIWS high-ROF burst directly shreds missile HP
      targetMissile.hp -= 30;
      this.effects.push({
        id: this.allocId(),
        kind: 'ciws_burst',
        x: targetMissile.x,
        y: targetMissile.y,
        z: targetMissile.z,
        radius: 14,
        age: 0,
        duration: 0.2,
        color: 0xfff176,
      });
      if (targetMissile.hp <= 0) {
        this.effects.push({
          id: this.allocId(),
          kind: 'explosion',
          x: targetMissile.x,
          y: targetMissile.y,
          z: targetMissile.z,
          radius: 22,
          age: 0,
          duration: 0.35,
          color: 0xffb74d,
        });
      }
      return;
    }

    this.projectiles.push({
      id: this.allocId(),
      faction,
      sourceUnitId,
      ballistic: 'sam',
      x,
      y,
      z,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      vz: (dz / dist) * speed,
      speed,
      damage: 100,
      splashRadius: 24,
      targetX: targetMissile.x,
      targetY: targetMissile.y,
      targetZ: targetMissile.z,
      targetUnitId: -targetMissile.id, // negative ID encodes missile interception!
      hp: 20,
      interceptable: false,
      age: 0,
      maxAge: 3.5,
    });
  }

  private spawnProjectileFromSpec(
    faction: PlayableFaction,
    sourceUnitId: number,
    x: number,
    y: number,
    z: number,
    spec: Unit['type'] extends never ? never : (typeof UNIT_DEFS)['mbt']['primaryWeapon'],
    tx: number,
    ty: number,
    tz: number,
    targetUnitId: number | null,
  ): void {
    const dx = tx - x;
    const dy = ty - y;
    const groundDist = Math.max(1, Math.hypot(dx, dy));
    const speed = spec.projectileSpeed;
    let vx = (dx / groundDist) * speed;
    let vy = (dy / groundDist) * speed;
    let vz = ((tz - z) / groundDist) * speed;

    // 3D Parabolic Gravity Arc for 155mm Howitzers!
    if (spec.ballistic === 'artillery') {
      const flightTime = groundDist / speed;
      const gravity = 155; // m/s^2 scaled for dramatic 3D arc over hills!
      vz = (tz - z) / flightTime + 0.5 * gravity * flightTime;
      // Slight artillery dispersion
      const disp = this.rng.range(-18, 18);
      const dispY = this.rng.range(-18, 18);
      tx += disp;
      ty += dispY;
      vx = ((tx - x) / groundDist) * speed;
      vy = ((ty - y) / groundDist) * speed;
    } else if (spec.ballistic === 'cruise_missile') {
      z += 18; // Vertical VLS launch pop-up!
      vz = 0;
    } else if (spec.ballistic === 'bomb') {
      const doc = DOCTRINES[this.economy[faction].doctrine];
      spec = { ...spec, damage: Math.round(spec.damage * doc.bombDamageMult) };
    }

    const interceptable =
      spec.ballistic === 'cruise_missile' ||
      spec.ballistic === 'sead' ||
      spec.ballistic === 'atgm';

    this.projectiles.push({
      id: this.allocId(),
      faction,
      sourceUnitId,
      ballistic: spec.ballistic,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      speed,
      damage: spec.damage,
      splashRadius: spec.splashRadius,
      targetX: tx,
      targetY: ty,
      targetZ: tz,
      targetUnitId,
      hp: spec.ballistic === 'cruise_missile' ? 55 : 25,
      interceptable,
      age: 0,
      maxAge: Math.max(2.5, (groundDist / speed) * 1.8),
    });

    this.effects.push({
      id: this.allocId(),
      kind: 'muzzle',
      x,
      y,
      z,
      radius: spec.ballistic === 'artillery' || spec.ballistic === 'apfsds' ? 12 : 6,
      age: 0,
      duration: 0.12,
      color: 0xffd54f,
    });

    if (this.onSound) {
      if (spec.ballistic === 'apfsds' || spec.ballistic === 'artillery') {
        this.onSound('cannon', x, y);
      } else if (spec.ballistic === 'autocannon') {
        this.onSound('autocannon', x, y);
      } else if (spec.ballistic === 'small_arms') {
        this.onSound('small_arms', x, y);
      } else {
        this.onSound('missile', x, y);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const gravity = 155;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.hp <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      p.age += dt;
      if (p.age > p.maxAge) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Missile Interception Tracking (targetUnitId < 0)
      if (p.targetUnitId !== null && p.targetUnitId < 0) {
        const targetProjId = -p.targetUnitId;
        const mTarget = this.projectiles.find((m) => m.id === targetProjId && m.hp > 0);
        if (!mTarget) {
          this.projectiles.splice(i, 1);
          continue;
        }
        const dx = mTarget.x - p.x;
        const dy = mTarget.y - p.y;
        const dz = mTarget.z - p.z;
        const d = Math.max(1, Math.hypot(dx, dy, dz));
        if (d < 22) {
          mTarget.hp = 0;
          this.effects.push({
            id: this.allocId(),
            kind: 'explosion',
            x: mTarget.x,
            y: mTarget.y,
            z: mTarget.z,
            radius: 26,
            age: 0,
            duration: 0.4,
            color: 0x4fc3f7,
          });
          if (this.onSound) this.onSound('explosion', mTarget.x, mTarget.y);
          this.projectiles.splice(i, 1);
          continue;
        }
        p.vx = (dx / d) * p.speed;
        p.vy = (dy / d) * p.speed;
        p.vz = (dz / d) * p.speed;
      } else if (
        (p.ballistic === 'atgm' || p.ballistic === 'sam' || p.ballistic === 'sead') &&
        p.targetUnitId !== null
      ) {
        const tu = this.units.find((u) => u.id === p.targetUnitId && u.hp > 0);
        if (tu) {
          // SEAD loses lock if target switches radar OFF!
          const lostSead = p.ballistic === 'sead' && !tu.radarActive;
          // ATGM loses guidance if target pops smokescreen!
          const smoked =
            p.ballistic === 'atgm' &&
            this.smokeClouds.some((s) => Math.hypot(s.x - tu.x, s.y - tu.y) < s.radius + 12);

          if (!lostSead && !smoked) {
            p.targetX = tu.x;
            p.targetY = tu.y;
            p.targetZ = tu.z + 3;
            const dx = p.targetX - p.x;
            const dy = p.targetY - p.y;
            const dz = p.targetZ - p.z;
            const d = Math.max(1, Math.hypot(dx, dy, dz));
            p.vx = (dx / d) * p.speed;
            p.vy = (dy / d) * p.speed;
            p.vz = (dz / d) * p.speed;
          }
        }
      }

      // Advance 3D coordinates
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const terrZ = Math.max(0, this.map.getElevation(p.x, p.y));

      if (p.ballistic === 'artillery') {
        p.vz -= gravity * dt;
        p.z += p.vz * dt;
      } else if (p.ballistic === 'cruise_missile') {
        // Terrain-skimming cruise altitude (hugs valleys & climbs ridges smoothly!)
        const distRem = Math.hypot(p.targetX - p.x, p.targetY - p.y);
        if (distRem < 95) {
          // Terminal dive onto target!
          const dz = p.targetZ - p.z;
          p.z += (dz / Math.max(0.08, distRem / p.speed)) * dt;
        } else {
          const desiredZ = terrZ + 15;
          p.z += (desiredZ - p.z) * Math.min(1, 7.5 * dt);
        }
      } else {
        p.z += p.vz * dt;
      }

      // Check proximity detonation or 3D Terrain Collision!
      const distToTarget2D = Math.hypot(p.targetX - p.x, p.targetY - p.y);
      const hitTarget =
        distToTarget2D < 16 && Math.abs(p.z - p.targetZ) < 24;
      const hitRidge = p.z <= terrZ && p.age > 0.08;

      if (hitTarget || hitRidge) {
        this.detonateProjectile(p);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private detonateProjectile(p: Projectile): void {
    const enemy: PlayableFaction = p.faction === 'blue' ? 'red' : 'blue';
    const enemyDoc = DOCTRINES[this.economy[enemy].doctrine];

    // ECM Evasion check for guided missiles
    if (
      (p.ballistic === 'sam' || p.ballistic === 'atgm' || p.ballistic === 'sead') &&
      this.rng.next() < enemyDoc.ecmMissChance
    ) {
      this.effects.push({
        id: this.allocId(),
        kind: 'explosion',
        x: p.x + 18,
        y: p.y - 14,
        z: p.z,
        radius: 14,
        age: 0,
        duration: 0.25,
        color: 0x90caf9,
      });
      return;
    }

    const hitRadius = Math.max(18, p.splashRadius);

    for (const u of this.units) {
      if (u.faction === p.faction || u.hp <= 0 || u.insideTransportId !== null) continue;
      const uDef = UNIT_DEFS[u.type];
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      const dz = Math.abs(u.z - p.z);
      if (d <= hitRadius + uDef.radius && dz <= 38) {
        let dmg = p.damage;
        if (p.splashRadius > 12 && d > uDef.radius + 6) {
          dmg *= Math.max(0.25, 1 - d / (hitRadius + uDef.radius));
        }

        // Armor Class Interactions
        if (p.ballistic === 'small_arms') {
          if (uDef.armorClass === 'heavy' || uDef.armorClass === 'ship') dmg *= 0.06;
          else if (uDef.armorClass === 'light') dmg *= 0.25;
        } else if (p.ballistic === 'autocannon') {
          if (uDef.armorClass === 'heavy' || uDef.armorClass === 'ship') dmg *= 0.22;
        }

        // Directional Front / Side / Rear Armor Multiplier!
        if (
          uDef.directionalArmor &&
          (p.ballistic === 'apfsds' || p.ballistic === 'atgm' || p.ballistic === 'autocannon')
        ) {
          const incomingAngle = Math.atan2(p.vy, p.vx); // direction shell travels
          const hitFromAngle = normalizeAngle(incomingAngle + Math.PI); // direction relative to unit center
          const relAngle = Math.abs(normalizeAngle(hitFromAngle - u.angle));
          if (relAngle < Math.PI / 3) {
            // Front 60-deg glacis hit!
            dmg *= Math.max(0.42, 0.65 - (u.type === 'mbt' ? enemyDoc.tankFrontArmorBonus : 0));
          } else if (relAngle > (2 * Math.PI) / 3) {
            // Rear engine deck critical hit!
            dmg *= 1.65;
          } else {
            // Side hull hit
            dmg *= 1.12;
          }
        }

        // Garrison & Forest Cover protection for Infantry
        if (uDef.category === 'infantry') {
          if (u.garrisonNodeId !== null) dmg *= 0.42;
          else if (this.map.getLandcover(u.x, u.y) === 'forest') dmg *= 0.68;
        }

        u.hp -= dmg;
        if (u.hp <= 0) {
          this.effects.push({
            id: this.allocId(),
            kind: 'explosion',
            x: u.x,
            y: u.y,
            z: u.z,
            radius: uDef.radius * 2.1,
            age: 0,
            duration: 0.55,
            color: 0xff7043,
          });
          if (this.onSound) this.onSound('heavy_explosion', u.x, u.y);
        }
      }
    }

    // Heavy Ordnance Infrastructure Damage (Bridges, Runways, Radar Domes, Rail/Road Segments!)
    const isHeavyOrdnance =
      p.ballistic === 'bomb' ||
      p.ballistic === 'artillery' ||
      p.ballistic === 'cruise_missile' ||
      p.ballistic === 'sead' ||
      p.ballistic === 'apfsds';

    if (isHeavyOrdnance) {
      // 1. Check Bridges
      for (const br of this.bridges) {
        if (!br.destroyed && Math.hypot(br.x - p.x, br.y - p.y) < hitRadius + 38) {
          const structMult = p.ballistic === 'apfsds' ? 0.35 : 1.1;
          br.hp -= p.damage * structMult;
          if (br.hp <= 0) {
            br.hp = 0;
            br.destroyed = true;
            const sp = this.map.splines.find((s) => s.id === br.splineId);
            sp?.damagedSegments.add(br.segmentIndex);
            this.emitAlert('all', `${br.name} demolished! Supply line severed!`, 'warn');
          }
        }
      }

      // 2. Check Nodes (Runways, Radars, HQs, SAM Sites, FOBs)
      for (const nd of this.nodes) {
        if (nd.faction === p.faction || nd.destroyed) continue;
        if (Math.hypot(nd.x - p.x, nd.y - p.y) < nd.radius + hitRadius * 0.6) {
          const structMult = p.ballistic === 'apfsds' ? 0.35 : 1.0;
          nd.hp -= p.damage * structMult;
          if (nd.hp <= 0) {
            nd.hp = 0;
            nd.destroyed = true;
            if (nd.type === 'hq') {
              this.winner = p.faction;
            } else {
              this.emitAlert(
                'all',
                `${nd.name} neutralized! Combat Engineers required for repair.`,
                'warn',
              );
            }
          }
        }
      }

      // 3. Bombs & Cruise Missiles can sever exposed Rail/Highway segments & leave craters!
      if (p.ballistic === 'bomb' || p.ballistic === 'cruise_missile' || p.ballistic === 'artillery') {
        if (this.map.getElevation(p.x, p.y) > 0.2 && this.craters.length < 220) {
          this.craters.push({ x: p.x, y: p.y, r: p.ballistic === 'artillery' ? 9 : 14 });
        }
        if (p.ballistic === 'bomb' || p.ballistic === 'cruise_missile') {
          for (const sp of this.map.splines) {
            for (let s = 0; s < sp.points.length - 1; s++) {
              const a = sp.points[s];
              const b = sp.points[s + 1];
              const mx = (a.x + b.x) * 0.5;
              const my = (a.y + b.y) * 0.5;
              if (Math.hypot(mx - p.x, my - p.y) < 42) {
                sp.damagedSegments.add(s);
              }
            }
          }
        }
      }
    }

    // Visual & Audio Impact
    const inWater =
      this.map.getElevation(p.x, p.y) < -0.5 &&
      !this.map.getIntactBridgeAt(p.x, p.y, this.bridges) &&
      p.z < 5;

    this.effects.push({
      id: this.allocId(),
      kind: inWater ? 'splash' : 'explosion',
      x: p.x,
      y: p.y,
      z: Math.max(0, p.z),
      radius: Math.max(10, p.splashRadius * 0.85),
      age: 0,
      duration: p.splashRadius > 30 ? 0.5 : 0.28,
      color: inWater ? 0x81d4fa : p.splashRadius > 30 ? 0xff8a65 : 0xffd54f,
    });

    if (this.onSound && p.splashRadius >= 10) {
      this.onSound(p.splashRadius > 35 ? 'heavy_explosion' : 'explosion', p.x, p.y);
    }
  }

  private updateSmokeAndEffects(dt: number): void {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      this.smokeClouds[i].remainingSec -= dt;
      if (this.smokeClouds[i].remainingSec <= 0) {
        this.smokeClouds.splice(i, 1);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].age += dt;
      if (this.effects[i].age >= this.effects[i].duration) {
        this.effects.splice(i, 1);
      }
    }
  }

  /** Computes Height-Shadowed Visual LOS & Radar Horizon Coverage */
  updateVisibilityGrid(): void {
    for (const faction of ['blue', 'red'] as PlayableFaction[]) {
      const vis = this.visible[faction];
      const exp = this.explored[faction];
      vis.fill(0);

      const doc = DOCTRINES[this.economy[faction].doctrine];

      const stampSensor = (
        sx: number,
        sy: number,
        sz: number,
        visRange: number,
        radRange: number,
        isAirborne: boolean,
      ) => {
        const maxR = Math.max(visRange, radRange);
        const minCol = Math.max(0, Math.floor((sx - maxR) / FOG_STEP));
        const maxCol = Math.min(FOG_COLS - 1, Math.ceil((sx + maxR) / FOG_STEP));
        const minRow = Math.max(0, Math.floor((sy - maxR) / FOG_STEP));
        const maxRow = Math.min(FOG_ROWS - 1, Math.ceil((sy + maxR) / FOG_STEP));

        for (let r = minRow; r <= maxRow; r++) {
          const cy = r * FOG_STEP + FOG_STEP * 0.5;
          for (let c = minCol; c <= maxCol; c++) {
            const idx = r * FOG_COLS + c;
            if (vis[idx] === 1) continue; // Already full visual LOS

            const cx = c * FOG_STEP + FOG_STEP * 0.5;
            const d = Math.hypot(cx - sx, cy - sy);
            if (d > maxR) continue;

            const cellZ = Math.max(0, this.map.getElevation(cx, cy));
            if (d <= visRange) {
              if (
                isAirborne ||
                d < 65 ||
                this.map.checkLineOfSight3D(sx, sy, sz + 5, cx, cy, cellZ + 4, 2.5)
              ) {
                vis[idx] = 1;
                exp[idx] = 1;
                continue;
              }
            }
            if (d <= radRange && vis[idx] === 0) {
              if (
                isAirborne ||
                this.map.checkLineOfSight3D(sx, sy, sz + 9, cx, cy, cellZ + 12, 3.0)
              ) {
                vis[idx] = 2; // Radar coverage!
                exp[idx] = 1;
              }
            }
          }
        }
      };

      for (const n of this.nodes) {
        if (n.faction !== faction || n.destroyed) continue;
        const nz = Math.max(0, this.map.getElevation(n.x, n.y)) + 10;
        stampSensor(n.x, n.y, nz, n.radius + 165, n.radarRange * doc.radarRangeMult, false);
      }

      for (const u of this.units) {
        if (u.faction !== faction || u.hp <= 0 || u.insideTransportId !== null) continue;
        const def = UNIT_DEFS[u.type];
        const isAir = def.domain === 'jet' || def.domain === 'heli';
        // Elevated ground units get expanded visual horizon!
        const heightBonus = isAir ? 0 : Math.max(0, (u.z - 20) * 1.35);
        const vr = (def.visionRange + heightBonus) * (u.type === 'recon_uav' ? doc.radarRangeMult : 1);
        const rr = u.radarActive ? def.radarRange * doc.radarRangeMult : 0;
        stampSensor(u.x, u.y, u.z, vr, rr, isAir);
      }
    }
  }

  isCellVisible(faction: PlayableFaction, worldX: number, worldY: number): number {
    const c = Math.max(0, Math.min(FOG_COLS - 1, Math.floor(worldX / FOG_STEP)));
    const r = Math.max(0, Math.min(FOG_ROWS - 1, Math.floor(worldY / FOG_STEP)));
    return this.visible[faction][r * FOG_COLS + c];
  }

  isCellExplored(faction: PlayableFaction, worldX: number, worldY: number): boolean {
    const c = Math.max(0, Math.min(FOG_COLS - 1, Math.floor(worldX / FOG_STEP)));
    const r = Math.max(0, Math.min(FOG_ROWS - 1, Math.floor(worldY / FOG_STEP)));
    return this.explored[faction][r * FOG_COLS + c] === 1;
  }

  /** Checks if enemy unit `target` is spotted by `viewerFaction` (accounting for forest/urban stealth vs radar!) */
  isUnitDetectedBy(target: Unit, viewerFaction: PlayableFaction): boolean {
    if (target.faction === viewerFaction) return true;
    // Active radar emission gives away emitter position to ESM receivers!
    if (target.radarActive && UNIT_DEFS[target.type].radarRange > 0) {
      return true;
    }

    const cellVis = this.isCellVisible(viewerFaction, target.x, target.y);
    if (cellVis === 0) return false;

    const tDef = UNIT_DEFS[target.type];
    const inCover =
      target.garrisonNodeId !== null || this.map.getLandcover(target.x, target.y) === 'forest';

    // Stealth infantry in forests/cities cannot be picked up by distant ground radar alone — requires visual recon!
    if (cellVis === 2 && tDef.category === 'infantry' && inCover) {
      return false;
    }
    return true;
  }

  private checkVictoryConditions(): void {
    const blueHq = this.nodes.find((n) => n.type === 'hq' && n.id === 1);
    const redHq = this.nodes.find((n) => n.type === 'hq' && n.id !== 1);
    if (blueHq && (blueHq.destroyed || blueHq.faction === 'red')) {
      this.winner = 'red';
    } else if (redHq && (redHq.destroyed || redHq.faction === 'blue')) {
      this.winner = 'blue';
    }
  }
}
