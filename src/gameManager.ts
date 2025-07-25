// backend/src/gameManager.ts
import { GameState } from './gameState';
import { Player } from './player';
import {
    GameId, PlayerId, CardValue,
    GameStateUpdateMessage, ServerMessageType,
    GameCreatedMessage, GameDeletedMessage,
    PlayerJoinedMessage, PlayerLeftMessage,
    CardPlayedValidationMessage
} from './types';
import { ServerWebSocket } from 'bun'; // Import Bun's WebSocket type

type PlayerSocket = ServerWebSocket;

// Store WebSocket connections: Map<gameId, Map<playerId, WebSocket>>
type ActiveConnections = Map<GameId, Map<PlayerId, PlayerSocket>>;

// GameManager เป็น Singleton เพื่อให้มี instance เดียวในการจัดการทุกเกม
class GameManager {
    private activeGames: Map<GameId, GameState> = new Map(); // เก็บสถานะเกมทั้งหมดที่กำลัง active
    private activeWsConnections: ActiveConnections = new Map(); // เก็บ WebSocket connections ของผู้เล่นในแต่ละเกม

    // Map สำหรับเก็บ WebSocket ของ client ที่อยู่ใน Lobby (เพื่อรับการอัปเดตเกมที่สร้าง/ลบ)
    private lobbyClients: Map<PlayerId, PlayerSocket> = new Map(); // Key: clientId

    private static instance: GameManager; // Singleton instance

    // Singleton pattern: ได้ instance เดียวของ GameManager
    public static getInstance(): GameManager {
        if (!GameManager.instance) {
            GameManager.instance = new GameManager();
        }
        return GameManager.instance;
    }

    // --- Game Creation & Management (HTTP-triggered usually) ---

    // สร้างห้องเกมใหม่
    createGame(hostId: PlayerId, hostName: string, gameName: string, maxPlayers: number = 4): GameState {
        const gameId: GameId = crypto.randomUUID(); // สร้าง Game ID ที่ไม่ซ้ำกัน
        const newGame = new GameState(gameId, gameName, hostId, maxPlayers);

        const hostPlayer = new Player(hostId, hostName);
        newGame.addPlayer(hostPlayer); // เพิ่มโฮสต์เข้าเกมทันที

        this.activeGames.set(gameId, newGame);
        console.log(`Game created: ${gameId} by ${hostName}`);

        // แจ้ง Lobby Clients ทั้งหมดว่ามีเกมใหม่ถูกสร้างขึ้น
        this.broadcastLobbyUpdate({
            type: ServerMessageType.GAME_CREATED,
            game: newGame
        });

        return newGame;
    }

    // ดึงข้อมูลเกม
    getGame(gameId: GameId): GameState | undefined {
        return this.activeGames.get(gameId);
    }

    // ดึงข้อมูลเกมทั้งหมดที่ยังสามารถเข้าร่วมได้ (สถานะ Lobby และไม่เต็ม)
    getAllGames(): GameState[] {
        return Array.from(this.activeGames.values()).filter(game =>
            game.roundState === 'Lobby' && game.players.length < game.maxPlayers
        );
    }

    // ผู้เล่นเข้าร่วมเกม
    joinGame(gameId: GameId, playerId: PlayerId, playerName: string): GameState | null {
        console.log(`[GameManager.joinGame DEBUG] 🟥🟥🟥 Player ${playerName} (${playerId}) is CALLING joinGame for game ${gameId} 🟥🟥🟥`); // **เพิ่ม LOG นี้**
    
        const game = this.activeGames.get(gameId);
        if (!game) {
            console.warn(`[GameManager.joinGame DEBUG] Game ${gameId} not found in activeGames map. Returning null.`);
            return null;
        }
    
        // เพิ่ม Log ตรวจสอบเงื่อนไขก่อนเข้าร่วม
        console.log(`[GameManager.joinGame DEBUG] Game ${gameId} current roundState: ${game.roundState}, players count: ${game.players.length}/${game.maxPlayers}`);
        if (game.roundState !== 'Lobby') {
            console.warn(`[GameManager.joinGame DEBUG] Game ${gameId} is not in Lobby state (${game.roundState}). Cannot join.`);
            return null;
        }
        if (game.players.length >= game.maxPlayers) {
            console.warn(`[GameManager.joinGame DEBUG] Game ${gameId} is full (${game.players.length}/${game.maxPlayers}). Cannot join.`);
            return null;
        }
    
        const newPlayer = new Player(playerId, playerName);
        const playerAdded = game.addPlayer(newPlayer); // <--- นี่คือจุดที่เรียก GameState.addPlayer
    
        console.log(`[GameManager.joinGame DEBUG] Result of game.addPlayer(${newPlayer.id}) for game ${gameId}: ${playerAdded}`); // **เพิ่ม LOG นี้**
    
        if (playerAdded) {
            console.log(`[GameManager.joinGame DEBUG] Player ${playerName} (${playerId}) successfully added (via HTTP join) to game ${gameId}. Broadcasting state.`);
            // ตรงนี้ `game` คือ GameState instance ที่อัปเดตแล้ว
            this.broadcastGameState(gameId, game);
            this.broadcastLobbyUpdate({
                type: ServerMessageType.PLAYER_JOINED,
                gameId: gameId,
                player: newPlayer
            });
            return game;
        } else {
            console.warn(`[GameManager.joinGame DEBUG] Player ${playerName} (${playerId}) could NOT be added to game ${gameId} by GameState.addPlayer. Returning null.`);
            return null;
        }
    }

    // ลบเกม (เมื่อไม่มีผู้เล่นเหลืออยู่)
    removeGame(gameId: GameId): boolean {
        const deleted = this.activeGames.delete(gameId);
        if (deleted) {
            console.log(`Game ${gameId} deleted.`);
            this.activeWsConnections.delete(gameId); // ลบ WebSocket connections ทั้งหมดของเกมนี้
            this.broadcastLobbyUpdate({ // แจ้ง Lobby Clients ว่าเกมถูกลบ
                type: ServerMessageType.GAME_DELETED,
                gameId: gameId
            });
        }
        return deleted;
    }

    // --- Game Logic Actions (WebSocket-triggered usually) ---

    // โฮสต์เริ่มเกม
    startGame(gameId: GameId): boolean {
        const game = this.activeGames.get(gameId);
        if (game && game.roundState === 'Lobby') {
            try {
                game.startGame(); // เรียกใช้ Logic เริ่มเกมจาก GameState
                this.broadcastGameState(gameId, game); // Broadcast สถานะเกมที่เริ่มแล้ว
                // แจ้ง Lobby ว่าเกมนี้ไม่สามารถเข้าร่วมได้แล้ว
                this.broadcastLobbyUpdate({
                    type: ServerMessageType.GAME_STATE_UPDATE,
                    payload: game
                });
                return true;
            } catch (e: any) {
                console.error(`Failed to start game ${gameId}:`, e.message);
                // ส่ง Error กลับไปที่ Host โดยตรง
                this.sendToPlayer(game.hostId, gameId, { type: ServerMessageType.ERROR, message: e.message });
                return false;
            }
        }
        return false;
    }

    // ผู้เล่นลงไพ่
    playCard(gameId: GameId, playerId: PlayerId, cardValue: CardValue): void {
        const game = this.activeGames.get(gameId);
        if (!game) {
            this.sendToPlayer(playerId, gameId, { type: ServerMessageType.ERROR, message: 'Game not found.' });
            return;
        }

        const playResult = game.playCard(playerId, cardValue); // เรียกใช้ Logic การลงไพ่จาก GameState

        // หากการลงไพ่ไม่สำเร็จ (เช่น ไพ่ไม่ถูกต้อง, ไม่ใช่ตาเล่น) หรือมีการเสียพลังชีวิต
        if (!playResult.success || playResult.livesLost > 0) {
             // ส่งข้อความแจ้งผลการเล่นไปยังผู้เล่นทุกคนในเกม
            const validationMessage: CardPlayedValidationMessage = {
                type: ServerMessageType.CARD_PLAYED_VALIDATION,
                playerId: playerId,
                cardValue: cardValue,
                isCorrectPlay: playResult.livesLost === 0, // true ถ้าไม่เสียพลังชีวิต
                livesLost: playResult.livesLost,
                message: playResult.message
            };
            this.broadcastToGame(gameId, validationMessage);
        }

        // Broadcast สถานะเกมที่อัปเดตแล้ว (ไพ่ที่ลง, พลังชีวิตที่เหลือ)
        this.broadcastGameState(gameId, game);

        // หากจบรอบหรือจบเกม ให้แจ้ง Lobby ด้วย (เพื่ออัปเดตสถานะเกม)
        if (game.roundState === 'RoundEnd' || game.roundState === 'GameEnd') {
             this.broadcastLobbyUpdate({
                type: ServerMessageType.GAME_STATE_UPDATE,
                payload: game
            });
        }
    }

    // โฮสต์เริ่มรอบใหม่ (หลังจบรอบก่อนหน้า)
    triggerNextRound(gameId: GameId) {
        const game = this.activeGames.get(gameId);
        // ตรวจสอบว่าเกมอยู่ในสถานะ RoundEnd, พลังชีวิตยังเหลือ, และยังไม่ครบ 3 รอบ
        if (game && game.roundState === 'RoundEnd' && game.teamLivesRemaining > 0 && game.currentRound < 3) {
            game.startNewRound(); // เริ่มรอบใหม่
            this.broadcastGameState(gameId, game); // อัปเดตสถานะเกม
        } else if (game && game.roundState === 'RoundEnd' && (game.teamLivesRemaining <= 0 || game.currentRound >= 3)) {
            // ถ้าพลังชีวิตหมด หรือเล่นครบทุกรอบแล้ว (แต่ยังค้างที่ RoundEnd)
            game.roundState = 'GameEnd'; // เปลี่ยนสถานะเป็น GameEnd
            this.broadcastGameState(gameId, game);
        } else {
            console.warn(`Cannot trigger next round for game ${gameId}. Current state: ${game?.roundState}, Lives: ${game?.teamLivesRemaining}, Round: ${game?.currentRound}`);
            // อาจจะส่ง Error กลับไปที่ Host โดยตรง
            if (game?.hostId) {
                this.sendToPlayer(game.hostId, gameId, { type: ServerMessageType.ERROR, message: 'Cannot start next round under current conditions.' });
            }
        }
    }

    // --- WebSocket Management ---

    // ลงทะเบียน WebSocket ของ client ที่เชื่อมต่อ Lobby
    registerLobbyClient(clientId: PlayerId, ws: PlayerSocket) {
        this.lobbyClients.set(clientId, ws);
        console.log(`Lobby client ${clientId} registered.`);
        this.sendToPlayer(clientId, "lobby-context", { // Use "lobby-context" as GameIdจำลอง
            type: ServerMessageType.LOBBY_GAME_LIST_UPDATE, // Use the new type here
            payload: this.getAllGames() // Send the array of games
        });
    }

    // ยกเลิกการลงทะเบียน WebSocket ของ client ที่เชื่อมต่อ Lobby
    unregisterLobbyClient(clientId: PlayerId) {
        this.lobbyClients.delete(clientId);
        console.log(`Lobby client ${clientId} unregistered.`);
    }

    // Broadcast การอัปเดตสถานะ Lobby ไปยัง Lobby Clients ทั้งหมด
    broadcastLobbyUpdate(message: GameCreatedMessage | GameDeletedMessage | PlayerJoinedMessage | PlayerLeftMessage | GameStateUpdateMessage) {
        const messageString = JSON.stringify(message);
        this.lobbyClients.forEach((ws, clientId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(messageString);
            } else {
                console.warn(`Lobby client ${clientId} WS not open. Removing.`);
                this.lobbyClients.delete(clientId);
            }
        });
    }

    // ลงทะเบียน WebSocket ของผู้เล่นที่เชื่อมต่อเข้าห้องเกม
    registerWebSocket(playerId: PlayerId, gameId: GameId, ws: PlayerSocket) {
        if (!this.activeWsConnections.has(gameId)) {
            this.activeWsConnections.set(gameId, new Map());
        }
        this.activeWsConnections.get(gameId)?.set(playerId, ws);
        console.log(`Player ${playerId} registered WS for game ${gameId}`);
    }

    // ยกเลิกการลงทะเบียน WebSocket ของผู้เล่นเมื่อตัดการเชื่อมต่อ
    unregisterWebSocket(playerId: PlayerId, gameId: GameId) {
        const gameConnections = this.activeWsConnections.get(gameId);
        if (gameConnections) {
            gameConnections.delete(playerId); // ลบ WebSocket ของผู้เล่นคนนั้น
            console.log(`Player ${playerId} unregistered WS from game ${gameId}`);

            const game = this.activeGames.get(gameId);
            if (game) {
                game.removePlayer(playerId); // ลบผู้เล่นออกจากเกม
                this.broadcastGameState(gameId, game); // อัปเดตสถานะเกมให้ผู้เล่นที่เหลือ

                // แจ้ง Lobby ว่ามีผู้เล่นออกจากห้อง
                this.broadcastLobbyUpdate({
                    type: ServerMessageType.PLAYER_LEFT,
                    gameId: gameId,
                    playerId: playerId
                });

                // ถ้าผู้เล่นทั้งหมดออกจากห้อง ให้ลบห้องนั้นทิ้ง
                if (game.players.length === 0) {
                    this.removeGame(gameId); // การเรียกนี้จะ broadcastLobbyUpdate สำหรับการลบเกม
                }
            }
        }
    }

    // Broadcast สถานะเกมปัจจุบันไปยังผู้เล่นทุกคนในเกมนั้นๆ
    broadcastGameState(gameId: GameId, gameState: GameState) {
        const gameConnections = this.activeWsConnections.get(gameId);
        if (gameConnections) {
            const message: GameStateUpdateMessage = {
                type: ServerMessageType.GAME_STATE_UPDATE,
                payload: gameState
            };
            const messageString = JSON.stringify(message);

            gameConnections.forEach((ws, playerId) => {
                // FIX: Use WebSocket.OPEN instead of ws.OPEN
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(messageString);
                } else {
                    console.warn(`WS for player ${playerId} in game ${gameId} not open. Removing.`);
                    gameConnections.delete(playerId); // ลบ connection ที่เสีย
                }
            });
        }
    }

    // Broadcast ข้อความใดๆ ไปยังผู้เล่นทุกคนในเกมนั้นๆ
    broadcastToGame(gameId: GameId, message: any) {
        const gameConnections = this.activeWsConnections.get(gameId);
        if (gameConnections) {
            const messageString = JSON.stringify(message);
            gameConnections.forEach((ws, playerId) => {
                // FIX: Use WebSocket.OPEN instead of ws.OPEN
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(messageString);
                } else {
                    console.warn(`WS for player ${playerId} in game ${gameId} not open. Removing.`);
                    gameConnections.delete(playerId);
                }
            });
        }
    }

    // ส่งข้อความไปยัง WebSocket ของผู้เล่นคนใดคนหนึ่ง
    sendToPlayer(playerId: PlayerId, gameId: GameId, message: any) {
        const gameConnections = this.activeWsConnections.get(gameId);
        if (gameConnections) {
            const ws = gameConnections.get(playerId);
            // FIX: Use WebSocket.OPEN instead of ws.OPEN
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            } else {
                console.warn(`Cannot send message to player ${playerId}: WS not open or game not found.`);
            }
        }
    }
    changeGameTopic(gameId: GameId, playerId: PlayerId, topic: string): boolean {
        const game = this.activeGames.get(gameId);
        if (!game || game.hostId !== playerId) {
            console.warn(`Player ${playerId} is not host of game ${gameId} or game not found. Cannot change topic.`);
            return false;
        }

        if (game.roundState !== 'Lobby') { // อนุญาตให้เปลี่ยนเฉพาะใน Lobby
            console.warn(`Cannot change topic while game ${gameId} is in state: ${game.roundState}.`);
            return false;
        }

        if (game.setTopic(topic)) {
            console.log(`Game ${gameId} topic changed to: ${topic}`);
            this.broadcastGameState(gameId, game); // Broadcast การเปลี่ยนแปลง
            return true;
        }
        console.warn(`Failed to set topic ${topic} for game ${gameId}. Topic not found or invalid.`);
        return false;
    }
}

export const gameManager = GameManager.getInstance(); // Export instance เดียว