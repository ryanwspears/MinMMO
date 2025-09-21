
import Phaser from 'phaser'
import { Overworld } from '@game/scenes/Overworld'
import { Battle } from '@game/scenes/Battle'
import { load, subscribe } from '@config/store'
import { rebuildFromConfig } from '@content/registry'

const cfg = load()
rebuildFromConfig(cfg)
subscribe(rebuildFromConfig)

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 480,
  parent: 'game-root',
  backgroundColor: '#0f1220',
  scene: [Overworld, Battle]
}

new Phaser.Game(gameConfig)
