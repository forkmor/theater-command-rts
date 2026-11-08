# THEATER COMMAND: Modern Warfare

2D Top-Down Pixel-Art Operational Real-Time Strategy (RTS) web application featuring **Live Browser-Side OpenStreetMap (Overpass API) GIS streaming**, SRTM/Copernicus DEM terrain elevation, 3D ballistics, radar horizons, dual-layer fog of war, rail & highway supply lines, combined arms, AI skirmish, and WebSocket multiplayer lobbies.

## Key Features
- **Live Browser-Side OpenStreetMap GIS (`src/world/osmBrowserLoader.ts`, `src/world/suwalkiMap.ts`):**
  - Streams real-world building footprint polygons (`building=*`), highways & local streets (`highway=*`), railways (`railway=*`), destructible river bridges (`bridge=yes`), waterways/coastlines/piers, and SRTM/Copernicus terrain elevation (`api.open-meteo.com`) directly in the browser.
  - Includes 4 one-click tactical presets (**Suwałki City & Rail Baltica**, **Klaipėda Seaport & Memel Strait**, **Baltiysk Naval Base & Sea Canal**, **Kaunas Neman Bridges & Airfield**) plus a global **OpenStreetMap Nominatim search bar** to play on any city, seaport, airport, or `lat, lon` on Earth.
- **3D Ballistics & Radar Horizon (`src/sim/simulation.ts`):**
  - Height-aware 3D line-of-sight and radar horizon shadow casting.
  - Directional armor (Front/Side/Rear APFSDS), parabolic 155mm artillery, terrain-skimming cruise missiles, ATGMs + IR smokescreens, SEAD anti-radiation missiles, and automated CIWS/SAM interception.
- **Combined Arms & Logistics (`src/core/definitions.ts`):**
  - 15 unit classes across Infantry, Armor/Support, Aviation, and Naval forces, supplied by automated highway and railway logistics networks and armored reinforcement trains.

## Quick Start
```bash
npm install
npm run dev
```
