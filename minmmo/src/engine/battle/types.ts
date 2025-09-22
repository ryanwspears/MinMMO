
export type Targeting = 'self' | 'single' | 'all' | 'random' | 'lowest' | 'highest' | 'condition'
export type Resource = 'hp' | 'sta' | 'mp'

export interface Status { id: string; turns: number; stacks?: number }

export interface ShieldState {
  id: string
  hp: number
  element?: string
}

export interface TauntState {
  sourceId: string
  turns: number
}

export interface ChargeState {
  remaining: number
  max: number
}

export interface Stats  {
  maxHp:number; hp:number;
  maxSta:number; sta:number;
  maxMp:number; mp:number;
  atk:number; def:number; lv:number; xp:number; gold:number;
}

export interface Actor {
  id: string; name: string; color?: number; clazz?: string;
  stats: Stats; statuses: Status[]; alive: boolean; tags: string[];
  meta?: { skillIds?: string[]; itemDrops?: { id:string; qty:number }[] };
}

export interface InventoryEntry { id: string; qty: number }

export interface BattleState {
  turn: number; order: string[]; current: number; rngSeed: number;
  actors: Record<string, Actor>;
  sidePlayer: string[]; sideEnemy: string[];
  inventory: InventoryEntry[];
  log: string[];
  cooldowns: Record<string, Record<string, number>>;
  charges: Record<string, Record<string, ChargeState>>;
  shields: Record<string, Record<string, ShieldState>>;
  taunts: Record<string, TauntState | undefined>;
  ended?: { reason: 'fled' | 'defeat' | 'victory' };
}

export interface UseResult { ok: boolean; log: string[]; state: BattleState }
