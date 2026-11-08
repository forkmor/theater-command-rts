import { UNIT_DEFS } from '../core/definitions';
import type { AIDifficulty, PlayableFaction, UnitType } from '../core/types';
import type { GameSimulation } from './simulation';

export class AICommander {
  readonly faction: PlayableFaction;
  readonly difficulty: AIDifficulty;
  private decisionTimer = 1.5;
  private buildTimer = 2.0;

  constructor(faction: PlayableFaction, difficulty: AIDifficulty) {
    this.faction = faction;
    this.difficulty = difficulty;
  }

  update(sim: GameSimulation, dt: number): void {
    if (sim.winner) return;

    const interval =
      this.difficulty === 'hardcore' ? 1.6 : this.difficulty === 'tactical' ? 2.6 : 4.2;

    // Slight AI budget boost on hardcore
    if (this.difficulty === 'hardcore') {
      sim.economy[this.faction].money = Math.min(9999, sim.economy[this.faction].money + 8 * dt);
    }

    this.buildTimer -= dt;
    if (this.buildTimer <= 0) {
      this.buildTimer = interval * 1.3;
      this.handleReinforcements(sim);
    }

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = interval;
      this.handleTacticalManeuvers(sim);
    }
  }

  private handleReinforcements(sim: GameSimulation): void {
    const econ = sim.economy[this.faction];
    const myUnits = sim.units.filter((u) => u.faction === this.faction && u.hp > 0);
    if (myUnits.length >= 36) return;

    const countByType = (t: UnitType) => myUnits.filter((u) => u.type === t).length;
    const hasAirfield = sim.nodes.some(
      (n) => n.faction === this.faction && n.type === 'airfield' && !n.destroyed,
    );
    const hasSeaport = sim.nodes.some(
      (n) => n.faction === this.faction && n.type === 'seaport' && !n.destroyed,
    );

    let desired: UnitType = 'rifle_squad';

    if (countByType('rifle_squad') < 3) {
      desired = 'rifle_squad';
    } else if (countByType('ifv') < 2) {
      desired = 'ifv';
    } else if (countByType('recon_uav') < 1) {
      desired = 'recon_uav';
    } else if (countByType('combat_eng') < 1) {
      desired = 'combat_eng';
    } else if (countByType('mbt') < 3) {
      desired = 'mbt';
    } else if (countByType('mobile_sam') < 2) {
      desired = 'mobile_sam';
    } else if (hasSeaport && countByType('frigate') < 1 && econ.money >= 560 && this.difficulty !== 'easy') {
      desired = 'frigate';
    } else if (hasAirfield && countByType('attack_heli') < 2 && econ.money >= 370) {
      desired = 'attack_heli';
    } else if (
      hasAirfield &&
      this.difficulty !== 'easy' &&
      countByType('sead_jet') < 1 &&
      econ.money >= 430
    ) {
      desired = 'sead_jet';
    } else if (
      hasAirfield &&
      this.difficulty === 'hardcore' &&
      countByType('strike_jet') < 1 &&
      econ.money >= 470
    ) {
      desired = 'strike_jet';
    } else {
      const pool: UnitType[] = [
        'mbt',
        'ifv',
        'atgm_team',
        'manpads_team',
        'spg_artillery',
        'rifle_squad',
        'corvette',
      ];
      desired = pool[sim.rng.int(0, pool.length - 1)];
      if (desired === 'corvette' && !hasSeaport) desired = 'mbt';
    }

    if (econ.money >= UNIT_DEFS[desired].costMoney) {
      // Deploy toward the real Suwałki–Kalvarija–Wiżajny–Kybartai border corridor
      const frontX = 2190 + sim.rng.range(-260, 260);
      const frontY = 1480 + sim.rng.range(-260, 260);
      sim.executeCommand({
        kind: 'DEPLOY_UNIT',
        faction: this.faction,
        unitType: desired,
        targetX: frontX,
        targetY: frontY,
      });
    }
  }

  private handleTacticalManeuvers(sim: GameSimulation): void {
    const enemy: PlayableFaction = this.faction === 'blue' ? 'red' : 'blue';
    const myUnits = sim.units.filter(
      (u) => u.faction === this.faction && u.hp > 0 && u.insideTransportId === null,
    );

    // 1. Pop defensive smokescreens on damaged armor!
    for (const u of myUnits) {
      if (UNIT_DEFS[u.type].canSmoke && u.smokeCooldown <= 0 && u.hp < u.maxHp * 0.68) {
        sim.executeCommand({
          kind: 'UNIT_ABILITY',
          faction: this.faction,
          unitIds: [u.id],
          ability: 'pop_smoke',
        });
      }
    }

    // 2. Dispatch Combat Engineers to repair damaged bridges or airfields/radars
    const engineers = myUnits.filter((u) => u.type === 'combat_eng' && u.orders.length === 0);
    if (engineers.length > 0) {
      const brokenNode = sim.nodes.find(
        (n) => n.faction === this.faction && (n.destroyed || n.hp < n.maxHp * 0.7),
      );
      const brokenBridge = sim.bridges.find((b) => b.destroyed);
      if (brokenNode) {
        sim.executeCommand({
          kind: 'ORDER_UNITS',
          faction: this.faction,
          unitIds: engineers.map((e) => e.id),
          order: {
            kind: 'repair_target',
            x: brokenNode.x,
            y: brokenNode.y,
            targetNodeId: brokenNode.id,
          },
          queue: false,
        });
      } else if (brokenBridge) {
        sim.executeCommand({
          kind: 'ORDER_UNITS',
          faction: this.faction,
          unitIds: engineers.map((e) => e.id),
          order: {
            kind: 'repair_target',
            x: brokenBridge.x,
            y: brokenBridge.y,
            targetBridgeId: brokenBridge.id,
          },
          queue: false,
        });
      }
    }

    // 3. Direct Naval Ships along the Western Baltic Coast (between Baltiysk 54.64°N and Klaipėda 55.71°N)
    const idleShips = myUnits.filter(
      (u) => UNIT_DEFS[u.type].domain === 'sea' && u.orders.length === 0,
    );
    for (const ship of idleShips) {
      const patrolX = 160 + sim.rng.range(0, 420);
      const patrolY = 220 + sim.rng.range(0, 960);
      sim.executeCommand({
        kind: 'ORDER_UNITS',
        faction: this.faction,
        unitIds: [ship.id],
        order: { kind: 'attack_move', x: patrolX, y: patrolY },
        queue: false,
      });
    }

    // 4. Direct Strike & SEAD Jets toward high-value targets
    const jets = myUnits.filter(
      (u) => UNIT_DEFS[u.type].domain === 'jet' && !u.returningToBase,
    );
    for (const jet of jets) {
      if (jet.type === 'strike_jet') {
        const enemyTarget = sim.units.find(
          (e) =>
            e.faction === enemy &&
            e.hp > 0 &&
            (e.type === 'mbt' || e.type === 'spg_artillery') &&
            sim.isUnitDetectedBy(e, this.faction),
        );
        if (enemyTarget) {
          sim.executeCommand({
            kind: 'ORDER_UNITS',
            faction: this.faction,
            unitIds: [jet.id],
            order: {
              kind: 'attack_unit',
              x: enemyTarget.x,
              y: enemyTarget.y,
              targetUnitId: enemyTarget.id,
            },
            queue: false,
          });
        }
      } else if (jet.orders.length === 0) {
        sim.executeCommand({
          kind: 'ORDER_UNITS',
          faction: this.faction,
          unitIds: [jet.id],
          order: { kind: 'patrol_air', x: 2190, y: 1480 },
          queue: false,
        });
      }
    }

    // 5. Assign Idle Ground & Heli Units to Capture Neutral / Enemy Strategic Nodes!
    const idleGround = myUnits.filter(
      (u) =>
        u.orders.length === 0 &&
        u.type !== 'combat_eng' &&
        UNIT_DEFS[u.type].domain !== 'sea' &&
        UNIT_DEFS[u.type].domain !== 'jet',
    );

    if (idleGround.length === 0) return;

    const myHq = sim.nodes.find((n) => n.type === 'hq' && n.faction === this.faction);
    const homeX = myHq ? myHq.x : this.faction === 'red' ? 1723 : 2236;
    const homeY = myHq ? myHq.y : this.faction === 'red' ? 1291 : 1813;

    const targetNodes = sim.nodes
      .filter(
        (n) =>
          n.faction !== this.faction &&
          n.type !== 'seaport' &&
          n.type !== 'sam_site' &&
          n.type !== 'fob',
      )
      .sort((a, b) => {
        const da = Math.hypot(a.x - homeX, a.y - homeY) + (a.faction === 'neutral' ? -350 : 0);
        const db = Math.hypot(b.x - homeX, b.y - homeY) + (b.faction === 'neutral' ? -350 : 0);
        return da - db;
      });

    if (targetNodes.length > 0) {
      // Split forces across top 2 priority sectors
      const primaryNode = targetNodes[0];
      const secondaryNode = targetNodes[Math.min(1, targetNodes.length - 1)];

      const groupA: number[] = [];
      const groupB: number[] = [];
      idleGround.forEach((u, idx) => {
        if (idx % 2 === 0) groupA.push(u.id);
        else groupB.push(u.id);
      });

      if (groupA.length > 0) {
        sim.executeCommand({
          kind: 'ORDER_UNITS',
          faction: this.faction,
          unitIds: groupA,
          order: { kind: 'attack_move', x: primaryNode.x, y: primaryNode.y },
          queue: false,
        });
      }
      if (groupB.length > 0) {
        sim.executeCommand({
          kind: 'ORDER_UNITS',
          faction: this.faction,
          unitIds: groupB,
          order: { kind: 'attack_move', x: secondaryNode.x, y: secondaryNode.y },
          queue: false,
        });
      }
    }
  }
}
