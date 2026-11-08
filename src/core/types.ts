export type Faction = 'blue' | 'red' | 'neutral';
export type PlayableFaction = 'blue' | 'red';
export type DoctrineId = 'mech_blitz' | 'air_cav' | 'net_ew';
export type AIDifficulty = 'easy' | 'tactical' | 'hardcore';

export type UnitCategory = 'ground' | 'infantry' | 'air' | 'naval';
export type UnitDomain = 'land' | 'amphibious' | 'heli' | 'jet' | 'sea';

export type UnitType =
  | 'rifle_squad'
  | 'atgm_team'
  | 'manpads_team'
  | 'combat_eng'
  | 'mbt'
  | 'ifv'
  | 'recon_uav'
  | 'spg_artillery'
  | 'mobile_sam'
  | 'attack_heli'
  | 'fighter_jet'
  | 'strike_jet'
  | 'sead_jet'
  | 'corvette'
  | 'frigate';

export type NodeType =
  | 'hq'
  | 'city'
  | 'oil_depot'
  | 'ammo_plant'
  | 'airfield'
  | 'seaport'
  | 'railhead'
  | 'highway_entry'
  | 'radar_station'
  | 'fob'
  | 'sam_site';

export type LandcoverType =
  | 'deep_water'
  | 'coastal_water'
  | 'beach'
  | 'plains'
  | 'forest'
  | 'urban'
  | 'paved';

export type BallisticType =
  | 'small_arms'
  | 'autocannon'
  | 'apfsds'
  | 'artillery'
  | 'atgm'
  | 'sam'
  | 'sead'
  | 'cruise_missile'
  | 'bomb'
  | 'ciws';

export interface WeaponSpec {
  name: string;
  ballistic: BallisticType;
  damage: number;
  splashRadius: number;
  range: number;
  minRange: number;
  reloadSec: number;
  projectileSpeed: number;
  ammoCost: number;
  targetsGround: boolean;
  targetsAir: boolean;
  targetsMissile: boolean;
  requiresRadar?: boolean;
}

export interface UnitDef {
  type: UnitType;
  name: string;
  shortName: string;
  roleDesc: string;
  category: UnitCategory;
  domain: UnitDomain;
  deployVia: 'rail_hwy' | 'airfield' | 'seaport';
  costMoney: number;
  maxHp: number;
  armorClass: 'soft' | 'light' | 'heavy' | 'air' | 'ship';
  directionalArmor: boolean;
  speed: number;
  turnRate: number;
  turretTurnRate: number;
  hasTurret: boolean;
  radius: number;
  visionRange: number;
  radarRange: number;
  stealthFactor: number; // 0 = normal, 0.45 = stealthy recon/infantry
  maxFuel: number;
  fuelBurnPerSec: number;
  maxAmmo: number;
  transportCap: number;
  canSmoke: boolean;
  canEngineer: boolean;
  cruiseAltitude: number; // 0 for land/sea, ~36 for heli, ~115 for jet
  primaryWeapon: WeaponSpec;
  secondaryWeapon?: WeaponSpec;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface InfraSpline {
  id: string;
  kind: 'highway' | 'railroad';
  name: string;
  points: Point2D[];
  damagedSegments: Set<number>; // segment index i -> i+1 damaged/cratered
}

export interface Bridge {
  id: string;
  name: string;
  kind: 'highway' | 'railroad';
  x: number;
  y: number;
  angle: number;
  length: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  splineId: string;
  segmentIndex: number;
}

export interface StrategicNode {
  id: number;
  name: string;
  type: NodeType;
  faction: Faction;
  captureProgress: number; // -100 (red) to +100 (blue)
  capturingFaction: Faction;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  destroyed: boolean; // e.g., cratered runway or destroyed radar dome / SAM
  supplied: boolean;
  incomeMoney: number;
  incomeFuel: number;
  incomeAmmo: number;
  radarRange: number;
  runwayAngle?: number;
  attackCooldown?: number;
}

export interface UnitOrder {
  kind:
    | 'move'
    | 'attack_move'
    | 'attack_unit'
    | 'attack_ground'
    | 'board_transport'
    | 'garrison_node'
    | 'repair_target'
    | 'patrol_air';
  x: number;
  y: number;
  targetUnitId?: number;
  targetNodeId?: number;
  targetBridgeId?: string;
}

export interface Unit {
  id: number;
  type: UnitType;
  faction: PlayableFaction;
  x: number;
  y: number;
  z: number; // World elevation + flight altitude
  vx: number;
  vy: number;
  angle: number;
  turretAngle: number;
  hp: number;
  maxHp: number;
  fuel: number;
  maxFuel: number;
  ammo: number;
  maxAmmo: number;
  supplied: boolean;
  radarActive: boolean;
  holdFire: boolean;
  smokeCooldown: number;
  primaryCooldown: number;
  secondaryCooldown: number;
  passengers: number[];
  insideTransportId: number | null;
  garrisonNodeId: number | null;
  homeAirfieldId: number | null;
  returningToBase: boolean;
  loiterAngle: number;
  orders: UnitOrder[];
  waypoints: Point2D[];
  waypointIdx: number;
}

export interface TrainDelivery {
  id: number;
  faction: PlayableFaction;
  splineId: string;
  progressDist: number;
  totalDist: number;
  dropX: number;
  dropY: number;
  speed: number;
  cargoTypes: UnitType[];
  x: number;
  y: number;
  angle: number;
}

export interface Projectile {
  id: number;
  faction: PlayableFaction;
  sourceUnitId: number;
  ballistic: BallisticType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  damage: number;
  splashRadius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetUnitId: number | null;
  hp: number; // Missiles can be intercepted by SAM / CIWS
  interceptable: boolean;
  age: number;
  maxAge: number;
}

export interface SmokeCloud {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  remainingSec: number;
}

export interface VisualEffect {
  id: number;
  kind: 'explosion' | 'muzzle' | 'splash' | 'crater_smoke' | 'radar_ping' | 'ciws_burst';
  x: number;
  y: number;
  z: number;
  radius: number;
  age: number;
  duration: number;
  color: number;
}

export interface FactionEconomy {
  money: number;
  fuel: number;
  ammo: number;
  moneyRate: number;
  fuelRate: number;
  ammoRate: number;
  doctrine: DoctrineId;
  sectorsHeld: number;
}

export type GameCommand =
  | {
      kind: 'ORDER_UNITS';
      faction: PlayableFaction;
      unitIds: number[];
      order: UnitOrder;
      queue: boolean;
    }
  | {
      kind: 'DEPLOY_UNIT';
      faction: PlayableFaction;
      unitType: UnitType;
      targetX?: number;
      targetY?: number;
    }
  | {
      kind: 'UNIT_ABILITY';
      faction: PlayableFaction;
      unitIds: number[];
      ability:
        | 'pop_smoke'
        | 'toggle_radar'
        | 'toggle_hold_fire'
        | 'unload_passengers'
        | 'build_fob'
        | 'build_sam'
        | 'halt'
        | 'rtb';
      targetX?: number;
      targetY?: number;
    };
