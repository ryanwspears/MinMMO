import React, { useEffect, useMemo, useState } from 'react';
import {
  load,
  save,
  exportConfig,
  importConfig,
  subscribe,
} from '@config/store';
import type {
  CompareKey,
  Effect,
  EffectKind,
  GameConfig,
  ItemDef,
  Resource,
  SkillDef,
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
] as const satisfies readonly EffectKind[];
const valueTypes = ['flat', 'percent', 'formula'] as const satisfies readonly ValueType[];
const resources = ['hp', 'sta', 'mp'] as const satisfies readonly Resource[];
const statKeys = ['atk', 'def', 'maxHp', 'maxSta', 'maxMp'] as const;

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

export function AdminPortal() {
  const [config, setConfig] = useState<GameConfig>(() => cloneConfig(load()));
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(() => pickFirst(config.skills));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => pickFirst(config.items));
  const [activeTab, setActiveTab] = useState<'skills' | 'items'>('skills');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe((cfg) => {
      setConfig(cloneConfig(cfg));
    });
    return unsub;
  }, []);

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

  const skillValidation = useMemo(() => collectValidation(config.skills, validateSkill), [config.skills]);
  const itemValidation = useMemo(() => collectValidation(config.items, validateItem), [config.items]);

  const hasErrors = useMemo(() => {
    for (const result of skillValidation.values()) {
      if (!result.success) return true;
    }
    for (const result of itemValidation.values()) {
      if (!result.success) return true;
    }
    return false;
  }, [skillValidation, itemValidation]);

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

  const onSave = () => {
    save(config);
    setStatus('Configuration saved.');
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
    setStatus('Configuration imported.');
  };

  const onReload = () => {
    setConfig(cloneConfig(load()));
    setStatus('Reloaded from storage.');
  };

  const selectedSkill = selectedSkillId !== null ? config.skills[selectedSkillId] : null;
  const selectedItem = selectedItemId !== null ? config.items[selectedItemId] : null;

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
        <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            style={{ fontWeight: activeTab === 'skills' ? 700 : 400 }}
          >
            Skills
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('items')}
            style={{ fontWeight: activeTab === 'items' ? 700 : 400 }}
          >
            Items
          </button>
        </div>
      </div>
      {status && (
        <div className="card" style={{ borderColor: '#4a8', color: '#1b4', padding: 12 }}>{status}</div>
      )}
      {hasErrors && (
        <div className="card" style={{ borderColor: '#d22', color: '#d22', padding: 12 }}>
          Resolve validation errors before saving.
        </div>
      )}
      {activeTab === 'skills' ? (
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
      ) : (
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
      )}
    </div>
  );
}
