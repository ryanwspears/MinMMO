
export type Clazz = string
export type Element = string
export type StatusId = string

export type TargetSide = 'self' | 'ally' | 'enemy' | 'any'
export type TargetMode = 'self' | 'single' | 'all' | 'random' | 'lowest' | 'highest' | 'condition'
export type Resource = 'hp' | 'sta' | 'mp'
export type ConditionOp = 'lt'|'lte'|'eq'|'gte'|'gt'|'ne'|'in'|'notIn'
export type CompareKey = 'hpPct'|'staPct'|'mpPct'|'atk'|'def'|'lv'|'hasStatus'|'tag'|'clazz'

export interface Filter { all?: Filter[]; any?: Filter[]; not?: Filter; test?: { key: CompareKey; op: ConditionOp; value: any } }
export interface TargetSelector { side: TargetSide; mode: TargetMode; count?: number; ofWhat?: CompareKey; condition?: Filter; includeDead?: boolean }

export type EffectKind =
  | 'damage' | 'heal' | 'resource'
  | 'applyStatus' | 'cleanseStatus' | 'dispel'
  | 'modifyStat' | 'shield' | 'taunt'
  | 'flee' | 'revive' | 'summon'
  | 'giveItem' | 'removeItem'
  | 'preventAction'

export type ValueType = 'flat' | 'percent' | 'formula'
export interface Formula { expr: string }

export interface Effect {
  kind: EffectKind
  valueType?: ValueType; amount?: number; percent?: number; formula?: Formula; min?: number; max?: number
  element?: Element; canMiss?: boolean; canCrit?: boolean
  sharedAccuracyRoll?: boolean
  resource?: Resource
  stat?: 'atk'|'def'|'maxHp'|'maxSta'|'maxMp'
  statusId?: StatusId; statusTurns?: number; cleanseTags?: string[]
  shieldId?: string
  message?: string
  selector?: TargetSelector
  onlyIf?: Filter
}

export interface Cost { sta?: number; mp?: number; item?: { id: string; qty: number }; cooldown?: number; charges?: number }
export interface ActionBase {
  id: string; name: string; desc?: string; element?: Element
  targeting: TargetSelector; effects: Effect[]
  canUse?: Filter; costs?: Cost; aiWeight?: number
}
export type SkillDef = ActionBase & { type: 'skill' }
export type ItemDef  = ActionBase & { type: 'item'; consumable?: boolean }

export type StackRule = 'ignore' | 'renew' | 'stackCount' | 'stackMagnitude'
export interface StatusDef {
  id: StatusId; name: string; desc?: string; icon?: string; tags?: string[]
  maxStacks?: number; stackRule?: StackRule; durationTurns?: number
  modifiers?: {
    atk?: number; def?: number;
    damageTakenPct?: Record<string, number>;
    damageDealtPct?: Record<string, number>;
    resourceRegenPerTurn?: Partial<Record<Resource, number>>;
    dodgeBonus?: number; critChanceBonus?: number;
    shield?: { id: string; hp: number; element?: Element } | null;
  }
  hooks?: { onTurnStart?: Effect[]; onTurnEnd?: Effect[]; onDealDamage?: Effect[]; onTakeDamage?: Effect[]; onApply?: Effect[]; onExpire?: Effect[] }
}

export interface ClassPreset { maxHp:number; maxSta:number; maxMp:number; atk:number; def:number }
export type ClassSkills = Record<Clazz, string[]>
export type StartItems  = Record<Clazz, { id:string; qty:number }[]>

export interface EnemyDef {
  name: string; color: number;
  base:  { maxHp:number; maxSta:number; maxMp:number; atk:number; def:number };
  scale: { maxHp:number; maxSta:number; maxMp:number; atk:number; def:number };
  skills: string[]; items?: { id:string; qty:number }[]; tags?: string[]
  ai?: { preferTags?: string[]; avoidTags?: string[] }
}

export interface Balance {
  BASE_HIT:number; BASE_CRIT:number; CRIT_MULT:number; DODGE_FLOOR:number; HIT_CEIL:number;
  ELEMENT_MATRIX: Record<string, Record<string, number>>;
  RESISTS_BY_TAG: Record<string, number>;
  FLEE_BASE:number;
  ECONOMY: { buyMult:number; sellMult:number; restockTurns:number; priceByRarity: Record<'common'|'uncommon'|'rare'|'epic', number> };
  XP_CURVE: { base:number; growth:number };
  GOLD_DROP: { mean:number; variance:number };
  LOOT_ROLLS: number;
  LEVEL_UNLOCK_INTERVAL: number;
  SKILL_SLOTS_BY_LEVEL: number[];
}

export interface NPCDef {
  id: string; name: string; kind: 'merchant' | 'trainer' | 'questGiver' | 'generic';
  wander?: { speed:number; region:string };
  inventory?: { id:string; qty:number; price?:number; rarity?: 'common'|'uncommon'|'rare'|'epic' }[];
  trainer?: { clazz?: string; teaches: string[]; priceBySkill?: Record<string, number> };
  dialogue?: { lines: string[]; options?: { text:string; action?: Effect[] }[] };
  respawnTurns?: number;
}

export interface GameConfig {
  __version: number
  classes: Record<Clazz, ClassPreset>
  classSkills: ClassSkills
  startItems: StartItems
  skills: Record<string, SkillDef>
  items: Record<string, ItemDef>
  statuses: Record<string, StatusDef>
  enemies: Record<string, EnemyDef>
  balance: Balance
  elements: Element[]
  tags?: string[]
  npcs: Record<string, NPCDef>
}
