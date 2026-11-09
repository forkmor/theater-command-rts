import { Application } from 'pixi.js';
import type { AIDifficulty, DoctrineId, GameCommand, PlayableFaction } from './core/types';
import { soundEngine } from './audio/soundEngine';
import { MultiplayerClient } from './net/mpClient';
import { WorldRenderer } from './render/worldRenderer';
import { AICommander } from './sim/aiCommander';
import { GameSimulation } from './sim/simulation';
import { HudController } from './ui/hudController';
import {
  fetchLiveOsmSector,
  geocodeLocationBrowser,
  REAL_WORLD_SECTOR_PRESETS,
  type GisBoundingBox,
} from './world/osmBrowserLoader';
import {
  getActiveOsmSector,
  setActiveOsmSector,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './world/suwalkiMap';

let latestBluePct = 50;
let latestPreviewCanvas: HTMLCanvasElement | null = null;

function updateTheaterPreviewCanvas(bluePct = latestBluePct, previewCanvas = latestPreviewCanvas): void {
  latestBluePct = bluePct;
  if (previewCanvas) latestPreviewCanvas = previewCanvas;
  const canvas = document.getElementById('global-map-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  const osmSector = getActiveOsmSector();
  if (osmSector && latestPreviewCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(latestPreviewCanvas, 0, 0, w, h);

    // Top bar overlay showing live 1:1 scale OpenStreetMap sector title & coordinates
    ctx.fillStyle = 'rgba(9, 16, 22, 0.82)';
    ctx.fillRect(0, 0, w, 20);
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#66bb6a';
    ctx.fillText(
      `1:1 VECTOR GIS: ${osmSector.bounds.title} (1.6km × 1.2km)`,
      6,
      13,
    );
  } else {
    ctx.fillStyle = '#0c1821';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#4fc3f7';
    ctx.fillText('STREAMING 1:1 SCALE OVERPASS GIS VECTORS...', 18, h * 0.5);
  }

  const redPct = 100 - bluePct;
  const elBlue = document.getElementById('global-blue-pct');
  const elRed = document.getElementById('global-red-pct');
  const elFill = document.getElementById('global-war-fill') as HTMLElement | null;
  if (elBlue) elBlue.textContent = `BLUE: ${bluePct}%`;
  if (elRed) elRed.textContent = `RED: ${redPct}%`;
  if (elFill) elFill.style.width = `${bluePct}%`;
}

async function bootstrap(): Promise<void> {
  updateTheaterPreviewCanvas(50);

  const container = document.getElementById('pixi-canvas-container')!;
  const app = new Application();
  await app.init({
    resizeTo: container,
    backgroundColor: 0x0b151c,
    antialias: false,
    resolution: 1,
  });
  container.appendChild(app.canvas);

  const renderer = new WorldRenderer(app);
  const mpClient = new MultiplayerClient();

  let activeSim: GameSimulation | null = null;
  let previewSim: GameSimulation | null = null;
  let aiCommander: AICommander | null = null;
  let isMultiplayerMatch = false;
  let localFaction: PlayableFaction = 'blue';
  let selectedDoctrine: DoctrineId = 'mech_blitz';
  let matchEndedReported = false;

  const lobbyOverlay = document.getElementById('lobby-overlay')!;
  const gameoverModal = document.getElementById('gameover-modal')!;
  const elOsmStatus = document.getElementById('osm-live-status');
  const elNetStatus = document.getElementById('net-status-indicator');

  const dispatchCommand = (cmd: GameCommand) => {
    if (!activeSim) return;
    if (isMultiplayerMatch) {
      mpClient.sendGameCommand(cmd);
    } else {
      activeSim.executeCommand(cmd);
    }
  };

  const exitToLobby = () => {
    activeSim = null;
    aiCommander = null;
    isMultiplayerMatch = false;
    hud.detachMatch();
    gameoverModal.classList.add('hidden');
    lobbyOverlay.classList.remove('hidden');
    if (previewSim) {
      renderer.bindSimulation(previewSim, 'blue');
      renderer.camX = WORLD_WIDTH * 0.5;
      renderer.camY = WORLD_HEIGHT * 0.5;
      renderer.zoom = 1.0;
    }
  };

  const hud = new HudController(renderer, dispatchCommand, exitToLobby);

  const previewAiBlue = new AICommander('blue', 'tactical');
  const previewAiRed = new AICommander('red', 'tactical');

  let activeOsmPromise: Promise<void> | null = null;

  async function loadBrowserOsmSector(bounds: GisBoundingBox): Promise<void> {
    const task = (async () => {
      try {
        if (elOsmStatus) {
          elOsmStatus.className = 'osm-live-status loading';
        }
        const data = await fetchLiveOsmSector(bounds, WORLD_WIDTH, WORLD_HEIGHT, (msg) => {
          if (elOsmStatus) elOsmStatus.textContent = msg;
          if (elNetStatus) elNetStatus.textContent = 'STREAMING OPENSTREETMAP...';
        });
        setActiveOsmSector(data);
        if (elOsmStatus) {
          elOsmStatus.className = 'osm-live-status ok';
          elOsmStatus.textContent = `OSM LIVE READY // ${data.stats.buildings.toLocaleString()} BUILDINGS • ${data.stats.roads} ROAD SPLINES • ${data.stats.railways} RAILS • ${data.stats.bridges} BRIDGES`;
        }
        if (elNetStatus) {
          elNetStatus.textContent = `OSM LIVE: ${data.stats.buildings.toLocaleString()} BLDGS`;
        }

        // Build live preview simulation exclusively from real OpenStreetMap GIS data
        previewSim = new GameSimulation(541022, 'mech_blitz', 'air_cav');
        if (!activeSim) {
          renderer.bindSimulation(previewSim, 'blue');
          renderer.camX = WORLD_WIDTH * 0.5;
          renderer.camY = WORLD_HEIGHT * 0.5;
          renderer.zoom = 1.0;
        }
        updateTheaterPreviewCanvas(latestBluePct, renderer.minimapBaseCanvas);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (elOsmStatus) {
          elOsmStatus.className = 'osm-live-status warn';
          elOsmStatus.textContent = `OPENSTREETMAP STREAM ERROR: ${msg}`;
        }
      }
    })();
    activeOsmPromise = task;
    return task;
  }

  // Wire Preset Sector Buttons
  document.querySelectorAll('#osm-preset-list .theater-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#osm-preset-list .theater-card')
        .forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      const presetId = btn.getAttribute('data-preset');
      const preset = REAL_WORLD_SECTOR_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        soundEngine.playUiClick();
        void loadBrowserOsmSector(preset);
      }
    });
  });

  // Wire Custom Global OpenStreetMap Search (Nominatim + Overpass)
  const inputOsmSearch = document.getElementById('input-osm-search') as HTMLInputElement | null;
  const btnOsmSearch = document.getElementById('btn-osm-search');
  const triggerCustomOsmSearch = async () => {
    const q = inputOsmSearch?.value.trim();
    if (!q) return;
    soundEngine.playUiClick();
    try {
      if (elOsmStatus) {
        elOsmStatus.className = 'osm-live-status loading';
        elOsmStatus.textContent = `Geocoding "${q}" via OpenStreetMap Nominatim...`;
      }
      const bounds = await geocodeLocationBrowser(q);
      document
        .querySelectorAll('#osm-preset-list .theater-card')
        .forEach((b) => b.classList.remove('selected'));
      await loadBrowserOsmSector(bounds);
    } catch (err) {
      if (elOsmStatus) {
        elOsmStatus.className = 'osm-live-status warn';
        elOsmStatus.textContent = err instanceof Error ? err.message : String(err);
      }
    }
  };
  btnOsmSearch?.addEventListener('click', () => {
    void triggerCustomOsmSearch();
  });
  inputOsmSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      void triggerCustomOsmSearch();
    }
  });

  // Stream the default real-world sector (Suwalki City & Rail Baltica) in the user's browser on load
  void loadBrowserOsmSector(REAL_WORLD_SECTOR_PRESETS[0]);

  function startSession(opts: {
    seed: number;
    playerFaction: PlayableFaction;
    blueDoc: DoctrineId;
    redDoc: DoctrineId;
    multiplayer: boolean;
    aiDifficulty?: AIDifficulty;
  }): void {
    localFaction = opts.playerFaction;
    isMultiplayerMatch = opts.multiplayer;
    matchEndedReported = false;

    activeSim = new GameSimulation(opts.seed, opts.blueDoc, opts.redDoc);
    activeSim.onAlert = (alert) => hud.pushAlert(alert);
    activeSim.onSound = (ev, x, y) => {
      const d = Math.hypot(x - renderer.camX, y - renderer.camY);
      if (d > 1100) return;
      if (ev === 'explosion') soundEngine.playExplosion(false);
      else if (ev === 'heavy_explosion') soundEngine.playExplosion(true);
      else soundEngine.playWeaponFire(ev);
    };

    if (!opts.multiplayer) {
      const aiFaction: PlayableFaction = opts.playerFaction === 'blue' ? 'red' : 'blue';
      aiCommander = new AICommander(aiFaction, opts.aiDifficulty ?? 'tactical');
    } else {
      aiCommander = null;
    }

    const osmSector = getActiveOsmSector();
    const elTheaterLabel = document.getElementById('hud-theater-label');
    if (elTheaterLabel && osmSector) {
      elTheaterLabel.textContent = `${osmSector.bounds.title} // ${osmSector.stats.buildings.toLocaleString()} OSM BLDGS`;
    }

    renderer.bindSimulation(activeSim, localFaction);
    hud.attachMatch(activeSim, localFaction);
    lobbyOverlay.classList.add('hidden');
    gameoverModal.classList.add('hidden');
    soundEngine.playRadarPing();
  }

  // Setup Lobby Faction & Doctrine Selectors
  const btnBlue = document.getElementById('btn-faction-blue')!;
  const btnRed = document.getElementById('btn-faction-red')!;

  btnBlue.addEventListener('click', () => {
    localFaction = 'blue';
    btnBlue.className = 'choice-btn active-blue';
    btnRed.className = 'choice-btn';
    soundEngine.playUiClick();
  });

  btnRed.addEventListener('click', () => {
    localFaction = 'red';
    btnRed.className = 'choice-btn active-red';
    btnBlue.className = 'choice-btn';
    soundEngine.playUiClick();
  });

  document.querySelectorAll('.doctrine-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.doctrine-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedDoctrine = (card.getAttribute('data-doctrine') as DoctrineId) || 'mech_blitz';
      soundEngine.playUiClick();
    });
  });

  // Launch AI Skirmish (strictly requires live OpenStreetMap sector)
  const btnStartSkirmish = document.getElementById('btn-start-skirmish') as HTMLButtonElement;
  btnStartSkirmish.addEventListener('click', async () => {
    if (activeOsmPromise && !getActiveOsmSector()) {
      btnStartSkirmish.textContent = 'STREAMING LIVE OPENSTREETMAP...';
      btnStartSkirmish.disabled = true;
      await activeOsmPromise;
      btnStartSkirmish.textContent = 'LAUNCH AI SKIRMISH';
      btnStartSkirmish.disabled = false;
    }
    if (!getActiveOsmSector()) return;

    const diffSelect = document.getElementById('select-ai-difficulty') as HTMLSelectElement;
    const diff = (diffSelect.value as AIDifficulty) || 'tactical';
    const aiDocPool: DoctrineId[] = ['mech_blitz', 'air_cav', 'net_ew'];
    const aiDoc = aiDocPool[Math.floor(Math.random() * aiDocPool.length)];
    startSession({
      seed: 541022 + Math.floor(Math.random() * 10000),
      playerFaction: localFaction,
      blueDoc: localFaction === 'blue' ? selectedDoctrine : aiDoc,
      redDoc: localFaction === 'red' ? selectedDoctrine : aiDoc,
      multiplayer: false,
      aiDifficulty: diff,
    });
  });

  document.getElementById('btn-gameover-return')!.addEventListener('click', exitToLobby);

  // Multiplayer WebSocket Wiring
  const mpBadge = document.getElementById('mp-conn-badge')!;
  const mpRoomStatus = document.getElementById('mp-room-status')!;

  mpClient.onStatusChange = (online) => {
    mpBadge.textContent = online ? 'WS ONLINE' : 'LOCAL ONLY';
    mpBadge.className = online ? 'mp-badge online' : 'mp-badge';
  };

  mpClient.onGlobalWarUpdate = (bluePct) => {
    updateTheaterPreviewCanvas(bluePct);
  };

  mpClient.onRoomCreated = (code, faction) => {
    mpRoomStatus.classList.remove('hidden');
    mpRoomStatus.textContent = `ROOM CREATED: [ ${code} ] — Waiting for opponent to join (${faction.toUpperCase()})...`;
  };

  mpClient.onRoomError = (msg) => {
    mpRoomStatus.classList.remove('hidden');
    mpRoomStatus.textContent = `ERROR: ${msg}`;
  };

  mpClient.onMatchStart = (payload) => {
    mpRoomStatus.classList.add('hidden');
    const blueDoc = payload.yourFaction === 'blue' ? payload.yourDoctrine : payload.enemyDoctrine;
    const redDoc = payload.yourFaction === 'red' ? payload.yourDoctrine : payload.enemyDoctrine;
    startSession({
      seed: payload.seed,
      playerFaction: payload.yourFaction,
      blueDoc,
      redDoc,
      multiplayer: true,
    });
  };

  mpClient.onGameCommand = (cmd) => {
    activeSim?.executeCommand(cmd);
  };

  mpClient.onOpponentLeft = () => {
    if (activeSim && !activeSim.winner) {
      activeSim.winner = localFaction;
    }
  };

  mpClient.connect();

  document.getElementById('btn-mp-create')!.addEventListener('click', () => {
    mpClient.createRoom(localFaction, selectedDoctrine);
    soundEngine.playUiClick();
  });

  document.getElementById('btn-mp-join')!.addEventListener('click', () => {
    const input = document.getElementById('input-mp-room-code') as HTMLInputElement;
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    mpClient.joinRoom(code, selectedDoctrine);
    soundEngine.playUiClick();
  });

  // Deterministic Fixed-Step Simulation Loop (30Hz Sim + 60FPS Render)
  const FIXED_DT = 1 / 30;
  let accumulator = 0;

  app.ticker.add((ticker) => {
    const frameSec = Math.min(0.1, ticker.deltaMS / 1000);
    accumulator += frameSec;

    if (activeSim) {
      while (accumulator >= FIXED_DT) {
        activeSim.step(FIXED_DT);
        if (aiCommander) {
          aiCommander.update(activeSim, FIXED_DT);
        }
        accumulator -= FIXED_DT;
      }

      hud.update(frameSec);
      renderer.render(activeSim, localFaction, hud.selectedIds);

      if (activeSim.winner && !matchEndedReported) {
        matchEndedReported = true;
        mpClient.reportGlobalWarResult(activeSim.winner);
        const won = activeSim.winner === localFaction;
        document.getElementById('gameover-title')!.textContent = won
          ? 'THEATER VICTORY — CORRIDOR SECURED'
          : 'COMMAND NETWORK LOST — DEFEAT';
        document.getElementById('gameover-summary')!.textContent = won
          ? `${localFaction.toUpperCase()} Forces neutralized enemy HQ and shifted the Global Frontline!`
          : `Enemy forces overran your operational HQ.`;
        gameoverModal.classList.remove('hidden');
      }
    } else if (previewSim) {
      // Animate background AI clash on the live OpenStreetMap sector behind Command Lobby
      while (accumulator >= FIXED_DT) {
        previewSim.step(FIXED_DT);
        previewAiBlue.update(previewSim, FIXED_DT);
        previewAiRed.update(previewSim, FIXED_DT);
        accumulator -= FIXED_DT;
      }
      renderer.camX = WORLD_WIDTH * 0.5 + Math.sin(previewSim.elapsedSec * 0.08) * 280;
      renderer.camY = WORLD_HEIGHT * 0.5 + Math.cos(previewSim.elapsedSec * 0.06) * 200;
      renderer.render(previewSim, 'blue', new Set());
    }
  });
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap THEATER COMMAND:', err);
});

