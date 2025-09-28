import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Phaser from 'phaser';
import { load, subscribe } from '@config/store';
import { rebuildFromConfig } from '@content/registry';
import { Battle } from '@game/scenes/Battle';
import { Overworld } from '@game/scenes/Overworld';
import AuthApp from './auth/AuthApp';
import {
  ActiveSelection,
  getActiveProfile,
  getActiveSelection,
  getActiveWorld,
} from '@game/save';

const cfg = load();
rebuildFromConfig(cfg);
subscribe(rebuildFromConfig);

type GameSelection = ActiveSelection;

function GameShell() {
  const [selection, setSelection] = useState<GameSelection>(() => getActiveSelection());
  const [isGameRunning, setIsGameRunning] = useState<boolean>(() => Boolean(selection.accountId && selection.characterId));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const refreshSelection = useCallback((next: ActiveSelection) => {
    setSelection(next);
    if (!next.characterId) {
      setIsGameRunning(false);
    }
  }, []);

  const startGame = useCallback(() => {
    const profile = getActiveProfile();
    const world = getActiveWorld();
    if (!profile || !world) {
      console.warn('Cannot start game without an active character.');
      return;
    }
    setSelection(getActiveSelection());
    setIsGameRunning(true);
  }, []);

  const destroyGame = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
  }, []);

  const shouldRunGame = isGameRunning && Boolean(selection.characterId);

  useEffect(() => {
    if (!shouldRunGame) {
      destroyGame();
      return;
    }
    const host = containerRef.current;
    if (!host) {
      return;
    }
    const bounds = host.getBoundingClientRect();

    const gameConfig: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: host,
      backgroundColor: '#0f1220',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: Math.max(1, Math.floor(bounds.width) || window.innerWidth),
        height: Math.max(1, Math.floor(bounds.height) || window.innerHeight),
      },
      fps: { target: 120, min: 30 },
      physics: {
        default: 'matter',
        matter: { gravity: { x: 0, y: 0 } },
      },
      render: { powerPreference: 'high-performance', pixelArt: true, antialias: false, roundPixels: true },
      scene: [Overworld, Battle],
    };

    const game = new Phaser.Game(gameConfig);
    gameRef.current = game;

    const handleResize = () => {
      if (!gameRef.current || !containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      if (clientWidth > 0 && clientHeight > 0) {
        gameRef.current.scale.resize(clientWidth, clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      game.destroy(true);
      gameRef.current = null;
    };
  }, [destroyGame, shouldRunGame]);

  const handleLogout = useCallback(() => {
    setIsGameRunning(false);
    destroyGame();
    setSelection(getActiveSelection());
  }, [destroyGame]);

  if (!shouldRunGame) {
    return (
      <div className="auth-fullscreen">
        <AuthApp
          selection={selection}
          isGameRunning={isGameRunning}
          onSelectionChange={refreshSelection}
          onStartGame={startGame}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  return (
    <div className="game-layout">
      <aside className="auth-panel">
        <AuthApp
          selection={selection}
          isGameRunning={isGameRunning}
          onSelectionChange={refreshSelection}
          onStartGame={startGame}
          onLogout={handleLogout}
        />
      </aside>
      <main className="game-stage">
        <div ref={containerRef} className="phaser-host" />
      </main>
    </div>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<GameShell />);
}
