
import type {
  FormulaContext,
  RuntimeEffect,
  RuntimeItem,
  RuntimeSkill,
  RuntimeTargetSelector,
  ValueResolver,
} from '@content/adapters'
import type { Resource } from '@config/schema'
import { CONFIG } from '@config/store'

import { resolveTargets, matchesFilter } from './targeting'
import { critChance, elementMult, hitChance, tagResistMult, type RuleContext } from './rules'
import {
  absorbDamageWithShields,
  applyStatus,
  applyTaunt,
  cleanseStatuses,
  grantShield,
  tickEndOfTurn,
  triggerStatusHooks,
} from './status'
import type { Actor, BattleState, ChargeState, UseResult } from './types'

const RNG_A = 1664525
const RNG_C = 1013904223
const RNG_M = 0x100000000

type RuntimeAction = RuntimeSkill | RuntimeItem

export function useSkill(
  state: BattleState,
  skill: RuntimeSkill,
  userId: string,
  targetIds?: string[],
): UseResult {
  return executeAction(state, skill, userId, targetIds)
}

export function useItem(
  state: BattleState,
  item: RuntimeItem,
  userId: string,
  targetIds?: string[],
): UseResult {
  return executeAction(state, item, userId, targetIds)
}

export function endTurn(state: BattleState): BattleState {
  if (state.ended) {
    return state
  }

  const currentActorId = state.order[state.current]
  const actor = currentActorId ? state.actors[currentActorId] : undefined
  if (actor) {
    pushLog(state, `${actor.name} ended their turn.`)
    tickEndOfTurn(state, actor.id)
    tickCooldowns(state, actor.id)
    evaluateOutcome(state)
    if (state.ended) {
      return state
    }
  }

  state.current = (state.current + 1) % (state.order.length || 1)
  if (state.current === 0) {
    state.turn += 1
    pushLog(state, `Turn ${state.turn} begins.`)
  }
  return state
}

type ActionFormulaContext = FormulaContext & { state: BattleState; action: RuntimeAction }

type DamageOptions = {
  crit?: boolean
  element?: string
}

type ItemCost = { id: string; qty: number; consume: boolean }

function executeAction(
  state: BattleState,
  action: RuntimeAction,
  userId: string,
  providedTargetIds?: string[],
): UseResult {
  if (state.ended) {
    pushLog(state, 'The battle is already over.')
    return { ok: false, log: state.log, state }
  }

  const user = state.actors[userId]
  if (!user) {
    pushLog(state, `Unknown actor ${userId} tried to use ${action.name}.`)
    return { ok: false, log: state.log, state }
  }

  if (!user.alive) {
    pushLog(state, `${user.name} cannot act while defeated.`)
    return { ok: false, log: state.log, state }
  }

  if (!checkCooldownReady(state, user, action)) {
    return { ok: false, log: state.log, state }
  }

  if (!checkChargesAvailable(state, user, action)) {
    return { ok: false, log: state.log, state }
  }

  const itemCosts = collectItemCosts(action)
  if (!checkItemAvailability(state, itemCosts, action)) {
    return { ok: false, log: state.log, state }
  }

  const targetingSeed = state.rngSeed
  const normalizedSelector = normalizeSelector(action.targeting)
  const validationSelector: RuntimeTargetSelector = providedTargetIds
    ? { ...normalizedSelector, mode: 'condition', count: undefined }
    : normalizedSelector
  const resolvedTargetIds = resolveTargets(state, validationSelector, userId)
  let baseTargetIds: string[]
  if (providedTargetIds) {
    baseTargetIds = providedTargetIds.filter((id) => resolvedTargetIds.includes(id))
    state.rngSeed = targetingSeed
  } else {
    baseTargetIds = resolvedTargetIds
  }

  if (baseTargetIds.length === 0) {
    pushLog(state, `${action.name} has no valid targets.`)
    state.rngSeed = targetingSeed
    return { ok: false, log: state.log, state }
  }

  const baseTargets = filterActors(state, baseTargetIds)

  if (!checkCanUseFilter(state, action, user, baseTargets)) {
    state.rngSeed = targetingSeed
    return { ok: false, log: state.log, state }
  }

  if (!payResourceCost(user, action.costs?.sta ?? 0, 'sta', state, action.name)) {
    state.rngSeed = targetingSeed
    return { ok: false, log: state.log, state }
  }

  if (!payResourceCost(user, action.costs?.mp ?? 0, 'mp', state, action.name)) {
    state.rngSeed = targetingSeed
    return { ok: false, log: state.log, state }
  }

  if (baseTargets.length === 0) {
    pushLog(state, `${action.name} has no valid targets.`)
  }

  applyItemCosts(state, itemCosts)
  startCooldown(state, user, action)
  consumeCharge(state, user, action)

  pushLog(state, `${user.name} used ${action.name}.`)

  for (const effect of action.effects ?? []) {
    const selector = effect.selector ?? action.targeting
    const targets = effect.selector
      ? filterActors(state, resolveTargets(state, normalizeSelector(selector), userId))
      : baseTargets

    if (targets.length === 0) {
      continue
    }

    for (const target of targets) {
      applyEffect(state, action, effect, user, target)
      if (state.ended) {
        break
      }
    }
    if (state.ended) {
      break
    }
  }

  evaluateOutcome(state)
  return { ok: true, log: state.log, state }
}

function normalizeSelector(selector: RuntimeTargetSelector): RuntimeTargetSelector {
  const includeDead = selector.includeDead ?? false
  const count = selector.count ?? (selector.mode === 'random' ? 1 : undefined)
  return { ...selector, includeDead, count }
}

function filterActors(state: BattleState, ids: string[]): Actor[] {
  return ids
    .map((id) => state.actors[id])
    .filter((actor): actor is Actor => Boolean(actor))
}

function checkCanUseFilter(
  state: BattleState,
  action: RuntimeAction,
  user: Actor,
  targets: Actor[],
): boolean {
  const filter = action.canUse
  if (!filter) {
    return true
  }

  const userMatches = matchesFilter(user, filter)
  const targetMatches = targets.some((target) => matchesFilter(target, filter))

  if (userMatches || targetMatches) {
    return true
  }

  pushLog(state, `${user.name} cannot use ${action.name} right now.`)
  return false
}

function payResourceCost(
  actor: Actor,
  cost: number,
  resource: 'sta' | 'mp',
  state: BattleState,
  actionName: string,
): boolean {
  const amount = Math.max(0, cost ?? 0)
  if (amount === 0) {
    return true
  }

  const key = resource
  const current = actor.stats[key]
  if (current < amount) {
    pushLog(
      state,
      `Not enough ${resource.toUpperCase()} to use ${actionName} (need ${amount}, have ${current}).`,
    )
    return false
  }

  actor.stats[key] = current - amount
  return true
}

function applyEffect(
  state: BattleState,
  action: RuntimeAction,
  effect: RuntimeEffect,
  user: Actor,
  target: Actor,
) {
  if (effect.onlyIf && !matchesFilter(target, effect.onlyIf)) {
    return
  }

  const ctx: ActionFormulaContext = { state, action }
  const base = resolveValue(effect.value.resolve, effect.value.kind, user, target, ctx, effect, action)
  const amount = base.kind === 'none' ? 0 : base.amount
  const ruleCtx: RuleContext = { state, action, effect }

  switch (effect.kind) {
    case 'damage': {
      if (effect.canMiss) {
        const roll = nextRandom(state)
        const chance = clamp(hitChance(user, target, ruleCtx), 0, 1)
        if (roll > chance) {
          pushLog(state, `${user.name}'s ${action.name} missed ${target.name}.`)
          return
        }
      }

      const element = effect.element ?? action.element
      let finalAmount = amount * elementMult(element, target) * tagResistMult(target)
      let crit = false

      if (effect.canCrit) {
        const chance = clamp(critChance(user, target, ruleCtx), 0, 1)
        const roll = nextRandom(state)
        if (roll < chance) {
          const { CRIT_MULT } = CONFIG().balance
          finalAmount *= CRIT_MULT
          crit = true
        }
      }

      const dealt = applyDamage(state, user, target, finalAmount, { crit, element })
      triggerStatusHooks(state, user, 'onDealDamage', {
        other: target,
        amount: dealt,
        element,
      })
      triggerStatusHooks(state, target, 'onTakeDamage', {
        other: user,
        amount: dealt,
        element,
      })
      break
    }
    case 'heal':
      applyHeal(state, user, target, amount)
      break
    case 'resource':
      if (effect.resource) {
        applyResource(state, user, target, amount, effect.resource)
      }
      break
    case 'applyStatus': {
      if (!effect.statusId) {
        pushLog(state, `${action.name} tried to apply a status with no ID.`)
        break
      }

      if (effect.canMiss) {
        const roll = nextRandom(state)
        const chance = clamp(hitChance(user, target, ruleCtx), 0, 1)
        if (roll > chance) {
          pushLog(state, `${user.name}'s ${action.name} failed to affect ${target.name}.`)
          return
        }
      }

      const turns = effect.statusTurns ?? Math.round(amount)
      const stacks = normalizeStacks(amount)
      applyStatus(state, target.id, effect.statusId, turns, { stacks, sourceId: user.id })
      break
    }
    case 'cleanseStatus': {
      const removed = cleanseStatuses(state, target, effect.cleanseTags)
      if (removed.length === 0) {
        pushLog(state, `${action.name} could not find any statuses to cleanse on ${target.name}.`)
      } else {
        pushLog(state, `${user.name} cleansed ${removed.join(', ')} from ${target.name}.`)
      }
      break
    }
    case 'shield': {
      const shieldId = effect.shieldId ?? effect.statusId ?? action.id
      if (!shieldId) {
        pushLog(state, `${action.name} tried to grant a shield without an identifier.`)
        break
      }
      const total = Math.max(0, amount)
      const element = effect.element ?? action.element
      if (total <= 0) {
        grantShield(state, target, shieldId, 0, element, { replace: true })
        pushLog(state, `${target.name}'s ${shieldId} faded.`)
      } else {
        const remaining = grantShield(state, target, shieldId, total, element)
        pushLog(state, `${user.name} granted ${target.name} a ${shieldId} shield (${Math.round(remaining)} HP).`)
      }
      break
    }
    case 'taunt': {
      const turns = effect.statusTurns ?? Math.max(1, Math.round(amount))
      applyTaunt(state, target.id, user.id, turns)
      if (turns > 0) {
        pushLog(state, `${target.name} is taunted by ${user.name} for ${turns} turn(s).`)
      } else {
        pushLog(state, `${target.name} is no longer taunted.`)
      }
      break
    }
    case 'revive': {
      const healAmount = Math.max(0, amount)
      if (!target.alive) {
        const restored = clamp(Math.max(1, Math.round(healAmount || target.stats.maxHp * 0.25)), 1, target.stats.maxHp)
        target.stats.hp = restored
        target.alive = true
        pushLog(state, `${user.name} revived ${target.name} (${restored} HP).`)
      } else {
        applyHeal(state, user, target, healAmount)
      }
      break
    }
    case 'flee': {
      state.ended = { reason: 'fled' }
      pushLog(state, `${user.name} fled the battle!`)
      break
    }
    case 'modifyStat': {
      if (!effect.stat) {
        pushLog(state, `${action.name} tried to modify a stat without specifying one.`)
        break
      }
      const delta = Math.round(amount)
      modifyStat(target, effect.stat, delta, state, user.name, action.name)
      break
    }
    default:
      // unsupported kinds will be ignored in this phase
      break
  }
}

function resolveValue(
  resolver: ValueResolver,
  kind: RuntimeEffect['value']['kind'],
  user: Actor,
  target: Actor,
  ctx: ActionFormulaContext,
  effect: RuntimeEffect,
  action: RuntimeAction,
): { kind: 'number'; amount: number } | { kind: 'none' } {
  try {
    const resolved = resolver(user, target, ctx)
    const amount = normalizeAmount(resolved, kind, target, effect)
    return { kind: 'number', amount }
  } catch (error) {
    pushLog(
      ctx.state,
      `Failed to resolve value for ${action.name}: ${(error as Error).message}`,
    )
    return { kind: 'none' }
  }
}

function normalizeAmount(
  value: number,
  kind: RuntimeEffect['value']['kind'],
  target: Actor,
  effect: RuntimeEffect,
): number {
  const safe = Number.isFinite(value) ? value : 0
  if (kind === 'percent') {
    if (effect.kind === 'resource' && effect.resource) {
      const [, maxKey] = resourceKeys(effect.resource)
      const maxValue = target.stats[maxKey]
      return safe * maxValue
    }
    return safe * target.stats.maxHp
  }
  return safe
}

function applyDamage(
  state: BattleState,
  user: Actor,
  target: Actor,
  amount: number,
  options: DamageOptions = {},
): number {
  if (!target.alive) {
    return 0
  }

  const elementKey = options.element ?? 'neutral'
  const dealtMult = modifierMultiplier(user.statusModifiers?.damageDealtPct, [elementKey, 'damage'])
  const takenMult = modifierMultiplier(target.statusModifiers?.damageTakenPct, [elementKey, 'damage'])
  let pending = Math.max(0, amount * dealtMult * takenMult)
  const shieldResult = absorbDamageWithShields(state, target, pending, options.element)
  for (const log of shieldResult.logs) {
    pushLog(state, log)
  }
  pending = shieldResult.remaining

  if (pending <= 0) {
    if (shieldResult.absorbed > 0) {
      pushLog(state, `${user.name}'s attack was absorbed by ${target.name}'s shields.`)
    } else {
      pushLog(state, `${user.name}'s attack dealt no damage to ${target.name}.`)
    }
    return 0
  }

  const before = target.stats.hp
  const after = Math.max(0, before - pending)
  target.stats.hp = after
  if (after <= 0) {
    target.alive = false
  }
  const diff = before - after
  let entry = `${user.name} hit ${target.name} for ${Math.round(diff)} damage.`
  if (options.crit) {
    entry += ' Critical hit!'
  }
  if (after <= 0) {
    entry += ` ${target.name} was defeated.`
  }
  pushLog(state, entry)
  return diff
}

function applyHeal(state: BattleState, user: Actor, target: Actor, amount: number) {
  const healMult =
    modifierMultiplier(user.statusModifiers?.damageDealtPct, ['heal']) *
    modifierMultiplier(target.statusModifiers?.damageTakenPct, ['heal'])
  const heal = Math.max(0, amount) * healMult
  const before = target.stats.hp
  const after = Math.min(target.stats.maxHp, before + heal)
  target.stats.hp = after
  if (after > 0) {
    target.alive = true
  }
  const diff = after - before
  pushLog(state, `${user.name} healed ${target.name} for ${Math.round(diff)} HP.`)
}

function applyResource(
  state: BattleState,
  user: Actor,
  target: Actor,
  amount: number,
  resource: Resource,
) {
  const categories = ['resource', `resource:${resource}`]
  const scaledAmount =
    amount *
    modifierMultiplier(user.statusModifiers?.damageDealtPct, categories) *
    modifierMultiplier(target.statusModifiers?.damageTakenPct, categories)
  const [currentKey, maxKey] = resourceKeys(resource)
  const before = target.stats[currentKey]
  const max = target.stats[maxKey]
  const after = clamp(before + scaledAmount, 0, max)
  target.stats[currentKey] = after
  const diff = after - before
  const label = resource.toUpperCase()
  if (diff === 0) {
    pushLog(state, `${user.name} affected ${target.name}'s ${label}, but nothing changed.`)
  } else if (diff > 0) {
    pushLog(state, `${user.name} restored ${Math.round(diff)} ${label} to ${target.name}.`)
  } else {
    pushLog(state, `${user.name} drained ${Math.round(Math.abs(diff))} ${label} from ${target.name}.`)
  }
}

function modifierMultiplier(
  map: Record<string, number> | undefined,
  categories: (string | undefined)[],
): number {
  if (!map) {
    return 1
  }
  const keys: string[] = ['all', ...categories.filter((key): key is string => Boolean(key))]
  let total = 0
  const seen = new Set<string>()
  for (const key of keys) {
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    const value = map[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value
    }
  }
  const result = 1 + total
  return result < 0 ? 0 : result
}

function modifyStat(
  target: Actor,
  stat: NonNullable<RuntimeEffect['stat']>,
  delta: number,
  state: BattleState,
  sourceName: string,
  actionName: string,
) {
  let finalValue = 0
  switch (stat) {
    case 'atk':
      target.stats.atk = Math.max(0, target.stats.atk + delta)
      finalValue = target.stats.atk
      break
    case 'def':
      target.stats.def = Math.max(0, target.stats.def + delta)
      finalValue = target.stats.def
      break
    case 'maxHp':
      target.stats.maxHp = Math.max(1, target.stats.maxHp + delta)
      target.stats.hp = clamp(target.stats.hp, 0, target.stats.maxHp)
      finalValue = target.stats.maxHp
      break
    case 'maxSta':
      target.stats.maxSta = Math.max(0, target.stats.maxSta + delta)
      target.stats.sta = clamp(target.stats.sta, 0, target.stats.maxSta)
      finalValue = target.stats.maxSta
      break
    case 'maxMp':
      target.stats.maxMp = Math.max(0, target.stats.maxMp + delta)
      target.stats.mp = clamp(target.stats.mp, 0, target.stats.maxMp)
      finalValue = target.stats.maxMp
      break
    default:
      return
  }

  if (delta === 0) {
    pushLog(state, `${sourceName}'s ${actionName} left ${target.name}'s ${formatStatLabel(stat)} unchanged.`)
  } else {
    const sign = delta > 0 ? '+' : ''
    pushLog(
      state,
      `${sourceName}'s ${actionName} changed ${target.name}'s ${formatStatLabel(stat)} by ${sign}${delta} (now ${Math.round(finalValue)}).`,
    )
  }
}

function normalizeStacks(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 1
  }
  const rounded = Math.round(Math.abs(amount))
  return Math.max(1, rounded)
}

function formatStatLabel(stat: NonNullable<RuntimeEffect['stat']>): string {
  switch (stat) {
    case 'atk':
      return 'ATK'
    case 'def':
      return 'DEF'
    case 'maxHp':
      return 'Max HP'
    case 'maxSta':
      return 'Max STA'
    case 'maxMp':
      return 'Max MP'
    default:
      return stat
  }
}

function resourceKeys(resource: Resource): ['hp' | 'sta' | 'mp', 'maxHp' | 'maxSta' | 'maxMp'] {
  switch (resource) {
    case 'sta':
      return ['sta', 'maxSta']
    case 'mp':
      return ['mp', 'maxMp']
    case 'hp':
    default:
      return ['hp', 'maxHp']
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function nextRandom(state: BattleState): number {
  const seed = state.rngSeed >>> 0
  const next = (Math.imul(seed, RNG_A) + RNG_C) >>> 0
  state.rngSeed = next
  return next / RNG_M
}

function evaluateOutcome(state: BattleState) {
  if (state.ended) {
    return
  }
  const enemiesAlive = state.sideEnemy.some((id) => state.actors[id]?.alive)
  if (!enemiesAlive) {
    state.ended = { reason: 'victory' }
    pushLog(state, 'Victory!')
    return
  }
  const playersAlive = state.sidePlayer.some((id) => state.actors[id]?.alive)
  if (!playersAlive) {
    state.ended = { reason: 'defeat' }
    pushLog(state, 'Defeat...')
  }
}

function collectItemCosts(action: RuntimeAction): ItemCost[] {
  const map = new Map<string, { qty: number; consume: boolean }>()
  const add = (id: string, qty: number, consume: boolean) => {
    if (!id || qty <= 0) {
      return
    }
    const existing = map.get(id)
    if (existing) {
      existing.qty += qty
      existing.consume = existing.consume || consume
    } else {
      map.set(id, { qty, consume })
    }
  }

  if (action.type === 'item') {
    const id = action.costs?.item?.id ?? action.id
    const qty = action.costs?.item?.qty ?? 1
    add(id, Math.max(1, Math.round(qty)), action.consumable)
  } else if (action.costs?.item) {
    add(action.costs.item.id, Math.max(1, Math.round(action.costs.item.qty ?? 1)), true)
  }

  return Array.from(map.entries()).map(([id, value]) => ({ id, qty: value.qty, consume: value.consume }))
}

function checkItemAvailability(state: BattleState, costs: ItemCost[], action: RuntimeAction): boolean {
  for (const cost of costs) {
    const entry = state.inventory.find((item) => item.id === cost.id)
    if (!entry || entry.qty < cost.qty) {
      pushLog(state, `Missing ${cost.id} x${cost.qty} to use ${action.name}.`)
      return false
    }
  }
  return true
}

function applyItemCosts(state: BattleState, costs: ItemCost[]) {
  for (const cost of costs) {
    if (!cost.consume) {
      continue
    }
    const entry = state.inventory.find((item) => item.id === cost.id)
    if (!entry) {
      continue
    }
    entry.qty = Math.max(0, entry.qty - cost.qty)
    if (entry.qty <= 0) {
      state.inventory = state.inventory.filter((item) => item !== entry)
    }
  }
}

function checkCooldownReady(state: BattleState, user: Actor, action: RuntimeAction): boolean {
  const cooldown = Math.max(0, Math.floor(action.costs?.cooldown ?? 0))
  if (cooldown <= 0) {
    return true
  }
  const remaining = state.cooldowns[user.id]?.[action.id] ?? 0
  if (remaining > 0) {
    pushLog(state, `${action.name} is on cooldown for ${remaining} more turn(s).`)
    return false
  }
  return true
}

function startCooldown(state: BattleState, user: Actor, action: RuntimeAction) {
  const cooldown = Math.max(0, Math.floor(action.costs?.cooldown ?? 0))
  if (cooldown <= 0) {
    return
  }
  const map = ensureCooldownMap(state, user.id)
  map[action.id] = cooldown
}

function tickCooldowns(state: BattleState, _actorId: string) {
  for (const map of Object.values(state.cooldowns)) {
    for (const [actionId, remaining] of Object.entries(map)) {
      const next = Math.max(0, Math.floor(remaining) - 1)
      if (next <= 0) {
        delete map[actionId]
      } else {
        map[actionId] = next
      }
    }
  }
}

function checkChargesAvailable(state: BattleState, user: Actor, action: RuntimeAction): boolean {
  const maxCharges = Math.max(0, Math.floor(action.costs?.charges ?? 0))
  if (maxCharges <= 0) {
    return true
  }
  const map = ensureChargeMap(state, user.id)
  const existing = map[action.id] ?? { remaining: maxCharges, max: maxCharges }
  map[action.id] = existing
  if (existing.remaining <= 0) {
    pushLog(state, `${action.name} has no charges remaining.`)
    return false
  }
  return true
}

function consumeCharge(state: BattleState, user: Actor, action: RuntimeAction) {
  const maxCharges = Math.max(0, Math.floor(action.costs?.charges ?? 0))
  if (maxCharges <= 0) {
    return
  }
  const map = ensureChargeMap(state, user.id)
  const existing = map[action.id] ?? { remaining: maxCharges, max: maxCharges }
  map[action.id] = existing
  if (existing.remaining > 0) {
    existing.remaining -= 1
  }
}

function ensureCooldownMap(
  state: BattleState,
  actorId: string,
): Record<string, number> {
  const existing = state.cooldowns[actorId]
  if (existing) {
    return existing
  }
  state.cooldowns[actorId] = {}
  return state.cooldowns[actorId]
}

function ensureChargeMap(
  state: BattleState,
  actorId: string,
): Record<string, ChargeState> {
  const existing = state.charges[actorId]
  if (existing) {
    return existing
  }
  state.charges[actorId] = {}
  return state.charges[actorId]
}

function pushLog(state: BattleState, entry: string) {
  state.log.push(entry)
}
