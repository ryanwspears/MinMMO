
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
  parent: 'game-root',
  backgroundColor: '#0f1220',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  fps: {target: 120, min: 30},
  physics: {
    default: 'matter',
    matter: { gravity: { x: 0, y: 0 }/*, debug: { showBody:true, showStaticBody:true, showInternalEdges:true}*/ }
  },
  render: {powerPreference: 'high-performance', pixelArt: true, antialias: false, roundPixels: true},
  scene: [Overworld, Battle]
}

const game = new Phaser.Game(gameConfig)

window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight)
})


