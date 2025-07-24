// backend/src/gameState.ts
import { GameId, PlayerId, CardValue, GameState as IGameState } from './types';
import { Player } from './player';

// Helper function: สับไพ่อาร์เรย์
function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]; // สลับตำแหน่ง
    }
    return array;
}

export class GameState implements IGameState {
    id: GameId;
    name: string;
    hostId: PlayerId;
    players: Player[];
    deck: CardValue[]; // ไพ่ในสำรับที่ยังไม่ได้แจก
    discardPile: CardValue[]; // ไพ่ที่ถูกลงไปแล้วในรอบปัจจุบัน
    currentRound: number;
    cardsPerPlayerThisRound: number; // จำนวนไพ่ที่แต่ละคนได้ในรอบปัจจุบัน
    topicCard: CardValue | null; // เลขหัวข้อสำหรับรอบนี้ (1-100)
    lastPlayedCard: CardValue; // ไพ่ที่มีค่าสูงสุดที่ถูกลงไปล่าสุดบนโต๊ะในรอบนี้
    teamLivesRemaining: number; // จำนวนพลังชีวิตที่เหลือของทีม
    roundState: 'Lobby' | 'Playing' | 'RoundEnd' | 'GameEnd'; // สถานะของรอบ/เกม
    maxPlayers: number;

    constructor(id: GameId, name: string, hostId: PlayerId, maxPlayers: number = 4, initialTeamLives: number = 2) {
        this.id = id;
        this.name = name;
        this.hostId = hostId;
        this.maxPlayers = maxPlayers;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentRound = 0;
        this.cardsPerPlayerThisRound = 0;
        this.topicCard = null;
        this.lastPlayedCard = 0; // ค่าเริ่มต้นของไพ่ที่เล่นล่าสุด (ไพ่จริงจะเริ่มที่ 1)
        this.teamLivesRemaining = initialTeamLives; // กำหนดพลังชีวิตเริ่มต้นของทีม
        this.roundState = 'Lobby';
    }

    // เพิ่มผู้เล่นเข้าเกม
    addPlayer(player: Player): boolean {
        if (this.players.length >= this.maxPlayers) {
            return false; // ห้องเต็ม
        }
        if (this.players.find(p => p.id === player.id)) {
            return false; // ผู้เล่นคนนี้อยู่ในเกมอยู่แล้ว
        }
        this.players.push(player);
        return true;
    }

    // ลบผู้เล่นออกจากเกม
    removePlayer(playerId: PlayerId): boolean {
        const initialLength = this.players.length;
        this.players = this.players.filter(p => p.id !== playerId);
        if (this.players.length < initialLength) {
            // ถ้าโฮสต์ออก ให้คนถัดไปเป็นโฮสต์แทน
            if (this.hostId === playerId && this.players.length > 0) {
                this.hostId = this.players[0].id;
            }
            // ถ้าไม่มีผู้เล่นเหลือเลย ให้เกมถูกลบ
            if (this.players.length === 0) {
                this.roundState = 'GameEnd'; // ทำเครื่องหมายว่าเกมจบเพื่อ GameManager จะได้ลบ
            }
            return true;
        }
        return false;
    }

    // เริ่มต้นเกมครั้งแรก
    startGame() {
        if (this.players.length < 2) {
            throw new Error('Not enough players to start the game (minimum 2 players).');
        }
        this.currentRound = 0; // เริ่มที่รอบ 0 ก่อนจะเพิ่มเป็น 1 ใน startNewRound
        this.teamLivesRemaining = 2; // รีเซ็ตพลังชีวิตทีมสำหรับเกมใหม่ (ปรับได้ตามต้องการ)
        this.roundState = 'Playing'; // สถานะเริ่มเล่น
        this.startNewRound(); // เริ่มรอบแรก
    }

    // เริ่มรอบใหม่
    startNewRound() {
        this.currentRound++; // เพิ่มรอบ

        // กำหนดจำนวนไพ่ที่ผู้เล่นแต่ละคนจะได้รับในรอบนี้ ตามกฎของ Ito
        // (ตามตัวอย่างในคลิป: รอบ 1 ได้ 1 ใบ, รอบ 2 ได้ 2 ใบ, รอบ 3 ได้ 3 ใบ)
        if (this.currentRound === 1) {
            this.cardsPerPlayerThisRound = 1;
        } else if (this.currentRound === 2) {
            this.cardsPerPlayerThisRound = 2;
        } else if (this.currentRound === 3) {
            this.cardsPerPlayerThisRound = 3;
        } else {
            // ถ้าเกิน 3 รอบ ถือว่าจบเกม หรือสามารถเพิ่มรอบต่อไปได้
            this.roundState = 'GameEnd';
            return;
        }

        // เตรียมสำรับไพ่ใหม่ (1-100) และสับไพ่
        this.deck = Array.from({ length: 100 }, (_, i) => i + 1); // ไพ่ 1 ถึง 100
        shuffleArray(this.deck);
        this.discardPile = []; // กองทิ้งว่างเปล่าสำหรับรอบใหม่
        this.lastPlayedCard = 0; // รีเซ็ตไพ่ที่เล่นล่าสุดเป็น 0 สำหรับรอบใหม่
        this.roundState = 'Playing'; // สถานะกำลังเล่นในรอบใหม่

        // รีเซ็ตสถานะผู้เล่นและแจกไพ่
        this.players.forEach(p => p.resetForNewRound()); // ล้างมือ, รีเซ็ต hasPlayedCardThisRound

        // แจกไพ่ให้ผู้เล่นแต่ละคน
        this.players.forEach(player => {
            for (let i = 0; i < this.cardsPerPlayerThisRound; i++) {
                if (this.deck.length > 0) {
                    player.addCard(this.deck.shift()!); // แจกไพ่จากสำรับ (shift! คือบอก TS ว่ามั่นใจว่ามีค่า)
                }
            }
            // (Optional) เรียงไพ่ในมือผู้เล่นจากน้อยไปมาก เพื่อช่วยให้ผู้เล่นจัดการง่ายขึ้น
            player.hand.sort((a, b) => a - b);
        });

        // จั่ว Topic Card (ไพ่หัวข้อ)
        this.topicCard = this.deck.shift() || null;
        if (this.topicCard === null) {
            console.warn("Deck ran out before drawing topic card.");
            this.roundState = 'GameEnd'; // ไม่ควรเกิดขึ้นถ้าไพ่มีพอสำหรับผู้เล่นและ topic card
        }

        console.log(`Round ${this.currentRound} started. Topic Card (for interpretation): ${this.topicCard}, Cards per player: ${this.cardsPerPlayerThisRound}`);
    }

    // Logic สำหรับผู้เล่นลงไพ่
    // คืนค่าเป็น Object ที่บอกผลลัพธ์การลงไพ่
    playCard(playerId: PlayerId, cardValue: CardValue): { success: boolean, livesLost: number, message: string } {
        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, livesLost: 0, message: 'Player not found.' };
        }
        if (this.roundState !== 'Playing') {
            return { success: false, livesLost: 0, message: 'Game is not in playing state.' };
        }
        if (!player.hand.includes(cardValue)) {
            return { success: false, livesLost: 0, message: 'You do not have this card in your hand.' };
        }

        let livesLostThisPlay = 0;
        let playMessage = '';

        // 1. ตรวจสอบว่าไพ่ที่ลง มีค่าสูงกว่า lastPlayedCard หรือไม่ (ต้องเรียงขึ้นเท่านั้น)
        if (cardValue <= this.lastPlayedCard) {
            this.teamLivesRemaining--;
            livesLostThisPlay = 1;
            playMessage = `Player ${player.name} played ${cardValue}, which is not higher than ${this.lastPlayedCard}. Team loses 1 life!`;
            console.log(playMessage);
            this.endRound(); // จบรอบทันทีเมื่อมีการเล่นผิดพลาด
            return { success: false, livesLost: livesLostThisPlay, message: playMessage };
        }

        // 2. ตรวจสอบ "การ์ดแอบซ่อน" (Hidden lower cards)
        // ตรวจสอบผู้เล่นคนอื่นๆ ที่ *ยังไม่ได้ลงไพ่ในรอบนี้*
        const playersToCheck = this.players.filter(p => p.id !== playerId); // ทุกคนที่เหลือในเกม
        let hasLowerValidHiddenCard = false;
        let hiddenCardOwnerName = '';
        let hiddenCardValue = -1;

        for (const otherPlayer of playersToCheck) {
            // หาไพ่ในมือผู้เล่นคนอื่น ที่อยู่ระหว่าง lastPlayedCard กับ cardValue ที่เพิ่งลงไป
            // (นั่นคือ ไพ่ที่ควรจะลงก่อนแต่ไม่ได้ลง)
            const foundHiddenCard = otherPlayer.hand.find(
                (c) => c > this.lastPlayedCard && c < cardValue
            );
            if (foundHiddenCard !== undefined) {
                hasLowerValidHiddenCard = true;
                hiddenCardOwnerName = otherPlayer.name;
                hiddenCardValue = foundHiddenCard;
                break; // เจอแล้ว หยุดหาทันที
            }
        }

        if (hasLowerValidHiddenCard) {
            this.teamLivesRemaining--;
            livesLostThisPlay = 1;
            playMessage = `Player ${player.name} played ${cardValue}, but ${hiddenCardOwnerName} had ${hiddenCardValue} (a valid lower card). Team loses 1 life!`;
            console.log(playMessage);
            this.endRound(); // จบรอบทันทีเมื่อมีการเล่นผิดพลาด
            return { success: false, livesLost: livesLostThisPlay, message: playMessage };
        }

        // ถ้ามาถึงตรงนี้ แสดงว่าลงไพ่ถูกต้องและไม่มีการ์ดที่ควรลงก่อนแอบซ่อนอยู่
        playMessage = `Player ${player.name} successfully played ${cardValue}.`;

        // ลบไพ่จากมือผู้เล่นและเพิ่มเข้ากองทิ้ง
        player.removeCard(cardValue);
        this.discardPile.push(cardValue);
        this.lastPlayedCard = cardValue;
        player.hasPlayedCardThisRound = true; // ทำเครื่องหมายว่าผู้เล่นคนนี้ลงไพ่ในรอบนี้แล้ว (แต่กฎ Ito จริงๆ ไม่ได้จำกัดว่าลงได้ครั้งเดียวต่อรอบ)
                                            // ถ้าคุณต้องการให้ลงได้เรื่อยๆ จนกว่าไพ่จะหมดมือ ให้ลบบรรทัดนี้ออก

        // ตรวจสอบว่าผู้เล่นทุกคน (ที่ยังมีไพ่) ได้ลงไพ่หมดมือแล้วหรือไม่
        const allPlayersPlayedAllTheirCards = this.players.every(p => p.hand.length === 0);
        if (allPlayersPlayedAllTheirCards) {
            console.log("All players have played their cards. Round successful!");
            this.endRound(); // จบรอบเมื่อไพ่หมดมือทุกคน
        }

        return {
            success: true,
            livesLost: livesLostThisPlay,
            message: playMessage
        };
    }

    // จบรอบ (เกิดเมื่อเล่นผิดพลาด หรือทุกคนลงไพ่หมด)
    endRound() {
        this.roundState = 'RoundEnd';
        console.log(`Round ${this.currentRound} ended. Team Lives: ${this.teamLivesRemaining}`);

        // ตรวจสอบเงื่อนไขจบเกม
        if (this.teamLivesRemaining <= 0) {
            console.log("Game Over! Team ran out of lives.");
            this.roundState = 'GameEnd'; // เกมจบเพราะพลังชีวิตหมด
        } else if (this.currentRound >= 3 && this.players.every(p => p.hand.length === 0)) {
            // ถ้าเล่นครบ 3 รอบและไพ่หมดมือทุกคน (ถือว่าชนะ)
            console.log("Game Over! All rounds completed successfully!");
            this.roundState = 'GameEnd'; // เกมจบเพราะเล่นครบทุกรอบ
        } else {
            console.log("Round ended. Waiting for next round...");
            // รอรอบใหม่ (โดยโฮสต์จะกดปุ่ม หรือมี Timer)
        }
    }
}