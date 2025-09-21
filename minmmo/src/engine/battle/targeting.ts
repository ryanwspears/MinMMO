
import type { BattleState, Actor } from './types'

export function getEnemies(state: BattleState): Actor[] {
  return (state.sideEnemy ?? []).map(id => state.actors[id]).filter(Boolean) as Actor[]
}
export function getAllies(state: BattleState): Actor[] {
  return (state.sidePlayer ?? []).map(id => state.actors[id]).filter(Boolean) as Actor[]
}
