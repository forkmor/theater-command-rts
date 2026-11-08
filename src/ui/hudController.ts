import { UNIT_DEFS, UNIT_ORDER_LIST } from '../core/definitions';
import type { GameCommand, PlayableFaction, UnitCategory, UnitType } from '../core/types';
import { soundEngine } from '../audio/soundEngine';
import type { WorldRenderer } from '../render/worldRenderer';
import { FOG_COLS, FOG_ROWS, type GameSimulation, type RadioAlert } from '../sim/simulation';
import { WORLD_HEIGHT, WORLD_WIDTH, worldToLatLon } from '../world/suwalkiMap';

type CursorCommandMode = 'normal' | 'attack_move' | 'attack_ground';

export class HudController {
  private sim: GameSimulation | null = null;
  private renderer: WorldRenderer;
  private playerFaction: PlayableFaction = 'blue';
  private dispatchCommand: (cmd: GameCommand) => void;
  private onExitMatch: () => void;

  readonly selectedIds = new Set<number>();
  private controlGroups = new Map<number, number[]>();
  private lastGroupTap = { group: -1, time: 0 };

  private activeCategory: UnitCategory = 'ground';
  private cursorMode: CursorCommandMode = 'normal';

  // Camera & Mouse state
  private keysDown = new Set<string>();
  private isBoxDragging = false;
  private boxStartScreen = { x: 0, y: 0 };
  private isMiddlePanning = false;
  private panLastScreen = { x: 0, y: 0 };
  private isMinimapDragging = false;

  // Hold Right-Click Radial Menu state
  private rightDownTimer: number | null = null;
  private rightDownScreen = { x: 0, y: 0 };
  private radialOpen = false;
  private radialWorldTarget = { x: 0, y: 0 };
  private lastClickUnit = { id: -1, time: 0 };

  // DOM Elements
  private elTopBar = document.getElementById('hud-top-bar')!;
  private elLeftDock = document.getElementById('hud-left-dock')!;
  private elBottomBar = document.getElementById('hud-bottom-bar')!;
  private elAlertFeed = document.getElementById('hud-alert-feed')!;
  private elSelectionBox = document.getElementById('selection-box')!;
  private elRadialMenu = document.getElementById('radial-menu')!;
  private elRadialItems = document.getElementById('radial-items-container')!;
  private elReinforceList = document.getElementById('reinforce-list')!;
  private elNodeStatus = document.getElementById('dock-node-status')!;
  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private minimapCtx = this.minimapCanvas.getContext('2d')!;

  private lastHudRefresh = 0;

  constructor(
    renderer: WorldRenderer,
    dispatchCommand: (cmd: GameCommand) => void,
    onExitMatch: () => void,
  ) {
    this.renderer = renderer;
    this.dispatchCommand = dispatchCommand;
    this.onExitMatch = onExitMatch;

    this.bindDomEvents();
  }

  attachMatch(sim: GameSimulation, faction: PlayableFaction): void {
    this.sim = sim;
    this.playerFaction = faction;
    this.selectedIds.clear();
    this.controlGroups.clear();
    this.cursorMode = 'normal';
    this.closeRadialMenu();

    // Select player's initial tanks & IFV for immediate action
    for (const u of sim.units) {
      if (u.faction === faction && (u.type === 'mbt' || u.type === 'ifv')) {
        this.selectedIds.add(u.id);
      }
    }

    const badge = document.getElementById('hud-faction-badge')!;
    badge.textContent = faction === 'blue' ? 'BLUE TASK FORCE' : 'RED COALITION';
    badge.className = faction === 'red' ? 'faction-badge red' : 'faction-badge';

    this.elTopBar.classList.remove('hidden');
    this.elLeftDock.classList.remove('hidden');
    this.elBottomBar.classList.remove('hidden');
    this.elAlertFeed.classList.remove('hidden');
    this.elAlertFeed.innerHTML = '';

    this.renderReinforcementCards();
    this.refreshInspectorAndResources();
  }

  detachMatch(): void {
    this.sim = null;
    this.selectedIds.clear();
    this.closeRadialMenu();
    this.elTopBar.classList.add('hidden');
    this.elLeftDock.classList.add('hidden');
    this.elBottomBar.classList.add('hidden');
    this.elAlertFeed.classList.add('hidden');
  }

  pushAlert(alert: RadioAlert): void {
    if (alert.faction !== 'all' && alert.faction !== this.playerFaction) return;
    const div = document.createElement('div');
    div.className = `alert-toast ${alert.level}`;
    div.textContent = `> ${alert.text}`;
    this.elAlertFeed.prepend(div);
    while (this.elAlertFeed.children.length > 5) {
      this.elAlertFeed.lastElementChild?.remove();
    }
    window.setTimeout(() => {
      div.remove();
    }, 5500);
  }

  update(dt: number): void {
    if (!this.sim) return;

    // Smooth WASD / Arrow camera pan
    const panSpeed = (560 / this.renderer.zoom) * dt;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) this.renderer.camY -= panSpeed;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) this.renderer.camY += panSpeed;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) this.renderer.camX -= panSpeed;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) this.renderer.camX += panSpeed;

    // Prune dead units from selection
    for (const id of Array.from(this.selectedIds)) {
      const u = this.sim.units.find((x) => x.id === id && x.hp > 0 && x.insideTransportId === null);
      if (!u) this.selectedIds.delete(id);
    }

    this.lastHudRefresh += dt;
    if (this.lastHudRefresh >= 0.15) {
      this.lastHudRefresh = 0;
      this.refreshInspectorAndResources();
      this.renderMinimap();
    }
  }

  private bindDomEvents(): void {
    const canvasContainer = document.getElementById('pixi-canvas-container')!;

    canvasContainer.addEventListener('contextmenu', (e) => e.preventDefault());
    this.elRadialMenu.addEventListener('contextmenu', (e) => e.preventDefault());
    this.minimapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Canvas Pointer Down
    canvasContainer.addEventListener('pointerdown', (e) => {
      if (!this.sim) return;

      if (e.button === 1) {
        // Middle mouse camera pan
        this.isMiddlePanning = true;
        this.panLastScreen = { x: e.clientX, y: e.clientY };
        return;
      }

      if (e.button === 0) {
        if (this.radialOpen) {
          this.closeRadialMenu();
          return;
        }

        // Check Attack-Move or Ground-Barrage targeting mode!
        if (this.cursorMode !== 'normal' && this.selectedIds.size > 0) {
          const w = this.renderer.screenToWorld(e.clientX, e.clientY);
          this.dispatchCommand({
            kind: 'ORDER_UNITS',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            order: {
              kind: this.cursorMode === 'attack_ground' ? 'attack_ground' : 'attack_move',
              x: w.x,
              y: w.y,
            },
            queue: e.shiftKey,
          });
          soundEngine.playRadioAck();
          this.cursorMode = 'normal';
          document.body.style.cursor = 'default';
          return;
        }

        this.isBoxDragging = true;
        this.boxStartScreen = { x: e.clientX, y: e.clientY };
        this.elSelectionBox.style.left = `${e.clientX}px`;
        this.elSelectionBox.style.top = `${e.clientY}px`;
        this.elSelectionBox.style.width = '0px';
        this.elSelectionBox.style.height = '0px';
      }

      if (e.button === 2) {
        this.closeRadialMenu();
        this.rightDownScreen = { x: e.clientX, y: e.clientY };
        if (this.rightDownTimer !== null) window.clearTimeout(this.rightDownTimer);
        // Hold right-click 230ms opens Tactical Radial Command Wheel!
        this.rightDownTimer = window.setTimeout(() => {
          this.rightDownTimer = null;
          this.openRadialMenuAt(this.rightDownScreen.x, this.rightDownScreen.y);
        }, 230);
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.sim) return;

      const w = this.renderer.screenToWorld(e.clientX, e.clientY);
      const elev = Math.round(this.sim.map.getElevation(w.x, w.y));
      const { lat, lon } = worldToLatLon(w.x, w.y);
      const elReadout = document.getElementById('cursor-coords-readout');
      if (elReadout) {
        elReadout.textContent = `${lat.toFixed(2)}°N ${lon.toFixed(2)}°E • ${elev >= 0 ? '+' : ''}${elev}m`;
      }

      if (this.isMiddlePanning) {
        const dx = e.clientX - this.panLastScreen.x;
        const dy = e.clientY - this.panLastScreen.y;
        this.renderer.camX -= dx / this.renderer.zoom;
        this.renderer.camY -= dy / this.renderer.zoom;
        this.panLastScreen = { x: e.clientX, y: e.clientY };
      }

      if (this.isBoxDragging) {
        const x1 = Math.min(this.boxStartScreen.x, e.clientX);
        const y1 = Math.min(this.boxStartScreen.y, e.clientY);
        const bw = Math.abs(e.clientX - this.boxStartScreen.x);
        const bh = Math.abs(e.clientY - this.boxStartScreen.y);
        if (bw > 5 || bh > 5) {
          this.elSelectionBox.classList.remove('hidden');
          this.elSelectionBox.style.left = `${x1}px`;
          this.elSelectionBox.style.top = `${y1}px`;
          this.elSelectionBox.style.width = `${bw}px`;
          this.elSelectionBox.style.height = `${bh}px`;
        }
      }

      // Cancel radial timer if user drags right mouse far
      if (this.rightDownTimer !== null) {
        if (Math.hypot(e.clientX - this.rightDownScreen.x, e.clientY - this.rightDownScreen.y) > 18) {
          window.clearTimeout(this.rightDownTimer);
          this.rightDownTimer = null;
        }
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.sim) return;

      if (e.button === 1) {
        this.isMiddlePanning = false;
      }

      if (e.button === 0 && this.isBoxDragging) {
        this.isBoxDragging = false;
        this.elSelectionBox.classList.add('hidden');
        this.completeSelection(e.clientX, e.clientY, e.shiftKey);
      }

      if (e.button === 2) {
        if (this.rightDownTimer !== null) {
          window.clearTimeout(this.rightDownTimer);
          this.rightDownTimer = null;
          // Quick Right-Click -> Contextual Tactical Order!
          this.issueContextualRightClick(e.clientX, e.clientY, e.shiftKey, e.altKey);
        }
      }
    });

    // Mouse Wheel Pixel-Crisp Zoom
    canvasContainer.addEventListener(
      'wheel',
      (e) => {
        if (!this.sim) return;
        e.preventDefault();
        const before = this.renderer.screenToWorld(e.clientX, e.clientY);
        const factor = e.deltaY < 0 ? 1.14 : 0.88;
        this.renderer.zoom = Math.max(0.42, Math.min(2.25, this.renderer.zoom * factor));
        const after = this.renderer.screenToWorld(e.clientX, e.clientY);
        this.renderer.camX += before.x - after.x;
        this.renderer.camY += before.y - after.y;
      },
      { passive: false },
    );

    // Keyboard Hotkeys
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keysDown.add(e.code);

      if (!this.sim) return;

      if (e.code === 'Escape') {
        this.closeRadialMenu();
        this.cursorMode = 'normal';
        document.body.style.cursor = 'default';
        document.getElementById('manual-modal')?.classList.add('hidden');
      } else if (e.code === 'KeyQ') {
        if (this.radialOpen) this.closeRadialMenu();
        else this.openRadialMenuAt(window.innerWidth * 0.5, window.innerHeight * 0.5);
      } else if (e.code === 'KeyF') {
        this.cursorMode = 'attack_move';
        document.body.style.cursor = 'crosshair';
      } else if (e.code === 'KeyG') {
        this.cursorMode = 'attack_ground';
        document.body.style.cursor = 'crosshair';
      } else if (e.code === 'KeyH') {
        if (this.selectedIds.size > 0) {
          this.dispatchCommand({
            kind: 'UNIT_ABILITY',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            ability: 'halt',
          });
        }
      } else if (e.code === 'KeyX') {
        if (this.selectedIds.size > 0) {
          this.dispatchCommand({
            kind: 'UNIT_ABILITY',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            ability: 'pop_smoke',
          });
        }
      } else if (e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('btn-toggle-radar-overlay')?.click();
      } else if (e.code === 'KeyL') {
        document.getElementById('btn-toggle-supply-overlay')?.click();
      } else if (e.code === 'KeyT') {
        document.getElementById('btn-toggle-elev-overlay')?.click();
      } else if (e.code === 'KeyM') {
        document.getElementById('btn-toggle-audio')?.click();
      } else if (e.code.startsWith('Digit')) {
        const num = Number(e.code.replace('Digit', ''));
        if (num >= 1 && num <= 9) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.controlGroups.set(num, Array.from(this.selectedIds));
            soundEngine.playUiClick();
          } else {
            const grp = this.controlGroups.get(num);
            if (grp && grp.length > 0) {
              this.selectedIds.clear();
              for (const id of grp) {
                if (this.sim.units.some((u) => u.id === id && u.hp > 0)) {
                  this.selectedIds.add(id);
                }
              }
              const now = performance.now();
              if (this.lastGroupTap.group === num && now - this.lastGroupTap.time < 350) {
                const first = this.sim.units.find((u) => this.selectedIds.has(u.id));
                if (first) {
                  this.renderer.camX = first.x;
                  this.renderer.camY = first.y;
                }
              }
              this.lastGroupTap = { group: num, time: now };
              this.refreshInspectorAndResources();
            }
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    // Top Bar Overlay Buttons
    document.getElementById('btn-toggle-radar-overlay')!.addEventListener('click', (e) => {
      this.renderer.showRadarOverlay = !this.renderer.showRadarOverlay;
      (e.currentTarget as HTMLElement).classList.toggle('active', this.renderer.showRadarOverlay);
      soundEngine.playUiClick();
    });

    document.getElementById('btn-toggle-supply-overlay')!.addEventListener('click', (e) => {
      this.renderer.showSupplyOverlay = !this.renderer.showSupplyOverlay;
      (e.currentTarget as HTMLElement).classList.toggle('active', this.renderer.showSupplyOverlay);
      soundEngine.playUiClick();
    });

    document.getElementById('btn-toggle-elev-overlay')!.addEventListener('click', (e) => {
      this.renderer.showTopoOverlay = !this.renderer.showTopoOverlay;
      (e.currentTarget as HTMLElement).classList.toggle('active', this.renderer.showTopoOverlay);
      soundEngine.playUiClick();
    });

    document.getElementById('btn-toggle-audio')!.addEventListener('click', (e) => {
      soundEngine.enabled = !soundEngine.enabled;
      const btn = e.currentTarget as HTMLElement;
      btn.classList.toggle('active', soundEngine.enabled);
      btn.textContent = soundEngine.enabled ? 'SFX: ON' : 'SFX: OFF';
      if (soundEngine.enabled) soundEngine.playUiClick();
    });

    document.getElementById('btn-open-help')!.addEventListener('click', () => {
      document.getElementById('manual-modal')!.classList.remove('hidden');
      soundEngine.playUiClick();
    });

    document.getElementById('btn-close-manual')!.addEventListener('click', () => {
      document.getElementById('manual-modal')!.classList.add('hidden');
    });

    document.getElementById('btn-leave-match')!.addEventListener('click', () => {
      this.onExitMatch();
    });

    // Reinforcement Dock Category Tabs
    document.querySelectorAll('.dock-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dock-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = (tab.getAttribute('data-category') as UnitCategory) || 'ground';
        soundEngine.playUiClick();
        this.renderReinforcementCards();
      });
    });

    // Interactive Minimap Click / Drag / Right-Click Order
    const minimapPointToWorld = (ev: MouseEvent) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      return { x: nx * WORLD_WIDTH, y: ny * WORLD_HEIGHT };
    };

    this.minimapCanvas.addEventListener('pointerdown', (e) => {
      if (!this.sim) return;
      const w = minimapPointToWorld(e);
      if (e.button === 0) {
        this.isMinimapDragging = true;
        this.renderer.camX = w.x;
        this.renderer.camY = w.y;
      } else if (e.button === 2 && this.selectedIds.size > 0) {
        this.dispatchCommand({
          kind: 'ORDER_UNITS',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          order: { kind: 'attack_move', x: w.x, y: w.y },
          queue: e.shiftKey,
        });
        soundEngine.playRadioAck();
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (this.isMinimapDragging && this.sim) {
        const w = minimapPointToWorld(e);
        this.renderer.camX = w.x;
        this.renderer.camY = w.y;
      }
    });

    window.addEventListener('pointerup', () => {
      this.isMinimapDragging = false;
    });
  }

  private completeSelection(endX: number, endY: number, additive: boolean): void {
    if (!this.sim) return;

    const dragDist = Math.hypot(endX - this.boxStartScreen.x, endY - this.boxStartScreen.y);
    if (!additive) {
      this.selectedIds.clear();
    }

    if (dragDist < 7) {
      // Single click selection (with double-click same-type support!)
      const w = this.renderer.screenToWorld(endX, endY);
      let hitUnitId: number | null = null;
      let hitType: UnitType | null = null;
      let bestD = 26 / this.renderer.zoom;

      for (const u of this.sim.units) {
        if (u.faction !== this.playerFaction || u.hp <= 0 || u.insideTransportId !== null) continue;
        const groundZ = Math.max(0, this.sim.map.getElevation(u.x, u.y));
        const visualY = u.y - Math.max(0, u.z - groundZ) * 0.35;
        const d = Math.hypot(u.x - w.x, visualY - w.y);
        if (d <= bestD + UNIT_DEFS[u.type].radius) {
          bestD = d;
          hitUnitId = u.id;
          hitType = u.type;
        }
      }

      if (hitUnitId !== null && hitType !== null) {
        const now = performance.now();
        if (this.lastClickUnit.id === hitUnitId && now - this.lastClickUnit.time < 340) {
          // Select all on-screen units of same type!
          for (const u of this.sim.units) {
            if (u.faction === this.playerFaction && u.type === hitType && u.hp > 0 && u.insideTransportId === null) {
              const sc = this.renderer.worldToScreen(u.x, u.y);
              if (sc.x >= 0 && sc.x <= window.innerWidth && sc.y >= 0 && sc.y <= window.innerHeight) {
                this.selectedIds.add(u.id);
              }
            }
          }
        } else {
          this.selectedIds.add(hitUnitId);
        }
        this.lastClickUnit = { id: hitUnitId, time: now };
        soundEngine.playUiClick();
      }
    } else {
      // Box Selection
      const minX = Math.min(this.boxStartScreen.x, endX);
      const maxX = Math.max(this.boxStartScreen.x, endX);
      const minY = Math.min(this.boxStartScreen.y, endY);
      const maxY = Math.max(this.boxStartScreen.y, endY);

      for (const u of this.sim.units) {
        if (u.faction !== this.playerFaction || u.hp <= 0 || u.insideTransportId !== null) continue;
        const groundZ = Math.max(0, this.sim.map.getElevation(u.x, u.y));
        const sc = this.renderer.worldToScreen(u.x, u.y - Math.max(0, u.z - groundZ) * 0.35);
        if (sc.x >= minX && sc.x <= maxX && sc.y >= minY && sc.y <= maxY) {
          this.selectedIds.add(u.id);
        }
      }
      if (this.selectedIds.size > 0) soundEngine.playUiClick();
    }

    this.refreshInspectorAndResources();
  }

  private issueContextualRightClick(
    screenX: number,
    screenY: number,
    queue: boolean,
    altKey: boolean,
  ): void {
    if (!this.sim || this.selectedIds.size === 0) return;

    const w = this.renderer.screenToWorld(screenX, screenY);
    const selectedUnits = this.sim.units.filter((u) => this.selectedIds.has(u.id) && u.hp > 0);
    if (selectedUnits.length === 0) return;

    const allInfantry = selectedUnits.every((u) => UNIT_DEFS[u.type].category === 'infantry');
    const hasEngineer = selectedUnits.some((u) => UNIT_DEFS[u.type].canEngineer);

    // 1. Check Enemy Unit under cursor -> Attack Unit
    for (const u of this.sim.units) {
      if (u.faction === this.playerFaction || u.hp <= 0 || u.insideTransportId !== null) continue;
      if (!this.sim.isUnitDetectedBy(u, this.playerFaction)) continue;
      const groundZ = Math.max(0, this.sim.map.getElevation(u.x, u.y));
      const vy = u.y - Math.max(0, u.z - groundZ) * 0.35;
      if (Math.hypot(u.x - w.x, vy - w.y) <= UNIT_DEFS[u.type].radius + 18) {
        this.dispatchCommand({
          kind: 'ORDER_UNITS',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          order: { kind: 'attack_unit', x: u.x, y: u.y, targetUnitId: u.id },
          queue,
        });
        soundEngine.playRadioAck();
        return;
      }
    }

    // 2. Check Friendly IFV/APC Transport under cursor when Infantry selected -> Board APC!
    if (allInfantry) {
      for (const tr of this.sim.units) {
        if (
          tr.faction === this.playerFaction &&
          tr.hp > 0 &&
          UNIT_DEFS[tr.type].transportCap > tr.passengers.length &&
          Math.hypot(tr.x - w.x, tr.y - w.y) <= 28
        ) {
          this.dispatchCommand({
            kind: 'ORDER_UNITS',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            order: { kind: 'board_transport', x: tr.x, y: tr.y, targetUnitId: tr.id },
            queue,
          });
          soundEngine.playRadioAck();
          return;
        }
      }
    }

    // 3. Check Damaged Bridge or Friendly Node when Combat Engineer selected -> Repair!
    if (hasEngineer) {
      for (const br of this.sim.bridges) {
        if ((br.destroyed || br.hp < br.maxHp) && Math.hypot(br.x - w.x, br.y - w.y) <= 65) {
          this.dispatchCommand({
            kind: 'ORDER_UNITS',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            order: { kind: 'repair_target', x: br.x, y: br.y, targetBridgeId: br.id },
            queue,
          });
          soundEngine.playRadioAck();
          return;
        }
      }
      for (const nd of this.sim.nodes) {
        if (
          nd.faction === this.playerFaction &&
          (nd.destroyed || nd.hp < nd.maxHp) &&
          Math.hypot(nd.x - w.x, nd.y - w.y) <= nd.radius + 20
        ) {
          this.dispatchCommand({
            kind: 'ORDER_UNITS',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            order: { kind: 'repair_target', x: nd.x, y: nd.y, targetNodeId: nd.id },
            queue,
          });
          soundEngine.playRadioAck();
          return;
        }
      }
    }

    // 4. Alt + Right-Click on City / HQ / FOB -> Garrison Infantry inside buildings!
    if (allInfantry && altKey) {
      const city = this.sim.nodes.find(
        (n) =>
          (n.type === 'city' || n.type === 'hq' || n.type === 'fob') &&
          Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 16,
      );
      if (city) {
        this.dispatchCommand({
          kind: 'ORDER_UNITS',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          order: { kind: 'garrison_node', x: city.x, y: city.y, targetNodeId: city.id },
          queue,
        });
        soundEngine.playRadioAck();
        return;
      }
    }

    // 5. Standard Move / Jet Patrol
    const allJets = selectedUnits.every((u) => UNIT_DEFS[u.type].domain === 'jet');
    this.dispatchCommand({
      kind: 'ORDER_UNITS',
      faction: this.playerFaction,
      unitIds: Array.from(this.selectedIds),
      order: { kind: allJets ? 'patrol_air' : 'move', x: w.x, y: w.y },
      queue,
    });
    soundEngine.playRadioAck();
  }

  /** Opens Sleek Tactical Radial Command Wheel at (screenX, screenY) */
  private openRadialMenuAt(screenX: number, screenY: number): void {
    if (!this.sim) return;
    this.radialOpen = true;
    const clampedX = Math.max(120, Math.min(window.innerWidth - 120, screenX));
    const clampedY = Math.max(120, Math.min(window.innerHeight - 120, screenY));
    this.radialWorldTarget = this.renderer.screenToWorld(screenX, screenY);

    this.elRadialMenu.style.left = `${clampedX}px`;
    this.elRadialMenu.style.top = `${clampedY}px`;
    this.elRadialMenu.classList.remove('hidden');
    this.elRadialItems.innerHTML = '';

    const selected = this.sim.units.filter((u) => this.selectedIds.has(u.id) && u.hp > 0);
    const hasEngineer = selected.some((u) => UNIT_DEFS[u.type].canEngineer);
    const hasRadar = selected.some((u) => UNIT_DEFS[u.type].radarRange > 0);
    const hasSmoke = selected.some((u) => UNIT_DEFS[u.type].canSmoke);
    const hasTransportOrGarrison = selected.some(
      (u) => u.passengers.length > 0 || u.garrisonNodeId !== null || UNIT_DEFS[u.type].category === 'infantry',
    );
    const hasAirfield = this.sim.nodes.some(
      (n) => n.faction === this.playerFaction && n.type === 'airfield' && !n.destroyed,
    );

    interface RadialOption {
      label: string;
      sub: string;
      disabled?: boolean;
      action: () => void;
    }

    const opts: RadialOption[] = [
      {
        label: 'BARRAGE',
        sub: 'Ground Strike',
        disabled: selected.length === 0,
        action: () => {
          this.dispatchCommand({
            kind: 'ORDER_UNITS',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            order: {
              kind: 'attack_ground',
              x: this.radialWorldTarget.x,
              y: this.radialWorldTarget.y,
            },
            queue: false,
          });
        },
      },
      {
        label: 'AIRSTRIKE',
        sub: '$450 Strike Jet',
        disabled: !hasAirfield || this.sim.economy[this.playerFaction].money < 450,
        action: () => {
          this.dispatchCommand({
            kind: 'DEPLOY_UNIT',
            faction: this.playerFaction,
            unitType: 'strike_jet',
            targetX: this.radialWorldTarget.x,
            targetY: this.radialWorldTarget.y,
          });
        },
      },
      {
        label: 'SMOKE',
        sub: 'IR Screen [X]',
        disabled: !hasSmoke,
        action: () => {
          this.dispatchCommand({
            kind: 'UNIT_ABILITY',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            ability: 'pop_smoke',
          });
        },
      },
      {
        label: 'RADAR I/O',
        sub: 'Active / Passive',
        disabled: !hasRadar,
        action: () => {
          this.dispatchCommand({
            kind: 'UNIT_ABILITY',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            ability: 'toggle_radar',
          });
        },
      },
      hasEngineer
        ? {
            label: 'BUILD FOB',
            sub: '$180 Supply Hub',
            disabled: this.sim.economy[this.playerFaction].money < 180,
            action: () => {
              this.dispatchCommand({
                kind: 'UNIT_ABILITY',
                faction: this.playerFaction,
                unitIds: Array.from(this.selectedIds),
                ability: 'build_fob',
              });
            },
          }
        : {
            label: 'GARRISON',
            sub: 'Unload / Cover',
            disabled: !hasTransportOrGarrison,
            action: () => {
              const nearCity = this.sim?.nodes.find(
                (n) =>
                  (n.type === 'city' || n.type === 'hq' || n.type === 'fob') &&
                  selected.some((u) => Math.hypot(u.x - n.x, u.y - n.y) < n.radius + 90),
              );
              if (nearCity && selected.every((u) => UNIT_DEFS[u.type].category === 'infantry' && u.garrisonNodeId === null)) {
                this.dispatchCommand({
                  kind: 'ORDER_UNITS',
                  faction: this.playerFaction,
                  unitIds: Array.from(this.selectedIds),
                  order: { kind: 'garrison_node', x: nearCity.x, y: nearCity.y, targetNodeId: nearCity.id },
                  queue: false,
                });
              } else {
                this.dispatchCommand({
                  kind: 'UNIT_ABILITY',
                  faction: this.playerFaction,
                  unitIds: Array.from(this.selectedIds),
                  ability: 'unload_passengers',
                });
              }
            },
          },
      hasEngineer
        ? {
            label: 'BUILD SAM',
            sub: '$220 Air Defense',
            disabled: this.sim.economy[this.playerFaction].money < 220,
            action: () => {
              this.dispatchCommand({
                kind: 'UNIT_ABILITY',
                faction: this.playerFaction,
                unitIds: Array.from(this.selectedIds),
                ability: 'build_sam',
              });
            },
          }
        : {
            label: 'AMBUSH',
            sub: 'Hold / Open Fire',
            disabled: selected.length === 0,
            action: () => {
              this.dispatchCommand({
                kind: 'UNIT_ABILITY',
                faction: this.playerFaction,
                unitIds: Array.from(this.selectedIds),
                ability: 'toggle_hold_fire',
              });
            },
          },
    ];

    const radius = 78;
    opts.forEach((opt, idx) => {
      const ang = -Math.PI * 0.5 + (idx / opts.length) * Math.PI * 2;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'radial-item';
      btn.style.left = `${110 + Math.cos(ang) * radius}px`;
      btn.style.top = `${110 + Math.sin(ang) * radius}px`;
      btn.disabled = !!opt.disabled;
      btn.innerHTML = `<span>${opt.label}</span><span class="radial-sub">${opt.sub}</span>`;
      btn.addEventListener('click', () => {
        opt.action();
        soundEngine.playRadioAck();
        this.closeRadialMenu();
      });
      this.elRadialItems.appendChild(btn);
    });

    soundEngine.playUiClick();
  }

  private closeRadialMenu(): void {
    this.radialOpen = false;
    this.elRadialMenu.classList.add('hidden');
  }

  private renderReinforcementCards(): void {
    if (!this.sim) return;
    this.elReinforceList.innerHTML = '';

    const econ = this.sim.economy[this.playerFaction];
    const items = UNIT_ORDER_LIST.filter((t) => UNIT_DEFS[t].category === this.activeCategory);

    // Update entry node availability readout
    if (this.activeCategory === 'air') {
      const af = this.sim.nodes.find(
        (n) => n.faction === this.playerFaction && n.type === 'airfield' && !n.destroyed,
      );
      this.elNodeStatus.textContent = af ? `Hub: ${af.name} [READY]` : 'Hub: NO OPERATIONAL AIRFIELD';
    } else if (this.activeCategory === 'naval') {
      const sp = this.sim.nodes.find(
        (n) => n.faction === this.playerFaction && n.type === 'seaport' && !n.destroyed,
      );
      this.elNodeStatus.textContent = sp ? `Hub: ${sp.name} [READY]` : 'Hub: NO OPERATIONAL SEAPORT';
    } else {
      const rh = this.sim.nodes.find(
        (n) => n.faction === this.playerFaction && n.type === 'railhead' && !n.destroyed,
      );
      this.elNodeStatus.textContent = rh
        ? `Hub: ${rh.name} (Armored Train)`
        : 'Hub: Highway Staging / HQ';
    }

    for (const ut of items) {
      const def = UNIT_DEFS[ut];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `btn-deploy-${ut}`;
      btn.className = 'reinforce-card';
      btn.disabled = econ.money < def.costMoney;

      const viaLabel =
        def.deployVia === 'airfield'
          ? 'AIRPORT'
          : def.deployVia === 'seaport'
            ? 'SEAPORT'
            : def.category === 'ground'
              ? 'RAIL TRAIN'
              : 'HWY / FOB';

      btn.innerHTML = `
        <div class="rc-info">
          <span class="rc-name">${def.shortName}</span>
          <span class="rc-desc">${def.roleDesc}</span>
        </div>
        <div class="rc-cost">
          $${def.costMoney}
          <span class="rc-via">${viaLabel}</span>
        </div>
      `;

      btn.addEventListener('click', () => {
        if (!this.sim) return;
        this.dispatchCommand({
          kind: 'DEPLOY_UNIT',
          faction: this.playerFaction,
          unitType: ut,
          targetX: this.renderer.camX,
          targetY: this.renderer.camY,
        });
        soundEngine.playRadioAck();
      });

      this.elReinforceList.appendChild(btn);
    }
  }

  private refreshInspectorAndResources(): void {
    if (!this.sim) return;

    const econ = this.sim.economy[this.playerFaction];
    document.getElementById('res-money')!.textContent = `$${Math.floor(econ.money)}`;
    document.getElementById('res-money-rate')!.textContent = `+${econ.moneyRate}/s`;
    document.getElementById('res-fuel')!.textContent = `${Math.floor(econ.fuel)}`;
    document.getElementById('res-fuel-rate')!.textContent = `+${econ.fuelRate}/s`;
    document.getElementById('res-ammo')!.textContent = `${Math.floor(econ.ammo)}`;
    document.getElementById('res-ammo-rate')!.textContent = `+${econ.ammoRate}/s`;
    document.getElementById('res-sectors')!.textContent = `${econ.sectorsHeld} / ${this.sim.nodes.length}`;

    const mins = Math.floor(this.sim.elapsedSec / 60);
    const secs = Math.floor(this.sim.elapsedSec % 60);
    document.getElementById('hud-clock')!.textContent =
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Update reinforcement card disabled states
    for (const ut of UNIT_ORDER_LIST) {
      const btn = document.getElementById(`btn-deploy-${ut}`) as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = econ.money < UNIT_DEFS[ut].costMoney;
      }
    }

    // Selected Units Inspector
    const emptyEl = document.getElementById('inspector-empty')!;
    const contentEl = document.getElementById('inspector-content')!;
    const selected = this.sim.units.filter((u) => this.selectedIds.has(u.id) && u.hp > 0);

    if (selected.length === 0) {
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const lead = selected[0];
    const leadDef = UNIT_DEFS[lead.type];

    document.getElementById('insp-unit-name')!.textContent =
      selected.length === 1 ? leadDef.name.toUpperCase() : `${leadDef.shortName} TASK GROUP`;
    document.getElementById('insp-unit-count')!.textContent = `x${selected.length}`;

    const allSupplied = selected.every((u) => u.supplied);
    const supBadge = document.getElementById('insp-supply-badge')!;
    supBadge.textContent = allSupplied ? 'SUPPLIED' : 'SUPPLY CUT';
    supBadge.className = allSupplied ? 'insp-supply ok' : 'insp-supply cut';

    document.getElementById('insp-unit-role')!.textContent =
      `${leadDef.primaryWeapon.name} (${leadDef.primaryWeapon.range}m) • ${leadDef.roleDesc}`;

    const avgHp =
      selected.reduce((s, u) => s + u.hp / u.maxHp, 0) / selected.length;
    const avgFuel =
      selected.reduce((s, u) => s + (u.maxFuel > 0 ? u.fuel / u.maxFuel : 1), 0) / selected.length;
    const avgAmmo =
      selected.reduce((s, u) => s + u.ammo / u.maxAmmo, 0) / selected.length;

    (document.getElementById('insp-hp-fill') as HTMLElement).style.width = `${Math.round(avgHp * 100)}%`;
    document.getElementById('insp-hp-text')!.textContent = `${Math.round(avgHp * 100)}%`;

    (document.getElementById('insp-fuel-fill') as HTMLElement).style.width = `${Math.round(avgFuel * 100)}%`;
    document.getElementById('insp-fuel-text')!.textContent =
      lead.maxFuel > 0 ? `${Math.round(avgFuel * 100)}%` : 'INF';

    (document.getElementById('insp-ammo-fill') as HTMLElement).style.width = `${Math.round(avgAmmo * 100)}%`;
    document.getElementById('insp-ammo-text')!.textContent = `${Math.round(avgAmmo * 100)}%`;

    // Quick Action Buttons in Inspector
    const actionsEl = document.getElementById('inspector-actions')!;
    actionsEl.innerHTML = '';

    const addAct = (label: string, toggled: boolean, disabled: boolean, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `act-btn${toggled ? ' toggled' : ''}`;
      b.disabled = disabled;
      b.textContent = label;
      b.addEventListener('click', () => {
        onClick();
        soundEngine.playUiClick();
      });
      actionsEl.appendChild(b);
    };

    addAct('ATK-MOVE [F]', this.cursorMode === 'attack_move', false, () => {
      this.cursorMode = 'attack_move';
      document.body.style.cursor = 'crosshair';
    });

    addAct('BARRAGE [G]', this.cursorMode === 'attack_ground', false, () => {
      this.cursorMode = 'attack_ground';
      document.body.style.cursor = 'crosshair';
    });

    if (selected.some((u) => UNIT_DEFS[u.type].canSmoke)) {
      addAct(
        'SMOKE [X]',
        false,
        selected.every((u) => u.smokeCooldown > 0),
        () => {
          this.dispatchCommand({
            kind: 'UNIT_ABILITY',
            faction: this.playerFaction,
            unitIds: Array.from(this.selectedIds),
            ability: 'pop_smoke',
          });
        },
      );
    }

    if (selected.some((u) => UNIT_DEFS[u.type].radarRange > 0)) {
      const radOn = selected.some((u) => u.radarActive);
      addAct(radOn ? 'RADAR: ON' : 'RADAR: OFF', radOn, false, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'toggle_radar',
        });
      });
    }

    if (selected.some((u) => UNIT_DEFS[u.type].canEngineer)) {
      addAct('BUILD FOB $180', false, econ.money < 180, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'build_fob',
        });
      });
      addAct('BUILD SAM $220', false, econ.money < 220, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'build_sam',
        });
      });
    } else if (selected.some((u) => u.passengers.length > 0 || u.garrisonNodeId !== null)) {
      addAct('DISEMBARK', false, false, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'unload_passengers',
        });
      });
    } else if (selected.some((u) => UNIT_DEFS[u.type].domain === 'jet')) {
      addAct('RTB REARM', lead.returningToBase, false, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'rtb',
        });
      });
    } else {
      const holding = selected.some((u) => u.holdFire);
      addAct(holding ? 'HOLD FIRE' : 'FIRE AT WILL', holding, false, () => {
        this.dispatchCommand({
          kind: 'UNIT_ABILITY',
          faction: this.playerFaction,
          unitIds: Array.from(this.selectedIds),
          ability: 'toggle_hold_fire',
        });
      });
    }
  }

  private renderMinimap(): void {
    if (!this.sim) return;
    const ctx = this.minimapCtx;
    const mw = this.minimapCanvas.width;
    const mh = this.minimapCanvas.height;

    ctx.drawImage(this.renderer.minimapBaseCanvas, 0, 0, mw, mh);

    // Shade Unexplored Shroud on Minimap
    const exp = this.sim.explored[this.playerFaction];
    const vis = this.sim.visible[this.playerFaction];
    const cw = mw / FOG_COLS;
    const ch = mh / FOG_ROWS;
    for (let r = 0; r < FOG_ROWS; r++) {
      for (let c = 0; c < FOG_COLS; c++) {
        const idx = r * FOG_COLS + c;
        if (exp[idx] === 0) {
          ctx.fillStyle = 'rgba(6, 10, 14, 0.82)';
          ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
        } else if (vis[idx] === 0) {
          ctx.fillStyle = 'rgba(8, 13, 18, 0.4)';
          ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
        }
      }
    }

    const sx = mw / WORLD_WIDTH;
    const sy = mh / WORLD_HEIGHT;

    // Strategic Nodes
    for (const nd of this.sim.nodes) {
      ctx.fillStyle =
        nd.faction === 'blue' ? '#42b0ff' : nd.faction === 'red' ? '#ef5350' : '#cfd8dc';
      ctx.fillRect(nd.x * sx - 2.5, nd.y * sy - 2.5, 5, 5);
    }

    // Units
    for (const u of this.sim.units) {
      if (u.hp <= 0 || u.insideTransportId !== null) continue;
      if (!this.sim.isUnitDetectedBy(u, this.playerFaction)) continue;
      ctx.fillStyle = u.faction === 'blue' ? '#80d8ff' : '#ff5252';
      ctx.fillRect(u.x * sx - 1.5, u.y * sy - 1.5, 3, 3);
    }

    // Camera Viewport Box
    const topLeft = this.renderer.screenToWorld(0, 0);
    const botRight = this.renderer.screenToWorld(window.innerWidth, window.innerHeight);
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      topLeft.x * sx,
      topLeft.y * sy,
      (botRight.x - topLeft.x) * sx,
      (botRight.y - topLeft.y) * sy,
    );
  }
}
