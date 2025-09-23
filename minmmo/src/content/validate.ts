import { DEFAULTS } from '@config/defaults';
import type {
  ClassPreset,
  ClassSkills,
  EnemyDef,
  GameConfig,
  ItemDef,
  NPCDef,
  SkillDef,
  StackRule,
  StartItems,
  StatusDef,
  TargetSelector,
} from '@config/schema';
import { z } from 'zod';

type NonEmptyArray<T extends string> = readonly [T, ...T[]];

const compareKeys = ['hpPct', 'staPct', 'mpPct', 'atk', 'def', 'lv', 'hasStatus', 'tag', 'clazz'] as const;
const conditionOps = ['lt', 'lte', 'eq', 'gte', 'gt', 'ne', 'in', 'notIn'] as const;
const resources = ['hp', 'sta', 'mp'] as const;
const effectKinds = [
  'damage',
  'heal',
  'resource',
  'applyStatus',
  'cleanseStatus',
  'dispel',
  'modifyStat',
  'shield',
  'taunt',
  'flee',
  'revive',
  'summon',
  'giveItem',
  'removeItem',
  'preventAction',
] as const;
const targetSides = ['self', 'ally', 'enemy', 'any'] as const;
const targetModes = ['self', 'single', 'all', 'random', 'lowest', 'highest', 'condition'] as const;
const valueTypes = ['flat', 'percent', 'formula'] as const;
const statKeys = ['atk', 'def', 'maxHp', 'maxSta', 'maxMp'] as const;
const stackRuleValues = ['ignore', 'renew', 'stackCount', 'stackMagnitude'] as const satisfies readonly StackRule[];
const stackRuleTuple = stackRuleValues as unknown as NonEmptyArray<StackRule>;

const enumOptional = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((val) => (values.includes(val as string) ? val : undefined), z.enum(values).optional());

const coerceNumber = () =>
  z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined;
    const num = Number(val);
    return Number.isFinite(num) ? num : undefined;
  }, z.number().finite().optional());

const coerceBoolean = () =>
  z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined;
    if (typeof val === 'boolean') return val;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return undefined;
  }, z.boolean().optional());

const stringValue = () =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return undefined;
    return String(val);
  }, z.string());

const optionalString = () => stringValue().optional();

const FilterSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      all: z.array(FilterSchema).optional(),
      any: z.array(FilterSchema).optional(),
      not: FilterSchema.optional(),
      test: z
        .object({
          key: enumOptional(compareKeys),
          op: enumOptional(conditionOps),
          value: z.any().optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .strip()
).catch({});

const TargetSelectorSchema = z
  .object({
    side: enumOptional(targetSides),
    mode: enumOptional(targetModes),
    count: coerceNumber(),
    ofWhat: enumOptional(compareKeys),
    condition: FilterSchema.optional(),
    includeDead: coerceBoolean(),
  })
  .partial()
  .strip()
  .catch({ side: 'enemy', mode: 'single' } as TargetSelector) as z.ZodType<TargetSelector>;

const EffectSchema = z
  .object({
    kind: enumOptional(effectKinds),
    valueType: enumOptional(valueTypes),
    amount: coerceNumber(),
    percent: coerceNumber(),
    formula: z
      .object({ expr: optionalString() })
      .partial()
      .strip()
      .optional(),
    min: coerceNumber(),
    max: coerceNumber(),
    element: optionalString(),
    canMiss: coerceBoolean(),
    canCrit: coerceBoolean(),
    resource: enumOptional(resources),
    stat: enumOptional(statKeys),
    statusId: optionalString(),
    statusTurns: coerceNumber(),
    cleanseTags: z.array(optionalString()).catch([]).optional(),
    shieldId: optionalString(),
    selector: TargetSelectorSchema.optional(),
    onlyIf: FilterSchema.optional(),
  })
  .partial()
  .strip()
  .catch({ kind: 'damage' });

const CostSchema = z
  .object({
    sta: coerceNumber(),
    mp: coerceNumber(),
    item: z
      .object({
        id: optionalString(),
        qty: coerceNumber(),
      })
      .partial()
      .strip()
      .optional(),
    cooldown: coerceNumber(),
    charges: coerceNumber(),
  })
  .partial()
  .strip()
  .optional();

const ActionBaseSchema = z
  .object({
    id: optionalString(),
    name: optionalString(),
    desc: optionalString(),
    element: optionalString(),
    targeting: TargetSelectorSchema.optional(),
    effects: z.array(EffectSchema).catch([]).optional(),
    canUse: FilterSchema.optional(),
    costs: CostSchema,
    aiWeight: coerceNumber(),
  })
  .partial()
  .strip();

const SkillSchema: z.ZodType<SkillDef> = ActionBaseSchema.extend({
  type: z.literal('skill').optional(),
}).strip() as z.ZodType<SkillDef>;

const ItemSchema: z.ZodType<ItemDef> = ActionBaseSchema.extend({
  type: z.literal('item').optional(),
  consumable: coerceBoolean(),
}).strip() as z.ZodType<ItemDef>;

const StatusSchema: z.ZodType<StatusDef> = z
  .object({
    id: optionalString(),
    name: optionalString(),
    desc: optionalString(),
    icon: optionalString(),
    tags: z.array(optionalString()).catch([]).optional(),
    maxStacks: coerceNumber(),
    stackRule: enumOptional(stackRuleTuple),
    durationTurns: coerceNumber(),
    modifiers: z
      .object({
        atk: coerceNumber(),
        def: coerceNumber(),
        damageTakenPct: z.record(coerceNumber()).catch({}).optional(),
        damageDealtPct: z.record(coerceNumber()).catch({}).optional(),
        resourceRegenPerTurn: z.record(coerceNumber()).catch({}).optional(),
        dodgeBonus: coerceNumber(),
        critChanceBonus: coerceNumber(),
        shield: z
          .object({
            id: optionalString(),
            hp: coerceNumber(),
            element: optionalString(),
          })
          .partial()
          .strip()
          .nullable()
          .optional(),
      })
      .partial()
      .strip()
      .optional(),
    hooks: z
      .object({
        onTurnStart: z.array(EffectSchema).catch([]).optional(),
        onTurnEnd: z.array(EffectSchema).catch([]).optional(),
        onDealDamage: z.array(EffectSchema).catch([]).optional(),
        onTakeDamage: z.array(EffectSchema).catch([]).optional(),
        onApply: z.array(EffectSchema).catch([]).optional(),
        onExpire: z.array(EffectSchema).catch([]).optional(),
      })
      .partial()
      .strip()
      .optional(),
  })
  .partial()
  .strip() as z.ZodType<StatusDef>;

const StatsSchema = z
  .object({
    maxHp: coerceNumber(),
    maxSta: coerceNumber(),
    maxMp: coerceNumber(),
    atk: coerceNumber(),
    def: coerceNumber(),
  })
  .partial()
  .strip();

const ClassPresetSchema: z.ZodType<ClassPreset> = StatsSchema as z.ZodType<ClassPreset>;

const ClassesSchema = z.record(ClassPresetSchema).catch({}) as z.ZodType<Record<string, ClassPreset>>;

const ClassSkillsSchema: z.ZodType<ClassSkills> = z
  .record(z.array(optionalString()).catch([]))
  .catch({}) as z.ZodType<ClassSkills>;

const StartItemsSchema: z.ZodType<StartItems> = z
  .record(
    z
      .array(
        z
          .object({
            id: optionalString(),
            qty: coerceNumber(),
          })
          .partial()
          .strip()
      )
      .catch([])
  )
  .catch({}) as z.ZodType<StartItems>;

const EnemySchema: z.ZodType<EnemyDef> = z
  .object({
    name: optionalString(),
    color: coerceNumber(),
    base: StatsSchema,
    scale: StatsSchema,
    skills: z.array(optionalString()).catch([]).optional(),
    items: z
      .array(
        z
          .object({
            id: optionalString(),
            qty: coerceNumber(),
          })
          .partial()
          .strip()
      )
      .catch([])
      .optional(),
    tags: z.array(optionalString()).catch([]).optional(),
    ai: z
      .object({
        preferTags: z.array(optionalString()).catch([]).optional(),
        avoidTags: z.array(optionalString()).catch([]).optional(),
      })
      .partial()
      .strip()
      .optional(),
  })
  .partial()
  .strip() as z.ZodType<EnemyDef>;

const NPCSchema: z.ZodType<NPCDef> = z
  .object({
    id: optionalString(),
    name: optionalString(),
    kind: optionalString(),
    wander: z
      .object({
        speed: coerceNumber(),
        region: optionalString(),
      })
      .partial()
      .strip()
      .optional(),
    inventory: z
      .array(
        z
          .object({
            id: optionalString(),
            qty: coerceNumber(),
            price: coerceNumber(),
            rarity: optionalString(),
          })
          .partial()
          .strip()
      )
      .catch([])
      .optional(),
    trainer: z
      .object({
        clazz: optionalString(),
        teaches: z.array(optionalString()).catch([]).optional(),
        priceBySkill: z.record(coerceNumber()).catch({}).optional(),
      })
      .partial()
      .strip()
      .optional(),
    dialogue: z
      .object({
        lines: z.array(optionalString()).catch([]).optional(),
        options: z
          .array(
            z
              .object({
                text: optionalString(),
                action: z.array(EffectSchema).catch([]).optional(),
              })
              .partial()
              .strip()
          )
          .catch([])
          .optional(),
      })
      .partial()
      .strip()
      .optional(),
    respawnTurns: coerceNumber(),
  })
  .partial()
  .strip() as z.ZodType<NPCDef>;

const BalanceSchema = z
  .object({
    BASE_HIT: coerceNumber(),
    BASE_CRIT: coerceNumber(),
    CRIT_MULT: coerceNumber(),
    DODGE_FLOOR: coerceNumber(),
    HIT_CEIL: coerceNumber(),
    ELEMENT_MATRIX: z.record(z.record(coerceNumber()).catch({})).catch({}),
    RESISTS_BY_TAG: z.record(coerceNumber()).catch({}),
    FLEE_BASE: coerceNumber(),
    ECONOMY: z
      .object({
        buyMult: coerceNumber(),
        sellMult: coerceNumber(),
        restockTurns: coerceNumber(),
        priceByRarity: z.record(coerceNumber()).catch({}),
      })
      .partial()
      .strip(),
    XP_CURVE: z
      .object({
        base: coerceNumber(),
        growth: coerceNumber(),
      })
      .partial()
      .strip(),
    GOLD_DROP: z
      .object({
        mean: coerceNumber(),
        variance: coerceNumber(),
      })
      .partial()
      .strip(),
    LOOT_ROLLS: coerceNumber(),
    LEVEL_UNLOCK_INTERVAL: coerceNumber(),
    SKILL_SLOTS_BY_LEVEL: z.array(coerceNumber()).catch([]),
  })
  .partial()
  .strip();

const GameConfigSchema = z
  .object({
    __version: coerceNumber(),
    classes: ClassesSchema.optional(),
    classSkills: ClassSkillsSchema.optional(),
    startItems: StartItemsSchema.optional(),
    skills: z.record(SkillSchema).catch({}).optional(),
    items: z.record(ItemSchema).catch({}).optional(),
    statuses: z.record(StatusSchema).catch({}).optional(),
    enemies: z.record(EnemySchema).catch({}).optional(),
    balance: BalanceSchema.optional(),
    elements: z.array(optionalString()).catch([]).optional(),
    tags: z.array(optionalString()).catch([]).optional(),
    npcs: z.record(NPCSchema).catch({}).optional(),
  })
  .partial()
  .strip() as z.ZodType<Partial<GameConfig>>;

function deepMerge<T>(base: T, patch: any): T {
  if (Array.isArray(base)) {
    if (Array.isArray(patch)) {
      return (patch as any).slice();
    }
    return (base as any).slice();
  }
  if (typeof base === 'object' && base !== null) {
    const result: any = { ...(base as any) };
    if (typeof patch !== 'object' || patch === null) {
      return result;
    }
    for (const key of Object.keys(patch)) {
      const pVal = patch[key];
      if (pVal === undefined || pVal === null) continue;
      const bVal = (base as any)[key];
      if (Array.isArray(pVal)) {
        result[key] = pVal.slice();
      } else if (typeof pVal === 'object') {
        result[key] = deepMerge(bVal ?? {}, pVal);
      } else {
        result[key] = pVal;
      }
    }
    return result;
  }
  return patch ?? base;
}

export function migrate(cfg: GameConfig): GameConfig {
  if (!cfg.__version || cfg.__version === 1) {
    return { ...cfg, __version: 1 };
  }
  return cfg;
}

export function validateAndRepair(input: unknown): GameConfig {
  const parsed = GameConfigSchema.safeParse(input ?? {});
  const partial = parsed.success ? parsed.data : {};
  const merged = deepMerge(DEFAULTS, partial) as GameConfig;
  return migrate(merged);
}
