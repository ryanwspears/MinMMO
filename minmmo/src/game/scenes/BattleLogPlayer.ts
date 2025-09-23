import Phaser from 'phaser';

interface BattleLogPlayerOptions {
  maxLines?: number;
  charDelay?: number;
  lineDelay?: number;
  fastLineDelay?: number;
}

export class BattleLogPlayer {
  private readonly text: Phaser.GameObjects.Text;

  private readonly scene: Phaser.Scene;

  private readonly maxLines: number;

  private readonly charDelay: number;

  private readonly lineDelay: number;

  private readonly fastLineDelay: number;

  private cursor = 0;

  private queue: string[] = [];

  private displayed: string[] = [];

  private playing = false;

  private currentLine = '';

  private currentIndex = 0;

  private skipRequested = false;

  private timer?: Phaser.Time.TimerEvent;

  private drainPromise?: Promise<void>;

  private drainResolve?: () => void;

  constructor(scene: Phaser.Scene, text: Phaser.GameObjects.Text, options: BattleLogPlayerOptions = {}) {
    this.scene = scene;
    this.text = text;
    this.maxLines = Math.max(1, options.maxLines ?? 7);
    this.charDelay = Math.max(0, options.charDelay ?? 35);
    this.lineDelay = Math.max(0, options.lineDelay ?? 420);
    this.fastLineDelay = Math.max(0, options.fastLineDelay ?? 60);

    this.text.setInteractive({ useHandCursor: true });
    this.text.on('pointerdown', () => {
      this.requestSkip();
    });
    this.text.once('destroy', () => {
      this.timer?.remove(false);
      this.timer = undefined;
      this.drainResolve = undefined;
      this.drainPromise = undefined;
    });
  }

  prime(log: string[]) {
    this.cursor = log.length;
    this.queue = [];
    this.playing = false;
    this.currentLine = '';
    this.currentIndex = 0;
    this.skipRequested = false;
    this.timer?.remove(false);
    this.timer = undefined;
    this.displayed = log.slice(-this.maxLines);
    this.refreshText();
  }

  sync(log: string[]) {
    if (log.length < this.cursor) {
      this.cursor = 0;
    }
    if (log.length === this.cursor) {
      return;
    }
    const entries = log.slice(this.cursor);
    if (!entries.length) {
      return;
    }
    this.cursor = log.length;
    this.queue.push(...entries);
    if (!this.playing && !this.timer) {
      this.playNextLine();
    }
  }

  drain(): Promise<void> {
    if (!this.playing && !this.timer && this.queue.length === 0) {
      return Promise.resolve();
    }
    if (!this.drainPromise) {
      this.drainPromise = new Promise((resolve) => {
        this.drainResolve = resolve;
      });
    }
    return this.drainPromise;
  }

  private requestSkip() {
    if (this.timer) {
      this.timer.remove(false);
      this.timer = undefined;
      if (this.playing) {
        this.skipRequested = true;
        this.typeNextCharacter();
      } else if (this.queue.length > 0) {
        this.playNextLine();
      } else {
        this.finishPlayback();
      }
      return;
    }
    if (this.playing) {
      this.skipRequested = true;
      this.typeNextCharacter();
    }
  }

  private playNextLine() {
    if (this.playing) {
      return;
    }
    const next = this.queue.shift();
    if (next == null) {
      this.finishPlayback();
      return;
    }
    this.playing = true;
    this.currentLine = next;
    this.currentIndex = 0;
    this.typeNextCharacter();
  }

  private typeNextCharacter() {
    if (!this.playing) {
      return;
    }
    if (this.skipRequested) {
      const skip = this.skipRequested;
      this.skipRequested = false;
      this.refreshText(this.currentLine);
      this.handleLineComplete(skip);
      return;
    }

    this.currentIndex += 1;
    const partial = this.currentLine.slice(0, this.currentIndex);
    this.refreshText(partial);

    if (this.currentIndex >= this.currentLine.length) {
      this.handleLineComplete(false);
      return;
    }

    this.timer = this.scene.time.delayedCall(this.charDelay, () => {
      this.timer = undefined;
      this.typeNextCharacter();
    });
  }

  private handleLineComplete(skip: boolean) {
    this.displayed.push(this.currentLine);
    if (this.displayed.length > this.maxLines) {
      this.displayed = this.displayed.slice(-this.maxLines);
    }
    this.currentLine = '';
    this.currentIndex = 0;
    this.playing = false;
    this.refreshText();

    if (this.queue.length > 0) {
      const delay = skip ? this.fastLineDelay : this.lineDelay;
      if (delay <= 0) {
        this.playNextLine();
      } else {
        this.timer = this.scene.time.delayedCall(delay, () => {
          this.timer = undefined;
          this.playNextLine();
        });
      }
      return;
    }

    this.finishPlayback();
  }

  private finishPlayback() {
    this.timer = undefined;
    this.refreshText();
    if (this.drainResolve) {
      const resolve = this.drainResolve;
      this.drainResolve = undefined;
      this.drainPromise = undefined;
      resolve();
    }
  }

  private refreshText(partial?: string) {
    const visible: string[] = [];
    const start = Math.max(0, this.displayed.length - this.maxLines);
    for (let i = start; i < this.displayed.length; i += 1) {
      visible.push(this.displayed[i]);
    }
    if (partial !== undefined) {
      visible.push(partial);
    }
    const limited = visible.slice(-this.maxLines);
    this.text.setText(limited.join('\n'));
  }
}
