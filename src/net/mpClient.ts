import type { DoctrineId, GameCommand, PlayableFaction } from '../core/types';

export interface MatchStartPayload {
  code: string;
  seed: number;
  yourFaction: PlayableFaction;
  yourDoctrine: DoctrineId;
  enemyDoctrine: DoctrineId;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  connected = false;
  globalBluePct = 50;

  onStatusChange?: (connected: boolean) => void;
  onGlobalWarUpdate?: (bluePct: number) => void;
  onRoomCreated?: (code: string, faction: PlayableFaction) => void;
  onRoomError?: (message: string) => void;
  onMatchStart?: (payload: MatchStartPayload) => void;
  onGameCommand?: (cmd: GameCommand) => void;
  onOpponentLeft?: () => void;

  connect(): void {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws-game`;
      this.ws = new WebSocket(url);

      this.ws.addEventListener('open', () => {
        this.connected = true;
        this.onStatusChange?.(true);
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        this.onStatusChange?.(false);
      });

      this.ws.addEventListener('error', () => {
        this.connected = false;
        this.onStatusChange?.(false);
      });

      this.ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === 'GLOBAL_WAR_STATE') {
            this.globalBluePct = Number(msg.bluePct) || 50;
            this.onGlobalWarUpdate?.(this.globalBluePct);
          } else if (msg.type === 'ROOM_CREATED') {
            this.onRoomCreated?.(msg.code, msg.faction);
          } else if (msg.type === 'ROOM_ERROR') {
            this.onRoomError?.(msg.message || 'Unable to join room');
          } else if (msg.type === 'MATCH_START') {
            this.onMatchStart?.({
              code: msg.code,
              seed: msg.seed,
              yourFaction: msg.yourFaction,
              yourDoctrine: msg.yourDoctrine,
              enemyDoctrine: msg.enemyDoctrine,
            });
          } else if (msg.type === 'GAME_CMD') {
            this.onGameCommand?.(msg.cmd);
          } else if (msg.type === 'OPPONENT_LEFT') {
            this.onOpponentLeft?.();
          }
        } catch {
          // Ignore invalid JSON
        }
      });
    } catch {
      this.connected = false;
      this.onStatusChange?.(false);
    }
  }

  createRoom(faction: PlayableFaction, doctrine: DoctrineId): void {
    this.send({ type: 'CREATE_ROOM', faction, doctrine });
  }

  joinRoom(code: string, doctrine: DoctrineId): void {
    this.send({ type: 'JOIN_ROOM', code, doctrine });
  }

  sendGameCommand(cmd: GameCommand): void {
    this.send({ type: 'GAME_CMD', cmd });
  }

  reportGlobalWarResult(winner: PlayableFaction): void {
    this.send({ type: 'REPORT_WAR_RESULT', winner });
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
