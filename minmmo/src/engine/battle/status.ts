
import type { BattleState } from './types'

export function tickEndOfTurn(state: BattleState, actorOrId: string | { statuses:any[] }) {
  const a: any = typeof actorOrId === 'string' ? (state.actors as any)[actorOrId] : actorOrId
  if (!a) return
  if (!Array.isArray(a.statuses)) a.statuses = []
  a.statuses = a.statuses
    .map((s:any)=>({ ...s, turns: (s.turns ?? 0) - 1 }))
    .filter((s:any)=> (s.turns ?? 0) > 0)
}
