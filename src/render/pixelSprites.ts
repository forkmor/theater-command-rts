import { CanvasSource, Texture, TextureStyle } from 'pixi.js';
import type { Faction, NodeType, PlayableFaction, UnitType } from '../core/types';

TextureStyle.defaultOptions.scaleMode = 'nearest';

function makePixelTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  return new Texture({
    source: new CanvasSource({
      resource: canvas,
      scaleMode: 'nearest',
    }),
  });
}

function getFactionPalette(faction: Faction) {
  if (faction === 'blue') {
    return {
      hullDark: '#233642',
      hullMid: '#345468',
      hullLight: '#4f7c99',
      accent: '#42b0ff',
      camo: '#2c483d',
    };
  }
  if (faction === 'red') {
    return {
      hullDark: '#3d2a24',
      hullMid: '#593e33',
      hullLight: '#7c5947',
      accent: '#ef5350',
      camo: '#42472b',
    };
  }
  return {
    hullDark: '#353b3c',
    hullMid: '#525b5d',
    hullLight: '#737f82',
    accent: '#d4b44a',
    camo: '#454d48',
  };
}

export class PixelSpriteAtlas {
  private hullTextures = new Map<string, Texture>();
  private turretTextures = new Map<string, Texture>();
  private nodeTextures = new Map<string, Texture>();
  readonly rotorTexture: Texture;
  readonly radarDishTexture: Texture;
  readonly trainLocoBlue: Texture;
  readonly trainLocoRed: Texture;
  readonly trainFlatbed: Texture;
  readonly treeTextures: Texture[];

  constructor() {
    this.rotorTexture = this.buildRotorTexture();
    this.radarDishTexture = this.buildRadarDishTexture();
    this.trainLocoBlue = this.buildTrainLoco('blue');
    this.trainLocoRed = this.buildTrainLoco('red');
    this.trainFlatbed = this.buildTrainFlatbed();
    this.treeTextures = [this.buildTree(0), this.buildTree(1), this.buildTree(2)];

    const factions: PlayableFaction[] = ['blue', 'red'];
    const unitTypes: UnitType[] = [
      'rifle_squad',
      'atgm_team',
      'manpads_team',
      'combat_eng',
      'mbt',
      'ifv',
      'recon_uav',
      'spg_artillery',
      'mobile_sam',
      'attack_heli',
      'fighter_jet',
      'strike_jet',
      'sead_jet',
      'corvette',
      'frigate',
    ];

    for (const f of factions) {
      for (const ut of unitTypes) {
        this.hullTextures.set(`${f}:${ut}`, this.buildUnitHull(ut, f));
        const tur = this.buildUnitTurret(ut, f);
        if (tur) {
          this.turretTextures.set(`${f}:${ut}`, tur);
        }
      }
    }

    const nodeTypes: NodeType[] = [
      'hq',
      'city',
      'oil_depot',
      'ammo_plant',
      'airfield',
      'seaport',
      'railhead',
      'highway_entry',
      'radar_station',
      'fob',
      'sam_site',
    ];
    for (const nf of ['blue', 'red', 'neutral'] as Faction[]) {
      for (const nt of nodeTypes) {
        this.nodeTextures.set(`${nf}:${nt}`, this.buildNodeSprite(nt, nf));
      }
    }
  }

  getUnitHull(type: UnitType, faction: PlayableFaction): Texture {
    return this.hullTextures.get(`${faction}:${type}`)!;
  }

  getUnitTurret(type: UnitType, faction: PlayableFaction): Texture | undefined {
    return this.turretTextures.get(`${faction}:${type}`);
  }

  getNodeTexture(type: NodeType, faction: Faction): Texture {
    return this.nodeTextures.get(`${faction}:${type}`)!;
  }

  private buildUnitHull(type: UnitType, faction: PlayableFaction): Texture {
    const p = getFactionPalette(faction);

    // Infantry Squads (20x20 pixel art 3-soldier fireteam facing +X)
    if (
      type === 'rifle_squad' ||
      type === 'atgm_team' ||
      type === 'manpads_team' ||
      type === 'combat_eng'
    ) {
      return makePixelTexture(20, 20, (ctx) => {
        const spots = [
          [12, 10],
          [6, 5],
          [6, 15],
        ];
        for (let i = 0; i < spots.length; i++) {
          const [sx, sy] = spots[i];
          // Soldier shoulders
          ctx.fillStyle = p.hullDark;
          ctx.fillRect(sx - 2, sy - 3, 4, 6);
          ctx.fillStyle = p.camo;
          ctx.fillRect(sx - 1, sy - 2, 3, 4);
          // Helmet with faction pixel band
          ctx.fillStyle = p.hullLight;
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
          ctx.fillStyle = p.accent;
          ctx.fillRect(sx - 2, sy - 1, 1, 2);

          // Weapon barrel facing +X
          if (i === 0 && (type === 'atgm_team' || type === 'manpads_team')) {
            ctx.fillStyle = type === 'atgm_team' ? '#cfd8dc' : '#8bc34a';
            ctx.fillRect(sx, sy + 1, 6, 2);
          } else if (type === 'combat_eng' && i === 0) {
            ctx.fillStyle = '#ffb300'; // Engineer tool / satchel pack
            ctx.fillRect(sx - 3, sy - 2, 2, 4);
            ctx.fillStyle = '#b0bec5';
            ctx.fillRect(sx + 1, sy + 1, 4, 1);
          } else {
            ctx.fillStyle = '#90a4ae';
            ctx.fillRect(sx + 1, sy + 1, 5, 1);
          }
        }
      });
    }

    // Tracked / Wheeled Armored Hulls (32x24 facing +X)
    if (
      type === 'mbt' ||
      type === 'ifv' ||
      type === 'recon_uav' ||
      type === 'spg_artillery' ||
      type === 'mobile_sam'
    ) {
      return makePixelTexture(32, 24, (ctx) => {
        const isWheeled = type === 'recon_uav' || type === 'mobile_sam';
        if (isWheeled) {
          // 8x8 Tactical Tires
          ctx.fillStyle = '#14181a';
          for (const wx of [5, 11, 18, 24]) {
            ctx.fillRect(wx, 2, 4, 3);
            ctx.fillRect(wx, 19, 4, 3);
          }
        } else {
          // Heavy Tank Treads with pixel track links
          ctx.fillStyle = '#181c1e';
          ctx.fillRect(3, 2, 25, 4);
          ctx.fillRect(3, 18, 25, 4);
          ctx.fillStyle = '#374045';
          for (let tx = 4; tx < 27; tx += 3) {
            ctx.fillRect(tx, 2, 1, 4);
            ctx.fillRect(tx, 18, 1, 4);
          }
        }

        // Armored Hull Body
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(4, 4, 24, 16);
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(5, 5, 22, 14);
        // Camo patches
        ctx.fillStyle = p.camo;
        ctx.fillRect(7, 6, 6, 5);
        ctx.fillRect(17, 12, 7, 5);
        // Front sloped glacis plate (+X side)
        ctx.fillStyle = p.hullLight;
        ctx.fillRect(24, 6, 3, 12);
        // Faction ID stripe on rear deck
        ctx.fillStyle = p.accent;
        ctx.fillRect(5, 7, 2, 10);
        // Engine louvers on rear
        ctx.fillStyle = '#1b2226';
        ctx.fillRect(8, 8, 4, 8);
      });
    }

    // Attack Helicopter (36x28 facing +X)
    if (type === 'attack_heli') {
      return makePixelTexture(36, 28, (ctx) => {
        // Tail boom (-X)
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(3, 12, 15, 4);
        ctx.fillRect(2, 9, 3, 10); // tail stabilizer
        // Stub wings with ATGM rocket pods
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(17, 4, 6, 20);
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(18, 3, 6, 2);
        ctx.fillRect(18, 23, 6, 2);
        // Fuselage & Tandem Cockpit (+X)
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(14, 10, 16, 8);
        ctx.fillStyle = p.accent;
        ctx.fillRect(15, 11, 3, 6);
        // Armored Canopy Glass
        ctx.fillStyle = '#80deea';
        ctx.fillRect(23, 11, 6, 6);
        // 30mm Chin gun
        ctx.fillStyle = '#b0bec5';
        ctx.fillRect(30, 13, 4, 2);
      });
    }

    // Supersonic Jets (fighter_jet, strike_jet, sead_jet) — 38x34 facing +X
    if (type === 'fighter_jet' || type === 'strike_jet' || type === 'sead_jet') {
      return makePixelTexture(38, 34, (ctx) => {
        // Swept delta/tactical wings
        ctx.fillStyle = p.hullDark;
        ctx.beginPath();
        ctx.moveTo(24, 17);
        ctx.lineTo(9, 2);
        ctx.lineTo(6, 5);
        ctx.lineTo(12, 17);
        ctx.lineTo(6, 29);
        ctx.lineTo(9, 32);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = p.hullMid;
        ctx.fillRect(8, 14, 22, 6);
        // Nose radome (+X)
        ctx.fillStyle = type === 'sead_jet' ? '#ffd54f' : p.hullLight;
        ctx.fillRect(30, 15, 6, 4);
        ctx.fillRect(35, 16, 2, 2);
        // Twin afterburners (-X)
        ctx.fillStyle = '#ff9800';
        ctx.fillRect(5, 14, 3, 2);
        ctx.fillRect(5, 18, 3, 2);
        // Wingtip missiles / bombs + faction markings
        ctx.fillStyle = p.accent;
        ctx.fillRect(11, 7, 4, 3);
        ctx.fillRect(11, 24, 4, 3);
        ctx.fillStyle = type === 'strike_jet' ? '#aed581' : '#eceff1';
        ctx.fillRect(14, 4, 7, 1);
        ctx.fillRect(14, 29, 7, 1);
        // Bubble canopy
        ctx.fillStyle = '#80deea';
        ctx.fillRect(24, 16, 5, 2);
      });
    }

    // Naval Warships (corvette 46x22, frigate 58x26 facing +X)
    const isFrigate = type === 'frigate';
    const sw = isFrigate ? 58 : 46;
    const sh = isFrigate ? 26 : 22;
    return makePixelTexture(sw, sh, (ctx) => {
      const cy = Math.floor(sh / 2);
      // Stealth angular warship hull
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.moveTo(sw - 2, cy);
      ctx.lineTo(sw - 14, 3);
      ctx.lineTo(4, 4);
      ctx.lineTo(2, cy);
      ctx.lineTo(4, sh - 4);
      ctx.lineTo(sw - 14, sh - 3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#455a64';
      ctx.fillRect(6, 6, sw - 20, sh - 12);
      // Superstructure & Bridge
      ctx.fillStyle = '#607d8b';
      ctx.fillRect(18, 7, 16, sh - 14);
      ctx.fillStyle = p.accent;
      ctx.fillRect(8, cy - 3, 4, 6); // Helipad faction emblem
      // VLS Cruise Missile Vertical Launch Cells on Frigate!
      if (isFrigate) {
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(36, cy - 4, 7, 8);
        ctx.fillStyle = '#37474f';
        for (let vx = 37; vx <= 41; vx += 2) {
          ctx.fillRect(vx, cy - 3, 1, 2);
          ctx.fillRect(vx, cy + 1, 1, 2);
        }
      }
      // White CIWS Phalanx dome aft
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(13, cy - 2, 3, 4);
    });
  }

  private buildUnitTurret(type: UnitType, faction: PlayableFaction): Texture | null {
    const p = getFactionPalette(faction);
    if (type === 'mbt') {
      return makePixelTexture(36, 20, (ctx) => {
        // Composite turret centered around (14, 10)
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(7, 4, 14, 12);
        ctx.fillStyle = p.hullLight;
        ctx.fillRect(8, 5, 12, 10);
        ctx.fillStyle = p.accent;
        ctx.fillRect(9, 6, 3, 2);
        // 120mm Smoothbore Barrel with fume extractor
        ctx.fillStyle = '#90a4ae';
        ctx.fillRect(21, 9, 14, 2);
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(25, 8, 4, 4);
      });
    }
    if (type === 'ifv' || type === 'recon_uav') {
      return makePixelTexture(30, 18, (ctx) => {
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(9, 5, 10, 8);
        ctx.fillStyle = p.hullLight;
        ctx.fillRect(10, 6, 8, 6);
        // 30mm Autocannon
        ctx.fillStyle = '#b0bec5';
        ctx.fillRect(19, 8, 9, 2);
        if (type === 'ifv') {
          // Side ATGM pod
          ctx.fillStyle = p.accent;
          ctx.fillRect(11, 3, 6, 2);
        } else {
          // Recon optical sensor mast
          ctx.fillStyle = '#ffd54f';
          ctx.fillRect(12, 7, 3, 4);
        }
      });
    }
    if (type === 'spg_artillery') {
      return makePixelTexture(40, 22, (ctx) => {
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(6, 4, 16, 14);
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(7, 5, 14, 12);
        // Long 155mm L/52 barrel + muzzle brake
        ctx.fillStyle = '#90a4ae';
        ctx.fillRect(22, 10, 16, 2);
        ctx.fillRect(36, 9, 3, 4);
      });
    }
    if (type === 'mobile_sam') {
      return makePixelTexture(28, 22, (ctx) => {
        // Quad SAM canister rack + tracking radar dish
        ctx.fillStyle = p.hullDark;
        ctx.fillRect(7, 4, 14, 14);
        ctx.fillStyle = p.hullLight;
        ctx.fillRect(9, 5, 12, 4);
        ctx.fillRect(9, 13, 12, 4);
        ctx.fillStyle = '#ffd54f'; // Radar emitter bar
        ctx.fillRect(8, 8, 3, 6);
      });
    }
    if (type === 'corvette' || type === 'frigate') {
      return makePixelTexture(26, 16, (ctx) => {
        ctx.fillStyle = '#78909c';
        ctx.fillRect(8, 5, 8, 6);
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(16, 7, 8, 2);
      });
    }
    return null;
  }

  private buildRotorTexture(): Texture {
    return makePixelTexture(34, 34, (ctx) => {
      ctx.fillStyle = 'rgba(220, 235, 240, 0.55)';
      ctx.fillRect(1, 16, 32, 2);
      ctx.fillRect(16, 1, 2, 32);
      ctx.fillStyle = '#263238';
      ctx.fillRect(15, 15, 4, 4);
    });
  }

  private buildRadarDishTexture(): Texture {
    return makePixelTexture(20, 20, (ctx) => {
      ctx.fillStyle = '#eceff1';
      ctx.fillRect(7, 3, 4, 14);
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(11, 8, 4, 4);
    });
  }

  private buildTrainLoco(faction: PlayableFaction): Texture {
    const p = getFactionPalette(faction);
    return makePixelTexture(34, 16, (ctx) => {
      ctx.fillStyle = '#161b1d';
      ctx.fillRect(1, 1, 32, 14);
      ctx.fillStyle = p.hullMid;
      ctx.fillRect(3, 2, 28, 12);
      ctx.fillStyle = p.accent;
      ctx.fillRect(26, 3, 4, 10);
      ctx.fillStyle = '#80deea';
      ctx.fillRect(23, 4, 3, 8);
      ctx.fillStyle = '#263238';
      ctx.fillRect(7, 4, 12, 8);
    });
  }

  private buildTrainFlatbed(): Texture {
    return makePixelTexture(30, 14, (ctx) => {
      ctx.fillStyle = '#21272a';
      ctx.fillRect(1, 1, 28, 12);
      ctx.fillStyle = '#4e4335';
      ctx.fillRect(3, 2, 24, 10);
      ctx.fillStyle = '#78909c';
      ctx.fillRect(5, 4, 20, 6);
    });
  }

  private buildTree(kind: number): Texture {
    return makePixelTexture(16, 16, (ctx) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(5, 6, 9, 8);
      ctx.fillStyle = kind === 0 ? '#1e3b27' : kind === 1 ? '#26472c' : '#2e5230';
      ctx.fillRect(3, 3, 10, 10);
      ctx.fillStyle = kind === 2 ? '#4a753c' : '#36613b';
      ctx.fillRect(5, 4, 6, 6);
    });
  }

  private buildNodeSprite(type: NodeType, faction: Faction): Texture {
    const p = getFactionPalette(faction);
    return makePixelTexture(64, 64, (ctx) => {
      // Concrete foundation pad
      ctx.fillStyle = '#2c3336';
      ctx.fillRect(8, 8, 48, 48);
      ctx.fillStyle = '#3b4447';
      ctx.fillRect(10, 10, 44, 44);

      // Faction perimeter corners
      ctx.fillStyle = p.accent;
      ctx.fillRect(8, 8, 8, 3);
      ctx.fillRect(8, 8, 3, 8);
      ctx.fillRect(48, 8, 8, 3);
      ctx.fillRect(53, 8, 3, 8);
      ctx.fillRect(8, 53, 8, 3);
      ctx.fillRect(8, 48, 3, 8);
      ctx.fillRect(48, 53, 8, 3);
      ctx.fillRect(53, 48, 3, 8);

      if (type === 'hq') {
        // Hardened Command Bunker + Helipad H + Comms Mast
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(14, 14, 22, 22);
        ctx.fillStyle = p.hullLight;
        ctx.fillRect(17, 17, 16, 16);
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(40, 36, 2, 12);
        ctx.fillRect(48, 36, 2, 12);
        ctx.fillRect(40, 41, 10, 2); // 'H' pad
      } else if (type === 'city') {
        // High-rise pixel civic center
        ctx.fillStyle = '#546e7a';
        ctx.fillRect(14, 14, 16, 18);
        ctx.fillStyle = '#78909c';
        ctx.fillRect(34, 20, 16, 26);
        ctx.fillStyle = '#ffe082';
        for (let wy = 23; wy < 43; wy += 5) {
          ctx.fillRect(37, wy, 3, 2);
          ctx.fillRect(43, wy, 3, 2);
        }
      } else if (type === 'oil_depot') {
        // Cylindrical White/Amber Fuel Storage Tanks & Pipelines
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(14, 14, 14, 14);
        ctx.fillRect(34, 14, 14, 14);
        ctx.fillStyle = '#ffb300';
        ctx.fillRect(14, 19, 14, 3);
        ctx.fillRect(34, 19, 14, 3);
        ctx.fillStyle = '#78909c';
        ctx.fillRect(18, 34, 28, 12);
      } else if (type === 'ammo_plant') {
        // Earth-bermed Munition Bunkers
        ctx.fillStyle = '#3e4f3a';
        ctx.fillRect(13, 14, 17, 14);
        ctx.fillRect(34, 14, 17, 14);
        ctx.fillRect(13, 35, 38, 13);
        ctx.fillStyle = '#ff7043';
        ctx.fillRect(20, 39, 24, 4);
      } else if (type === 'airfield') {
        // Hardened Aircraft Shelters & Control Tower
        ctx.fillStyle = '#455a64';
        ctx.fillRect(12, 12, 18, 14);
        ctx.fillRect(34, 12, 18, 14);
        ctx.fillStyle = '#80deea';
        ctx.fillRect(26, 40, 12, 10);
      } else if (type === 'seaport') {
        // Naval Pier, Container Stacks & Dockyard Cranes
        ctx.fillStyle = '#546e7a';
        ctx.fillRect(10, 4, 10, 28);
        ctx.fillRect(44, 4, 10, 28);
        ctx.fillStyle = '#ff7043';
        ctx.fillRect(12, 10, 40, 4); // Gantry crane
        ctx.fillStyle = '#29b6f6';
        ctx.fillRect(16, 36, 12, 12);
        ctx.fillStyle = '#ffa726';
        ctx.fillRect(34, 36, 12, 12);
      } else if (type === 'railhead' || type === 'highway_entry') {
        // Logistics gantry & loading bay
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(14, 16, 36, 12);
        ctx.fillStyle = '#ffd54f';
        ctx.fillRect(16, 36, 32, 8);
      } else if (type === 'radar_station') {
        // Geodesic Radome base
        ctx.fillStyle = '#cfd8dc';
        ctx.fillRect(20, 20, 24, 24);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(24, 24, 16, 16);
      } else if (type === 'fob') {
        // Sandbagged Forward Operating Base & Supply Crates
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(12, 12, 40, 40);
        ctx.fillStyle = '#4e5d42';
        ctx.fillRect(18, 18, 28, 28);
        ctx.fillStyle = '#ffb300';
        ctx.fillRect(26, 26, 12, 12);
      } else if (type === 'sam_site') {
        // Fixed Tactical SAM Battery Emplacement
        ctx.fillStyle = p.hullMid;
        ctx.fillRect(16, 16, 32, 32);
        ctx.fillStyle = '#eceff1';
        ctx.fillRect(22, 20, 6, 24);
        ctx.fillRect(36, 20, 6, 24);
      }
    });
  }
}
