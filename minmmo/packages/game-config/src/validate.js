import { DEFAULTS } from './defaults.js';
import { z } from 'zod';
const compareKeys = ['hpPct', 'staPct', 'mpPct', 'atk', 'def', 'lv', 'hasStatus', 'tag', 'clazz'];
const conditionOps = ['lt', 'lte', 'eq', 'gte', 'gt', 'ne', 'in', 'notIn'];
const resources = ['hp', 'sta', 'mp'];
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
];
const targetSides = ['self', 'ally', 'enemy', 'any'];
const targetModes = ['self', 'single', 'all', 'random', 'lowest', 'highest', 'condition'];
const valueTypes = ['flat', 'percent', 'formula'];
const statKeys = ['atk', 'def', 'maxHp', 'maxSta', 'maxMp'];
const stackRuleValues = ['ignore', 'renew', 'stackCount', 'stackMagnitude'];
const stackRuleTuple = stackRuleValues;
const enumOptional = (values) => z.preprocess((val) => (values.includes(val) ? val : undefined), z.enum(values).optional());
const coerceNumber = () => z.preprocess((val) => {
    if (val === '' || val === null || val === undefined)
        return undefined;
    const num = Number(val);
    return Number.isFinite(num) ? num : undefined;
}, z.number().finite().optional());
const coerceBoolean = () => z.preprocess((val) => {
    if (val === '' || val === null || val === undefined)
        return undefined;
    if (typeof val === 'boolean')
        return val;
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    return undefined;
}, z.boolean().optional());
const stringValue = () => z.preprocess((val) => {
    if (val === null || val === undefined)
        return undefined;
    return String(val);
}, z.string());
const optionalString = () => stringValue().optional();
const FilterSchema = z.lazy(() => z
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
    .strip()).catch({});
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
    .catch({ side: 'enemy', mode: 'single' });
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
    sharedAccuracyRoll: coerceBoolean(),
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
const SkillSchema = ActionBaseSchema.extend({
    type: z.literal('skill').optional(),
}).strip();
const ItemSchema = ActionBaseSchema.extend({
    type: z.literal('item').optional(),
    consumable: coerceBoolean(),
}).strip();
const StatusSchema = z
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
    .strip();
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
const ClassPresetSchema = StatsSchema;
const ClassesSchema = z.record(ClassPresetSchema).catch({});
const ClassSkillsSchema = z
    .record(z.array(optionalString()).catch([]))
    .catch({});
const StartItemsSchema = z
    .record(z
    .array(z
    .object({
    id: optionalString(),
    qty: coerceNumber(),
})
    .partial()
    .strip())
    .catch([]))
    .catch({});
const EnemySchema = z
    .object({
    name: optionalString(),
    color: coerceNumber(),
    base: StatsSchema,
    scale: StatsSchema,
    skills: z.array(optionalString()).catch([]).optional(),
    items: z
        .array(z
        .object({
        id: optionalString(),
        qty: coerceNumber(),
    })
        .partial()
        .strip())
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
    .strip();
const NPCSchema = z
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
        .array(z
        .object({
        id: optionalString(),
        qty: coerceNumber(),
        price: coerceNumber(),
        rarity: optionalString(),
    })
        .partial()
        .strip())
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
            .array(z
            .object({
            text: optionalString(),
            action: z.array(EffectSchema).catch([]).optional(),
        })
            .partial()
            .strip())
            .catch([])
            .optional(),
    })
        .partial()
        .strip()
        .optional(),
    respawnTurns: coerceNumber(),
})
    .partial()
    .strip();
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
    .strip();
function deepMerge(base, patch) {
    if (Array.isArray(base)) {
        if (Array.isArray(patch)) {
            return patch.slice();
        }
        return base.slice();
    }
    if (typeof base === 'object' && base !== null) {
        const result = { ...base };
        if (typeof patch !== 'object' || patch === null) {
            return result;
        }
        for (const key of Object.keys(patch)) {
            const pVal = patch[key];
            if (pVal === undefined || pVal === null)
                continue;
            const bVal = base[key];
            if (Array.isArray(pVal)) {
                result[key] = pVal.slice();
            }
            else if (typeof pVal === 'object') {
                result[key] = deepMerge(bVal ?? {}, pVal);
            }
            else {
                result[key] = pVal;
            }
        }
        return result;
    }
    return patch ?? base;
}
export function migrate(cfg) {
    if (!cfg.__version || cfg.__version === 1) {
        return { ...cfg, __version: 1 };
    }
    return cfg;
}
export function validateAndRepair(input) {
    const parsed = GameConfigSchema.safeParse(input ?? {});
    const partial = parsed.success ? parsed.data : {};
    const merged = deepMerge(DEFAULTS, partial);
    return migrate(merged);
}
