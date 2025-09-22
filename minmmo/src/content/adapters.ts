import type {
  ActionBase,
  Cost,
  Effect,
  Filter,
  GameConfig,
  ItemDef,
  SkillDef,
  StackRule,
  StatusDef,
  TargetSelector,
  ValueType,
} from '@config/schema';
import type { Actor } from '@engine/battle/types';

export type EnemyFactory = (level: number) => Actor;

type AnyRecord<T> = Record<string, T>;

type Assoc = 'left' | 'right';

export type FormulaContext = Record<string, unknown>;

export type ValueResolver = (user: Actor, target: Actor, ctx: FormulaContext) => number;

interface OperatorConfig {
  precedence: number;
  assoc: Assoc;
  args: number;
  apply: (...args: number[]) => number;
}

interface FunctionConfig {
  arity: number;
  apply: (...args: number[]) => number;
}

interface TokenBase {
  type: string;
}

interface NumberToken extends TokenBase {
  type: 'number';
  value: number;
}

interface IdentifierToken extends TokenBase {
  type: 'identifier';
  value: string;
}

interface OperatorToken extends TokenBase {
  type: 'operator';
  value: keyof typeof OPERATORS;
}

interface FunctionToken extends TokenBase {
  type: 'function';
  name: keyof typeof FUNCTIONS;
}

interface FunctionRpnToken extends TokenBase {
  type: 'function-rpn';
  name: keyof typeof FUNCTIONS;
}

interface ParenToken extends TokenBase {
  type: 'paren';
  value: '(' | ')';
}

interface CommaToken extends TokenBase {
  type: 'comma';
}

type Token =
  | NumberToken
  | IdentifierToken
  | OperatorToken
  | FunctionToken
  | FunctionRpnToken
  | ParenToken
  | CommaToken;

export interface RuntimeCost {
  sta: number;
  mp: number;
  item?: { id: string; qty: number };
  cooldown: number;
  charges?: number;
}

export interface RuntimeTargetSelector extends TargetSelector {
  includeDead: boolean;
  condition?: Filter;
}

export interface RuntimeValue {
  kind: ValueType;
  resolve: ValueResolver;
  rawAmount?: number;
  rawPercent?: number;
  expr?: string;
  min?: number;
  max?: number;
}

export interface RuntimeEffect
  extends Omit<Effect, 'valueType' | 'amount' | 'percent' | 'formula' | 'selector'> {
  selector?: RuntimeTargetSelector;
  value: RuntimeValue;
}

export interface RuntimeActionBase
  extends Omit<ActionBase, 'targeting' | 'effects' | 'costs' | 'canUse'> {
  targeting: RuntimeTargetSelector;
  effects: RuntimeEffect[];
  costs: RuntimeCost;
  canUse?: Filter;
}

export interface RuntimeSkill extends RuntimeActionBase {
  type: 'skill';
}

export interface RuntimeItem extends RuntimeActionBase {
  type: 'item';
  consumable: boolean;
}

export interface RuntimeStatusTemplate
  extends Omit<StatusDef, 'hooks' | 'durationTurns' | 'stackRule' | 'maxStacks' | 'tags' | 'modifiers'> {
  stackRule: StackRule;
  maxStacks: number;
  durationTurns: number | null;
  tags: string[];
  modifiers: StatusDef['modifiers'];
  hooks: {
    onApply: RuntimeEffect[];
    onTurnStart: RuntimeEffect[];
    onTurnEnd: RuntimeEffect[];
    onDealDamage: RuntimeEffect[];
    onTakeDamage: RuntimeEffect[];
    onExpire: RuntimeEffect[];
  };
}

interface RuntimeActionContext<T extends SkillDef | ItemDef> {
  id: string;
  def: T;
  scope: string;
}

const OPERATORS: Record<string, OperatorConfig> = {
  '+': { precedence: 1, assoc: 'left', args: 2, apply: (a, b) => a + b },
  '-': { precedence: 1, assoc: 'left', args: 2, apply: (a, b) => a - b },
  '*': { precedence: 2, assoc: 'left', args: 2, apply: (a, b) => a * b },
  '/': { precedence: 2, assoc: 'left', args: 2, apply: (a, b) => a / b },
  '%': { precedence: 2, assoc: 'left', args: 2, apply: (a, b) => a % b },
  '^': { precedence: 3, assoc: 'right', args: 2, apply: (a, b) => Math.pow(a, b) },
  neg: { precedence: 4, assoc: 'right', args: 1, apply: (a) => -a },
};

const FUNCTIONS: Record<string, FunctionConfig> = {
  min: { arity: 2, apply: (a, b) => Math.min(a, b) },
  max: { arity: 2, apply: (a, b) => Math.max(a, b) },
  floor: { arity: 1, apply: (a) => Math.floor(a) },
  ceil: { arity: 1, apply: (a) => Math.ceil(a) },
  abs: { arity: 1, apply: (a) => Math.abs(a) },
  pow: { arity: 2, apply: (a, b) => Math.pow(a, b) },
  clamp: { arity: 3, apply: (v, min, max) => Math.min(Math.max(v, min), max) },
  round: { arity: 1, apply: (a) => Math.round(a) },
  sqrt: { arity: 1, apply: (a) => Math.sqrt(a) },
};

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepClone(entry);
    }
    return result as T;
  }
  return value;
}

function normalizeSelector(selector?: TargetSelector): RuntimeTargetSelector {
  const base: TargetSelector = selector
    ? deepClone(selector)
    : { side: 'enemy', mode: 'single', count: 1 };
  return {
    ...base,
    count:
      base.count ?? (base.mode === 'random' ? 1 : base.mode === 'single' ? 1 : base.count),
    includeDead: Boolean(base.includeDead),
    condition: base.condition ? deepClone(base.condition) : undefined,
  };
}

function normalizeCost(costs?: Cost): RuntimeCost {
  const src = costs ?? {};
  return {
    sta: src.sta ?? 0,
    mp: src.mp ?? 0,
    item: src.item ? { id: src.item.id, qty: src.item.qty ?? 1 } : undefined,
    cooldown: src.cooldown ?? 0,
    charges: src.charges ?? undefined,
  };
}

function compileAction<T extends SkillDef | ItemDef>(context: RuntimeActionContext<T>): T extends SkillDef
  ? RuntimeSkill
  : RuntimeItem {
  const { id, def, scope } = context;
  const targeting = normalizeSelector(def.targeting);
  const effects = compileEffects(def.effects ?? [], `${scope}.effects`);
  const costs = normalizeCost(def.costs);
  const canUse = def.canUse ? deepClone(def.canUse) : undefined;

  const base: RuntimeActionBase = {
    id,
    name: def.name ?? id,
    desc: def.desc,
    element: def.element,
    targeting,
    effects,
    costs,
    canUse,
    aiWeight: def.aiWeight ?? 1,
  };

  if (def.type === 'item') {
    const item: RuntimeItem = {
      ...base,
      type: 'item',
      consumable: def.consumable ?? true,
    };
    return item as unknown as T extends SkillDef ? RuntimeSkill : RuntimeItem;
  }

  const skill: RuntimeSkill = {
    ...base,
    type: 'skill',
  };
  return skill as unknown as T extends SkillDef ? RuntimeSkill : RuntimeItem;
}

function compileEffects(effects: Effect[], scope: string): RuntimeEffect[] {
  return effects.map((effect, index) => compileEffect(effect, `${scope}[${index}]`));
}

function compileEffect(effect: Effect, scope: string): RuntimeEffect {
  const selector = effect.selector ? normalizeSelector(effect.selector) : undefined;
  const value = compileValue(effect, scope);
  return {
    kind: effect.kind,
    element: effect.element,
    canMiss: effect.canMiss ?? false,
    canCrit: effect.canCrit ?? false,
    resource: effect.resource,
    stat: effect.stat,
    statusId: effect.statusId,
    statusTurns: effect.statusTurns,
    cleanseTags: effect.cleanseTags ? [...effect.cleanseTags] : undefined,
    shieldId: effect.shieldId,
    onlyIf: effect.onlyIf ? deepClone(effect.onlyIf) : undefined,
    selector,
    value,
  };
}

function compileValue(effect: Effect, scope: string): RuntimeValue {
  const kind: ValueType = effect.valueType ?? (effect.percent != null ? 'percent' : 'flat');
  const min = effect.min ?? undefined;
  const max = effect.max ?? undefined;

  const applyClamp = (resolver: ValueResolver): ValueResolver => {
    return (user, target, ctx) => {
      const raw = resolver(user, target, ctx);
      const lower = min ?? -Infinity;
      const upper = max ?? Infinity;
      const clamped = Math.min(Math.max(raw, lower), upper);
      return Number.isFinite(clamped) ? clamped : 0;
    };
  };

  if (kind === 'formula') {
    const expr = effect.formula?.expr ?? '0';
    const resolver = compileFormula(expr, scope);
    return {
      kind,
      resolve: applyClamp(resolver),
      expr,
      min,
      max,
    };
  }

  if (kind === 'percent') {
    const percent = effect.percent ?? 0;
    const resolver: ValueResolver = () => percent / 100;
    return {
      kind,
      resolve: applyClamp(resolver),
      rawPercent: percent,
      min,
      max,
    };
  }

  const amount = effect.amount ?? 0;
  const resolver: ValueResolver = () => amount;
  return {
    kind: 'flat',
    resolve: applyClamp(resolver),
    rawAmount: amount,
    min,
    max,
  };
}

function compileFormula(expr: string, scope: string): ValueResolver {
  const tokens = tokenize(expr, scope);
  const rpn = toRpn(tokens, scope);
  return (user, target, ctx) => {
    const stack: number[] = [];
    const push = (value: number) => {
      if (!Number.isFinite(value)) {
        throw new Error(`Formula in ${scope} evaluated to a non-finite number`);
      }
      stack.push(value);
    };

    for (const token of rpn) {
      switch (token.type) {
        case 'number':
          push(token.value);
          break;
        case 'identifier':
          push(resolveIdentifier(token.value, user, target, ctx, scope));
          break;
        case 'operator': {
          const op = OPERATORS[token.value];
          if (stack.length < op.args) {
            throw new Error(`Operator ${token.value} in ${scope} is missing operands`);
          }
          const args = stack.splice(stack.length - op.args, op.args);
          const result = op.apply(...args);
          push(result);
          break;
        }
        case 'function-rpn': {
          const fn = FUNCTIONS[token.name];
          if (stack.length < fn.arity) {
            throw new Error(`Function ${token.name} in ${scope} is missing operands`);
          }
          const args = stack.splice(stack.length - fn.arity, fn.arity);
          const result = fn.apply(...args);
          push(result);
          break;
        }
        default:
          throw new Error(`Unexpected token ${token.type} in formula for ${scope}`);
      }
    }

    if (stack.length !== 1) {
      throw new Error(`Formula in ${scope} did not resolve to a single value`);
    }

    return stack[0];
  };
}

function tokenize(expr: string, scope: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let expectValue = true;

  const pushToken = (token: Token) => {
    tokens.push(token);
    if (
      token.type === 'number' ||
      token.type === 'identifier' ||
      token.type === 'function-rpn'
    ) {
      expectValue = false;
    } else if (token.type === 'paren' && token.value === '(') {
      expectValue = true;
    } else if (token.type === 'paren' && token.value === ')') {
      expectValue = false;
    } else if (token.type === 'comma') {
      expectValue = true;
    } else if (token.type === 'function') {
      expectValue = true;
    } else if (token.type === 'operator') {
      expectValue = true;
    }
  };

  while (index < expr.length) {
    const ch = expr[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let end = index + 1;
      while (end < expr.length && /[0-9.]/.test(expr[end])) end += 1;
      const raw = expr.slice(index, end);
      if (!/^\d*(\.\d+)?$/.test(raw)) {
        throw new Error(`Invalid number '${raw}' in formula for ${scope}`);
      }
      pushToken({ type: 'number', value: Number(raw) });
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let end = index + 1;
      while (end < expr.length && /[A-Za-z0-9_\.]/.test(expr[end])) end += 1;
      const name = expr.slice(index, end);
      let next = end;
      while (next < expr.length && /\s/.test(expr[next])) next += 1;
      if (next < expr.length && expr[next] === '(' && FUNCTIONS[name]) {
        pushToken({ type: 'function', name: name as keyof typeof FUNCTIONS });
      } else {
        pushToken({ type: 'identifier', value: name });
      }
      index = end;
      continue;
    }

    if (ch === '(' || ch === ')') {
      pushToken({ type: 'paren', value: ch });
      index += 1;
      continue;
    }

    if (ch === ',') {
      pushToken({ type: 'comma' });
      index += 1;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^') {
      let op = ch;
      if (expectValue) {
        if (ch === '-') {
          op = 'neg';
        } else if (ch === '+') {
          index += 1;
          continue;
        }
      }
      if (!OPERATORS[op]) {
        throw new Error(`Operator '${ch}' is not supported in formula for ${scope}`);
      }
      pushToken({ type: 'operator', value: op as keyof typeof OPERATORS });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' in formula for ${scope}`);
  }

  return tokens;
}

function toRpn(tokens: Token[], scope: string): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'number':
      case 'identifier':
        output.push(token);
        break;
      case 'function':
        stack.push(token);
        break;
      case 'comma': {
        while (stack.length && !(stack[stack.length - 1].type === 'paren' && (stack[stack.length - 1] as ParenToken).value === '(')) {
          output.push(stack.pop()!);
        }
        if (!stack.length) {
          throw new Error(`Misplaced comma in formula for ${scope}`);
        }
        break;
      }
      case 'operator': {
        const op = OPERATORS[token.value];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'operator') {
            const topOp = OPERATORS[(top as OperatorToken).value];
            const higher =
              topOp.precedence > op.precedence ||
              (topOp.precedence === op.precedence && op.assoc === 'left');
            if (higher) {
              output.push(stack.pop()!);
              continue;
            }
          }
          break;
        }
        stack.push(token);
        break;
      }
      case 'paren':
        if (token.value === '(') {
          stack.push(token);
        } else {
          while (stack.length && !(stack[stack.length - 1].type === 'paren' && (stack[stack.length - 1] as ParenToken).value === '(')) {
            output.push(stack.pop()!);
          }
          if (!stack.length) {
            throw new Error(`Mismatched parentheses in formula for ${scope}`);
          }
          stack.pop();
          if (stack.length && stack[stack.length - 1].type === 'function') {
            const fn = stack.pop() as FunctionToken;
            output.push({ type: 'function-rpn', name: fn.name });
          }
        }
        break;
      default:
        throw new Error(`Unhandled token ${token.type} in formula for ${scope}`);
    }
  }

  while (stack.length) {
    const token = stack.pop()!;
    if (token.type === 'paren') {
      throw new Error(`Mismatched parentheses in formula for ${scope}`);
    }
    if (token.type === 'function') {
      output.push({ type: 'function-rpn', name: token.name });
    } else {
      output.push(token);
    }
  }

  return output;
}

function isActor(value: unknown): value is Actor {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'stats' in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).stats === 'object',
  );
}

function resolveActorMetric(actor: Actor, key: string): number | undefined {
  const { stats } = actor;
  switch (key) {
    case 'hpPct':
      return stats.maxHp > 0 ? stats.hp / stats.maxHp : 0;
    case 'staPct':
      return stats.maxSta > 0 ? stats.sta / stats.maxSta : 0;
    case 'mpPct':
      return stats.maxMp > 0 ? stats.mp / stats.maxMp : 0;
    default:
      return undefined;
  }
}

function readProperty(
  value: unknown,
  key: string,
  path: string,
  scope: string,
): unknown {
  if (value == null || typeof value !== 'object') {
    throw new Error(`Identifier '${path}' is undefined in formula for ${scope}`);
  }

  const record = value as Record<string, unknown>;
  if (key in record) {
    return record[key];
  }

  if (isActor(value)) {
    const stats = value.stats as Record<string, unknown>;
    if (key in stats) {
      return stats[key];
    }
    const derived = resolveActorMetric(value, key);
    if (typeof derived === 'number') {
      return derived;
    }
  }

  throw new Error(`Identifier '${path}' is undefined in formula for ${scope}`);
}

function resolveIdentifier(
  path: string,
  user: Actor,
  target: Actor,
  ctx: FormulaContext,
  scope: string,
): number {
  const root: Record<string, unknown> = { u: user, t: target, ctx, PI: Math.PI, E: Math.E };
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Empty identifier in formula for ${scope}`);
  }
  if (!(parts[0] in root)) {
    throw new Error(`Identifier '${path}' is undefined in formula for ${scope}`);
  }
  let value: unknown = root[parts[0]];
  for (let i = 1; i < parts.length; i += 1) {
    value = readProperty(value, parts[i], path, scope);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  throw new Error(`Identifier '${path}' is not numeric in formula for ${scope}`);
}

function compileStatus(def: StatusDef, id: string, scope: string): RuntimeStatusTemplate {
  const hooks = def.hooks ?? {};
  return {
    ...def,
    id: def.id ?? id,
    stackRule: def.stackRule ?? 'renew',
    maxStacks: def.maxStacks ?? 1,
    durationTurns: def.durationTurns ?? null,
    tags: def.tags ? [...def.tags] : [],
    modifiers: def.modifiers ? deepClone(def.modifiers) : undefined,
    hooks: {
      onApply: compileEffects(hooks.onApply ?? [], `${scope}.hooks.onApply`),
      onTurnStart: compileEffects(hooks.onTurnStart ?? [], `${scope}.hooks.onTurnStart`),
      onTurnEnd: compileEffects(hooks.onTurnEnd ?? [], `${scope}.hooks.onTurnEnd`),
      onDealDamage: compileEffects(hooks.onDealDamage ?? [], `${scope}.hooks.onDealDamage`),
      onTakeDamage: compileEffects(hooks.onTakeDamage ?? [], `${scope}.hooks.onTakeDamage`),
      onExpire: compileEffects(hooks.onExpire ?? [], `${scope}.hooks.onExpire`),
    },
  };
}

function compileEnemyFactory(id: string, def: GameConfig['enemies'][string]): EnemyFactory {
  return (level: number) => {
    const lvl = Math.max(1, Math.floor(level || 1));
    const base = def.base;
    const scale = def.scale;
    const stats = {
      maxHp: base.maxHp + scale.maxHp * lvl,
      maxSta: base.maxSta + scale.maxSta * lvl,
      maxMp: base.maxMp + scale.maxMp * lvl,
      atk: base.atk + scale.atk * lvl,
      def: base.def + scale.def * lvl,
    };
    return {
      id,
      name: def.name ?? id,
      color: def.color,
      clazz: undefined,
      stats: {
        maxHp: stats.maxHp,
        hp: stats.maxHp,
        maxSta: stats.maxSta,
        sta: stats.maxSta,
        maxMp: stats.maxMp,
        mp: stats.maxMp,
        atk: stats.atk,
        def: stats.def,
        lv: lvl,
        xp: 0,
        gold: 0,
      },
      statuses: [],
      alive: true,
      tags: def.tags ? [...def.tags] : [],
      meta: {
        skillIds: def.skills ? [...def.skills] : [],
        itemDrops: def.items ? def.items.map((item) => ({ ...item })) : undefined,
      },
    };
  };
}

export function toSkills(cfg: GameConfig): AnyRecord<RuntimeSkill> {
  const out: AnyRecord<RuntimeSkill> = {};
  for (const [id, def] of Object.entries(cfg.skills)) {
    out[id] = compileAction({ id, def, scope: `skills.${id}` }) as RuntimeSkill;
  }
  return out;
}

export function toItems(cfg: GameConfig): AnyRecord<RuntimeItem> {
  const out: AnyRecord<RuntimeItem> = {};
  for (const [id, def] of Object.entries(cfg.items)) {
    out[id] = compileAction({ id, def, scope: `items.${id}` }) as RuntimeItem;
  }
  return out;
}

export function toStatuses(cfg: GameConfig): AnyRecord<RuntimeStatusTemplate> {
  const out: AnyRecord<RuntimeStatusTemplate> = {};
  for (const [id, def] of Object.entries(cfg.statuses)) {
    out[id] = compileStatus(def, id, `statuses.${id}`);
  }
  return out;
}

export function toEnemies(cfg: GameConfig): AnyRecord<EnemyFactory> {
  const out: AnyRecord<EnemyFactory> = {};
  for (const [id, def] of Object.entries(cfg.enemies)) {
    out[id] = compileEnemyFactory(id, def);
  }
  return out;
}
