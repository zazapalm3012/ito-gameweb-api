// backend/src/index.ts
import { Hono } from 'hono';
import { serve } from 'bun'; // ไม่ได้ใช้ serve ตรงๆ แต่ถูกเรียกใช้โดย default export
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun'; // Type ของ WebSocket ของ Bun
import { gameManager } from './gameManager'; // Import GameManager
import { ClientMessageType, ServerMessageType, PlayCardMessage, ChangeTopicMessage } from './types';

import { cors } from 'hono/cors'; // Import CORS middleware

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>(); // สร้าง WebSocket handler สำหรับ Hono/Bun

// CORS configuration: อนุญาตให้ Frontend (localhost:3000) เชื่อมต่อได้
app.use(
  '/*', // ใช้กับทุกเส้นทาง
  cors({
    origin: '*', 
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'DELETE'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  })
);


// --- HTTP API Endpoints (สำหรับจัดการ Lobby และการเริ่มต้นเกม) ---

// POST /api/games: สร้างห้องเกมใหม่
app.post('/api/games', async (c) => {
  try {
    const { hostId, hostName, gameName, maxPlayers } = await c.req.json();
    if (!hostId || !hostName || !gameName) {
      return c.json({ error: 'Missing hostId, hostName, or gameName' }, 400);
    }
    const newGame = gameManager.createGame(hostId, hostName, gameName, maxPlayers);
    return c.json(newGame, 201); // 201 Created
  } catch (error: any) {
    console.error('Error creating game:', error);
    return c.json({ error: error.message || 'Failed to create game' }, 500);
  }
});

// GET /api/games: ดึงรายชื่อเกมทั้งหมดที่อยู่ใน Lobby และยังเข้าร่วมได้
app.get('/api/games', (c) => {
  const games = gameManager.getAllGames();
  return c.json(games);
});

// POST /api/games/:gameId/join: เข้าร่วมเกม (ผ่าน HTTP ก่อนแล้วค่อยเชื่อม WS)
app.post('/api/games/:gameId/join', async (c) => {
    try {
        const gameId = c.req.param('gameId');
        const { playerId, playerName } = await c.req.json();

        if (!playerId || !playerName) {
            return c.json({ error: 'Missing playerId or playerName' }, 400);
        }

        const game = gameManager.joinGame(gameId, playerId, playerName);
        if (!game) {
            return c.json({ error: 'Game not found or cannot be joined' }, 404);
        }
        return c.json(game); // คืนสถานะเกมที่อัปเดตแล้ว
    } catch (error: any) {
        console.error('Error joining game:', error);
        return c.json({ error: error.message || 'Failed to join game' }, 500);
    }
});

// DELETE /api/games/:gameId: ลบเกม (โดยโฮสต์ หรือเมื่อไม่มีผู้เล่น)
app.delete('/api/games/:gameId', async (c) => {
    try {
        const gameId = c.req.param('gameId');
        const { requesterId } = await c.req.json(); // ID ของผู้ที่ร้องขอการลบ

        const game = gameManager.getGame(gameId);
        if (!game) {
            return c.json({ error: 'Game not found' }, 404);
        }
        // ตรวจสอบสิทธิ์: เฉพาะโฮสต์เท่านั้นที่ลบได้ (หรือถ้าเกมว่างเปล่า)
        if (game.hostId !== requesterId && game.players.length > 0) {
             return c.json({ error: 'Forbidden: Only host can delete this game' }, 403);
        }

        const deleted = gameManager.removeGame(gameId);
        if (deleted) {
            return c.json({ message: 'Game deleted successfully' });
        }
        return c.json({ error: 'Failed to delete game' }, 500);
    } catch (error: any) {
        console.error('Error deleting game:', error);
        return c.json({ error: error.message || 'Failed to delete game' }, 500);
    }
    });


// POST /api/games/:gameId/start: โฮสต์เริ่มเกม
app.post('/api/games/:gameId/start', async (c) => {
    try {
        const gameId = c.req.param('gameId');
        const { requesterId } = await c.req.json(); // ID ของโฮสต์ที่กดเริ่ม

        const game = gameManager.getGame(gameId);
        if (!game) {
            return c.json({ error: 'Game not found' }, 404);
        }
        if (game.hostId !== requesterId) {
            return c.json({ error: 'Forbidden: Only host can start the game' }, 403);
        }

        const started = gameManager.startGame(gameId);
        if (started) {
            return c.json({ message: 'Game started successfully' });
        }
        return c.json({ error: 'Failed to start game' }, 500);
    } catch (error: any) {
        console.error('Error starting game:', error);
        return c.json({ error: error.message || 'Failed to start game' }, 500);
    }
});

// POST /api/games/:gameId/next-round: โฮสต์เริ่มรอบถัดไป
app.post('/api/games/:gameId/next-round', async (c) => {
    try {
        const gameId = c.req.param('gameId');
        const { requesterId } = await c.req.json(); // ID ของโฮสต์ที่กดเริ่ม

        const game = gameManager.getGame(gameId);
        if (!game) {
            return c.json({ error: 'Game not found' }, 404);
        }
        if (game.hostId !== requesterId) {
            return c.json({ error: 'Forbidden: Only host can start the next round' }, 403);
        }

        gameManager.triggerNextRound(gameId);
        return c.json({ message: 'Next round triggered' });
    } catch (error: any) {
        console.error('Error triggering next round:', error);
        return c.json({ error: error.message || 'Failed to trigger next round' }, 500);
    }
});


// --- WebSocket Server (สำหรับ Real-time Game Play) ---
// Path: /ws/game?gameId=<game_id>&playerId=<player_id>&playerName=<player_name>
app.get(
  '/ws/game',
  upgradeWebSocket((c) => {
    const gameId = c.req.query('gameId');
    const playerId = c.req.query('playerId');
    const playerName = c.req.query('playerName');

    if (!gameId || !playerId || !playerName) {
        console.error("WebSocket connection attempt missing gameId, playerId, or playerName");
        // FIX: Throw an error instead of returning null
        throw new Error('Missing gameId, playerId, or playerName for WebSocket connection.');
    }

    const game = gameManager.getGame(gameId);
    if (!game) {
        console.error(`WebSocket connection failed: Game ${gameId} not found.`);
        // FIX: Throw an error instead of returning null
        throw new Error(`Game ${gameId} not found.`);
    }

    // (Optional) ตรวจสอบว่าผู้เล่นคนนี้อยู่ในเกมจริงหรือไม่ (ควรจะเข้าร่วมผ่าน HTTP มาแล้ว)
    if (!game.players.some(p => p.id === playerId)) {
        console.error(`WebSocket connection failed: Player ${playerId} not in game ${gameId}.`);
        // FIX: Throw an error instead of returning null
        throw new Error(`Player ${playerId} not in game ${gameId}.`);
    }

    return {
      onOpen(event, ws) {
        console.log(`WS opened for player ${playerName} (${playerId}) in game ${gameId}`);
        gameManager.registerWebSocket(playerId, gameId, ws as any); // ลงทะเบียน WS Connection

        // ส่งสถานะเกมปัจจุบันไปให้ผู้เล่นที่เพิ่งเชื่อมต่อ
        const currentGameState = gameManager.getGame(gameId);
        if (currentGameState) {
            gameManager.sendToPlayer(playerId, gameId, {
                type: ServerMessageType.GAME_STATE_UPDATE,
                payload: currentGameState
            });
        }
      },
      onMessage(event, ws) {
        console.log(`Message from client ${playerName} (${playerId}) in game ${gameId}: ${event.data}`);
        try {
          const message = JSON.parse(event.data as string);
          const type = message.type;

          switch (type) {
            case ClientMessageType.PLAY_CARD:
              const playCardMsg = message as PlayCardMessage; // Cast message to specific type
              gameManager.playCard(
                gameId,
                playerId,
                playCardMsg.cardValue
              );
              break;
            case ClientMessageType.CHANGE_TOPIC:
                const changeTopicMsg = message as ChangeTopicMessage;
                // ส่งสถานะเกมปัจจุบันไปให้ผู้เล่นที่เพิ่งเชื่อมต่อ
                const currentGameState = gameManager.getGame(gameId);
                if (currentGameState) {
                  gameManager.changeGameTopic(gameId, playerId, changeTopicMsg.topic);
                  gameManager.sendToPlayer(playerId, gameId, {
                      type: ServerMessageType.GAME_STATE_UPDATE,
                      payload: currentGameState
                  });
                }
                break;
            default:
              console.warn(`Unknown message type received from ${playerId}: ${type}`);
              gameManager.sendToPlayer(playerId, gameId, {
                  type: ServerMessageType.ERROR,
                  message: `Unknown message type: ${type}`
              });
          }
        } catch (e) {
          console.error(`Error parsing message from ${playerId}:`, e);
          gameManager.sendToPlayer(playerId, gameId, {
              type: ServerMessageType.ERROR,
              message: 'Invalid message format.'
          });
        }
      },
      onClose: () => {
        console.log(`WS closed for player ${playerName} (${playerId}) in game ${gameId}`);
        gameManager.unregisterWebSocket(playerId, gameId); // ยกเลิกการลงทะเบียน WS
      },
      onError: (error) => {
        console.error(`WS error for player ${playerName} (${playerId}) in game ${gameId}:`, error);
      }
    }
  })
);


// --- WebSocket Server (สำหรับ Lobby เพื่ออัปเดตรายชื่อเกมแบบ Real-time) ---
// Path: /ws/lobby?clientId=<unique_client_id>
app.get(
    '/ws/lobby',
    upgradeWebSocket((c) => {
        const clientId = c.req.query('clientId'); // ID เฉพาะสำหรับ client ที่เชื่อมต่อ Lobby

        if (!clientId) {
            console.error("Lobby WS connection attempt missing clientId.");
            // FIX: Throw an error instead of returning null
            throw new Error('Missing clientId for Lobby WebSocket connection.');
        }

        return {
            onOpen(event, ws) {
                console.log(`Lobby WS opened for client ${clientId}`);
                gameManager.registerLobbyClient(clientId, ws as any);
                // ส่งรายชื่อเกมปัจจุบันไปให้ client ที่เพิ่งเชื่อมต่อ
                gameManager.sendToPlayer(clientId, "lobby-context", { // ใช้ "lobby-context" เป็น GameId จำลอง
                    type: ServerMessageType.GAME_STATE_UPDATE, // ใช้ type นี้เพื่อส่ง payload เป็น array ของ GameState
                    payload: gameManager.getAllGames() // ส่งรายการเกมที่ Join ได้
                });
            },
            onMessage(event, ws) {
                // Lobby clients ส่วนใหญ่จะแค่รับข้อมูล ไม่ได้ส่งข้อความกลับมามากนัก
                console.log(`Lobby message from ${clientId}: ${event.data}`);
            },
            onClose: () => {
                console.log(`Lobby WS closed for client ${clientId}`);
                gameManager.unregisterLobbyClient(clientId);
            },
            onError: (error) => {
                console.error(`Lobby WS error for client ${clientId}:`, error);
            }
        }
    })
);


// --- Bun Serve Configuration ---
// Export default object สำหรับ Bun Hono Server
export default {
  port: 5000,
  fetch: app.fetch,
  websocket, // สำคัญมากสำหรับ Hono/Bun WebSocket integration
}

console.log(`Bun+Hono Game Server running on http://localhost:5000`);