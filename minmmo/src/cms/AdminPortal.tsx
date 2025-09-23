import React, { useEffect, useMemo, useState } from 'react';
import {
  load,
  save,
  exportConfig,
  importConfig,
  subscribe,
} from '@config/store';
import type {
  Balance,
  ClassPreset,
  CompareKey,
  Effect,
  EffectKind,
  EnemyDef,
  GameConfig,
  ItemDef,
  NPCDef,
  Resource,
  SkillDef,
  StackRule,
  StatusDef,
  TargetMode,
  TargetSide,
  ValueType,
} from '@config/schema';
import { z } from 'zod';

const targetSides = ['self', 'ally', 'enemy', 'any'] as const satisfies readonly TargetSide[];
const targetModes = [
  'self',
  'single',
  'all',
  'random',
  'lowest',
  'highest',
  'condition',
] as const satisfies readonly TargetMode[];
const compareKeys = [
  'hpPct',
  'staPct',
  'mpPct',
  'atk',
  'def',
  'lv',
  'hasStatus',
  'tag',
  'clazz',
] as const satisfies readonly CompareKey[];
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
] as const satisfies readonly EffectKind[];
const valueTypes = ['flat', 'percent', 'formula'] as const satisfies readonly ValueType[];
const resources = ['hp', 'sta', 'mp'] as const satisfies readonly Resource[];
const statKeys = ['atk', 'def', 'maxHp', 'maxSta', 'maxMp'] as const;
const stackRules = ['ignore', 'renew', 'stackCount', 'stackMagnitude'] as const satisfies readonly StackRule[];
const npcKinds = ['merchant', 'trainer', 'questGiver', 'generic'] as const satisfies readonly NPCDef['kind'][];
const inventoryRarities =
  ['common', 'uncommon', 'rare', 'epic'] as const satisfies readonly NonNullable<
    NonNullable<NPCDef['inventory']>[number]['rarity']
  >[];

const TargetingSchema = z
  .object({
    side: z.enum(targetSides, { errorMap: () => ({ message: 'Target side is required' }) }),
    mode: z.enum(targetModes, { errorMap: () => ({ message: 'Target mode is required' }) }),
    count: z.number().int().positive().optional(),
    ofWhat: z.enum(compareKeys).optional(),
    includeDead: z.boolean().optional(),
    condition: z.any().optional(),
  })
  .passthrough();

const CostSchema = z
  .object({
    sta: z.number().min(0).optional(),
    mp: z.number().min(0).optional(),
    cooldown: z.number().min(0).optional(),
    charges: z.number().min(0).optional(),
    item: z
      .object({
        id: z.string().min(1, 'Item id is required'),
        qty: z.number().min(1, 'Quantity must be at least 1'),
      })
      .partial()
      .superRefine((val, ctx) => {
        const hasId = typeof val.id === 'string' && val.id.length > 0;
        const hasQty = typeof val.qty === 'number' && Number.isFinite(val.qty);
        if (hasId !== hasQty) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Item id and quantity are both required when using item costs',
          });
        }
      })
      .optional(),
  })
  .partial()
  .passthrough();

const EffectSchema = z
  .object({
    kind: z.enum(effectKinds, { errorMap: () => ({ message: 'Effect kind is required' }) }),
    valueType: z.enum(valueTypes).optional(),
    amount: z.number().finite().optional(),
    percent: z.number().finite().optional(),
    formula: z.object({ expr: z.string().min(1, 'Formula expression is required') }).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    element: z.string().optional(),
    canMiss: z.boolean().optional(),
    canCrit: z.boolean().optional(),
    resource: z.enum(resources).optional(),
    stat: z.enum(statKeys as any).optional(),
    statusId: z.string().optional(),
    statusTurns: z.number().int().nonnegative().optional(),
    cleanseTags: z.array(z.string()).optional(),
    shieldId: z.string().optional(),
    selector: TargetingSchema.optional(),
    onlyIf: z.any().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const hasFormula = val.formula && typeof val.formula.expr === 'string' && val.formula.expr.length > 0;
    const hasAmount = typeof val.amount === 'number' && Number.isFinite(val.amount);
    const hasPercent = typeof val.percent === 'number' && Number.isFinite(val.percent);
    if (!hasFormula && !hasAmount && !hasPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide an amount, percent, or formula',
        path: ['amount'],
      });
    }
  });

const SkillSchema = z
  .object({
    id: z.string().min(1, 'ID is required'),
    name: z.string().min(1, 'Name is required'),
    desc: z.string().optional(),
    element: z.string().optional(),
    targeting: TargetingSchema,
    effects: z.array(EffectSchema).min(1, 'At least one effect is required'),
    costs: CostSchema.optional(),
    canUse: z.any().optional(),
    aiWeight: z.number().optional(),
    type: z.literal('skill').optional(),
  })
  .passthrough();

const ItemSchema = SkillSchema.extend({
  type: z.literal('item').optional(),
  consumable: z.boolean().optional(),
}).passthrough();

const StatusSchema = z
  .object({
    id: z.string().min(1, 'ID is required'),
    name: z.string().min(1, 'Name is required'),
    desc: z.string().optional(),
    icon: z.string().optional(),
    tags: z.array(z.string().min(1, 'Tag is required')).optional(),
    maxStacks: z.number().int().positive().optional(),
    stackRule: z.enum(stackRules).optional(),
    durationTurns: z.number().int().nonnegative().optional(),
    modifiers: z.any().optional(),
    hooks: z.any().optional(),
  })
  .passthrough();

const ClassSchema = z
  .object({
    id: z.string().min(1, 'ID is required'),
    maxHp: z.number().finite(),
    maxSta: z.number().finite(),
    maxMp: z.number().finite(),
    atk: z.number().finite(),
    def: z.number().finite(),
    skills: z.array(z.string().min(1, 'Skill id is required')).optional(),
    startItems: z
      .array(
        z.object({ id: z.string().min(1, 'Item id is required'), qty: z.number().int().nonnegative('Quantity must be >= 0') }),
      )
      .optional(),
  })
  .passthrough();

const StatBlockSchema = z
  .object({
    maxHp: z.number().nonnegative('Max HP must be >= 0'),
    maxSta: z.number().nonnegative('Max STA must be >= 0'),
    maxMp: z.number().nonnegative('Max MP must be >= 0'),
    atk: z.number().nonnegative('Attack must be >= 0'),
    def: z.number().nonnegative('Defense must be >= 0'),
  })
  .passthrough();

const EnemySchema = z
  .object({
    id: z.string().min(1, 'ID is required'),
    name: z.string().min(1, 'Name is required'),
    color: z.number().finite(),
    base: StatBlockSchema,
    scale: StatBlockSchema,
    skills: z.array(z.string().min(1, 'Skill id is required')).optional(),
    items: z
      .array(z.object({ id: z.string().min(1, 'Item id is required'), qty: z.number().int().nonnegative('Qty must be >= 0') }))
      .optional(),
    tags: z.array(z.string().min(1, 'Tag is required')).optional(),
    ai: z
      .object({
        preferTags: z.array(z.string().min(1, 'Tag is required')).optional(),
        avoidTags: z.array(z.string().min(1, 'Tag is required')).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

const NpcSchema = z
  .object({
    id: z.string().min(1, 'ID is required'),
    name: z.string().min(1, 'Name is required'),
    kind: z.enum(npcKinds, { errorMap: () => ({ message: 'Kind is required' }) }),
    wander: z
      .object({
        speed: z.number().nonnegative('Speed must be >= 0').optional(),
        region: z.string().min(1, 'Region is required').optional(),
      })
      .partial()
      .optional(),
    inventory: z
      .array(
        z
          .object({
            id: z.string().min(1, 'Item id is required'),
            qty: z.number().int().nonnegative('Quantity must be >= 0'),
            price: z.number().int().nonnegative('Price must be >= 0').optional(),
            rarity: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    trainer: z
      .object({
        clazz: z.string().optional(),
        teaches: z.array(z.string().min(1, 'Skill id is required')).optional(),
        priceBySkill: z.record(z.number().nonnegative('Price must be >= 0')).optional(),
      })
      .partial()
      .optional(),
    dialogue: z
      .object({
        lines: z.array(z.string().min(1, 'Dialogue line is required')).optional(),
        options: z
          .array(
            z
              .object({
                text: z.string().min(1, 'Option text is required'),
                action: z.any().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .partial()
      .optional(),
    respawnTurns: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const BalanceSchema = z
  .object({
    BASE_HIT: z.number().finite(),
    BASE_CRIT: z.number().finite(),
    CRIT_MULT: z.number().finite(),
    DODGE_FLOOR: z.number().finite(),
    HIT_CEIL: z.number().finite(),
    ELEMENT_MATRIX: z.record(z.record(z.number().finite())).optional(),
    RESISTS_BY_TAG: z.record(z.number().finite()).optional(),
    FLEE_BASE: z.number().finite(),
    ECONOMY: z
      .object({
        buyMult: z.number().finite(),
        sellMult: z.number().finite(),
        restockTurns: z.number().finite(),
        priceByRarity: z.record(z.number().finite()).optional(),
      })
      .passthrough(),
    XP_CURVE: z.object({ base: z.number().finite(), growth: z.number().finite() }).passthrough(),
    GOLD_DROP: z.object({ mean: z.number().finite(), variance: z.number().finite() }).passthrough(),
    LOOT_ROLLS: z.number().finite(),
    LEVEL_UNLOCK_INTERVAL: z.number().finite(),
    SKILL_SLOTS_BY_LEVEL: z.array(z.number().int().nonnegative()),
  })
  .passthrough();

const StringListSchema = z
  .array(z.string().min(1, 'Value is required'))
  .superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Value must be unique',
          path: [index],
        });
      }
      seen.add(value);
    });
  });

type ClassFormValue = ClassPreset & {
  id: string;
  skills: string[];
  startItems: { id: string; qty: number }[];
};

type EnemyFormValue = EnemyDef & { id: string };

type AdminTabKey = 'skills' | 'items' | 'classes' | 'statuses' | 'enemies' | 'npcs' | 'balance' | 'world';

type ValidationResult = {
  success: boolean;
  errors: Record<string, string[]>;
};

function cloneConfig(cfg: GameConfig): GameConfig {
  return JSON.parse(JSON.stringify(cfg));
}

function formatIssues(issues: z.ZodIssue[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map((part) => `${part}`).join('.') : '__root__';
    if (!map[key]) map[key] = [];
    map[key].push(issue.message);
  }
  return map;
}

function validateSkill(skill: SkillDef): ValidationResult {
  const result = SkillSchema.safeParse(skill);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateItem(item: ItemDef): ValidationResult {
  const result = ItemSchema.safeParse(item);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateStatus(status: StatusDef): ValidationResult {
  const result = StatusSchema.safeParse(status);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateClassEntry(clazz: ClassFormValue): ValidationResult {
  const result = ClassSchema.safeParse(clazz);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateEnemyEntry(enemy: EnemyFormValue): ValidationResult {
  const result = EnemySchema.safeParse(enemy);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateNpcEntry(npc: NPCDef): ValidationResult {
  const result = NpcSchema.safeParse(npc);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateBalance(balance: Balance): ValidationResult {
  const result = BalanceSchema.safeParse(balance);
  if (result.success) {
    return { success: true, errors: {} };
  }
  return { success: false, errors: formatIssues(result.error.issues) };
}

function validateStringList(values: string[], prefix: string): ValidationResult {
  const result = StringListSchema.safeParse(values);
  if (result.success) {
    return { success: true, errors: {} };
  }
  const base = formatIssues(result.error.issues);
  const remapped: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(base)) {
    remapped[`${prefix}.${key}`] = value;
  }
  return { success: false, errors: remapped };
}

function collectValidation<T extends { id: string }>(
  records: Record<string, T>,
  validator: (value: T) => ValidationResult,
): Map<string, ValidationResult> {
  const map = new Map<string, ValidationResult>();
  const counts = new Map<string, number>();
  for (const value of Object.values(records)) {
    const id = value.id ?? '';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [key, value] of Object.entries(records)) {
    const validation = validator(value);
    if (value.id && counts.get(value.id)! > 1) {
      const errs = { ...validation.errors };
      const idKey = 'id';
      errs[idKey] = [...(errs[idKey] ?? []), 'ID must be unique'];
      map.set(key, { success: false, errors: errs });
    } else {
      map.set(key, validation);
    }
  }
  return map;
}

function pickFirst<T>(obj: Record<string, T>): string | null {
  const keys = Object.keys(obj);
  return keys.length ? keys[0] : null;
}

function uniqueId(base: string, used: Record<string, { id: string }>): string {
  let attempt = base;
  let counter = 1;
  const existing = new Set(Object.values(used).map((entry) => entry.id));
  while (existing.has(attempt)) {
    attempt = `${base}-${counter++}`;
  }
  return attempt;
}

function uniqueKey(base: string, used: Record<string, unknown>): string {
  let attempt = base;
  let counter = 1;
  while (Object.prototype.hasOwnProperty.call(used, attempt)) {
    attempt = `${base}-${counter++}`;
  }
  return attempt;
}

function defaultEffect(): Effect {
  return {
    kind: 'damage',
    valueType: 'flat',
    amount: 0,
    canMiss: true,
    canCrit: true,
  };
}

function defaultSkill(skills: Record<string, SkillDef>): SkillDef {
  const id = uniqueId('new-skill', skills);
  return {
    type: 'skill',
    id,
    name: 'New Skill',
    desc: '',
    element: 'neutral',
    targeting: { side: 'enemy', mode: 'single' },
    effects: [defaultEffect()],
    costs: {},
  };
}

function defaultItem(items: Record<string, ItemDef>): ItemDef {
  const id = uniqueId('new-item', items);
  return {
    type: 'item',
    id,
    name: 'New Item',
    desc: '',
    element: 'neutral',
    targeting: { side: 'enemy', mode: 'single' },
    effects: [defaultEffect()],
    costs: {},
    consumable: true,
  };
}

function defaultStatus(statuses: Record<string, StatusDef>): StatusDef {
  const id = uniqueId('new-status', statuses);
  return {
    id,
    name: 'New Status',
    desc: '',
    tags: [],
    stackRule: 'ignore',
  };
}

function defaultClassEntry(config: GameConfig): ClassFormValue {
  const id = uniqueKey('new-class', config.classes);
  return {
    id,
    maxHp: 25,
    maxSta: 10,
    maxMp: 5,
    atk: 5,
    def: 5,
    skills: [],
    startItems: [],
  };
}

function defaultEnemyEntry(enemies: Record<string, EnemyDef>): EnemyFormValue {
  const id = uniqueKey('new-enemy', enemies);
  return {
    id,
    name: 'New Enemy',
    color: 0xffffff,
    base: { maxHp: 30, maxSta: 10, maxMp: 5, atk: 5, def: 5 },
    scale: { maxHp: 4, maxSta: 2, maxMp: 1, atk: 1, def: 1 },
    skills: [],
    items: [],
    tags: [],
  };
}

function defaultNpcEntry(npcs: Record<string, NPCDef>): NPCDef {
  const id = uniqueKey('new-npc', npcs);
  return {
    id,
    name: 'New NPC',
    kind: 'generic',
    dialogue: { lines: [] },
  };
}

interface ListProps {
  title: string;
  entries: Record<string, { id: string; name?: string } | undefined>;
  selectedId: string | null;
  onSelect(id: string): void;
  onAdd(): void;
  onRemove(id: string): void;
  validation: Map<string, ValidationResult>;
  addLabel: string;
}

function ActionList({ title, entries, selectedId, onSelect, onAdd, onRemove, validation, addLabel }: ListProps) {
  const ordered = useMemo(
    () =>
      Object.entries(entries)
        .filter(([, value]) => Boolean(value))
        .sort((a, b) => {
          const nameA = a[1]?.name ?? a[1]?.id ?? a[0];
          const nameB = b[1]?.name ?? b[1]?.id ?? b[0];
          return nameA.localeCompare(nameB);
        }),
    [entries],
  );
  return (
    <div className="card" style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button type="button" onClick={onAdd}>
          {addLabel}
        </button>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '60vh', border: '1px solid var(--border)', borderRadius: 4 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ordered.map(([key, value]) => {
            const isSelected = selectedId === key;
            const validationEntry = validation.get(key);
            const invalid = validationEntry ? !validationEntry.success : false;
            return (
              <li
                key={key}
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'rgba(80,120,255,0.1)' : 'transparent',
                }}
              >
                <div
                  className="row"
                  style={{
                    padding: '8px 12px',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(key)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{value?.name ?? value?.id ?? key}</div>
                    <div className="small" style={{ color: '#666' }}>
                      {value?.id ?? key}
                    </div>
                  </button>
                  {invalid && (
                    <span title="Has validation issues" style={{ color: '#d22', fontWeight: 700 }}>
                      !
                    </span>
                  )}
                  <button type="button" onClick={() => onRemove(key)} aria-label={`Remove ${value?.name ?? key}`}>
                    ×
                  </button>
                </div>
              </li>
            );
          })}
          {ordered.length === 0 && <li style={{ padding: 12, color: '#666' }}>No entries yet.</li>}
        </ul>
      </div>
    </div>
  );
}

interface FieldErrorProps {
  error?: string[];
}

function FieldError({ error }: FieldErrorProps) {
  if (!error || error.length === 0) return null;
  return (
    <div role="alert" className="small" style={{ color: '#d22' }}>
      {error.join(', ')}
    </div>
  );
}

interface JsonEditorProps {
  label: string;
  value: unknown;
  onChange(next: unknown | undefined): void;
  errors?: string[];
  description?: string;
}

function JsonEditor({ label, value, onChange, errors, description }: JsonEditorProps) {
  const [text, setText] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const nextText = value === undefined ? '' : JSON.stringify(value, null, 2);
    setText(nextText);
    setLocalError(null);
  }, [value]);

  const onTextChange = (nextText: string) => {
    setText(nextText);
    if (nextText.trim() === '') {
      setLocalError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(nextText);
      setLocalError(null);
      onChange(parsed);
    } catch (err) {
      setLocalError('Invalid JSON');
    }
  };

  const combinedErrors = [...(errors ?? [])];
  if (localError) combinedErrors.push(localError);

  return (
    <label style={{ display: 'block' }}>
      <div>{label}</div>
      {description && (
        <div className="small" style={{ color: '#666', marginBottom: 4 }}>
          {description}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={6}
        style={{ width: '100%', fontFamily: 'monospace' }}
      />
      <FieldError error={combinedErrors.length ? combinedErrors : undefined} />
    </label>
  );
}

interface SkillFormProps {
  kind: 'skill' | 'item';
  title: string;
  skill: SkillDef;
  onChange(next: SkillDef): void;
  errors: Record<string, string[]>;
  extras?: React.ReactNode;
}

function SkillForm({ kind, title, skill, onChange, errors, extras }: SkillFormProps) {
  const updateSkill = (patch: Partial<SkillDef>) => {
    onChange({ ...skill, ...patch });
  };

  const updateTargeting = (patch: Partial<SkillDef['targeting']>) => {
    updateSkill({ targeting: { ...skill.targeting, ...patch } });
  };

  const updateCosts = (patch: Partial<NonNullable<SkillDef['costs']>>) => {
    const nextCosts: Record<string, unknown> = { ...(skill.costs ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) {
        delete (nextCosts as any)[key];
      } else {
        (nextCosts as any)[key] = value;
      }
    }
    updateSkill({ costs: Object.keys(nextCosts).length ? (nextCosts as NonNullable<SkillDef['costs']>) : undefined });
  };

  const updateCostsNumber = (key: keyof NonNullable<SkillDef['costs']>) => (value: string) => {
    const num = value === '' ? undefined : Number(value);
    updateCosts({ [key]: num } as Partial<NonNullable<SkillDef['costs']>>);
  };

  const updateItemCost = (field: 'id' | 'qty', value: string) => {
    const existing = skill.costs?.item;
    const nextId = field === 'id' ? value : existing?.id ?? '';
    const rawQty =
      field === 'qty'
        ? value === ''
          ? undefined
          : Number(value)
        : existing?.qty;
    const nextQty = rawQty !== undefined && Number.isFinite(rawQty) ? rawQty : undefined;

    if (!nextId || nextQty === undefined) {
      updateCosts({ item: undefined });
      return;
    }

    updateCosts({ item: { id: nextId, qty: nextQty } });
  };

  const updateEffect = (index: number, patch: Partial<Effect>) => {
    const nextEffects = skill.effects.map((effect, i) => (i === index ? { ...effect, ...patch } : effect));
    updateSkill({ effects: nextEffects });
  };

  const addEffect = () => updateSkill({ effects: [...skill.effects, defaultEffect()] });
  const removeEffect = (index: number) => {
    const nextEffects = skill.effects.filter((_, i) => i !== index);
    updateSkill({ effects: nextEffects });
  };

  const getError = (path: string) => errors[path];

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <FieldError error={getError('__root__')} />
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>Skill ID</div>
          <input
            aria-label="Skill ID"
            value={skill.id}
            onChange={(e) => updateSkill({ id: e.target.value })}
          />
          <FieldError error={getError('id')} />
        </label>
        <label>
          <div>Skill Name</div>
          <input
            aria-label="Skill Name"
            value={skill.name}
            onChange={(e) => updateSkill({ name: e.target.value })}
          />
          <FieldError error={getError('name')} />
        </label>
        <label>
          <div>Element</div>
          <input value={skill.element ?? ''} onChange={(e) => updateSkill({ element: e.target.value })} />
        </label>
        <label>
          <div>Target Side</div>
          <select
            aria-label="Target Side"
            value={skill.targeting.side}
            onChange={(e) => updateTargeting({ side: e.target.value as TargetSide })}
          >
            {targetSides.map((side) => (
              <option key={side} value={side}>
                {side}
              </option>
            ))}
          </select>
          <FieldError error={getError('targeting.side')} />
        </label>
        <label>
          <div>Target Mode</div>
          <select
            aria-label="Target Mode"
            value={skill.targeting.mode}
            onChange={(e) => updateTargeting({ mode: e.target.value as TargetMode })}
          >
            {targetModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <FieldError error={getError('targeting.mode')} />
        </label>
        <label>
          <div>Target Count</div>
          <input
            type="number"
            value={skill.targeting.count ?? ''}
            onChange={(e) => updateTargeting({ count: e.target.value === '' ? undefined : Number(e.target.value) })}
            min={1}
          />
        </label>
        <label>
          <div>Target Metric</div>
          <select
            value={skill.targeting.ofWhat ?? ''}
            onChange={(e) =>
              updateTargeting({ ofWhat: e.target.value === '' ? undefined : (e.target.value as CompareKey) })
            }
          >
            <option value="">(none)</option>
            {compareKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(skill.targeting.includeDead)}
            onChange={(e) => updateTargeting({ includeDead: e.target.checked })}
          />
          <span>Include Dead Targets</span>
        </label>
      </div>
      <label>
        <div>Description</div>
        <textarea value={skill.desc ?? ''} onChange={(e) => updateSkill({ desc: e.target.value })} rows={3} />
      </label>
      {extras}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{ margin: '8px 0 0' }}>Costs</h4>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label>
            <div>STA</div>
            <input
              type="number"
              value={skill.costs?.sta ?? ''}
              min={0}
              onChange={(e) => updateCostsNumber('sta')(e.target.value)}
            />
          </label>
          <label>
            <div>MP</div>
            <input
              type="number"
              value={skill.costs?.mp ?? ''}
              min={0}
              onChange={(e) => updateCostsNumber('mp')(e.target.value)}
            />
          </label>
          <label>
            <div>Cooldown</div>
            <input
              type="number"
              value={skill.costs?.cooldown ?? ''}
              min={0}
              onChange={(e) => updateCostsNumber('cooldown')(e.target.value)}
            />
          </label>
          <label>
            <div>Charges</div>
            <input
              type="number"
              value={skill.costs?.charges ?? ''}
              min={0}
              onChange={(e) => updateCostsNumber('charges')(e.target.value)}
            />
          </label>
          <label>
            <div>Cost Item ID</div>
            <input value={skill.costs?.item?.id ?? ''} onChange={(e) => updateItemCost('id', e.target.value)} />
            <FieldError error={getError('costs.item')} />
          </label>
          <label>
            <div>Cost Item Qty</div>
            <input
              type="number"
              min={1}
              value={skill.costs?.item?.qty ?? ''}
              onChange={(e) => updateItemCost('qty', e.target.value)}
            />
          </label>
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: '8px 0 0' }}>Effects</h4>
          <button type="button" onClick={addEffect}>
            Add Effect
          </button>
        </div>
        {skill.effects.map((effect, index) => {
          const prefix = `effects.${index}`;
          return (
            <div key={index} className="card" style={{ borderColor: '#ddd', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Effect {index + 1}</strong>
                <button type="button" onClick={() => removeEffect(index)} aria-label={`Remove effect ${index + 1}`}>
                  Remove
                </button>
              </div>
              <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <label>
                  <div>Kind</div>
                  <select
                    value={effect.kind}
                    onChange={(e) => updateEffect(index, { kind: e.target.value as EffectKind })}
                  >
                    {effectKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <FieldError error={getError(`${prefix}.kind`)} />
                </label>
                <label>
                  <div>Value Type</div>
                  <select
                    value={effect.valueType ?? ''}
                    onChange={(e) =>
                      updateEffect(index, {
                        valueType: e.target.value === '' ? undefined : (e.target.value as ValueType),
                      })
                    }
                  >
                    <option value="">(auto)</option>
                    {valueTypes.map((vt) => (
                      <option key={vt} value={vt}>
                        {vt}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Amount</div>
                  <input
                    aria-label={`Effect ${index + 1} Amount`}
                    type="number"
                    value={effect.amount ?? ''}
                    onChange={(e) =>
                      updateEffect(index, { amount: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                  <FieldError error={getError(`${prefix}.amount`)} />
                </label>
                <label>
                  <div>Percent</div>
                  <input
                    type="number"
                    value={effect.percent ?? ''}
                    onChange={(e) =>
                      updateEffect(index, { percent: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  <div>Formula</div>
                  <input
                    value={effect.formula?.expr ?? ''}
                    onChange={(e) => updateEffect(index, { formula: e.target.value ? { expr: e.target.value } : undefined })}
                  />
                  <FieldError error={getError(`${prefix}.formula`)} />
                </label>
                <label>
                  <div>Min</div>
                  <input
                    type="number"
                    value={effect.min ?? ''}
                    onChange={(e) => updateEffect(index, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label>
                  <div>Max</div>
                  <input
                    type="number"
                    value={effect.max ?? ''}
                    onChange={(e) => updateEffect(index, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label>
                  <div>Element</div>
                  <input value={effect.element ?? ''} onChange={(e) => updateEffect(index, { element: e.target.value })} />
                </label>
                <label>
                  <div>Resource</div>
                  <select
                    value={effect.resource ?? ''}
                    onChange={(e) =>
                      updateEffect(index, {
                        resource: e.target.value === '' ? undefined : (e.target.value as Resource),
                      })
                    }
                  >
                    <option value="">(none)</option>
                    {resources.map((resource) => (
                      <option key={resource} value={resource}>
                        {resource}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Stat</div>
                  <select
                    value={(effect as any).stat ?? ''}
                    onChange={(e) => updateEffect(index, { stat: e.target.value === '' ? undefined : (e.target.value as any) })}
                  >
                    <option value="">(none)</option>
                    {statKeys.map((stat) => (
                      <option key={stat} value={stat}>
                        {stat}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Status ID</div>
                  <input value={effect.statusId ?? ''} onChange={(e) => updateEffect(index, { statusId: e.target.value })} />
                </label>
                <label>
                  <div>Status Turns</div>
                  <input
                    type="number"
                    value={effect.statusTurns ?? ''}
                    onChange={(e) =>
                      updateEffect(index, { statusTurns: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                    min={0}
                  />
                </label>
                <label>
                  <div>Shield ID</div>
                  <input value={effect.shieldId ?? ''} onChange={(e) => updateEffect(index, { shieldId: e.target.value })} />
                </label>
                <label className="row" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(effect.canMiss)}
                    onChange={(e) => updateEffect(index, { canMiss: e.target.checked })}
                  />
                  <span>Can Miss</span>
                </label>
                <label className="row" style={{ alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(effect.canCrit)}
                    onChange={(e) => updateEffect(index, { canCrit: e.target.checked })}
                  />
                  <span>Can Crit</span>
                </label>
              </div>
            </div>
          );
        })}
        <FieldError error={getError('effects')} />
      </section>
    </div>
  );
}

interface ItemFormProps {
  item: ItemDef;
  onChange(next: ItemDef): void;
  errors: Record<string, string[]>;
}

function ItemForm({ item, onChange, errors }: ItemFormProps) {
  const updateItem = (patch: Partial<ItemDef>) => {
    onChange({ ...item, ...patch, type: 'item' });
  };

  const extras = (
    <label className="row" style={{ alignItems: 'center', gap: 6 }}>
      <input
        type="checkbox"
        checked={Boolean(item.consumable)}
        onChange={(e) => updateItem({ consumable: e.target.checked })}
      />
      <span>Consumable</span>
    </label>
  );

  return (
    <SkillForm
      kind="item"
      title="Item Details"
      skill={item as unknown as SkillDef}
      onChange={(skill) => updateItem(skill as unknown as ItemDef)}
      errors={errors}
      extras={extras}
    />
  );
}

interface ClassFormProps {
  clazz: ClassFormValue;
  onChange(next: ClassFormValue): void;
  errors: Record<string, string[]>;
}

function ClassForm({ clazz, onChange, errors }: ClassFormProps) {
  const update = (patch: Partial<ClassFormValue>) => {
    onChange({ ...clazz, ...patch });
  };

  const updateStat = (key: keyof ClassPreset) => (value: string) => {
    const num = Number(value);
    update({ [key]: Number.isFinite(num) ? num : 0 } as Partial<ClassFormValue>);
  };

  const updateSkill = (index: number, value: string) => {
    const next = clazz.skills.slice();
    next[index] = value;
    update({ skills: next });
  };

  const addSkill = () => {
    update({ skills: [...clazz.skills, ''] });
  };

  const removeSkill = (index: number) => {
    const next = clazz.skills.filter((_, i) => i !== index);
    update({ skills: next });
  };

  const updateStartItem = (index: number, patch: Partial<{ id: string; qty: number }>) => {
    const next = clazz.startItems.map((item, i) => (i === index ? { ...item, ...patch } : item));
    update({ startItems: next });
  };

  const addStartItem = () => {
    update({ startItems: [...clazz.startItems, { id: '', qty: 1 }] });
  };

  const removeStartItem = (index: number) => {
    update({ startItems: clazz.startItems.filter((_, i) => i !== index) });
  };

  const getError = (path: string) => errors[path];

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Class Details</h3>
      <FieldError error={getError('__root__')} />
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>Class ID</div>
          <input aria-label="Class ID" value={clazz.id} onChange={(e) => update({ id: e.target.value })} />
          <FieldError error={getError('id')} />
        </label>
        <label>
          <div>Max HP</div>
          <input type="number" aria-label="Max HP" value={clazz.maxHp} onChange={(e) => updateStat('maxHp')(e.target.value)} />
          <FieldError error={getError('maxHp')} />
        </label>
        <label>
          <div>Max STA</div>
          <input type="number" aria-label="Max STA" value={clazz.maxSta} onChange={(e) => updateStat('maxSta')(e.target.value)} />
          <FieldError error={getError('maxSta')} />
        </label>
        <label>
          <div>Max MP</div>
          <input type="number" aria-label="Max MP" value={clazz.maxMp} onChange={(e) => updateStat('maxMp')(e.target.value)} />
          <FieldError error={getError('maxMp')} />
        </label>
        <label>
          <div>Attack</div>
          <input type="number" aria-label="Attack" value={clazz.atk} onChange={(e) => updateStat('atk')(e.target.value)} />
          <FieldError error={getError('atk')} />
        </label>
        <label>
          <div>Defense</div>
          <input type="number" aria-label="Defense" value={clazz.def} onChange={(e) => updateStat('def')(e.target.value)} />
          <FieldError error={getError('def')} />
        </label>
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Class Skills</h4>
          <button type="button" onClick={addSkill}>
            Add Skill
          </button>
        </div>
        {clazz.skills.length === 0 && <div style={{ color: '#666' }}>No class skills yet.</div>}
        {clazz.skills.map((skillId, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Skill ${index + 1}`}</div>
              <input
                aria-label={`Class Skill ${index + 1}`}
                value={skillId}
                onChange={(e) => updateSkill(index, e.target.value)}
              />
              <FieldError error={getError(`skills.${index}`)} />
            </label>
            <button type="button" onClick={() => removeSkill(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Starting Items</h4>
          <button type="button" onClick={addStartItem}>
            Add Item
          </button>
        </div>
        {clazz.startItems.length === 0 && <div style={{ color: '#666' }}>No starting items yet.</div>}
        {clazz.startItems.map((item, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Item ${index + 1} ID`}</div>
              <input
                aria-label={`Start Item ${index + 1} ID`}
                value={item.id}
                onChange={(e) => updateStartItem(index, { id: e.target.value })}
              />
              <FieldError error={getError(`startItems.${index}.id`)} />
            </label>
            <label>
              <div>{`Item ${index + 1} Quantity`}</div>
              <input
                type="number"
                aria-label={`Start Item ${index + 1} Quantity`}
                value={item.qty}
                onChange={(e) => updateStartItem(index, { qty: Number(e.target.value) || 0 })}
                min={0}
              />
              <FieldError error={getError(`startItems.${index}.qty`)} />
            </label>
            <button type="button" onClick={() => removeStartItem(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

interface StatusFormProps {
  status: StatusDef;
  onChange(next: StatusDef): void;
  errors: Record<string, string[]>;
}

function StatusForm({ status, onChange, errors }: StatusFormProps) {
  const updateStatus = (patch: Partial<StatusDef>) => {
    onChange({ ...status, ...patch });
  };

  const tags = status.tags ?? [];

  const updateTag = (index: number, value: string) => {
    const next = tags.slice();
    next[index] = value;
    updateStatus({ tags: next });
  };

  const addTag = () => updateStatus({ tags: [...tags, ''] });
  const removeTag = (index: number) => updateStatus({ tags: tags.filter((_, i) => i !== index) });

  const getError = (path: string) => errors[path];

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Status Details</h3>
      <FieldError error={getError('__root__')} />
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>Status ID</div>
          <input aria-label="Status ID" value={status.id} onChange={(e) => updateStatus({ id: e.target.value })} />
          <FieldError error={getError('id')} />
        </label>
        <label>
          <div>Status Name</div>
          <input aria-label="Status Name" value={status.name} onChange={(e) => updateStatus({ name: e.target.value })} />
          <FieldError error={getError('name')} />
        </label>
        <label>
          <div>Icon</div>
          <input value={status.icon ?? ''} onChange={(e) => updateStatus({ icon: e.target.value })} />
        </label>
        <label>
          <div>Stack Rule</div>
          <select
            value={status.stackRule ?? ''}
            onChange={(e) => updateStatus({ stackRule: e.target.value === '' ? undefined : (e.target.value as StackRule) })}
          >
            <option value="">(none)</option>
            {stackRules.map((rule) => (
              <option key={rule} value={rule}>
                {rule}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div>Max Stacks</div>
          <input
            type="number"
            value={status.maxStacks ?? ''}
            min={1}
            onChange={(e) =>
              updateStatus({ maxStacks: e.target.value === '' ? undefined : Number(e.target.value) || undefined })
            }
          />
          <FieldError error={getError('maxStacks')} />
        </label>
        <label>
          <div>Duration (Turns)</div>
          <input
            type="number"
            value={status.durationTurns ?? ''}
            min={0}
            onChange={(e) =>
              updateStatus({ durationTurns: e.target.value === '' ? undefined : Number(e.target.value) || undefined })
            }
          />
          <FieldError error={getError('durationTurns')} />
        </label>
      </div>
      <label>
        <div>Description</div>
        <textarea value={status.desc ?? ''} onChange={(e) => updateStatus({ desc: e.target.value })} rows={3} />
      </label>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Tags</h4>
          <button type="button" onClick={addTag}>
            Add Tag
          </button>
        </div>
        {tags.length === 0 && <div style={{ color: '#666' }}>No tags yet.</div>}
        {tags.map((tag, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Tag ${index + 1}`}</div>
              <input
                aria-label={`Status Tag ${index + 1}`}
                value={tag}
                onChange={(e) => updateTag(index, e.target.value)}
              />
              <FieldError error={getError(`tags.${index}`)} />
            </label>
            <button type="button" onClick={() => removeTag(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <JsonEditor
        label="Modifiers"
        value={status.modifiers}
        onChange={(value) => updateStatus({ modifiers: value as StatusDef['modifiers'] | undefined })}
        errors={getError('modifiers')}
        description="JSON object for stat adjustments, shields, and related metadata."
      />
      <JsonEditor
        label="Hooks"
        value={status.hooks}
        onChange={(value) => updateStatus({ hooks: value as StatusDef['hooks'] | undefined })}
        errors={getError('hooks')}
        description="JSON object describing trigger effects (onTurnStart, onApply, etc.)."
      />
    </div>
  );
}

interface EnemyFormProps {
  enemy: EnemyFormValue;
  onChange(next: EnemyFormValue): void;
  errors: Record<string, string[]>;
}

function EnemyForm({ enemy, onChange, errors }: EnemyFormProps) {
  const updateEnemy = (patch: Partial<EnemyFormValue>) => {
    onChange({ ...enemy, ...patch });
  };

  const updateStatBlock = (block: 'base' | 'scale', key: keyof EnemyDef['base']) => (value: string) => {
    const num = Number(value);
    const nextBlock = { ...enemy[block], [key]: Number.isFinite(num) ? num : 0 } as EnemyDef['base'];
    updateEnemy({ [block]: nextBlock } as Partial<EnemyFormValue>);
  };

  const skills = enemy.skills ?? [];
  const updateSkill = (index: number, value: string) => {
    const next = skills.slice();
    next[index] = value;
    updateEnemy({ skills: next });
  };
  const addSkill = () => updateEnemy({ skills: [...skills, ''] });
  const removeSkill = (index: number) => updateEnemy({ skills: skills.filter((_, i) => i !== index) });

  const items = enemy.items ?? [];
  const updateItem = (index: number, patch: Partial<{ id: string; qty: number }>) => {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    updateEnemy({ items: next });
  };
  const addItem = () => updateEnemy({ items: [...items, { id: '', qty: 1 }] });
  const removeItem = (index: number) => updateEnemy({ items: items.filter((_, i) => i !== index) });

  const tags = enemy.tags ?? [];
  const updateTag = (index: number, value: string) => {
    const next = tags.slice();
    next[index] = value;
    updateEnemy({ tags: next });
  };
  const addTag = () => updateEnemy({ tags: [...tags, ''] });
  const removeTag = (index: number) => updateEnemy({ tags: tags.filter((_, i) => i !== index) });

  const updateAi = (patch: Partial<NonNullable<EnemyDef['ai']>>) => {
    const next = { ...(enemy.ai ?? {}) } as NonNullable<EnemyDef['ai']>;
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value) && value.length === 0) {
        delete (next as any)[key];
      } else if (value === undefined) {
        delete (next as any)[key];
      } else {
        (next as any)[key] = value;
      }
    }
    const keys = Object.keys(next);
    updateEnemy({ ai: keys.length === 0 ? undefined : next });
  };

  const preferTags = enemy.ai?.preferTags ?? [];
  const avoidTags = enemy.ai?.avoidTags ?? [];

  const getError = (path: string) => errors[path];

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Enemy Details</h3>
      <FieldError error={getError('__root__')} />
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>Enemy ID</div>
          <input aria-label="Enemy ID" value={enemy.id} onChange={(e) => updateEnemy({ id: e.target.value })} />
          <FieldError error={getError('id')} />
        </label>
        <label>
          <div>Enemy Name</div>
          <input aria-label="Enemy Name" value={enemy.name} onChange={(e) => updateEnemy({ name: e.target.value })} />
          <FieldError error={getError('name')} />
        </label>
        <label>
          <div>Color</div>
          <input
            type="number"
            aria-label="Enemy Color"
            value={enemy.color}
            onChange={(e) => updateEnemy({ color: Number(e.target.value) || 0 })}
          />
          <FieldError error={getError('color')} />
        </label>
      </div>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <h4 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>Base Stats</h4>
        {(['maxHp', 'maxSta', 'maxMp', 'atk', 'def'] as (keyof EnemyDef['base'])[]).map((key) => (
          <label key={`base-${key}`}>
            <div>{key}</div>
            <input type="number" value={enemy.base[key]} onChange={(e) => updateStatBlock('base', key)(e.target.value)} />
            <FieldError error={getError(`base.${key}`)} />
          </label>
        ))}
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <h4 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>Scaling Per Level</h4>
        {(['maxHp', 'maxSta', 'maxMp', 'atk', 'def'] as (keyof EnemyDef['scale'])[]).map((key) => (
          <label key={`scale-${key}`}>
            <div>{key}</div>
            <input type="number" value={enemy.scale[key]} onChange={(e) => updateStatBlock('scale', key)(e.target.value)} />
            <FieldError error={getError(`scale.${key}`)} />
          </label>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Skills</h4>
          <button type="button" onClick={addSkill}>
            Add Skill
          </button>
        </div>
        {skills.length === 0 && <div style={{ color: '#666' }}>No skills yet.</div>}
        {skills.map((skillId, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Skill ${index + 1}`}</div>
              <input
                aria-label={`Enemy Skill ${index + 1}`}
                value={skillId}
                onChange={(e) => updateSkill(index, e.target.value)}
              />
              <FieldError error={getError(`skills.${index}`)} />
            </label>
            <button type="button" onClick={() => removeSkill(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Loot Table</h4>
          <button type="button" onClick={addItem}>
            Add Drop
          </button>
        </div>
        {items.length === 0 && <div style={{ color: '#666' }}>No drops yet.</div>}
        {items.map((item, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Drop ${index + 1} ID`}</div>
              <input
                aria-label={`Enemy Drop ${index + 1} ID`}
                value={item.id}
                onChange={(e) => updateItem(index, { id: e.target.value })}
              />
              <FieldError error={getError(`items.${index}.id`)} />
            </label>
            <label>
              <div>{`Quantity`}</div>
              <input
                type="number"
                aria-label={`Enemy Drop ${index + 1} Quantity`}
                value={item.qty}
                onChange={(e) => updateItem(index, { qty: Number(e.target.value) || 0 })}
                min={0}
              />
              <FieldError error={getError(`items.${index}.qty`)} />
            </label>
            <button type="button" onClick={() => removeItem(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Tags</h4>
          <button type="button" onClick={addTag}>
            Add Tag
          </button>
        </div>
        {tags.length === 0 && <div style={{ color: '#666' }}>No tags yet.</div>}
        {tags.map((tag, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Tag ${index + 1}`}</div>
              <input value={tag} onChange={(e) => updateTag(index, e.target.value)} />
              <FieldError error={getError(`tags.${index}`)} />
            </label>
            <button type="button" onClick={() => removeTag(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{ margin: 0 }}>AI Preferences</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <strong>Prefer Tags</strong>
            <button type="button" style={{ marginLeft: 8 }} onClick={() => updateAi({ preferTags: [...preferTags, ''] })}>
              Add
            </button>
          </div>
          {preferTags.length === 0 && <div style={{ color: '#666' }}>None</div>}
          {preferTags.map((tag, index) => (
            <div key={`prefer-${index}`} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <div>{`Prefer Tag ${index + 1}`}</div>
                <input value={tag} onChange={(e) => updateAi({ preferTags: preferTags.map((t, i) => (i === index ? e.target.value : t)) })} />
                <FieldError error={getError(`ai.preferTags.${index}`)} />
              </label>
              <button
                type="button"
                onClick={() => updateAi({ preferTags: preferTags.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <strong>Avoid Tags</strong>
            <button type="button" style={{ marginLeft: 8 }} onClick={() => updateAi({ avoidTags: [...avoidTags, ''] })}>
              Add
            </button>
          </div>
          {avoidTags.length === 0 && <div style={{ color: '#666' }}>None</div>}
          {avoidTags.map((tag, index) => (
            <div key={`avoid-${index}`} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <div>{`Avoid Tag ${index + 1}`}</div>
                <input value={tag} onChange={(e) => updateAi({ avoidTags: avoidTags.map((t, i) => (i === index ? e.target.value : t)) })} />
                <FieldError error={getError(`ai.avoidTags.${index}`)} />
              </label>
              <button
                type="button"
                onClick={() => updateAi({ avoidTags: avoidTags.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

interface NpcFormProps {
  npc: NPCDef;
  onChange(next: NPCDef): void;
  errors: Record<string, string[]>;
}

function NpcForm({ npc, onChange, errors }: NpcFormProps) {
  const updateNpc = (patch: Partial<NPCDef>) => {
    onChange({ ...npc, ...patch });
  };

  const updateWander = (patch: Partial<NonNullable<NPCDef['wander']>>) => {
    const next = { ...(npc.wander ?? {}) } as NonNullable<NPCDef['wander']>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') {
        delete (next as any)[key];
      } else {
        (next as any)[key] = value;
      }
    }
    const hasContent = Object.keys(next).length > 0;
    updateNpc({ wander: hasContent ? next : undefined });
  };

  const setTrainer = (patch: Partial<NonNullable<NPCDef['trainer']>> | undefined) => {
    const next = { ...(npc.trainer ?? {}) } as NonNullable<NPCDef['trainer']>;
    if (!patch) {
      updateNpc({ trainer: undefined });
      return;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          delete (next as any)[key];
        } else {
          (next as any)[key] = value;
        }
      } else if (value && typeof value === 'object') {
        if (Object.keys(value).length === 0) {
          delete (next as any)[key];
        } else {
          (next as any)[key] = value;
        }
      } else if (value === undefined || value === '') {
        delete (next as any)[key];
      } else {
        (next as any)[key] = value;
      }
    }
    const hasContent = Object.keys(next).length > 0;
    updateNpc({ trainer: hasContent ? next : undefined });
  };

  const setDialogue = (patch: Partial<NonNullable<NPCDef['dialogue']>>) => {
    const next = { ...(npc.dialogue ?? {}) } as NonNullable<NPCDef['dialogue']>;
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          delete (next as any)[key];
        } else {
          (next as any)[key] = value;
        }
      } else if (value && typeof value === 'object') {
        if (Object.keys(value).length === 0) {
          delete (next as any)[key];
        } else {
          (next as any)[key] = value;
        }
      } else if (value === undefined || value === '') {
        delete (next as any)[key];
      } else {
        (next as any)[key] = value;
      }
    }
    const hasContent = Object.keys(next).length > 0;
    updateNpc({ dialogue: hasContent ? next : undefined });
  };

  const inventory = (npc.inventory ?? []) as NonNullable<NPCDef['inventory']>;
  const updateInventoryItem = (
    index: number,
    patch: Partial<NonNullable<NPCDef['inventory']>[number]>,
  ) => {
    const next = inventory.map((item, i) => (i === index ? { ...item, ...patch } : item));
    updateNpc({ inventory: next });
  };
  const addInventoryItem = () => updateNpc({ inventory: [...inventory, { id: '', qty: 1 }] });
  const removeInventoryItem = (index: number) => updateNpc({ inventory: inventory.filter((_, i) => i !== index) });

  const trainer = (npc.trainer ?? { teaches: [] as string[] }) as NonNullable<NPCDef['trainer']>;
  const teaches = trainer.teaches ?? [];
  const priceEntries = Object.entries(trainer.priceBySkill ?? {}) as [string, number][];
  const setPriceEntries = (entries: [string, number][]) => {
    const record: Record<string, number> = {};
    entries.forEach(([key, value]) => {
      record[key] = value;
    });
    setTrainer({ priceBySkill: Object.keys(record).length ? record : undefined });
  };

  const dialogueLines = npc.dialogue?.lines ?? [];

  const getError = (path: string) => errors[path];

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>NPC Details</h3>
      <FieldError error={getError('__root__')} />
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>NPC ID</div>
          <input aria-label="NPC ID" value={npc.id} onChange={(e) => updateNpc({ id: e.target.value })} />
          <FieldError error={getError('id')} />
        </label>
        <label>
          <div>NPC Name</div>
          <input aria-label="NPC Name" value={npc.name} onChange={(e) => updateNpc({ name: e.target.value })} />
          <FieldError error={getError('name')} />
        </label>
        <label>
          <div>Kind</div>
          <select value={npc.kind} onChange={(e) => updateNpc({ kind: e.target.value as NPCDef['kind'] })}>
            {npcKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <FieldError error={getError('kind')} />
        </label>
        <label>
          <div>Respawn Turns</div>
          <input
            type="number"
            value={npc.respawnTurns ?? ''}
            onChange={(e) =>
              updateNpc({ respawnTurns: e.target.value === '' ? undefined : Number(e.target.value) || undefined })
            }
            min={0}
          />
          <FieldError error={getError('respawnTurns')} />
        </label>
      </div>
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>
          <div>Wander Speed</div>
          <input
            type="number"
            value={npc.wander?.speed ?? ''}
            min={0}
            onChange={(e) =>
              updateWander({ speed: e.target.value === '' ? undefined : Number(e.target.value) || undefined })
            }
          />
          <FieldError error={getError('wander.speed')} />
        </label>
        <label>
          <div>Wander Region</div>
          <input value={npc.wander?.region ?? ''} onChange={(e) => updateWander({ region: e.target.value })} />
          <FieldError error={getError('wander.region')} />
        </label>
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Inventory</h4>
          <button type="button" onClick={addInventoryItem}>
            Add Item
          </button>
        </div>
        {inventory.length === 0 && <div style={{ color: '#666' }}>No inventory items yet.</div>}
        {inventory.map((item, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 160px' }}>
              <div>{`Item ${index + 1} ID`}</div>
              <input
                aria-label={`NPC Item ${index + 1} ID`}
                value={item.id ?? ''}
                onChange={(e) => updateInventoryItem(index, { id: e.target.value })}
              />
              <FieldError error={getError(`inventory.${index}.id`)} />
            </label>
            <label>
              <div>Quantity</div>
              <input
                type="number"
                aria-label={`NPC Item ${index + 1} Quantity`}
                value={item.qty ?? 0}
                onChange={(e) => updateInventoryItem(index, { qty: Number(e.target.value) || 0 })}
                min={0}
              />
              <FieldError error={getError(`inventory.${index}.qty`)} />
            </label>
            <label>
              <div>Price</div>
              <input
                type="number"
                value={item.price ?? ''}
                onChange={(e) => updateInventoryItem(index, { price: e.target.value === '' ? undefined : Number(e.target.value) })}
                min={0}
              />
              <FieldError error={getError(`inventory.${index}.price`)} />
            </label>
            <label>
              <div>Rarity</div>
              <select
                value={item.rarity ?? ''}
                onChange={(e) => {
                  const value = e.target.value as (typeof inventoryRarities)[number] | '';
                  updateInventoryItem(index, { rarity: value === '' ? undefined : value });
                }}
              >
                <option value="">None</option>
                {inventoryRarities.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {rarity}
                  </option>
                ))}
              </select>
              <FieldError error={getError(`inventory.${index}.rarity`)} />
            </label>
            <button type="button" onClick={() => removeInventoryItem(index)}>
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{ margin: 0 }}>Trainer</h4>
        <label>
          <div>Trainer Class</div>
          <input value={trainer.clazz ?? ''} onChange={(e) => setTrainer({ clazz: e.target.value })} />
        </label>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 style={{ margin: 0 }}>Teaches Skills</h5>
          <button type="button" onClick={() => setTrainer({ teaches: [...teaches, ''] })}>
            Add Skill
          </button>
        </div>
        {teaches.length === 0 && <div style={{ color: '#666' }}>No skills taught yet.</div>}
        {teaches.map((skill, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Skill ${index + 1}`}</div>
              <input
                aria-label={`Trainer Skill ${index + 1}`}
                value={skill}
                onChange={(e) => setTrainer({ teaches: teaches.map((s, i) => (i === index ? e.target.value : s)) })}
              />
              <FieldError error={getError(`trainer.teaches.${index}`)} />
            </label>
            <button type="button" onClick={() => setTrainer({ teaches: teaches.filter((_, i) => i !== index) })}>
              Remove
            </button>
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h5 style={{ margin: 0 }}>Skill Prices</h5>
          <button type="button" onClick={() => setPriceEntries([...priceEntries, ['', 0]])}>
            Add Price
          </button>
        </div>
        {priceEntries.length === 0 && <div style={{ color: '#666' }}>No price overrides.</div>}
        {priceEntries.map(([skillId, price], index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Skill ${index + 1} ID`}</div>
              <input
                aria-label={`Trainer Price ${index + 1} Skill`}
                value={skillId}
                onChange={(e) => {
                  const next = priceEntries.slice();
                  next[index] = [e.target.value, price];
                  setPriceEntries(next);
                }}
              />
              <FieldError error={getError(`trainer.priceBySkill.${skillId || ''}`)} />
            </label>
            <label>
              <div>Price</div>
              <input
                type="number"
                aria-label={`Trainer Price ${index + 1} Amount`}
                value={price}
                onChange={(e) => {
                  const next = priceEntries.slice();
                  next[index] = [skillId, Number(e.target.value) || 0];
                  setPriceEntries(next);
                }}
                min={0}
              />
            </label>
            <button
              type="button"
              onClick={() => setPriceEntries(priceEntries.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Dialogue Lines</h4>
          <button type="button" onClick={() => setDialogue({ lines: [...dialogueLines, ''] })}>
            Add Line
          </button>
        </div>
        {dialogueLines.length === 0 && <div style={{ color: '#666' }}>No dialogue lines yet.</div>}
        {dialogueLines.map((line, index) => (
          <div key={index} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <div>{`Line ${index + 1}`}</div>
              <input
                aria-label={`Dialogue Line ${index + 1}`}
                value={line}
                onChange={(e) =>
                  setDialogue({ lines: dialogueLines.map((l, i) => (i === index ? e.target.value : l)) })
                }
              />
              <FieldError error={getError(`dialogue.lines.${index}`)} />
            </label>
            <button type="button" onClick={() => setDialogue({ lines: dialogueLines.filter((_, i) => i !== index) })}>
              Remove
            </button>
          </div>
        ))}
        <JsonEditor
          label="Dialogue Options"
          value={npc.dialogue?.options}
          onChange={(value) => setDialogue({ options: value as NonNullable<NPCDef['dialogue']>['options'] | undefined })}
          errors={getError('dialogue.options')}
          description="Optional interactive options with text and action arrays."
        />
      </section>
    </div>
  );
}

interface BalanceFormProps {
  balance: Balance;
  onChange(next: Balance): void;
  errors: Record<string, string[]>;
}

function BalanceForm({ balance, onChange, errors }: BalanceFormProps) {
  const updateBalance = (patch: Partial<Balance>) => {
    onChange({ ...balance, ...patch });
  };

  const updateNumber = (key: keyof Balance) => (value: string) => {
    const num = Number(value);
    updateBalance({ [key]: Number.isFinite(num) ? num : 0 } as Partial<Balance>);
  };

  const updateEconomy = (patch: Partial<Balance['ECONOMY']>) => {
    updateBalance({ ECONOMY: { ...balance.ECONOMY, ...patch } });
  };

  const updatePrice = (rarity: string, value: string) => {
    const num = Number(value);
    updateEconomy({ priceByRarity: { ...balance.ECONOMY.priceByRarity, [rarity]: Number.isFinite(num) ? num : 0 } });
  };

  const updateXpCurve = (patch: Partial<Balance['XP_CURVE']>) => {
    updateBalance({ XP_CURVE: { ...balance.XP_CURVE, ...patch } });
  };

  const updateGoldDrop = (patch: Partial<Balance['GOLD_DROP']>) => {
    updateBalance({ GOLD_DROP: { ...balance.GOLD_DROP, ...patch } });
  };

  const getError = (path: string) => errors[path];

  const skillSlotsString = balance.SKILL_SLOTS_BY_LEVEL.join(', ');

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Balance Settings</h3>
      <FieldError error={getError('__root__')} />
      <section className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label>
          <div>Base Hit Chance</div>
          <input type="number" value={balance.BASE_HIT} step="0.01" onChange={(e) => updateNumber('BASE_HIT')(e.target.value)} />
          <FieldError error={getError('BASE_HIT')} />
        </label>
        <label>
          <div>Base Crit Chance</div>
          <input type="number" value={balance.BASE_CRIT} step="0.01" onChange={(e) => updateNumber('BASE_CRIT')(e.target.value)} />
          <FieldError error={getError('BASE_CRIT')} />
        </label>
        <label>
          <div>Crit Multiplier</div>
          <input type="number" value={balance.CRIT_MULT} step="0.01" onChange={(e) => updateNumber('CRIT_MULT')(e.target.value)} />
          <FieldError error={getError('CRIT_MULT')} />
        </label>
        <label>
          <div>Dodge Floor</div>
          <input type="number" value={balance.DODGE_FLOOR} step="0.01" onChange={(e) => updateNumber('DODGE_FLOOR')(e.target.value)} />
          <FieldError error={getError('DODGE_FLOOR')} />
        </label>
        <label>
          <div>Hit Ceiling</div>
          <input type="number" value={balance.HIT_CEIL} step="0.01" onChange={(e) => updateNumber('HIT_CEIL')(e.target.value)} />
          <FieldError error={getError('HIT_CEIL')} />
        </label>
        <label>
          <div>Flee Base Chance</div>
          <input type="number" value={balance.FLEE_BASE} step="0.01" onChange={(e) => updateNumber('FLEE_BASE')(e.target.value)} />
          <FieldError error={getError('FLEE_BASE')} />
        </label>
        <label>
          <div>Loot Rolls</div>
          <input type="number" value={balance.LOOT_ROLLS} onChange={(e) => updateNumber('LOOT_ROLLS')(e.target.value)} />
          <FieldError error={getError('LOOT_ROLLS')} />
        </label>
        <label>
          <div>Level Unlock Interval</div>
          <input
            type="number"
            value={balance.LEVEL_UNLOCK_INTERVAL}
            onChange={(e) => updateNumber('LEVEL_UNLOCK_INTERVAL')(e.target.value)}
          />
          <FieldError error={getError('LEVEL_UNLOCK_INTERVAL')} />
        </label>
      </section>
      <section className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <h4 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>Economy</h4>
        <label>
          <div>Buy Multiplier</div>
          <input
            type="number"
            value={balance.ECONOMY.buyMult}
            step="0.01"
            onChange={(e) => updateEconomy({ buyMult: Number(e.target.value) || 0 })}
          />
          <FieldError error={getError('ECONOMY.buyMult')} />
        </label>
        <label>
          <div>Sell Multiplier</div>
          <input
            type="number"
            value={balance.ECONOMY.sellMult}
            step="0.01"
            onChange={(e) => updateEconomy({ sellMult: Number(e.target.value) || 0 })}
          />
          <FieldError error={getError('ECONOMY.sellMult')} />
        </label>
        <label>
          <div>Restock Turns</div>
          <input type="number" value={balance.ECONOMY.restockTurns} onChange={(e) => updateEconomy({ restockTurns: Number(e.target.value) || 0 })} />
          <FieldError error={getError('ECONOMY.restockTurns')} />
        </label>
        {Object.entries(balance.ECONOMY.priceByRarity).map(([rarity, value]) => (
          <label key={rarity}>
            <div>{`Price (${rarity})`}</div>
            <input type="number" value={value} onChange={(e) => updatePrice(rarity, e.target.value)} />
            <FieldError error={getError(`ECONOMY.priceByRarity.${rarity}`)} />
          </label>
        ))}
      </section>
      <section className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <h4 style={{ gridColumn: '1 / -1', marginBottom: 0 }}>Progression</h4>
        <label>
          <div>XP Base</div>
          <input type="number" value={balance.XP_CURVE.base} onChange={(e) => updateXpCurve({ base: Number(e.target.value) || 0 })} />
          <FieldError error={getError('XP_CURVE.base')} />
        </label>
        <label>
          <div>XP Growth</div>
          <input type="number" value={balance.XP_CURVE.growth} onChange={(e) => updateXpCurve({ growth: Number(e.target.value) || 0 })} />
          <FieldError error={getError('XP_CURVE.growth')} />
        </label>
        <label>
          <div>Gold Mean</div>
          <input type="number" value={balance.GOLD_DROP.mean} onChange={(e) => updateGoldDrop({ mean: Number(e.target.value) || 0 })} />
          <FieldError error={getError('GOLD_DROP.mean')} />
        </label>
        <label>
          <div>Gold Variance</div>
          <input type="number" value={balance.GOLD_DROP.variance} onChange={(e) => updateGoldDrop({ variance: Number(e.target.value) || 0 })} />
          <FieldError error={getError('GOLD_DROP.variance')} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <div>Skill Slots By Level</div>
          <input
            value={skillSlotsString}
            onChange={(e) => {
              const numbers = e.target.value
                .split(',')
                .map((part) => Number(part.trim()))
                .filter((num) => Number.isFinite(num));
              updateBalance({ SKILL_SLOTS_BY_LEVEL: numbers });
            }}
          />
          <FieldError error={getError('SKILL_SLOTS_BY_LEVEL')} />
        </label>
      </section>
      <JsonEditor
        label="Element Matrix"
        value={balance.ELEMENT_MATRIX}
        onChange={(value) => updateBalance({ ELEMENT_MATRIX: value as Balance['ELEMENT_MATRIX'] | undefined })}
        errors={getError('ELEMENT_MATRIX')}
        description="Nested record of attacker elements vs defender elements."
      />
      <JsonEditor
        label="Resists By Tag"
        value={balance.RESISTS_BY_TAG}
        onChange={(value) => updateBalance({ RESISTS_BY_TAG: value as Balance['RESISTS_BY_TAG'] | undefined })}
        errors={getError('RESISTS_BY_TAG')}
        description="Record mapping enemy tags to damage resistance multipliers."
      />
    </div>
  );
}

interface WorldFormProps {
  elements: string[];
  tags: string[];
  onChangeElements(next: string[]): void;
  onChangeTags(next: string[]): void;
  elementErrors: Record<string, string[]>;
  tagErrors: Record<string, string[]>;
}

function WorldForm({ elements, tags, onChangeElements, onChangeTags, elementErrors, tagErrors }: WorldFormProps) {
  const updateListValue = (
    values: string[],
    index: number,
    value: string,
    setter: (next: string[]) => void,
  ) => {
    const next = values.slice();
    next[index] = value;
    setter(next);
  };

  const addValue = (values: string[], setter: (next: string[]) => void) => setter([...values, '']);
  const removeValue = (values: string[], index: number, setter: (next: string[]) => void) =>
    setter(values.filter((_, i) => i !== index));

  const renderList = (
    title: string,
    label: string,
    values: string[],
    setter: (next: string[]) => void,
    errors: Record<string, string[]>,
    errorPrefix: string,
  ) => (
    <section key={title} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button type="button" onClick={() => addValue(values, setter)}>
          Add {label}
        </button>
      </div>
      {values.length === 0 && <div style={{ color: '#666' }}>No {label.toLowerCase()}s yet.</div>}
      {values.map((value, index) => (
        <div key={`${title}-${index}`} className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            <div>{`${label} ${index + 1}`}</div>
            <input
              aria-label={`${title} ${index + 1}`}
              value={value}
              onChange={(e) => updateListValue(values, index, e.target.value, setter)}
            />
            <FieldError error={errors[`${errorPrefix}.${index}`]} />
          </label>
          <button type="button" onClick={() => removeValue(values, index, setter)}>
            Remove
          </button>
        </div>
      ))}
    </section>
  );

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {renderList('Elements', 'Element', elements, onChangeElements, elementErrors, 'elements')}
      {renderList('Tags', 'Tag', tags, onChangeTags, tagErrors, 'tags')}
    </div>
  );
}

export function AdminPortal() {
  const [config, setConfig] = useState<GameConfig>(() => cloneConfig(load()));
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(() => pickFirst(config.skills));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => pickFirst(config.items));
  const [selectedClassId, setSelectedClassId] = useState<string | null>(() => pickFirst(config.classes));
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(() => pickFirst(config.statuses));
  const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(() => pickFirst(config.enemies));
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(() => pickFirst(config.npcs));
  const [activeTab, setActiveTab] = useState<AdminTabKey>('skills');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe((cfg) => {
      setConfig(cloneConfig(cfg));
    });
    return unsub;
  }, []);

  const classRecords = useMemo(() => {
    const result: Record<string, ClassFormValue> = {};
    for (const [key, preset] of Object.entries(config.classes)) {
      result[key] = {
        id: key,
        maxHp: preset.maxHp,
        maxSta: preset.maxSta,
        maxMp: preset.maxMp,
        atk: preset.atk,
        def: preset.def,
        skills: (config.classSkills[key] ?? []).slice(),
        startItems: (config.startItems[key] ?? []).map((item) => ({ ...item })),
      };
    }
    return result;
  }, [config.classes, config.classSkills, config.startItems]);

  const enemyRecords = useMemo(() => {
    const result: Record<string, EnemyFormValue> = {};
    for (const [key, enemy] of Object.entries(config.enemies)) {
      result[key] = { id: key, ...enemy };
    }
    return result;
  }, [config.enemies]);

  useEffect(() => {
    if (selectedSkillId !== null && config.skills[selectedSkillId]) return;
    setSelectedSkillId((prev) => {
      if (prev !== null && config.skills[prev]) return prev;
      return pickFirst(config.skills);
    });
  }, [config.skills, selectedSkillId]);

  useEffect(() => {
    if (selectedItemId !== null && config.items[selectedItemId]) return;
    setSelectedItemId((prev) => {
      if (prev !== null && config.items[prev]) return prev;
      return pickFirst(config.items);
    });
  }, [config.items, selectedItemId]);

  useEffect(() => {
    if (selectedClassId !== null && classRecords[selectedClassId]) return;
    setSelectedClassId((prev) => {
      if (prev !== null && classRecords[prev]) return prev;
      return pickFirst(classRecords);
    });
  }, [classRecords, selectedClassId]);

  useEffect(() => {
    if (selectedStatusId !== null && config.statuses[selectedStatusId]) return;
    setSelectedStatusId((prev) => {
      if (prev !== null && config.statuses[prev]) return prev;
      return pickFirst(config.statuses);
    });
  }, [config.statuses, selectedStatusId]);

  useEffect(() => {
    if (selectedEnemyId !== null && enemyRecords[selectedEnemyId]) return;
    setSelectedEnemyId((prev) => {
      if (prev !== null && enemyRecords[prev]) return prev;
      return pickFirst(enemyRecords);
    });
  }, [enemyRecords, selectedEnemyId]);

  useEffect(() => {
    if (selectedNpcId !== null && config.npcs[selectedNpcId]) return;
    setSelectedNpcId((prev) => {
      if (prev !== null && config.npcs[prev]) return prev;
      return pickFirst(config.npcs);
    });
  }, [config.npcs, selectedNpcId]);

  const skillValidation = useMemo(() => collectValidation(config.skills, validateSkill), [config.skills]);
  const itemValidation = useMemo(() => collectValidation(config.items, validateItem), [config.items]);
  const classValidation = useMemo(() => collectValidation(classRecords, validateClassEntry), [classRecords]);
  const statusValidation = useMemo(() => collectValidation(config.statuses, validateStatus), [config.statuses]);
  const enemyValidation = useMemo(() => collectValidation(enemyRecords, validateEnemyEntry), [enemyRecords]);
  const npcValidation = useMemo(() => collectValidation(config.npcs, validateNpcEntry), [config.npcs]);
  const balanceValidation = useMemo(() => validateBalance(config.balance), [config.balance]);
  const elementValidation = useMemo(() => validateStringList(config.elements, 'elements'), [config.elements]);
  const tagValidation = useMemo(() => validateStringList(config.tags ?? [], 'tags'), [config.tags]);

  const hasErrors = useMemo(() => {
    const maps = [skillValidation, itemValidation, statusValidation, classValidation, enemyValidation, npcValidation];
    for (const map of maps) {
      for (const result of map.values()) {
        if (!result.success) return true;
      }
    }
    if (!balanceValidation.success) return true;
    if (!elementValidation.success) return true;
    if (!tagValidation.success) return true;
    return false;
  }, [
    skillValidation,
    itemValidation,
    statusValidation,
    classValidation,
    enemyValidation,
    npcValidation,
    balanceValidation,
    elementValidation,
    tagValidation,
  ]);

  const setSkill = (key: string, next: SkillDef) => {
    setConfig((prev) => {
      const nextSkills = { ...prev.skills };
      delete nextSkills[key];
      const finalId = next.id;
      nextSkills[finalId] = { ...next, type: 'skill' };
      setSelectedSkillId(finalId);
      return { ...prev, skills: nextSkills };
    });
  };

  const setItem = (key: string, next: ItemDef) => {
    setConfig((prev) => {
      const nextItems = { ...prev.items };
      delete nextItems[key];
      const finalId = next.id;
      nextItems[finalId] = { ...next, type: 'item' };
      setSelectedItemId(finalId);
      return { ...prev, items: nextItems };
    });
  };

  const setClassEntry = (key: string, next: ClassFormValue) => {
    setConfig((prev) => {
      const nextClasses = { ...prev.classes };
      const nextClassSkills = { ...prev.classSkills };
      const nextStartItems = { ...prev.startItems };
      delete nextClasses[key];
      delete nextClassSkills[key];
      delete nextStartItems[key];
      const { id, skills, startItems, ...preset } = next;
      nextClasses[id] = preset;
      nextClassSkills[id] = skills.map((skillId) => skillId.trim());
      nextStartItems[id] = startItems.map((item) => ({ id: item.id, qty: item.qty }));
      setSelectedClassId(id);
      return { ...prev, classes: nextClasses, classSkills: nextClassSkills, startItems: nextStartItems };
    });
  };

  const setStatusEntry = (key: string, next: StatusDef) => {
    setConfig((prev) => {
      const nextStatuses = { ...prev.statuses };
      delete nextStatuses[key];
      nextStatuses[next.id] = { ...next };
      setSelectedStatusId(next.id);
      return { ...prev, statuses: nextStatuses };
    });
  };

  const setEnemyEntry = (key: string, next: EnemyFormValue) => {
    setConfig((prev) => {
      const nextEnemies = { ...prev.enemies };
      delete nextEnemies[key];
      const { id, ...enemyData } = next;
      nextEnemies[id] = { ...enemyData };
      setSelectedEnemyId(id);
      return { ...prev, enemies: nextEnemies };
    });
  };

  const setNpcEntry = (key: string, next: NPCDef) => {
    setConfig((prev) => {
      const nextNpcs = { ...prev.npcs };
      delete nextNpcs[key];
      nextNpcs[next.id] = { ...next };
      setSelectedNpcId(next.id);
      return { ...prev, npcs: nextNpcs };
    });
  };

  const setBalanceConfig = (next: Balance) => {
    setConfig((prev) => ({ ...prev, balance: next }));
  };

  const setElements = (next: string[]) => {
    setConfig((prev) => ({ ...prev, elements: next }));
  };

  const setTags = (next: string[]) => {
    setConfig((prev) => ({ ...prev, tags: next }));
  };

  const onAddSkill = () => {
    setConfig((prev) => {
      const newSkill = defaultSkill(prev.skills);
      const nextSkills = { ...prev.skills, [newSkill.id]: newSkill };
      setSelectedSkillId(newSkill.id);
      return { ...prev, skills: nextSkills };
    });
  };

  const onAddItem = () => {
    setConfig((prev) => {
      const newItem = defaultItem(prev.items);
      const nextItems = { ...prev.items, [newItem.id]: newItem };
      setSelectedItemId(newItem.id);
      return { ...prev, items: nextItems };
    });
  };

  const onAddClass = () => {
    setConfig((prev) => {
      const entry = defaultClassEntry(prev);
      const { id, skills, startItems, ...preset } = entry;
      const nextClasses = { ...prev.classes, [id]: preset };
      const nextClassSkills = { ...prev.classSkills, [id]: skills };
      const nextStartItems = { ...prev.startItems, [id]: startItems };
      setSelectedClassId(id);
      return { ...prev, classes: nextClasses, classSkills: nextClassSkills, startItems: nextStartItems };
    });
  };

  const onAddStatus = () => {
    setConfig((prev) => {
      const entry = defaultStatus(prev.statuses);
      const nextStatuses = { ...prev.statuses, [entry.id]: entry };
      setSelectedStatusId(entry.id);
      return { ...prev, statuses: nextStatuses };
    });
  };

  const onAddEnemy = () => {
    setConfig((prev) => {
      const entry = defaultEnemyEntry(prev.enemies);
      const { id, ...enemyData } = entry;
      const nextEnemies = { ...prev.enemies, [id]: enemyData };
      setSelectedEnemyId(id);
      return { ...prev, enemies: nextEnemies };
    });
  };

  const onAddNpc = () => {
    setConfig((prev) => {
      const entry = defaultNpcEntry(prev.npcs);
      const nextNpcs = { ...prev.npcs, [entry.id]: entry };
      setSelectedNpcId(entry.id);
      return { ...prev, npcs: nextNpcs };
    });
  };

  const onRemoveSkill = (id: string) => {
    setConfig((prev) => {
      const nextSkills = { ...prev.skills };
      delete nextSkills[id];
      setSelectedSkillId((current) => {
        if (current !== id) return current;
        return pickFirst(nextSkills);
      });
      return { ...prev, skills: nextSkills };
    });
  };

  const onRemoveItem = (id: string) => {
    setConfig((prev) => {
      const nextItems = { ...prev.items };
      delete nextItems[id];
      setSelectedItemId((current) => {
        if (current !== id) return current;
        return pickFirst(nextItems);
      });
      return { ...prev, items: nextItems };
    });
  };

  const onRemoveClass = (id: string) => {
    setConfig((prev) => {
      const nextClasses = { ...prev.classes };
      const nextClassSkills = { ...prev.classSkills };
      const nextStartItems = { ...prev.startItems };
      delete nextClasses[id];
      delete nextClassSkills[id];
      delete nextStartItems[id];
      setSelectedClassId((current) => {
        if (current !== id) return current;
        return pickFirst(nextClasses);
      });
      return { ...prev, classes: nextClasses, classSkills: nextClassSkills, startItems: nextStartItems };
    });
  };

  const onRemoveStatus = (id: string) => {
    setConfig((prev) => {
      const nextStatuses = { ...prev.statuses };
      delete nextStatuses[id];
      setSelectedStatusId((current) => {
        if (current !== id) return current;
        return pickFirst(nextStatuses);
      });
      return { ...prev, statuses: nextStatuses };
    });
  };

  const onRemoveEnemy = (id: string) => {
    setConfig((prev) => {
      const nextEnemies = { ...prev.enemies };
      delete nextEnemies[id];
      setSelectedEnemyId((current) => {
        if (current !== id) return current;
        return pickFirst(nextEnemies);
      });
      return { ...prev, enemies: nextEnemies };
    });
  };

  const onRemoveNpc = (id: string) => {
    setConfig((prev) => {
      const nextNpcs = { ...prev.npcs };
      delete nextNpcs[id];
      setSelectedNpcId((current) => {
        if (current !== id) return current;
        return pickFirst(nextNpcs);
      });
      return { ...prev, npcs: nextNpcs };
    });
  };

  const onSave = () => {
    save(config);
    setStatusMessage('Configuration saved.');
  };

  const onExport = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'game-config.json';
    a.click();
  };

  const onImportFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    importConfig(text);
    setConfig(cloneConfig(load()));
    setStatusMessage('Configuration imported.');
  };

  const onReload = () => {
    setConfig(cloneConfig(load()));
    setStatusMessage('Reloaded from storage.');
  };

  const selectedSkill = selectedSkillId !== null ? config.skills[selectedSkillId] : null;
  const selectedItem = selectedItemId !== null ? config.items[selectedItemId] : null;
  const selectedClass = selectedClassId !== null ? classRecords[selectedClassId] : null;
  const selectedStatus = selectedStatusId !== null ? config.statuses[selectedStatusId] : null;
  const selectedEnemy = selectedEnemyId !== null ? enemyRecords[selectedEnemyId] : null;
  const selectedNpc = selectedNpcId !== null ? config.npcs[selectedNpcId] : null;
  const tagsList = config.tags ?? [];

  const tabs: { key: AdminTabKey; label: string }[] = [
    { key: 'skills', label: 'Skills' },
    { key: 'items', label: 'Items' },
    { key: 'classes', label: 'Classes' },
    { key: 'statuses', label: 'Statuses' },
    { key: 'enemies', label: 'Enemies' },
    { key: 'npcs', label: 'NPCs' },
    { key: 'balance', label: 'Balance' },
    { key: 'world', label: 'World Data' },
  ];

  let mainContent: React.ReactNode;
  if (activeTab === 'skills') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="Skills"
          entries={config.skills}
          selectedId={selectedSkillId}
          onSelect={setSelectedSkillId}
          onAdd={onAddSkill}
          onRemove={onRemoveSkill}
          validation={skillValidation}
          addLabel="Add Skill"
        />
        {selectedSkill ? (
          <SkillForm
            kind="skill"
            title="Skill Details"
            skill={selectedSkill}
            onChange={(next) => setSkill(selectedSkillId ?? next.id, next)}
            errors={skillValidation.get(selectedSkillId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select a skill to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'items') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="Items"
          entries={config.items}
          selectedId={selectedItemId}
          onSelect={setSelectedItemId}
          onAdd={onAddItem}
          onRemove={onRemoveItem}
          validation={itemValidation}
          addLabel="Add Item"
        />
        {selectedItem ? (
          <ItemForm
            item={selectedItem}
            onChange={(next) => setItem(selectedItemId ?? next.id, next)}
            errors={itemValidation.get(selectedItemId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select an item to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'classes') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="Classes"
          entries={classRecords}
          selectedId={selectedClassId}
          onSelect={setSelectedClassId}
          onAdd={onAddClass}
          onRemove={onRemoveClass}
          validation={classValidation}
          addLabel="Add Class"
        />
        {selectedClass ? (
          <ClassForm
            clazz={selectedClass}
            onChange={(next) => setClassEntry(selectedClassId ?? next.id, next)}
            errors={classValidation.get(selectedClassId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select a class to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'statuses') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="Statuses"
          entries={config.statuses}
          selectedId={selectedStatusId}
          onSelect={setSelectedStatusId}
          onAdd={onAddStatus}
          onRemove={onRemoveStatus}
          validation={statusValidation}
          addLabel="Add Status"
        />
        {selectedStatus ? (
          <StatusForm
            status={selectedStatus}
            onChange={(next) => setStatusEntry(selectedStatusId ?? next.id, next)}
            errors={statusValidation.get(selectedStatusId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select a status to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'enemies') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="Enemies"
          entries={enemyRecords}
          selectedId={selectedEnemyId}
          onSelect={setSelectedEnemyId}
          onAdd={onAddEnemy}
          onRemove={onRemoveEnemy}
          validation={enemyValidation}
          addLabel="Add Enemy"
        />
        {selectedEnemy ? (
          <EnemyForm
            enemy={selectedEnemy}
            onChange={(next) => setEnemyEntry(selectedEnemyId ?? next.id, next)}
            errors={enemyValidation.get(selectedEnemyId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select an enemy to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'npcs') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <ActionList
          title="NPCs"
          entries={config.npcs}
          selectedId={selectedNpcId}
          onSelect={setSelectedNpcId}
          onAdd={onAddNpc}
          onRemove={onRemoveNpc}
          validation={npcValidation}
          addLabel="Add NPC"
        />
        {selectedNpc ? (
          <NpcForm
            npc={selectedNpc}
            onChange={(next) => setNpcEntry(selectedNpcId ?? next.id, next)}
            errors={npcValidation.get(selectedNpcId ?? '')?.errors ?? {}}
          />
        ) : (
          <div style={{ padding: 24, color: '#666' }}>Select an NPC to edit.</div>
        )}
      </div>
    );
  } else if (activeTab === 'balance') {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <BalanceForm balance={config.balance} onChange={setBalanceConfig} errors={balanceValidation.errors} />
      </div>
    );
  } else {
    mainContent = (
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <WorldForm
          elements={config.elements}
          tags={tagsList}
          onChangeElements={setElements}
          onChangeTags={setTags}
          elementErrors={elementValidation.errors}
          tagErrors={tagValidation.errors}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>MinMMO Admin CMS</h1>
      <p className="small">All gameplay content is editable here. Changes apply after saving.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onSave} disabled={hasErrors}>
          Save
        </button>
        <button type="button" onClick={onExport}>
          Export JSON
        </button>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input type="file" accept="application/json" onChange={(e) => onImportFile(e.target.files?.[0] ?? undefined)} />
          <span className="small">Import JSON</span>
        </label>
        <button type="button" onClick={onReload}>
          Reload
        </button>
        <div className="row" style={{ marginLeft: 'auto', gap: 8, flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{ fontWeight: activeTab === tab.key ? 700 : 400 }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {statusMessage && (
        <div className="card" style={{ borderColor: '#4a8', color: '#1b4', padding: 12 }}>{statusMessage}</div>
      )}
      {hasErrors && (
        <div className="card" style={{ borderColor: '#d22', color: '#d22', padding: 12 }}>
          Resolve validation errors before saving.
        </div>
      )}
      {mainContent}
    </div>
  );
}

