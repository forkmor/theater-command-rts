import { defineConfig } from 'vite';
import type { ViteDevServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

interface PlayerSlot {
  ws: WebSocket;
  faction: 'blue' | 'red';
  doctrine: string;
}

interface GameRoom {
  code: string;
  seed: number;
  players: PlayerSlot[];
  started: boolean;
}

function createMultiplayerPlugin() {
  const rooms = new Map<string, GameRoom>();
  // Persistent Global Meta-War frontline state (Blue Force % in Suwalki Sector)
  let globalBlueControl = 50;

  function makeRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  function broadcastGlobalWar(wss: WebSocketServer) {
    const msg = JSON.stringify({
      type: 'GLOBAL_WAR_STATE',
      bluePct: globalBlueControl,
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  return {
    name: 'rts-multiplayer-ws',
    configureServer(server: ViteDevServer) {
      if (!server.httpServer) return;
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (req.url?.startsWith('/ws-game')) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
      });

      wss.on('connection', (ws: WebSocket) => {
        let currentRoom: GameRoom | null = null;

        ws.send(
          JSON.stringify({
            type: 'GLOBAL_WAR_STATE',
            bluePct: globalBlueControl,
          }),
        );

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(String(raw));

            if (msg.type === 'CREATE_ROOM') {
              const code = makeRoomCode();
              const faction: 'blue' | 'red' = msg.faction === 'red' ? 'red' : 'blue';
              const room: GameRoom = {
                code,
                seed: Math.floor(Math.random() * 900000) + 100000,
                players: [{ ws, faction, doctrine: msg.doctrine || 'mech_blitz' }],
                started: false,
              };
              rooms.set(code, room);
              currentRoom = room;
              ws.send(
                JSON.stringify({
                  type: 'ROOM_CREATED',
                  code,
                  faction,
                }),
              );
            } else if (msg.type === 'JOIN_ROOM') {
              const code = String(msg.code || '').toUpperCase().trim();
              const room = rooms.get(code);
              if (!room || room.started || room.players.length >= 2) {
                ws.send(
                  JSON.stringify({
                    type: 'ROOM_ERROR',
                    message: 'Room unavailable or already in combat.',
                  }),
                );
                return;
              }
              const hostSlot = room.players[0];
              const joinFaction: 'blue' | 'red' = hostSlot.faction === 'blue' ? 'red' : 'blue';
              const joinSlot: PlayerSlot = {
                ws,
                faction: joinFaction,
                doctrine: msg.doctrine || 'mech_blitz',
              };
              room.players.push(joinSlot);
              room.started = true;
              currentRoom = room;

              for (const slot of room.players) {
                const opp = room.players.find((p) => p !== slot)!;
                if (slot.ws.readyState === WebSocket.OPEN) {
                  slot.ws.send(
                    JSON.stringify({
                      type: 'MATCH_START',
                      code: room.code,
                      seed: room.seed,
                      yourFaction: slot.faction,
                      yourDoctrine: slot.doctrine,
                      enemyDoctrine: opp.doctrine,
                    }),
                  );
                }
              }
            } else if (msg.type === 'GAME_CMD') {
              if (!currentRoom) return;
              const payload = JSON.stringify({
                type: 'GAME_CMD',
                cmd: msg.cmd,
              });
              for (const slot of currentRoom.players) {
                if (slot.ws.readyState === WebSocket.OPEN) {
                  slot.ws.send(payload);
                }
              }
            } else if (msg.type === 'REPORT_WAR_RESULT') {
              const winner = msg.winner === 'red' ? 'red' : 'blue';
              const delta = winner === 'blue' ? 4 : -4;
              globalBlueControl = Math.max(10, Math.min(90, globalBlueControl + delta));
              broadcastGlobalWar(wss);
            }
          } catch {
            // Ignore malformed client message
          }
        });

        ws.on('close', () => {
          if (currentRoom) {
            for (const slot of currentRoom.players) {
              if (slot.ws !== ws && slot.ws.readyState === WebSocket.OPEN) {
                slot.ws.send(
                  JSON.stringify({
                    type: 'OPPONENT_LEFT',
                  }),
                );
              }
            }
            rooms.delete(currentRoom.code);
            currentRoom = null;
          }
        });
      });
    },
  };
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  plugins: [createMultiplayerPlugin()],
});
