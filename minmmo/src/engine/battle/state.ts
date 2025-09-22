
import type { Actor, BattleState } from './types'

type InventoryEntry = { id: string; qty: number }

type Legacy = { rngSeed:number; player: Actor; enemies?: Actor[]; inventory: InventoryEntry[]; order?:string[]; current?:number; turn?:number; log?:string[] }
type V2     = { rngSeed:number; actors:Record<string,Actor>; sidePlayer:string[]; sideEnemy:string[]; inventory:InventoryEntry[]; order?:string[]; current?:number; turn?:number; log?:string[] }
type Params = Legacy | V2

export function createState(p: Params): BattleState {
  let actors: Record<string, Actor> = {}
  let sidePlayer: string[] = []
  let sideEnemy:  string[] = []

  if ('actors' in p) {
    actors = p.actors
    sidePlayer = p.sidePlayer ?? Object.values(actors).filter(a=>a.tags.includes('player')).map(a=>a.id)
    sideEnemy  = p.sideEnemy  ?? Object.values(actors).filter(a=>a.tags.includes('enemy')).map(a=>a.id)
  } else {
    const player = p.player
    const enemies = p.enemies ?? []
    actors[player.id] = player; sidePlayer = [player.id]
    for (const e of enemies) { actors[e.id] = e; sideEnemy.push(e.id) }
  }

  const order = (('order' in p) && p.order?.length) ? p.order.slice() : [...sidePlayer, ...sideEnemy]
  return {
    rngSeed: p.rngSeed,
    actors, sidePlayer, sideEnemy,
    inventory: (p as any).inventory?.slice?.() ?? [],
    order,
    current: (('current' in p) && p.current!=null) ? p.current! : 0,
    turn:    (('turn' in p) && p.turn!=null)       ? p.turn!    : 1,
    log:     (('log' in p) && p.log)               ? p.log!.slice() : [],
    cooldowns: {},
    charges: {},
    shields: {},
    taunts: {},
  }
}
