export const BUILDING_ID = 'main';
export const TICK_HZ = 10;
export const WALK_SPEED = 4;
export const PLAYER_RADIUS = 0.35;
export const INTERACT_RANGE = 1.5;
export const GREET_RANGE = 2;
export const GREET_COOLDOWN_MS = 5000;
export const GREET_TOAST_MS = 5000;
export const BUILDING_CAPACITY = 50;
export const NPC_REAL_THRESHOLD = 3;
export const NICK_MIN = 2;
export const NICK_MAX = 12;
export const BREAK_MINUTES_OPTIONS = [5, 10, 15] as const;
export const DEFAULT_BREAK_MINUTES = 10;
export const DAY_START_HOUR = 7;
export const NIGHT_START_HOUR = 19;
export const THEME_FADE_MS = 1600;
export const ZONE_FADE_MS = 500;
export const OTHER_ZONE_BRIGHTNESS = 0.45;
export const DRINK_LIFETIME_MS = 600000;
export const DRINKS = {
  coffee: ['americano', 'latte'],
  vending: ['greenTea', 'ionDrink'],
} as const;
export const HAIR_STYLES = ['short', 'long', 'bun'] as const;
export const TODAY_BROADCAST_MS = 10000;
