import { NPC_REAL_THRESHOLD, seatById, type Appearance, type PlayerView } from '@studyverse/shared';

export const NPC_SEATS = ['R24', 'R19', 'R14'] as const; // far from the entrance

const NPC_APPEARANCES: readonly Appearance[] = [
  { hair: 'short', hairColor: '#2b2118', shirtColor: '#8a6fd6' },
  { hair: 'long', hairColor: '#5a3a22', shirtColor: '#5fa8a0' },
  { hair: 'bun', hairColor: '#1c1c24', shirtColor: '#d68aa6' },
];

/** >=3 real players → 0 NPCs, 2 → 2, 0..1 → 3. */
export function npcTarget(realCount: number): number {
  if (realCount >= NPC_REAL_THRESHOLD) return 0;
  return realCount === 2 ? 2 : 3;
}

/** `seatId` overrides NPC_SEATS[index] when that desk is occupied. startedAt is display-only. */
export function makeNpc(index: number, now: number, rand: () => number, seatId: string = NPC_SEATS[index]): PlayerView {
  const seat = seatById(seatId)!;
  const minutes = 20 + rand() * 70;
  return {
    id: `npc-${index + 1}`, nickname: '메이트', appearance: NPC_APPEARANCES[index % NPC_APPEARANCES.length], isNpc: true,
    x: seat.x, z: seat.z, ry: seat.facing, zone: 'reading', seatId: seat.id,
    status: { kind: 'studying', startedAt: now - Math.floor(minutes * 60000), focus: true },
    drink: null,
  };
}
