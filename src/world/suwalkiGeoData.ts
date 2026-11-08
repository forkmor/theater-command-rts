/**
 * Real-world WGS84 GIS Dataset for the Suwalki Gap, Kaliningrad Oblast,
 * Southern Lithuania, Northeastern Poland, and Northwestern Belarus Theater.
 *
 * Bounding Box:
 *   Latitude:  53.55°N (South: Augustow / Grodno / Elk) to 55.80°N (North: Klaipeda / Palanga)
 *   Longitude: 19.75°E (West: Baltic Sea / Gdansk Bay / Baltiysk) to 24.30°E (East: Kaunas / Alytus / Grodno)
 */

export const GIS_BOUNDS = {
  minLat: 53.55,
  maxLat: 55.8,
  minLon: 19.75,
  maxLon: 24.3,
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GisWaterPolygon {
  name: string;
  depthMeters: number;
  polygon: Array<[number, number]>; // [lat, lon]
}

export interface GisLandSpitPolygon {
  name: string;
  elevMeters: number;
  polygon: Array<[number, number]>; // [lat, lon]
}

export interface GisRiverLine {
  name: string;
  widthMeters: number;
  depthMeters: number;
  points: Array<[number, number]>; // [lat, lon]
}

export interface GisRouteLine {
  id: string;
  name: string;
  kind: 'highway' | 'railroad';
  points: Array<[number, number]>; // [lat, lon]
}

export interface GisBridgeDef {
  id: string;
  name: string;
  kind: 'highway' | 'railroad';
  lat: number;
  lon: number;
  length: number;
  routeId: string;
  segmentIndex: number;
}

export interface GisSettlement {
  name: string;
  lat: number;
  lon: number;
  type:
    | 'hq'
    | 'city'
    | 'oil_depot'
    | 'ammo_plant'
    | 'airfield'
    | 'seaport'
    | 'railhead'
    | 'highway_entry'
    | 'radar_station';
  faction: 'blue' | 'red' | 'neutral';
  populationRank: 1 | 2 | 3; // 1=Major City (Kaunas, Kaliningrad, Klaipeda, Grodno, Suwalki), 2=Regional Town, 3=Base/Facility
  runwayHeadingDeg?: number;
  incomeMoney: number;
  incomeFuel: number;
  incomeAmmo: number;
  radarRange: number;
  buildingClusterSeed: number;
}

export interface GisElevationFeature {
  name: string;
  lat: number;
  lon: number;
  peakMeters: number;
  radiusLat: number;
  radiusLon: number;
}

/**
 * 1. Real Baltic Sea, Gdansk Bay, Vistula Lagoon & Curonian Lagoon Coastline Polygons
 */
export const BALTIC_COASTLINE_LON_BY_LAT: Array<[number, number]> = [
  // [lat, coastline_lon] from South (Elblag/Vistula Spit 54.30N) to North (Palanga 55.85N)
  [53.55, 19.35],
  [54.25, 19.45],
  [54.35, 19.65],
  [54.45, 19.78],
  [54.58, 19.86],
  [54.65, 19.9], // Baltiysk Strait
  [54.76, 19.96], // Yantarny
  [54.95, 19.98], // Cape Taran (NW corner of Sambia Peninsula)
  [54.96, 20.47], // Zelenogradsk (root of Curonian Spit)
  [55.15, 20.84], // Rybachy (Curonian Spit)
  [55.3, 20.99], // Nida (Curonian Spit)
  [55.52, 21.11], // Juodkrante
  [55.7, 21.12], // Klaipeda Seaport Gate
  [55.85, 21.08], // Palanga
];

export const WATER_POLYGONS: GisWaterPolygon[] = [
  {
    name: 'Vistula Lagoon (Zalew Wislany)',
    depthMeters: -9,
    polygon: [
      [54.28, 19.55],
      [54.42, 19.78],
      [54.63, 19.93],
      [54.68, 20.38], // Kaliningrad Sea Canal entrance
      [54.62, 20.28],
      [54.5, 20.05],
      [54.35, 19.72],
    ],
  },
  {
    name: 'Curonian Lagoon (Kursiu Marios)',
    depthMeters: -10,
    polygon: [
      [54.93, 20.52], // Southern shore near Zelenogradsk / Polessk
      [55.15, 20.88],
      [55.35, 21.04],
      [55.68, 21.14], // Klaipeda Strait
      [55.55, 21.26], // Dreverna
      [55.34, 21.28], // Neman Delta / Vente Cape
      [55.15, 21.25], // Mysovka
      [54.9, 21.12], // Polessk
      [54.88, 20.75],
    ],
  },
  {
    name: 'Lake Wigry (Suwalki)',
    depthMeters: -12,
    polygon: [
      [54.0, 23.02],
      [54.08, 23.04],
      [54.09, 23.14],
      [54.01, 23.13],
    ],
  },
  {
    name: 'Lake Vistytis (Border Lake)',
    depthMeters: -11,
    polygon: [
      [54.39, 22.69],
      [54.46, 22.7],
      [54.46, 22.77],
      [54.39, 22.76],
    ],
  },
  {
    name: 'Lake Mamry & Masurian Lakes (Gizycko)',
    depthMeters: -11,
    polygon: [
      [54.03, 21.65],
      [54.2, 21.66],
      [54.2, 21.8],
      [54.03, 21.79],
    ],
  },
  {
    name: 'Kaunas Reservoir (Kauno Marios)',
    depthMeters: -12,
    polygon: [
      [54.88, 23.99],
      [54.91, 24.08],
      [54.82, 24.22],
      [54.79, 24.14],
    ],
  },
];

export const SPIT_POLYGONS: GisLandSpitPolygon[] = [
  {
    name: 'Curonian Spit (Kursiu Nerija)',
    elevMeters: 9,
    polygon: [
      [54.96, 20.47],
      [55.15, 20.83],
      [55.32, 20.99],
      [55.66, 21.11],
      [55.66, 21.14],
      [55.32, 21.03],
      [55.15, 20.87],
      [54.96, 20.51],
    ],
  },
  {
    name: 'Vistula Spit (Mierzeja Wislana)',
    elevMeters: 8,
    polygon: [
      [54.35, 19.64],
      [54.63, 19.88],
      [54.63, 19.92],
      [54.35, 19.68],
    ],
  },
];

/**
 * 2. Real Rivers (Neman / Nemunas, Pregolya, Sesupe, Neris, Czarna Hancza / Augustow Canal)
 */
export const REAL_RIVERS: GisRiverLine[] = [
  {
    name: 'Neman River (Nemunas)',
    widthMeters: 44,
    depthMeters: -9,
    points: [
      [53.55, 23.85],
      [53.68, 23.83], // Grodno
      [53.88, 23.91],
      [54.02, 23.97], // Druskininkai
      [54.22, 24.03], // Merkine
      [54.4, 24.05], // Alytus
      [54.6, 24.03], // Birstonas / Prienai
      [54.88, 23.98], // Kaunas Reservoir Dam
      [54.9, 23.88], // Kaunas Confluence
      [55.04, 23.42], // Vilkija
      [55.07, 22.77], // Jurbarkas
      [55.05, 22.26], // Rambynas
      [55.08, 21.89], // Sovetsk / Panemune (Queen Louise Bridge)
      [55.18, 21.55], // Rusne
      [55.31, 21.28], // Curonian Lagoon Delta
    ],
  },
  {
    name: 'Pregolya River',
    widthMeters: 38,
    depthMeters: -8,
    points: [
      [54.45, 22.22], // Angrapa source near Gusev/Oziorisk
      [54.59, 22.2], // Gusev
      [54.64, 21.81], // Chernyakhovsk
      [54.65, 21.41], // Talpaki
      [54.65, 21.07], // Gvardeysk
      [54.7, 20.5], // Kaliningrad
      [54.69, 20.34], // Vistula Lagoon Mouth
    ],
  },
  {
    name: 'Sesupe River',
    widthMeters: 32,
    depthMeters: -7,
    points: [
      [54.24, 22.92], // Szypliszki / Rutka-Tartak
      [54.34, 23.11], // Liubavas
      [54.41, 23.23], // Kalvarija
      [54.56, 23.35], // Marijampole
      [54.71, 23.04], // Pilviskiai
      [54.78, 22.86], // Kudirkos Naumiestis
      [54.95, 22.49], // Krasnoznamensk
      [55.05, 22.18], // Joins Neman east of Sovetsk
    ],
  },
  {
    name: 'Augustow Canal & Czarna Hancza',
    widthMeters: 28,
    depthMeters: -6,
    points: [
      [53.83, 22.36], // Elk / Netta connection
      [53.84, 22.98], // Augustow
      [53.87, 23.35], // Mikaszowka
      [53.86, 23.78], // Joins Neman north of Grodno
    ],
  },
  {
    name: 'Minija & Jura Rivers (Western Lithuania)',
    widthMeters: 28,
    depthMeters: -6,
    points: [
      [55.7, 21.4], // Gargzdai
      [55.54, 21.32], // Priekule
      [55.35, 21.28], // Into Curonian Lagoon
    ],
  },
];

/**
 * 3. Real SRTM-Calibrated Topographic Ridges & Hills
 * (Suwalki Moraine Uplands, Vistytis / Sudovian Hills, Dzukija Highlands, Medininkai/Zemaiciai)
 */
export const REAL_ELEVATION_FEATURES: GisElevationFeature[] = [
  {
    name: 'Rowelska Gora & Wizajny Moraine Ridge (Highest Point in Suwalki Gap)',
    lat: 54.36,
    lon: 22.87,
    peakMeters: 118,
    radiusLat: 0.22,
    radiusLon: 0.36,
  },
  {
    name: 'Szeskie Hills (Goldap Uplands)',
    lat: 54.24,
    lon: 22.34,
    peakMeters: 108,
    radiusLat: 0.2,
    radiusLon: 0.34,
  },
  {
    name: 'Vistytis / Sudovian Heights (Dunojus Hill)',
    lat: 54.44,
    lon: 22.78,
    peakMeters: 104,
    radiusLat: 0.18,
    radiusLon: 0.28,
  },
  {
    name: 'Suwalki & Krzemianucha Moraine Ridge',
    lat: 54.17,
    lon: 22.91,
    peakMeters: 92,
    radiusLat: 0.2,
    radiusLon: 0.35,
  },
  {
    name: 'Dzukija / Alytus Eastern Highlands',
    lat: 54.3,
    lon: 23.75,
    peakMeters: 86,
    radiusLat: 0.28,
    radiusLon: 0.42,
  },
  {
    name: 'Grodno Heights (Belarus Fortified Uplands)',
    lat: 53.66,
    lon: 23.68,
    peakMeters: 88,
    radiusLat: 0.22,
    radiusLon: 0.38,
  },
  {
    name: 'Zemaiciai Western Uplands (North of Taurage)',
    lat: 55.48,
    lon: 22.35,
    peakMeters: 84,
    radiusLat: 0.25,
    radiusLon: 0.45,
  },
  {
    name: 'Sambia Peninsula Coastal Bluffs (Kaliningrad NW)',
    lat: 54.88,
    lon: 20.18,
    peakMeters: 52,
    radiusLat: 0.14,
    radiusLon: 0.26,
  },
  {
    name: 'Stablack / Dolgorukovo Uplands (Southern Kaliningrad)',
    lat: 54.42,
    lon: 20.52,
    peakMeters: 68,
    radiusLat: 0.16,
    radiusLon: 0.3,
  },
];

/**
 * 4. Real Highway & Railroad Vector Routes (OpenStreetMap / European E-Road & Rail Network)
 */
export const REAL_ROUTES: GisRouteLine[] = [
  // --- HIGHWAYS ---
  {
    id: 'hwy_e67_via_baltica',
    name: 'E67 Via Baltica (S61 / A5)',
    kind: 'highway',
    points: [
      [53.83, 22.36], // Elk
      [53.99, 22.78], // Raczki
      [54.1, 22.93], // Suwalki
      [54.24, 23.06], // Szypliszki
      [54.28, 23.12], // Budzisko PL/LT Border
      [54.41, 23.22], // Kalvarija (Crosses Sesupe at seg 5)
      [54.56, 23.35], // Marijampole
      [54.73, 23.66], // Mauruciai
      [54.9, 23.88], // Kaunas (Crosses Neman at seg 7)
      [55.14, 23.5], // Ariogala
      [55.47, 22.69], // Kryzkalnis
    ],
  },
  {
    id: 'hwy_a1_lithuania',
    name: 'A1 Motorway (Kaunas - Klaipeda)',
    kind: 'highway',
    points: [
      [54.9, 23.88], // Kaunas
      [55.22, 23.12], // Raseiniai
      [55.47, 22.69], // Kryzkalnis
      [55.62, 21.95], // Rietavas
      [55.7, 21.4], // Gargzdai
      [55.7, 21.14], // Klaipeda Port
    ],
  },
  {
    id: 'hwy_e28_kaliningrad_minsk',
    name: 'E28 / A229 (Baltiysk - Kaliningrad - Gusev - Marijampole)',
    kind: 'highway',
    points: [
      [54.65, 19.91], // Baltiysk Naval Base
      [54.73, 20.1], // Primorsk
      [54.71, 20.5], // Kaliningrad
      [54.65, 21.07], // Gvardeysk (Crosses Pregolya at seg 2)
      [54.65, 21.41], // Talpaki
      [54.63, 21.81], // Chernyakhovsk
      [54.59, 22.2], // Gusev
      [54.63, 22.57], // Nesterov
      [54.64, 22.76], // Kybartai Border
      [54.65, 23.03], // Vilkaviskis
      [54.56, 23.35], // Marijampole
    ],
  },
  {
    id: 'hwy_e77_sovetsk_taurage',
    name: 'E77 / A216 (Talpaki - Sovetsk - Taurage)',
    kind: 'highway',
    points: [
      [54.65, 21.41], // Talpaki
      [54.88, 21.65], // Bolshakovo
      [55.06, 21.88], // Sovetsk South
      [55.11, 21.91], // Panemune North (Crosses Neman Queen Louise Bridge at seg 2)
      [55.25, 22.29], // Taurage
      [55.47, 22.69], // Kryzkalnis
    ],
  },
  {
    id: 'hwy_coastal_a190_a12',
    name: 'Baltic Littoral Hwy (Kaliningrad - Sovetsk - Silute - Klaipeda)',
    kind: 'highway',
    points: [
      [54.71, 20.5], // Kaliningrad
      [54.76, 20.45], // Chkalovsk Airbase
      [54.86, 21.1], // Polessk
      [55.06, 21.88], // Sovetsk
      [55.14, 21.91], // Pagegiai
      [55.35, 21.48], // Silute
      [55.54, 21.32], // Priekule
      [55.7, 21.14], // Klaipeda Port
    ],
  },
  {
    id: 'hwy_dk16_grodno_alytus',
    name: 'DK16 / A4 Corridor (Gizycko - Elk - Augustow - Grodno - Alytus)',
    kind: 'highway',
    points: [
      [54.04, 21.77], // Gizycko
      [53.83, 22.36], // Elk
      [53.84, 22.98], // Augustow (Crosses Augustow Canal at seg 1)
      [54.1, 22.93], // Suwalki
      [54.11, 23.35], // Sejny
      [54.23, 23.51], // Lazdijai
      [54.4, 24.02], // Alytus West
      [54.4, 24.08], // Alytus East (Crosses Neman at seg 6)
      [54.02, 23.97], // Druskininkai
      [53.68, 23.83], // Grodno
      [53.84, 22.98], // Augustow - Grodno direct link
    ],
  },
  {
    id: 'hwy_dk65_goldap_gusev',
    name: 'DK65 / DW651 Border Highway (Elk - Goldap - Wizajny - Gusev)',
    kind: 'highway',
    points: [
      [53.83, 22.36], // Elk
      [54.04, 22.5], // Olecko
      [54.31, 22.3], // Goldap
      [54.36, 22.87], // Wizajny Radar Ridge
      [54.41, 23.22], // Kalvarija
      [54.31, 22.3], // Goldap branch
      [54.59, 22.2], // Gusev
    ],
  },
  {
    id: 'hwy_a16_marijampole_alytus',
    name: 'A16 / A130 (Marijampole - Prienai - Alytus - Kaunas)',
    kind: 'highway',
    points: [
      [54.56, 23.35], // Marijampole
      [54.64, 23.95], // Prienai
      [54.4, 24.02], // Alytus
      [54.64, 23.95], // Prienai
      [54.9, 23.88], // Kaunas
    ],
  },

  // --- RAILROADS ---
  {
    id: 'rail_baltica',
    name: 'Rail Baltica Mainline (Elk - Suwalki - Mockava - Marijampole - Kaunas)',
    kind: 'railroad',
    points: [
      [53.83, 22.36], // Elk Railhead
      [54.04, 22.5], // Olecko
      [54.1, 22.93], // Suwalki Station
      [54.16, 23.18], // Trakiskiai
      [54.32, 23.29], // Mockava Intermodal Yard
      [54.36, 23.44], // Sestokai
      [54.56, 23.35], // Marijampole (Crosses Sesupe at seg 5)
      [54.75, 23.49], // Kazlu Ruda Junction
      [54.9, 23.88], // Kaunas Intermodal Hub
    ],
  },
  {
    id: 'rail_kaliningrad_trunk',
    name: 'Kaliningrad - Chernyakhovsk - Gusev - Kybartai Trunk Rail',
    kind: 'railroad',
    points: [
      [54.65, 19.91], // Baltiysk Port Rail
      [54.69, 20.5], // Kaliningrad-Yuzhny
      [54.65, 21.07], // Gvardeysk
      [54.63, 21.81], // Chernyakhovsk Railhead (Crosses Pregolya at seg 2)
      [54.59, 22.2], // Gusev Station
      [54.63, 22.57], // Nesterov
      [54.64, 22.76], // Kybartai
      [54.65, 23.03], // Vilkaviskis
      [54.75, 23.49], // Kazlu Ruda Junction
    ],
  },
  {
    id: 'rail_klaipeda_sovetsk',
    name: 'Klaipeda - Silute - Sovetsk - Chernyakhovsk Railway',
    kind: 'railroad',
    points: [
      [55.7, 21.14], // Klaipeda Port Rail Yard
      [55.35, 21.48], // Silute
      [55.14, 21.91], // Pagegiai
      [55.06, 21.88], // Sovetsk (Crosses Neman at seg 2)
      [54.88, 21.65], // Bolshakovo
      [54.63, 21.81], // Chernyakhovsk Railhead
    ],
  },
  {
    id: 'rail_grodno_suwalki',
    name: 'Grodno - Augustow - Elk Southern Rail Line',
    kind: 'railroad',
    points: [
      [53.68, 23.83], // Grodno Rail Terminal
      [53.75, 23.42], // Duba / Lipsk
      [53.84, 22.98], // Augustow
      [53.83, 22.36], // Elk Railhead
    ],
  },
];

/**
 * 5. Real River Bridges along the Highway & Rail Corridors
 */
export const REAL_BRIDGES: GisBridgeDef[] = [
  {
    id: 'br_queen_louise_sovetsk',
    name: 'Queen Louise Bridge (Sovetsk - Panemune)',
    kind: 'highway',
    lat: 55.085,
    lon: 21.895,
    length: 118,
    routeId: 'hwy_e77_sovetsk_taurage',
    segmentIndex: 2,
  },
  {
    id: 'br_sovetsk_rail',
    name: 'Sovetsk - Pagegiai Neman Rail Bridge',
    kind: 'railroad',
    lat: 55.095,
    lon: 21.895,
    length: 120,
    routeId: 'rail_klaipeda_sovetsk',
    segmentIndex: 2,
  },
  {
    id: 'br_kalvarija_sesupe',
    name: 'Kalvarija Via Baltica Bridge (Sesupe)',
    kind: 'highway',
    lat: 54.41,
    lon: 23.22,
    length: 98,
    routeId: 'hwy_e67_via_baltica',
    segmentIndex: 4,
  },
  {
    id: 'br_marijampole_rail',
    name: 'Marijampole Rail Baltica Bridge (Sesupe)',
    kind: 'railroad',
    lat: 54.56,
    lon: 23.35,
    length: 105,
    routeId: 'rail_baltica',
    segmentIndex: 5,
  },
  {
    id: 'br_kaunas_neman_hwy',
    name: 'Kaunas Via Baltica Neman Bridge',
    kind: 'highway',
    lat: 54.88,
    lon: 23.86,
    length: 125,
    routeId: 'hwy_e67_via_baltica',
    segmentIndex: 7,
  },
  {
    id: 'br_alytus_neman',
    name: 'Alytus Kaniukai Neman Bridge',
    kind: 'highway',
    lat: 54.4,
    lon: 24.05,
    length: 115,
    routeId: 'hwy_dk16_grodno_alytus',
    segmentIndex: 6,
  },
  {
    id: 'br_gvardeysk_pregolya',
    name: 'Gvardeysk E28 Pregolya Bridge',
    kind: 'highway',
    lat: 54.65,
    lon: 21.07,
    length: 105,
    routeId: 'hwy_e28_kaliningrad_minsk',
    segmentIndex: 2,
  },
  {
    id: 'br_Augustow_canal',
    name: 'Augustow Canal S61/DK16 Bridge',
    kind: 'highway',
    lat: 53.84,
    lon: 22.98,
    length: 95,
    routeId: 'hwy_dk16_grodno_alytus',
    segmentIndex: 1,
  },
];

/**
 * 6. Real Cities, Military Bases, Seaports, Airfields, Railheads & Industrial Depots
 */
export const REAL_SETTLEMENTS: GisSettlement[] = [
  // ================= BLUE FORCE (NATO: Poland & Lithuania) =================
  {
    name: 'Suwalki (MNC-NE Forward HQ)',
    lat: 54.1018,
    lon: 22.9308,
    type: 'hq',
    faction: 'blue',
    populationRank: 1,
    incomeMoney: 16,
    incomeFuel: 10,
    incomeAmmo: 10,
    radarRange: 480,
    buildingClusterSeed: 101,
  },
  {
    name: 'Elk Intermodal Railhead (PKP)',
    lat: 53.828,
    lon: 22.364,
    type: 'railhead',
    faction: 'blue',
    populationRank: 2,
    incomeMoney: 6,
    incomeFuel: 2,
    incomeAmmo: 8,
    radarRange: 260,
    buildingClusterSeed: 102,
  },
  {
    name: 'Kaunas / Karmelava Airbase (EYKA)',
    lat: 54.9,
    lon: 23.88,
    type: 'airfield',
    faction: 'blue',
    populationRank: 1,
    runwayHeadingDeg: 260,
    incomeMoney: 10,
    incomeFuel: 6,
    incomeAmmo: 6,
    radarRange: 560,
    buildingClusterSeed: 103,
  },
  {
    name: 'Klaipeda State Seaport',
    lat: 55.703,
    lon: 21.144,
    type: 'seaport',
    faction: 'blue',
    populationRank: 1,
    incomeMoney: 10,
    incomeFuel: 10,
    incomeAmmo: 4,
    radarRange: 540,
    buildingClusterSeed: 104,
  },
  {
    name: 'Gizycko (15th Mechanized Staging)',
    lat: 54.038,
    lon: 21.764,
    type: 'highway_entry',
    faction: 'blue',
    populationRank: 2,
    incomeMoney: 6,
    incomeFuel: 4,
    incomeAmmo: 6,
    radarRange: 260,
    buildingClusterSeed: 105,
  },
  {
    name: 'Wizajny / Rowelska Gora Radar Station',
    lat: 54.364,
    lon: 22.868,
    type: 'radar_station',
    faction: 'blue',
    populationRank: 3,
    incomeMoney: 0,
    incomeFuel: 0,
    incomeAmmo: 0,
    radarRange: 920,
    buildingClusterSeed: 106,
  },

  // ================= RED FORCE (Kaliningrad Oblast & Grodno Sector) =================
  {
    name: 'Kaliningrad / Gusev 11th Corps HQ',
    lat: 54.592,
    lon: 22.199,
    type: 'hq',
    faction: 'red',
    populationRank: 1,
    incomeMoney: 16,
    incomeFuel: 10,
    incomeAmmo: 10,
    radarRange: 480,
    buildingClusterSeed: 201,
  },
  {
    name: 'Chernyakhovsk Rail Terminal',
    lat: 54.633,
    lon: 21.815,
    type: 'railhead',
    faction: 'red',
    populationRank: 2,
    incomeMoney: 6,
    incomeFuel: 2,
    incomeAmmo: 8,
    radarRange: 260,
    buildingClusterSeed: 202,
  },
  {
    name: 'Chkalovsk Naval Airbase (Kaliningrad)',
    lat: 54.766,
    lon: 20.397,
    type: 'airfield',
    faction: 'red',
    populationRank: 1,
    runwayHeadingDeg: 115,
    incomeMoney: 10,
    incomeFuel: 6,
    incomeAmmo: 6,
    radarRange: 560,
    buildingClusterSeed: 203,
  },
  {
    name: 'Baltiysk Baltic Fleet Seaport',
    lat: 54.645,
    lon: 19.91,
    type: 'seaport',
    faction: 'red',
    populationRank: 2,
    incomeMoney: 10,
    incomeFuel: 10,
    incomeAmmo: 4,
    radarRange: 540,
    buildingClusterSeed: 204,
  },
  {
    name: 'Grodno Operational Staging (Belarus)',
    lat: 53.678,
    lon: 23.829,
    type: 'highway_entry',
    faction: 'red',
    populationRank: 1,
    incomeMoney: 8,
    incomeFuel: 6,
    incomeAmmo: 6,
    radarRange: 300,
    buildingClusterSeed: 205,
  },
  {
    name: 'Nesterov / Dunayevka Early Warning Radar',
    lat: 54.63,
    lon: 22.57,
    type: 'radar_station',
    faction: 'red',
    populationRank: 3,
    incomeMoney: 0,
    incomeFuel: 0,
    incomeAmmo: 0,
    radarRange: 920,
    buildingClusterSeed: 206,
  },

  // ================= CONTESTED REAL CITIES, REFINERIES & DEPOTS =================
  {
    name: 'Marijampole (Via Baltica Hub)',
    lat: 54.559,
    lon: 23.354,
    type: 'city',
    faction: 'neutral',
    populationRank: 1,
    incomeMoney: 16,
    incomeFuel: 3,
    incomeAmmo: 3,
    radarRange: 240,
    buildingClusterSeed: 301,
  },
  {
    name: 'Kalvarija Border Town',
    lat: 54.414,
    lon: 23.226,
    type: 'city',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 14,
    incomeFuel: 2,
    incomeAmmo: 2,
    radarRange: 220,
    buildingClusterSeed: 302,
  },
  {
    name: 'Alytus (Neman Crossing City)',
    lat: 54.396,
    lon: 24.045,
    type: 'city',
    faction: 'neutral',
    populationRank: 1,
    incomeMoney: 16,
    incomeFuel: 2,
    incomeAmmo: 4,
    radarRange: 240,
    buildingClusterSeed: 303,
  },
  {
    name: 'Augustow (Canal & S61 Junction)',
    lat: 53.843,
    lon: 22.979,
    type: 'city',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 13,
    incomeFuel: 2,
    incomeAmmo: 2,
    radarRange: 220,
    buildingClusterSeed: 304,
  },
  {
    name: 'Sovetsk / Tilze (Neman Port City)',
    lat: 55.081,
    lon: 21.887,
    type: 'city',
    faction: 'neutral',
    populationRank: 1,
    incomeMoney: 15,
    incomeFuel: 3,
    incomeAmmo: 3,
    radarRange: 240,
    buildingClusterSeed: 305,
  },
  {
    name: 'Goldap (Border Garrison Town)',
    lat: 54.306,
    lon: 22.303,
    type: 'city',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 12,
    incomeFuel: 2,
    incomeAmmo: 4,
    radarRange: 220,
    buildingClusterSeed: 306,
  },
  {
    name: 'Taurage / Kryzkalnis Fuel Terminal',
    lat: 55.252,
    lon: 22.289,
    type: 'oil_depot',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 5,
    incomeFuel: 15,
    incomeAmmo: 0,
    radarRange: 200,
    buildingClusterSeed: 307,
  },
  {
    name: 'Gvardeysk / Kaliningrad Oil Depot',
    lat: 54.651,
    lon: 21.066,
    type: 'oil_depot',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 5,
    incomeFuel: 15,
    incomeAmmo: 0,
    radarRange: 200,
    buildingClusterSeed: 308,
  },
  {
    name: 'Mockava / Sestokai Rail Munitions Yard',
    lat: 54.322,
    lon: 23.294,
    type: 'ammo_plant',
    faction: 'neutral',
    populationRank: 3,
    incomeMoney: 5,
    incomeFuel: 0,
    incomeAmmo: 15,
    radarRange: 200,
    buildingClusterSeed: 309,
  },
  {
    name: 'Lazdijai / Sejny Forward Arsenal',
    lat: 54.234,
    lon: 23.515,
    type: 'ammo_plant',
    faction: 'neutral',
    populationRank: 2,
    incomeMoney: 5,
    incomeFuel: 0,
    incomeAmmo: 15,
    radarRange: 200,
    buildingClusterSeed: 310,
  },
];

/**
 * 7. Real International Borders (Suwalki Corridor PL-LT, Kaliningrad Oblast RU, Belarus BY)
 */
export const REAL_BORDERS: Array<{ name: string; points: Array<[number, number]> }> = [
  {
    name: 'Russia (Kaliningrad Oblast) Land & River Border',
    points: [
      [54.44, 19.64], // Vistula Spit border
      [54.39, 20.05],
      [54.36, 20.64], // South of Bagrationovsk
      [54.34, 21.25],
      [54.33, 21.85],
      [54.35, 22.35], // North of Goldap
      [54.363, 22.792], // Vistytis / Wishtyniec Tripoint (PL-LT-RU)
      [54.45, 22.73], // Lake Vistytis
      [54.64, 22.75], // Kybartai
      [54.78, 22.86], // Kudirkos Naumiestis (Sesupe)
      [54.95, 22.58],
      [55.05, 22.25], // Joins Neman River
      [55.085, 21.89], // Sovetsk
      [55.26, 21.32], // Rusne
      [55.28, 20.98], // Curonian Spit (Nida border)
    ],
  },
  {
    name: 'Poland - Lithuania Suwalki Corridor Border',
    points: [
      [54.363, 22.792], // Vistytis Tripoint
      [54.33, 22.92], // North of Wizajny
      [54.28, 23.12], // Budzisko (Via Baltica E67 crossing)
      [54.22, 23.22], // Punsk / Trakiskiai (Rail Baltica crossing)
      [54.15, 23.46], // Ogrodniki / Lazdijai crossing
      [53.956, 23.515], // Marycha Tripoint (PL-LT-BY)
    ],
  },
  {
    name: 'Belarus (Grodno Oblast) Border',
    points: [
      [53.55, 23.48],
      [53.78, 23.5],
      [53.956, 23.515], // Marycha Tripoint (PL-LT-BY)
      [53.94, 23.88], // South of Druskininkai
      [53.98, 24.3],
    ],
  },
];

