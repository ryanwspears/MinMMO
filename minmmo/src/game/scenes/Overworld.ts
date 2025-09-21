
import Phaser from 'phaser'

export class Overworld extends Phaser.Scene {
  constructor(){ super('Overworld') }
  create(){
    this.add.text(20,20,'Overworld — press SPACE to battle',{ color:'#e6e8ef' })
    this.input.keyboard!.on('keydown-SPACE', ()=>{
      const profile = { username: 'Hero', clazz: 'Knight', color: 0xffffff }
      const stats = { maxHp:30, hp:30, maxSta:12, sta:12, maxMp:4, mp:4, atk:5, def:6, lv:1, xp:0, gold:0 }
      const inventory:any[] = []
      this.scene.start('Battle', { profile, stats, inventory, enemyKind: 'Slime', enemyLevel: 1 })
    })
  }
}
