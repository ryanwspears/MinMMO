
import Phaser from 'phaser'
import { createState } from '@engine/battle/state'
import { useSkill, useItem, endTurn } from '@engine/battle/actions'
import { Skills, Items } from '@content/registry'

type BattleInit = { profile:any; stats:any; inventory:any[]; enemyKind:string; enemyLevel:number }

export class Battle extends Phaser.Scene {
  state: any
  constructor(){ super('Battle') }
  create(data: BattleInit){
    const player = {
      id: 'P1', name: data.profile.username ?? 'Hero', clazz: data.profile.clazz,
      stats: { ...data.stats }, statuses: [], alive: true, tags: ['player']
    }
    const enemy = {
      id: 'E1', name: data.enemyKind ?? 'Enemy', color: 0xff3333,
      stats: { maxHp: 20, hp: 20, maxSta: 0, sta: 0, maxMp: 0, mp: 0, atk: 4, def: 2, lv: data.enemyLevel ?? 1, xp:0, gold:0 },
      statuses: [], alive: true, tags: ['enemy']
    }

    this.state = createState({
      rngSeed: Math.floor(Math.random()*1e9),
      actors: { [player.id]: player, [enemy.id]: enemy },
      sidePlayer: [player.id], sideEnemy: [enemy.id],
      inventory: data.inventory ?? [],
    })
    this.add.text(20,20,'Battle started. Click buttons.',{ color:'#e6e8ef' })
    const logText = this.add.text(20,50,'', { color:'#8b8fa3' })

    const skillBtn = this.add.text(20, 420, '[Use Skill]', { color:'#7c5cff' }).setInteractive()
    skillBtn.on('pointerdown', ()=>{
      const ids = Object.keys(Skills())
      if (!ids.length) { this.state.log.push('No skills in config.'); render(); return }
      useSkill(this.state, Skills()[ids[0]], 'P1', ['E1']); render()
    })
    const itemBtn = this.add.text(140, 420, '[Use Item]', { color:'#7c5cff' }).setInteractive()
    itemBtn.on('pointerdown', ()=>{
      const ids = Object.keys(Items())
      if (!ids.length) { this.state.log.push('No items in config.'); render(); return }
      useItem(this.state, Items()[ids[0]], 'P1', ['E1']); render()
    })
    const endBtn = this.add.text(260, 420, '[End Turn]', { color:'#7c5cff' }).setInteractive()
    endBtn.on('pointerdown', ()=>{ endTurn(this.state); render() })

    const render = ()=> { logText.setText(this.state.log.slice(-8).join('\n')) }
    render()
  }
}
