import Phaser from 'phaser';
import { CONFIG } from '@config/store';
import { Items, Skills, Enemies, Statuses } from '@content/registry';
import type { RuntimeItem, RuntimeSkill } from '@content/adapters';
import { createState } from '@engine/battle/state';
import { useItem, useSkill, endTurn, collectUsableTargets, attemptFlee } from '@engine/battle/actions';
import { tickStartOfTurn } from '@engine/battle/status';
import { resolveTargets } from '@engine/battle/targeting';
import type { Actor, BattleState, InventoryEntry, UseResult } from '@engine/battle/types';
import {
  PlayerProfile,
  WorldState,
  MerchantState,
  saveAll,
  clampInventory,
} from '@game/save';
import { BattleLogPlayer } from './BattleLogPlayer';

interface BattleInitData {
  profile: PlayerProfile;
  world: WorldState;
  enemyId: string;
  enemyLevel: number;
}

interface TargetButton {
  actorId: string;
  text: Phaser.GameObjects.Text;
}

const PLAYER_ID = 'player';

interface CardLayoutMetrics {
  padding: number;
  portraitDiameter: number;
  portraitX: number;
  portraitY: number;
  textX: number;
  nameY: number;
  classY: number;
  levelY: number;
  barsY: number;
  barHeight: number;
  barSpacing: number;
  statusY: number;
}

interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutMetrics {
  header: LayoutRect;
  stage: LayoutRect;
  sidebar: LayoutRect;
  footer: LayoutRect;
  rightColumnX: number;
  logWidth: number;
  logY: number;
  endTurnX: number;
  endTurnY: number;
  targetX: number;
  skillColumnX: number;
  itemColumnX: number;
  commandsY: number;
  playerCard: LayoutRect;
  enemyCard: { x: number; startY: number; width: number; height: number; spacing: number };
  cardLayout: CardLayoutMetrics;
}

interface ActorCardElements {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  portrait: Phaser.GameObjects.Ellipse;
  nameText: Phaser.GameObjects.Text;
  classText: Phaser.GameObjects.Text;
  levelText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  barArea: { x: number; y: number; width: number; height: number; spacing: number };
}

export class Battle extends Phaser.Scene {
  private profile!: PlayerProfile;
  private world!: WorldState;
  private state!: BattleState;
  private playerId = PLAYER_ID;
  private headerBackground!: Phaser.GameObjects.Graphics;
  private stageBackground!: Phaser.GameObjects.Graphics;
  private sidebarBackground!: Phaser.GameObjects.Graphics;
  private footerBackground!: Phaser.GameObjects.Graphics;
  private barGraphics!: Phaser.GameObjects.Graphics;
  private actorCards: Record<string, ActorCardElements> = {};
  private logText!: Phaser.GameObjects.Text;
  private logPlayer!: BattleLogPlayer;
  private headerTitle?: Phaser.GameObjects.Text;
  private skillButtons: Phaser.GameObjects.Text[] = [];
  private itemButtons: Phaser.GameObjects.Text[] = [];
  private endTurnButton?: Phaser.GameObjects.Text;
  private fleeButton?: Phaser.GameObjects.Text;
  private targetPrompt?: Phaser.GameObjects.Text;
  private targetButtons: TargetButton[] = [];
  private outcomeHandled = false;
  private layout?: LayoutMetrics;
  private busy = false;
  private targetSelectionActive = false;
  private lastAnnouncedActor?: string;
  private lastStartOfTurn?: { actorId: string; index: number; turn: number; prevented: boolean };
  private autoSkippingPlayer = false;

  constructor() {
    super('Battle');
  }

  create(data: BattleInitData) {
    this.outcomeHandled = false;
    this.profile = data.profile;
    this.world = data.world;
    const enemyFactory = Enemies()[data.enemyId];
    if (!enemyFactory) {
      this.scene.start('Overworld', { summary: [`Enemy ${data.enemyId} is not configured.`] });
      return;
    }

    const playerActor = this.createPlayerActor(this.profile);
    const enemyActor = enemyFactory(Math.max(1, Math.floor(data.enemyLevel)));

    this.state = createState({
      rngSeed: Math.floor(Math.random() * 1e9),
      actors: { [playerActor.id]: playerActor, [enemyActor.id]: enemyActor },
      sidePlayer: [playerActor.id],
      sideEnemy: [enemyActor.id],
      inventory: this.profile.inventory.map((entry) => ({ id: entry.id, qty: entry.qty })),
    });

    this.cameras.resize(this.scale.width, this.scale.height);
    this.layout = this.computeLayout();
    this.headerBackground = this.add.graphics().setDepth(-10).setScrollFactor(0);
    this.stageBackground = this.add.graphics().setDepth(-10).setScrollFactor(0);
    this.sidebarBackground = this.add.graphics().setDepth(-10).setScrollFactor(0);
    this.footerBackground = this.add.graphics().setDepth(-10).setScrollFactor(0);
    this.barGraphics = this.add.graphics();
    this.logText = this.add.text(this.layout.stage.x + 16, this.layout.logY, '', {
      color: '#8b8fa3',
      wordWrap: { width: this.layout.logWidth },
    });
    this.logPlayer = new BattleLogPlayer(this, this.logText);
    this.logPlayer.prime(this.state.log);

    this.buildStaticUi();
    this.layoutUi();
    this.renderActions();
    this.announceCurrentActor();
    this.renderState();

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private buildStaticUi() {
    const layout = this.layout ?? this.computeLayout();
    this.headerTitle = this.add.text(layout.header.x + 16, layout.header.y + 16, 'Battle — defeat all enemies!', {
      color: '#e6e8ef',
      fontSize: '18px',
    });
    for (const card of Object.values(this.actorCards)) {
      card.container.destroy(true);
    }
    this.actorCards = {};
    const playerActor = this.state.actors[this.playerId];
    if (playerActor) {
      this.actorCards[playerActor.id] = this.createActorCard(playerActor);
    }
    for (const enemyId of this.state.sideEnemy) {
      const actor = this.state.actors[enemyId];
      if (!actor) continue;
      this.actorCards[enemyId] = this.createActorCard(actor);
    }

    this.endTurnButton = this.add
      .text(layout.endTurnX, layout.endTurnY, '[End Turn]', { color: '#7c5cff' })
      .setInteractive({ useHandCursor: true });
    this.endTurnButton.on('pointerdown', () => {
      if (this.state.ended || this.busy || !this.isPlayerTurn() || this.targetSelectionActive) return;
      void this.handleEndTurn();
    });
  }

  private createActorCard(actor: Actor): ActorCardElements {
    const container = this.add.container(0, 0);
    container.setDepth(5);
    const background = this.add.graphics();
    container.add(background);

    const portrait = this.add.ellipse(0, 0, 56, 56, 0x1d223d, 0.9);
    portrait.setStrokeStyle(2, 0x2f3659, 0.9);
    container.add(portrait);

    const nameText = this.add.text(0, 0, actor.name, {
      color: '#f4f6ff',
      fontSize: '16px',
      fontStyle: 'bold',
    });
    const classText = this.add.text(0, 0, actor.clazz ?? 'Adventurer', {
      color: '#a99efc',
      fontSize: '13px',
    });
    const levelText = this.add.text(0, 0, `Lv. ${actor.stats.lv}`, {
      color: '#8b8fa3',
      fontSize: '12px',
    });
    const statusText = this.add.text(0, 0, '', {
      color: '#9da3c3',
      fontSize: '12px',
      wordWrap: { width: 180 },
    });

    container.add(nameText);
    container.add(classText);
    container.add(levelText);
    container.add(statusText);

    return {
      container,
      background,
      portrait,
      nameText,
      classText,
      levelText,
      statusText,
      barArea: { x: 0, y: 0, width: 0, height: 0, spacing: 0 },
    };
  }

  private layoutActorCard(card: ActorCardElements, rect: LayoutRect, metrics: CardLayoutMetrics) {
    card.container.setPosition(rect.x, rect.y);
    card.container.setSize(rect.width, rect.height);

    const radius = 18;
    card.background.clear();
    card.background.fillGradientStyle(0x1a1f3c, 0x1a1f3c, 0x13172c, 0x151a33, 0.95);
    card.background.fillRoundedRect(0, 0, rect.width, rect.height, radius);
    card.background.lineStyle(2, 0x262d4f, 0.75);
    card.background.strokeRoundedRect(0, 0, rect.width, rect.height, radius);
    card.background.fillStyle(0xffffff, 0.04);
    card.background.fillRoundedRect(2, 2, rect.width - 4, Math.max(10, rect.height * 0.28), {
      tl: radius - 2,
      tr: radius - 2,
      bl: Math.max(6, radius - 12),
      br: Math.max(6, radius - 12),
    });

    card.portrait.setPosition(metrics.portraitX, metrics.portraitY);
    card.portrait.setDisplaySize(metrics.portraitDiameter, metrics.portraitDiameter);

    const contentWidth = Math.max(0, rect.width - metrics.textX - metrics.padding);
    const textMaxWidth = contentWidth;
    card.nameText.setPosition(metrics.textX, metrics.nameY);
    card.nameText.setMaxWidth(textMaxWidth);
    card.classText.setPosition(metrics.textX, metrics.classY);
    card.classText.setMaxWidth(textMaxWidth);
    card.levelText.setPosition(metrics.textX, metrics.levelY);
    card.levelText.setMaxWidth(textMaxWidth);
    card.statusText.setPosition(metrics.textX, metrics.statusY);
    card.statusText.setWordWrapWidth(Math.max(1, textMaxWidth));

    card.barArea = {
      x: metrics.textX,
      y: metrics.barsY,
      width: Math.max(0, contentWidth),
      height: metrics.barHeight,
      spacing: metrics.barSpacing,
    };
  }

  private renderActions() {
    for (const btn of this.skillButtons) btn.destroy();
    for (const btn of this.itemButtons) btn.destroy();
    if (this.fleeButton) {
      this.fleeButton.destroy();
      this.fleeButton = undefined;
    }
    this.skillButtons = [];
    this.itemButtons = [];

    const layout = this.layout ?? this.computeLayout();
    this.fleeButton = this.add
      .text(layout.endTurnX - 120, layout.endTurnY, '[Flee]', { color: '#7c5cff' })
      .setInteractive({ useHandCursor: true });
    this.fleeButton.on('pointerdown', () => {
      if (this.state.ended || this.busy || !this.isPlayerTurn() || this.targetSelectionActive) return;
      void this.handleFlee();
    });

    const skillX = layout.skillColumnX;
    let skillY = layout.commandsY;
    for (const id of this.profile.equippedSkills) {
      const skill = Skills()[id];
      if (!skill) continue;
      const label = `[Skill] ${skill.name}`;
      const text = this.add
        .text(skillX, skillY, label, { color: '#7c5cff' })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        if (this.state.ended || this.busy || !this.isPlayerTurn() || this.targetSelectionActive) return;
        void this.handleSkill(skill);
      });
      this.skillButtons.push(text);
      skillY += 24;
    }

    const stackItems = layout.itemColumnX <= skillX + 24;
    const itemX = stackItems ? skillX : layout.itemColumnX;
    let itemY = stackItems
      ? (this.skillButtons.length ? skillY + 16 : layout.commandsY)
      : layout.commandsY;
    for (const entry of this.state.inventory) {
      const item = Items()[entry.id];
      if (!item) continue;
      const label = `[Item] ${item.name} x${entry.qty}`;
      const text = this.add
        .text(itemX, itemY, label, { color: '#7c5cff' })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        if (this.state.ended || this.busy || !this.isPlayerTurn() || this.targetSelectionActive) return;
        void this.handleItem(item);
      });
      this.itemButtons.push(text);
      itemY += 24;
    }

    this.refreshCommandAvailability();
  }

  private async handleSkill(skill: RuntimeSkill) {
    this.clearTargetPicker();
    const selector = skill.targeting;
    if (this.needsManualTarget(selector)) {
      const targets = this.collectTargets(selector, this.playerId, skill.name);
      if (!targets.length) {
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        this.refreshCommandAvailability();
        return;
      }
      this.targetSelectionActive = true;
      this.refreshCommandAvailability();
      this.promptForTarget(targets, (targetId) => {
        void this.runPlayerAction(() => {
          const result = useSkill(this.state, skill, this.playerId, [targetId]);
          return { result, autoAdvance: result.ok };
        });
      });
    } else {
      await this.runPlayerAction(() => {
        const result = useSkill(this.state, skill, this.playerId);
        return { result, autoAdvance: result.ok };
      });
    }
  }

  private async handleItem(item: RuntimeItem) {
    this.clearTargetPicker();
    const selector = item.targeting;
    if (this.needsManualTarget(selector)) {
      const targets = this.collectTargets(selector, this.playerId, item.name);
      if (!targets.length) {
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        this.refreshCommandAvailability();
        return;
      }
      this.targetSelectionActive = true;
      this.refreshCommandAvailability();
      this.promptForTarget(targets, (targetId) => {
        void this.runPlayerAction(() => {
          const result = useItem(this.state, item, this.playerId, [targetId]);
          return { result, autoAdvance: result.ok };
        });
      });
    } else {
      await this.runPlayerAction(() => {
        const result = useItem(this.state, item, this.playerId);
        return { result, autoAdvance: result.ok };
      });
    }
  }

  private async handleFlee() {
    if (this.busy || this.state.ended || !this.isPlayerTurn()) return;
    await this.runPlayerAction(() => {
      const result = attemptFlee(this.state, this.playerId);
      return { result, autoAdvance: true };
    });
  }

  private async runPlayerAction(
    executor: () => { result: UseResult; autoAdvance?: boolean },
  ) {
    if (this.busy) return;
    this.busy = true;
    this.refreshCommandAvailability();
    this.clearTargetPicker();
    const { result, autoAdvance } = executor();
    await this.afterAction({ autoAdvance: autoAdvance ?? result.ok });
    this.busy = false;
    this.refreshCommandAvailability();
  }

  private async handleEndTurn() {
    if (this.busy || this.state.ended || !this.isPlayerTurn()) return;
    this.busy = true;
    this.refreshCommandAvailability();
    this.clearTargetPicker();
    await this.advanceTurnAfterPlayer();
    this.busy = false;
    this.refreshCommandAvailability();
  }

  private announceCurrentActor() {
    const actorId = this.state.order[this.state.current];
    if (!actorId) return;
    const actor = this.state.actors[actorId];
    if (!actor) return;
    const canAct = this.announceActor(actor);
    if (!canAct && this.state.sidePlayer.includes(actor.id)) {
      void this.autoSkipPlayerTurn();
    }
  }

  private announceActor(actor: Actor): boolean {
    if (!actor.alive) {
      const message = `${actor.name} cannot act.`;
      if (this.state.log[this.state.log.length - 1] !== message) {
        this.state.log.push(message);
      }
      this.lastAnnouncedActor = actor.id;
      return false;
    }

    const canAct = this.evaluateStartOfTurn(actor);
    if (!canAct) {
      this.lastAnnouncedActor = actor.id;
      return false;
    }

    const isPlayer = this.state.sidePlayer.includes(actor.id);
    const message = isPlayer
      ? `${actor.name} is preparing to act.`
      : `${actor.name} prepares to act.`;
    if (this.lastAnnouncedActor === actor.id && this.state.log[this.state.log.length - 1] === message) {
      return true;
    }
    this.lastAnnouncedActor = actor.id;
    this.state.log.push(message);
    return true;
  }

  private evaluateStartOfTurn(actor: Actor): boolean {
    const snapshot = this.lastStartOfTurn;
    if (
      snapshot &&
      snapshot.actorId === actor.id &&
      snapshot.turn === this.state.turn &&
      snapshot.index === this.state.current
    ) {
      return !snapshot.prevented;
    }

    const prevented = tickStartOfTurn(this.state, actor);
    this.lastStartOfTurn = {
      actorId: actor.id,
      index: this.state.current,
      turn: this.state.turn,
      prevented,
    };
    return !prevented;
  }

  private async autoSkipPlayerTurn() {
    if (this.autoSkippingPlayer || this.state.ended) {
      return;
    }
    this.autoSkippingPlayer = true;
    const previousBusy = this.busy;
    this.busy = true;
    this.refreshCommandAvailability();
    this.clearTargetPicker();
    await this.logPlayer.drain();
    await this.advanceTurnAfterPlayer();
    this.busy = previousBusy;
    this.autoSkippingPlayer = false;
    this.refreshCommandAvailability();
  }

  private needsManualTarget(selector: RuntimeSkill['targeting']): boolean {
    return selector.mode === 'single' && selector.side !== 'self';
  }

  private collectTargets(
    selector: RuntimeSkill['targeting'],
    userId: string,
    actionName?: string,
  ): string[] {
    const targetingSeed = this.state.rngSeed;
    const candidateSelector: RuntimeSkill['targeting'] = {
      ...selector,
      mode: 'condition',
      count: undefined,
      includeDead: selector.includeDead ?? false,
    };
    let filtered: string[];
    try {
      filtered = resolveTargets(this.state, candidateSelector, userId);
    } finally {
      this.state.rngSeed = targetingSeed;
    }
    if (filtered.length === 0) {
      const label = actionName ?? 'This action';
      this.state.log.push(`${label} has no valid targets.`);
    }
    return filtered;
  }

  private promptForTarget(candidates: string[], onPick: (targetId: string) => void) {
    this.clearTargetPicker();
    if (!candidates.length) {
      return;
    }
    this.targetSelectionActive = true;
    this.refreshCommandAvailability();
    const layout = this.layout ?? this.computeLayout();
    const baseY = layout.sidebar.height > 0 ? layout.sidebar.y + 16 : layout.stage.y + 16;
    this.targetPrompt = this.add.text(layout.targetX, baseY, 'Choose target:', { color: '#e6e8ef' });
    let y = baseY + 30;
    for (const id of candidates) {
      const actor = this.state.actors[id];
      if (!actor) continue;
      const text = this.add
        .text(layout.targetX, y, `${actor.name} (${Math.max(0, actor.stats.hp)}/${actor.stats.maxHp})`, {
          color: '#7c5cff',
        })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        onPick(id);
      });
      this.targetButtons.push({ actorId: id, text });
      y += 22;
    }
    const cancel = this.add
      .text(layout.targetX, y + 10, '[Cancel]', { color: '#8b8fa3' })
      .setInteractive({ useHandCursor: true });
    cancel.on('pointerdown', () => {
      this.clearTargetPicker();
    });
    this.targetButtons.push({ actorId: 'cancel', text: cancel });
  }

  private clearTargetPicker() {
    if (this.targetPrompt) {
      this.targetPrompt.destroy();
      this.targetPrompt = undefined;
    }
    for (const entry of this.targetButtons) entry.text.destroy();
    this.targetButtons = [];
    this.targetSelectionActive = false;
    this.refreshCommandAvailability();
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    const width = Math.max(1, gameSize.width ?? this.scale.width);
    const height = Math.max(1, gameSize.height ?? this.scale.height);
    this.cameras.resize(width, height);
    this.layoutUi();
    this.renderState();
  }

  private computeLayout(width = this.scale.width, height = this.scale.height): LayoutMetrics {
    const safeWidth = Math.max(360, width);
    const safeHeight = Math.max(320, height);
    const padding = 20;
    const gap = 20;
    const headerHeight = 64;
    const contentWidth = Math.max(160, safeWidth - padding * 2);
    const columnsWidth = Math.max(120, contentWidth - gap);
    const desiredStageRatio = 0.58;
    let stageWidth = Math.round(columnsWidth * desiredStageRatio);
    let sidebarWidth = columnsWidth - stageWidth;
    const desiredStageMin = 160;
    const desiredSidebarMin = 160;
    if (stageWidth < desiredStageMin) {
      stageWidth = desiredStageMin;
      sidebarWidth = columnsWidth - stageWidth;
    }
    if (sidebarWidth < desiredSidebarMin) {
      sidebarWidth = desiredSidebarMin;
      stageWidth = columnsWidth - sidebarWidth;
    }
    if (stageWidth < 120) {
      stageWidth = 120;
      sidebarWidth = columnsWidth - stageWidth;
    }
    if (sidebarWidth < 120) {
      sidebarWidth = 120;
      stageWidth = columnsWidth - sidebarWidth;
    }
    if (stageWidth + sidebarWidth > columnsWidth) {
      const total = stageWidth + sidebarWidth;
      if (total > 0) {
        const scale = columnsWidth / total;
        stageWidth = Math.max(80, Math.round(stageWidth * scale));
        sidebarWidth = Math.max(80, Math.round(sidebarWidth * scale));
      }
    }
    stageWidth = Math.min(stageWidth, columnsWidth);
    sidebarWidth = Math.max(0, columnsWidth - stageWidth);

    const headerRect: LayoutRect = {
      x: padding,
      y: padding,
      width: contentWidth,
      height: headerHeight,
    };

    const stageRect: LayoutRect = {
      x: padding,
      y: headerRect.y + headerRect.height + gap,
      width: stageWidth,
      height: 0,
    };
    const sidebarRect: LayoutRect = {
      x: stageRect.x + stageRect.width + gap,
      y: stageRect.y,
      width: Math.max(0, contentWidth - stageRect.width - gap),
      height: 0,
    };

    const totalBelowHeader = Math.max(0, safeHeight - (stageRect.y + padding));
    let footerHeight = Math.max(100, Math.round(totalBelowHeader * 0.35));
    const minFooterHeight = 80;
    if (footerHeight > totalBelowHeader - 120) {
      footerHeight = Math.max(minFooterHeight, totalBelowHeader - 120);
    }
    footerHeight = Math.max(minFooterHeight, Math.min(footerHeight, totalBelowHeader));
    let stageHeight = Math.max(160, totalBelowHeader - footerHeight - gap);
    if (stageHeight < 160) {
      stageHeight = Math.max(100, totalBelowHeader - footerHeight - gap);
    }
    if (stageHeight < 100) {
      stageHeight = Math.max(60, totalBelowHeader - footerHeight - gap);
    }
    if (stageHeight + footerHeight + gap > totalBelowHeader) {
      const excess = stageHeight + footerHeight + gap - totalBelowHeader;
      stageHeight = Math.max(60, stageHeight - excess);
      if (stageHeight + footerHeight + gap > totalBelowHeader) {
        footerHeight = Math.max(minFooterHeight, footerHeight - (stageHeight + footerHeight + gap - totalBelowHeader));
      }
    }
    stageHeight = Math.max(60, Math.min(stageHeight, totalBelowHeader));
    const footerRect: LayoutRect = {
      x: padding,
      y: stageRect.y + stageHeight + gap,
      width: contentWidth,
      height: Math.max(0, Math.min(footerHeight, safeHeight - (stageRect.y + stageHeight + gap) - padding)),
    };
    if (footerRect.height < minFooterHeight) {
      footerRect.height = Math.max(minFooterHeight, safeHeight - footerRect.y - padding);
    }
    stageRect.height = Math.max(0, Math.min(stageHeight, footerRect.y - stageRect.y - gap));
    sidebarRect.height = Math.max(stageRect.height, footerRect.y - stageRect.y - gap);

    const stageRight = stageRect.x + stageRect.width;
    const logWidth = Math.max(240, stageRect.width - 32);
    let logY = stageRect.y + stageRect.height - 120;
    logY = Math.min(logY, footerRect.y - 120);
    logY = Math.max(stageRect.y + 20, logY);
    const commandsY = footerRect.y + 16;
    const skillColumnX = stageRect.x + 16;
    let itemColumnX = stageRect.x + 220;
    if (itemColumnX + 160 > stageRight) {
      itemColumnX = stageRect.x + Math.max(16, Math.min(stageRect.width - 160, Math.round(stageRect.width / 2) + 16));
    }
    if (itemColumnX + 120 > stageRight) {
      itemColumnX = skillColumnX;
    }
    const computeCardWidth = (available: number) => {
      const safe = Math.max(0, available);
      if (safe <= 0) return 0;
      if (safe < 160) return safe;
      return Math.min(safe, 340);
    };

    const cardPadding = 16;
    const portraitDiameter = 56;
    const barHeight = 16;
    const barSpacing = barHeight + 6;
    const barsY = cardPadding + portraitDiameter + 6;
    const statusY = barsY + barSpacing * 2 + barHeight + 8;
    const cardHeight = statusY + Math.max(28, cardPadding + 12);
    const cardLayout: CardLayoutMetrics = {
      padding: cardPadding,
      portraitDiameter,
      portraitX: cardPadding + portraitDiameter / 2,
      portraitY: cardPadding + portraitDiameter / 2,
      textX: cardPadding + portraitDiameter + 12,
      nameY: cardPadding,
      classY: cardPadding + 24,
      levelY: cardPadding + 46,
      barsY,
      barHeight,
      barSpacing,
      statusY,
    };

    const playerCardWidth = computeCardWidth(stageRect.width - cardPadding * 2);
    const playerCard: LayoutRect = {
      x: stageRect.x + cardPadding,
      y: stageRect.y + cardPadding,
      width: Math.max(0, playerCardWidth),
      height: cardHeight,
    };

    const sidebarAvailableWidth = sidebarRect.width > 0 ? sidebarRect.width : stageRect.width;
    const enemyCardWidth = computeCardWidth(sidebarAvailableWidth - cardPadding * 2);
    const enemyCardHeight = cardHeight;
    const enemyColumnX =
      sidebarRect.width > 0 ? sidebarRect.x + cardPadding : Math.max(stageRect.x + cardPadding, playerCard.x);
    const enemyStartY =
      sidebarRect.width > 0 ? sidebarRect.y + cardPadding : playerCard.y + playerCard.height + cardPadding;
    const enemySpacing = enemyCardHeight + cardPadding;
    const targetXCandidate = sidebarRect.width > 0 ? sidebarRect.x + 16 : stageRight - 160;
    const targetX = Math.max(stageRect.x + 16, targetXCandidate);
    const endTurnX = Math.max(skillColumnX, footerRect.x + footerRect.width - 140);
    const endTurnY = footerRect.y + Math.max(32, footerRect.height - 48);
    const rightColumnX = sidebarRect.width > 0 ? sidebarRect.x + 16 : stageRight + 16;

    return {
      header: headerRect,
      stage: stageRect,
      sidebar: sidebarRect,
      footer: footerRect,
      rightColumnX,
      logWidth,
      logY,
      endTurnX,
      endTurnY,
      targetX,
      skillColumnX,
      itemColumnX,
      commandsY,
      playerCard,
      enemyCard: { x: enemyColumnX, startY: enemyStartY, width: Math.max(0, enemyCardWidth), height: enemyCardHeight, spacing: enemySpacing },
      cardLayout,
    };
  }

  private redrawBackgrounds(layout: LayoutMetrics) {
    if (!this.headerBackground || !this.stageBackground || !this.sidebarBackground || !this.footerBackground) {
      return;
    }
    const borderColor = 0x20264a;
    const headerRadius = 12;
    const panelRadius = 16;

    this.headerBackground.clear();
    if (layout.header.width > 0 && layout.header.height > 0) {
      this.headerBackground.fillStyle(0x141830, 0.95);
      this.headerBackground.fillRoundedRect(
        layout.header.x,
        layout.header.y,
        layout.header.width,
        layout.header.height,
        headerRadius,
      );
      this.headerBackground.lineStyle(2, borderColor, 0.8);
      this.headerBackground.strokeRoundedRect(
        layout.header.x,
        layout.header.y,
        layout.header.width,
        layout.header.height,
        headerRadius,
      );
    }

    this.stageBackground.clear();
    if (layout.stage.width > 0 && layout.stage.height > 0) {
      this.stageBackground.fillGradientStyle(0x141830, 0x1a1f3a, 0x0f1220, 0x10152a, 1);
      this.stageBackground.fillRect(layout.stage.x, layout.stage.y, layout.stage.width, layout.stage.height);
      this.stageBackground.lineStyle(2, borderColor, 0.7);
      this.stageBackground.strokeRect(layout.stage.x, layout.stage.y, layout.stage.width, layout.stage.height);
    }

    this.sidebarBackground.clear();
    if (layout.sidebar.width > 0 && layout.sidebar.height > 0) {
      this.sidebarBackground.fillStyle(0x141830, 0.92);
      this.sidebarBackground.fillRoundedRect(
        layout.sidebar.x,
        layout.sidebar.y,
        layout.sidebar.width,
        layout.sidebar.height,
        panelRadius,
      );
      this.sidebarBackground.lineStyle(2, borderColor, 0.7);
      this.sidebarBackground.strokeRoundedRect(
        layout.sidebar.x,
        layout.sidebar.y,
        layout.sidebar.width,
        layout.sidebar.height,
        panelRadius,
      );
    }

    this.footerBackground.clear();
    if (layout.footer.width > 0 && layout.footer.height > 0) {
      this.footerBackground.fillStyle(0x141830, 0.92);
      this.footerBackground.fillRoundedRect(
        layout.footer.x,
        layout.footer.y,
        layout.footer.width,
        layout.footer.height,
        panelRadius,
      );
      this.footerBackground.lineStyle(2, borderColor, 0.7);
      this.footerBackground.strokeRoundedRect(
        layout.footer.x,
        layout.footer.y,
        layout.footer.width,
        layout.footer.height,
        panelRadius,
      );
    }
  }

  private layoutUi() {
    this.layout = this.computeLayout();
    const layout = this.layout;
    if (!layout) return;
    this.redrawBackgrounds(layout);
    this.logText.setPosition(layout.stage.x + 16, layout.logY);
    this.logText.setWordWrapWidth(layout.logWidth);
    if (this.headerTitle) {
      this.headerTitle.setPosition(layout.header.x + 16, layout.header.y + 16);
    }
    if (this.endTurnButton) {
      this.endTurnButton.setPosition(layout.endTurnX, layout.endTurnY);
    }
    if (this.fleeButton) {
      this.fleeButton.setPosition(layout.endTurnX - 120, layout.endTurnY);
    }

    let skillY = layout.commandsY;
    for (const btn of this.skillButtons) {
      btn.setPosition(layout.skillColumnX, skillY);
      skillY += 24;
    }
    const stackItems = layout.itemColumnX <= layout.skillColumnX + 24;
    const itemX = stackItems ? layout.skillColumnX : layout.itemColumnX;
    let itemY = stackItems
      ? (this.skillButtons.length ? skillY + 16 : layout.commandsY)
      : layout.commandsY;
    for (const btn of this.itemButtons) {
      btn.setPosition(itemX, itemY);
      itemY += 24;
    }
    if (this.targetPrompt) {
      const baseY = layout.sidebar.height > 0 ? layout.sidebar.y + 16 : layout.stage.y + 16;
      this.targetPrompt.setPosition(layout.targetX, baseY);
      let y = baseY + 30;
      for (const entry of this.targetButtons) {
        if (entry.actorId === 'cancel') {
          entry.text.setPosition(layout.targetX, y + 10);
        } else {
          entry.text.setPosition(layout.targetX, y);
          y += 22;
        }
      }
    }
  }

  private isPlayerTurn(): boolean {
    const currentId = this.state.order[this.state.current];
    return !!currentId && this.state.sidePlayer.includes(currentId);
  }

  private refreshCommandAvailability() {
    const enabled = !this.state.ended && this.isPlayerTurn() && !this.busy && !this.targetSelectionActive;
    for (const btn of this.skillButtons) {
      if (enabled) {
        btn.setInteractive({ useHandCursor: true });
        btn.setAlpha(1);
      } else {
        btn.disableInteractive();
        btn.setAlpha(0.6);
      }
    }
    for (const btn of this.itemButtons) {
      if (enabled) {
        btn.setInteractive({ useHandCursor: true });
        btn.setAlpha(1);
      } else {
        btn.disableInteractive();
        btn.setAlpha(0.6);
      }
    }
    if (this.endTurnButton) {
      if (enabled) {
        this.endTurnButton.setInteractive({ useHandCursor: true });
        this.endTurnButton.setAlpha(1);
      } else {
        this.endTurnButton.disableInteractive();
        this.endTurnButton.setAlpha(0.6);
      }
    }
    if (this.fleeButton) {
      if (enabled) {
        this.fleeButton.setInteractive({ useHandCursor: true });
        this.fleeButton.setAlpha(1);
      } else {
        this.fleeButton.disableInteractive();
        this.fleeButton.setAlpha(0.6);
      }
    }
  }

  private async afterAction(options: { autoAdvance?: boolean } = {}) {
    clampInventory(this.state.inventory);
    this.renderActions();
    this.renderState();
    this.layoutUi();
    await this.logPlayer.drain();
    if (this.state.ended) {
      this.checkOutcome();
      return;
    }
    if (options.autoAdvance) {
      await this.advanceTurnAfterPlayer();
    } else {
      this.checkOutcome();
    }
  }

  private async advanceTurnAfterPlayer() {
    endTurn(this.state);
    clampInventory(this.state.inventory);
    this.renderActions();
    this.renderState();
    this.layoutUi();
    await this.logPlayer.drain();
    this.checkOutcome();
    if (this.state.ended) {
      return;
    }
    await this.processEnemyTurns();
  }

  private async processEnemyTurns() {
    let guard = 0;
    while (!this.state.ended && guard < 100) {
      guard += 1;
      const actorId = this.state.order[this.state.current];
      if (!actorId) {
        endTurn(this.state);
        clampInventory(this.state.inventory);
        this.renderActions();
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        continue;
      }
      const actor = this.state.actors[actorId];
      if (!actor) {
        endTurn(this.state);
        clampInventory(this.state.inventory);
        this.renderActions();
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        continue;
      }
      if (!actor.alive) {
        const message = `${actor.name} cannot act.`;
        if (this.state.log[this.state.log.length - 1] !== message) {
          this.state.log.push(message);
        }
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        endTurn(this.state);
        clampInventory(this.state.inventory);
        this.renderActions();
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        continue;
      }

      const canAct = this.announceActor(actor);
      this.renderActions();
      this.renderState();
      this.layoutUi();
      await this.logPlayer.drain();

      if (!canAct) {
        this.refreshCommandAvailability();
        this.checkOutcome();
        if (this.state.ended) {
          return;
        }
        endTurn(this.state);
        clampInventory(this.state.inventory);
        this.renderActions();
        this.renderState();
        this.layoutUi();
        await this.logPlayer.drain();
        this.refreshCommandAvailability();
        this.checkOutcome();
        if (this.state.ended) {
          return;
        }
        continue;
      }

      const isEnemy = this.state.sideEnemy.includes(actorId);
      if (!isEnemy) {
        this.refreshCommandAvailability();
        this.checkOutcome();
        return;
      }

      this.executeEnemyTurn(actor);
      clampInventory(this.state.inventory);
      this.renderActions();
      this.renderState();
      this.layoutUi();
      await this.logPlayer.drain();
      this.checkOutcome();
      if (this.state.ended) {
        return;
      }

      endTurn(this.state);
      clampInventory(this.state.inventory);
      this.renderActions();
      this.renderState();
      this.layoutUi();
      await this.logPlayer.drain();
      this.refreshCommandAvailability();
      this.checkOutcome();
      if (this.state.ended) {
        return;
      }
    }

    this.refreshCommandAvailability();
    this.checkOutcome();
  }

  private executeEnemyTurn(actor: Actor) {
    const skills = actor.meta?.skillIds ?? [];
    const skillMap = Skills();
    let chosen: RuntimeSkill | undefined;
    let bestWeight = -Infinity;
    for (const id of skills) {
      const skill = skillMap[id];
      if (!skill) continue;
      if (!this.canEnemyUseSkill(actor, skill)) {
        continue;
      }
      const weight = typeof skill.aiWeight === 'number' ? skill.aiWeight : 1;
      if (!chosen || weight > bestWeight) {
        chosen = skill;
        bestWeight = weight;
      }
    }

    if (chosen) {
      useSkill(this.state, chosen, actor.id);
      return;
    }

    this.state.log.push(`${actor.name} waits cautiously.`);
  }

  private canEnemyUseSkill(actor: Actor, skill: RuntimeSkill): boolean {
    if (actor.stats.sta < (skill.costs?.sta ?? 0)) {
      return false;
    }
    if (actor.stats.mp < (skill.costs?.mp ?? 0)) {
      return false;
    }
    const cooldown = this.state.cooldowns[actor.id]?.[skill.id];
    if (cooldown && cooldown > 0) {
      return false;
    }
    const charge = this.state.charges[actor.id]?.[skill.id];
    if (skill.costs?.charges != null && charge && charge.remaining <= 0) {
      return false;
    }
    const prevSeed = this.state.rngSeed;
    const result = collectUsableTargets(this.state, skill, actor);
    this.state.rngSeed = prevSeed;
    return result.ok;
  }

  private renderState() {
    this.barGraphics.clear();
    const player = this.state.actors[this.playerId];
    const layout = this.layout ?? this.computeLayout();
    this.layout = layout;
    if (player) {
      this.updateActorPanel(player, layout.playerCard);
    }
    this.state.sideEnemy.forEach((enemyId, index) => {
      const actor = this.state.actors[enemyId];
      if (!actor) return;
      const cardRect: LayoutRect = {
        x: layout.enemyCard.x,
        y: layout.enemyCard.startY + index * layout.enemyCard.spacing,
        width: layout.enemyCard.width,
        height: layout.enemyCard.height,
      };
      this.updateActorPanel(actor, cardRect);
    });
    this.logPlayer.sync(this.state.log);
  }

  private updateActorPanel(actor: Actor, rect: LayoutRect) {
    const layout = this.layout ?? this.computeLayout();
    const cardLayout = layout.cardLayout;
    let card = this.actorCards[actor.id];
    if (!card) {
      card = this.createActorCard(actor);
      this.actorCards[actor.id] = card;
    }
    this.layoutActorCard(card, rect, cardLayout);

    card.nameText.setText(actor.name);
    card.classText.setText(actor.clazz ?? 'Adventurer');
    card.levelText.setText(`Lv. ${actor.stats.lv}`);

    const statuses = actor.statuses.length
      ? actor.statuses
          .map((s) => {
            const template = Statuses()[s.id];
            const icon = template?.icon ?? template?.name ?? s.id;
            const stackStr = s.stacks && s.stacks > 1 ? ` x${s.stacks}` : '';
            return `${icon ?? s.id} (${s.turns}${stackStr})`;
          })
          .join(', ')
      : 'None';
    card.statusText.setText(`Status: ${statuses}`);

    this.drawBars(card, actor.stats);
  }

  private drawBars(card: ActorCardElements, stats: Actor['stats']) {
    const area = card.barArea;
    if (area.width <= 0 || area.height <= 0) {
      return;
    }
    const baseX = card.container.x + area.x;
    const baseY = card.container.y + area.y;
    this.drawBar(baseX, baseY, area.width, area.height, stats.hp / Math.max(1, stats.maxHp), 0xff4f64);
    this.drawBar(
      baseX,
      baseY + area.spacing,
      area.width,
      area.height,
      stats.sta / Math.max(1, stats.maxSta || 1),
      0x3ab0ff,
    );
    this.drawBar(
      baseX,
      baseY + area.spacing * 2,
      area.width,
      area.height,
      stats.mp / Math.max(1, stats.maxMp || 1),
      0x7c5cff,
    );
  }

  private drawBar(x: number, y: number, width: number, height: number, pct: number, color: number) {
    const clamped = Phaser.Math.Clamp(pct, 0, 1);
    const radius = height / 2;

    this.barGraphics.fillStyle(0x10142a, 0.95);
    this.barGraphics.fillRoundedRect(x, y, width, height, radius);
    this.barGraphics.lineStyle(2, 0x060914, 0.7);
    this.barGraphics.strokeRoundedRect(x, y, width, height, radius);

    const innerX = x + 2;
    const innerY = y + 2;
    const innerWidth = Math.max(0, width - 4);
    const innerHeight = Math.max(0, height - 4);
    const innerRadius = Math.max(0, radius - 2);

    this.barGraphics.fillStyle(0x000000, 0.25);
    this.barGraphics.fillRoundedRect(innerX, innerY, innerWidth, innerHeight, innerRadius);

    const filledWidth = Math.max(0, innerWidth * clamped);
    if (filledWidth > 0) {
      const topColor = this.mixColor(color, 0xffffff, 0.3);
      const bottomColor = this.mixColor(color, 0x000000, 0.35);
      this.barGraphics.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
      this.barGraphics.fillRoundedRect(innerX, innerY, filledWidth, innerHeight, innerRadius);

      this.barGraphics.fillStyle(0xffffff, 0.12);
      this.barGraphics.fillRoundedRect(innerX, innerY, filledWidth, Math.max(2, innerHeight * 0.45), innerRadius);

      if (filledWidth > 4) {
        this.barGraphics.lineStyle(1, 0xffffff, 0.15);
        this.barGraphics.strokeRoundedRect(
          innerX + 1,
          innerY + 1,
          filledWidth - 2,
          Math.max(0, innerHeight - 2),
          Math.max(0, innerRadius - 1),
        );
      }
    }
  }

  private mixColor(color: number, target: number, amount: number): number {
    const clampAmount = Phaser.Math.Clamp(amount, 0, 1);
    const cr = (color >> 16) & 0xff;
    const cg = (color >> 8) & 0xff;
    const cb = color & 0xff;
    const tr = (target >> 16) & 0xff;
    const tg = (target >> 8) & 0xff;
    const tb = target & 0xff;
    const r = Math.round(cr + (tr - cr) * clampAmount);
    const g = Math.round(cg + (tg - cg) * clampAmount);
    const b = Math.round(cb + (tb - cb) * clampAmount);
    return (r << 16) | (g << 8) | b;
  }

  private checkOutcome() {
    if (!this.state.ended || this.outcomeHandled) return;
    this.outcomeHandled = true;
    const summary = this.processOutcome();
    this.time.delayedCall(600, () => {
      this.scene.start('Overworld', { summary });
    });
  }

  private processOutcome(): string[] {
    const summary: string[] = [];
    const balance = CONFIG().balance;
    const reason = this.state.ended?.reason;
    this.world.turn = (this.world.turn ?? 0) + 1;
    for (const merchant of Object.values(this.world.merchants as Record<string, MerchantState>)) {
      if (merchant.restockIn > 0) {
        merchant.restockIn = Math.max(0, merchant.restockIn - 1);
      }
    }

    this.profile.inventory = this.state.inventory.map((entry) => ({ id: entry.id, qty: entry.qty }));
    clampInventory(this.profile.inventory);

    if (reason === 'victory') {
      const rewards = this.calculateRewards(balance.XP_CURVE, balance.GOLD_DROP, balance.LOOT_ROLLS);
      this.profile.xp += rewards.xp;
      this.profile.stats.xp = this.profile.xp;
      this.profile.gold += rewards.gold;
      this.profile.stats.gold = this.profile.gold;
      this.applyLoot(rewards.loot);
      this.updateLevelFromXp(balance.XP_CURVE);
      summary.push(`Victory! +${rewards.xp} XP, +${rewards.gold} gold.`);
      if (rewards.loot.length) {
        summary.push(`Loot: ${rewards.loot.map((l) => `${l.id} x${l.qty}`).join(', ')}`);
      }
    } else if (reason === 'defeat') {
      const economy: any = balance.ECONOMY ?? {};
      const penaltyPct = typeof economy.defeatPenaltyPct === 'number' ? Math.min(1, Math.max(0, economy.defeatPenaltyPct)) : 1;
      const goldLoss = Math.round(this.profile.gold * penaltyPct);
      this.profile.gold = Math.max(0, this.profile.gold - goldLoss);
      this.profile.stats.gold = this.profile.gold;
      summary.push(`Defeated. Lost ${goldLoss} gold.`);
    } else if (reason === 'fled') {
      summary.push('You fled the battle.');
    }

    this.profile.stats.hp = this.profile.stats.maxHp;
    this.profile.stats.sta = this.profile.stats.maxSta;
    this.profile.stats.mp = this.profile.stats.maxMp;

    saveAll(this.profile, this.world);
    return summary;
  }

  private calculateRewards(
    curve: { base: number; growth: number },
    goldDrop: { mean: number; variance: number },
    lootRolls: number,
  ) {
    let xp = 0;
    let gold = 0;
    const loot: InventoryEntry[] = [];
    const rolls = Math.max(1, Math.round(lootRolls || 1));
    for (const id of this.state.sideEnemy) {
      const enemy = this.state.actors[id];
      if (!enemy) continue;
      xp += Math.round(curve.base + curve.growth * enemy.stats.lv);
      gold += Math.max(0, Math.round(goldDrop.mean + goldDrop.variance * enemy.stats.lv));
      const drops = enemy.meta?.itemDrops;
      if (drops) {
        for (const drop of drops) {
          if (!drop.id || !drop.qty) continue;
          this.mergeInventoryEntries(loot, { id: drop.id, qty: drop.qty * rolls });
        }
      }
    }
    return { xp, gold, loot };
  }

  private applyLoot(loot: InventoryEntry[]) {
    for (const entry of loot) {
      this.mergeInventoryEntries(this.profile.inventory, entry);
    }
    clampInventory(this.profile.inventory);
  }

  private mergeInventoryEntries(inventory: InventoryEntry[], entry: InventoryEntry) {
    if (!entry.id || !Number.isFinite(entry.qty)) return;
    const existing = inventory.find((i) => i.id === entry.id);
    if (existing) {
      existing.qty += entry.qty;
    } else {
      inventory.push({ id: entry.id, qty: entry.qty });
    }
  }

  private updateLevelFromXp(curve: { base: number; growth: number }) {
    let level = 1;
    let xpRemaining = Math.max(0, this.profile.xp);
    const maxIterations = 200;
    for (let i = 0; i < maxIterations; i += 1) {
      const threshold = Math.max(1, Math.round(curve.base * Math.pow(curve.growth, level - 1)));
      if (xpRemaining < threshold) break;
      xpRemaining -= threshold;
      level += 1;
    }
    this.profile.level = level;
    this.profile.stats.lv = level;
  }

  private createPlayerActor(profile: PlayerProfile): Actor {
    return {
      id: this.playerId,
      name: profile.name,
      clazz: profile.clazz,
      stats: {
        maxHp: profile.stats.maxHp,
        hp: profile.stats.maxHp,
        maxSta: profile.stats.maxSta,
        sta: profile.stats.maxSta,
        maxMp: profile.stats.maxMp,
        mp: profile.stats.maxMp,
        atk: profile.stats.atk,
        def: profile.stats.def,
        lv: profile.level,
        xp: profile.xp,
        gold: profile.gold,
      },
      statuses: [],
      alive: true,
      tags: ['player'],
    };
  }
}
