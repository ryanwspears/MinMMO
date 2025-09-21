
import type { BattleState } from './types'

export function useSkill(state: BattleState, skill: any, userId: string, targetIds?: string[]) {
  state.log.push(`[skill] ${skill?.name ?? 'Unknown'} used by ${userId}`)
  return state
}

export function useItem(state: BattleState, item: any, userId: string, targetIds?: string[]) {
  state.log.push(`[item] ${item?.name ?? 'Unknown'} used by ${userId}`)
  return state
}

export function endTurn(state: BattleState) {
  state.current = (state.current + 1) % (state.order.length || 1)
  if (state.current === 0) state.turn += 1
  return state
}
