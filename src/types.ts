// backend/src/types.ts

// Basic Types
export type PlayerId = string;
export type GameId = string;
export type CardValue = number; // Represents a card's value (1-100)

// Player State
export interface Player {
    id: PlayerId;
    name: string;
    hand: CardValue[]; // Cards currently in the player's hand
    hasPlayedCardThisRound: boolean; // True if player has already played a card this round
}

// Game State (Represents the current state of a single game room)
export interface GameState {
    id: GameId;
    name: string;
    hostId: PlayerId;
    players: Player[]; // All players in the game
    deck: CardValue[]; // Cards remaining in the draw pile
    discardPile: CardValue[]; // Cards that have been played face-up this round
    currentRound: number; // Current round number (e.g., 1, 2, 3)
    cardsPerPlayerThisRound: number; // How many cards each player receives this round
    topicCard: CardValue | null; // The numerical "topic" for the current round (1-100)
    lastPlayedCard: CardValue; // The value of the last card played on the table (0 at start of round)
    teamLivesRemaining: number; // Shared lives for the team
    roundState: 'Lobby' | 'Playing' | 'RoundEnd' | 'GameEnd'; // Current phase of the game
    maxPlayers: number;
}

// --- Client -> Server WebSocket Messages ---
// Messages sent from the client (frontend) to the server (backend)
export enum ClientMessageType {
    PLAY_CARD = 'PLAY_CARD',
    GUESS_TOPIC = 'GUESS_TOPIC', // If you add a "guess the topic" feature
    START_GAME = 'START_GAME', // If client (host) can trigger game start via WS
    NEXT_ROUND = 'NEXT_ROUND', // If client (host) can trigger next round via WS
}

// Interface for a player playing a card
export interface PlayCardMessage {
    type: ClientMessageType.PLAY_CARD;
    gameId: GameId; // Redundant if WS connection is game-specific, but good for robust check
    playerId: PlayerId; // Redundant if WS connection is player-specific, but good for robust check
    cardValue: CardValue;
}

// --- Server -> Client WebSocket Messages ---
// Messages sent from the server (backend) to the client (frontend)
export enum ServerMessageType {
    GAME_STATE_UPDATE = 'GAME_STATE_UPDATE', // Full game state update
    PLAYER_JOINED = 'PLAYER_JOINED', // Notification for lobby clients
    PLAYER_LEFT = 'PLAYER_LEFT', // Notification for lobby clients
    GAME_CREATED = 'GAME_CREATED', // Notification for lobby clients
    GAME_DELETED = 'GAME_DELETED', // Notification for lobby clients
    ERROR = 'ERROR', // General error message
    CARD_PLAYED_VALIDATION = 'CARD_PLAYED_VALIDATION',
    LOBBY_GAME_LIST_UPDATE = "LOBBY_GAME_LIST_UPDATE", // Result of a card play (success/failure, lives lost)
}

// Interface for broadcasting game state updates
export interface GameStateUpdateMessage {
    type: ServerMessageType.GAME_STATE_UPDATE;
    payload: GameState;
}

// Interface for player joined event (for lobby)
export interface PlayerJoinedMessage {
    type: ServerMessageType.PLAYER_JOINED;
    gameId: GameId;
    player: Player; // The player who joined
}

// Interface for player left event (for lobby)
export interface PlayerLeftMessage {
    type: ServerMessageType.PLAYER_LEFT;
    gameId: GameId;
    playerId: PlayerId; // The ID of the player who left
}

// Interface for game created event (for lobby)
export interface GameCreatedMessage {
    type: ServerMessageType.GAME_CREATED;
    game: GameState; // The newly created game's initial state
}

// Interface for game deleted event (for lobby)
export interface GameDeletedMessage {
    type: ServerMessageType.GAME_DELETED;
    gameId: GameId;
}

// Interface for sending validation result of a played card
export interface CardPlayedValidationMessage {
    type: ServerMessageType.CARD_PLAYED_VALIDATION;
    playerId: PlayerId; // Player who played the card
    cardValue: CardValue; // Card they tried to play
    isCorrectPlay: boolean; // True if the play was valid (no lives lost for this specific play)
    livesLost: number; // How many lives were lost (0 or 1 for a single play error)
    message?: string; // Explanatory message for the result
}