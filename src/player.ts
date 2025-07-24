// backend/src/player.ts
import { PlayerId, CardValue } from './types';

export class Player {
    id: PlayerId;
    name: string;
    hand: CardValue[]; // ไพ่ในมือ
    hasPlayedCardThisRound: boolean; // สถานะว่าผู้เล่นคนนี้ลงไพ่ในรอบนี้ไปแล้วหรือยัง

    constructor(id: PlayerId, name: string) {
        this.id = id;
        this.name = name;
        this.hand = [];
        this.hasPlayedCardThisRound = false;
    }

    // เพิ่มการ์ดเข้ามือ
    addCard(card: CardValue) {
        this.hand.push(card);
    }

    // ลบการ์ดออกจากมือ
    removeCard(card: CardValue): boolean {
        const index = this.hand.indexOf(card);
        if (index > -1) {
            this.hand.splice(index, 1);
            return true;
        }
        return false;
    }

    // รีเซ็ตสถานะผู้เล่นสำหรับรอบใหม่
    resetForNewRound() {
        this.hand = []; // ล้างไพ่ในมือ
        this.hasPlayedCardThisRound = false; // รีเซ็ตสถานะการลงไพ่
    }
}