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
const BAR_WIDTH = 200;
const BAR_HEIGHT = 12;

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
  playerLabelY: number;
  playerBarY: number;
  enemyLabelStart: number;
  enemyBarStart: number;
  enemySpacing: number;
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
  private actorLabels: Record<string, Phaser.GameObjects.Text> = {};
  private statusLabels: Record<string, Phaser.GameObjects.Text> = {};
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
    const enemyCount = this.state.sideEnemy.length;
    this.actorLabels = {};
    this.statusLabels = {};
    const playerText = this.add.text(layout.stage.x + 16, layout.playerLabelY, '', { color: '#e6e8ef' });
    const playerStatus = this.add.text(layout.stage.x + 16, layout.playerLabelY + 28, '', {
      color: '#7c5cff',
      wordWrap: { width: Math.max(220, layout.stage.width - 32) },
    });
    this.actorLabels[this.playerId] = playerText;
    this.statusLabels[this.playerId] = playerStatus;

    for (let i = 0; i < enemyCount; i += 1) {
      const actorId = this.state.sideEnemy[i];
      const baseY = layout.enemyLabelStart + i * layout.enemySpacing;
      this.actorLabels[actorId] = this.add.text(layout.rightColumnX, baseY, '', { color: '#f5c6a5' });
      this.statusLabels[actorId] = this.add.text(layout.rightColumnX, baseY + 24, '', {
        color: '#7c5cff',
        wordWrap: { width: Math.max(220, layout.sidebar.width - 32) },
      });
    }

    this.endTurnButton = this.add
      .text(layout.endTurnX, layout.endTurnY, '[End Turn]', { color: '#7c5cff' })
      .setInteractive({ useHandCursor: true });
    this.endTurnButton.on('pointerdown', () => {
      if (this.state.ended || this.busy || !this.isPlayerTurn() || this.targetSelectionActive) return;
      void this.handleEndTurn();
    });
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
    const playerLabelY = stageRect.y + 16;
    const playerBarY = playerLabelY + 60;
    const enemyLabelStart = sidebarRect.y + 16;
    const enemySpacing = 80;
    const enemyBarStart = enemyLabelStart + 60;
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
      playerLabelY,
      playerBarY,
      enemyLabelStart,
      enemyBarStart,
      enemySpacing,
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
    const playerLabel = this.actorLabels[this.playerId];
    if (playerLabel) {
      playerLabel.setPosition(layout.stage.x + 16, layout.playerLabelY);
    }
    if (this.endTurnButton) {
      this.endTurnButton.setPosition(layout.endTurnX, layout.endTurnY);
    }
    if (this.fleeButton) {
      this.fleeButton.setPosition(layout.endTurnX - 120, layout.endTurnY);
    }
    const playerStatus = this.statusLabels[this.playerId];
    if (playerStatus) {
      playerStatus.setPosition(layout.stage.x + 16, layout.playerLabelY + 28);
      playerStatus.setWordWrapWidth(Math.max(220, layout.stage.width - 32));
    }
    this.state.sideEnemy.forEach((enemyId, index) => {
      const label = this.actorLabels[enemyId];
      const status = this.statusLabels[enemyId];
      const baseY = layout.enemyLabelStart + index * layout.enemySpacing;
      if (label) {
        label.setPosition(layout.rightColumnX, baseY);
      }
      if (status) {
        status.setPosition(layout.rightColumnX, baseY + 24);
        status.setWordWrapWidth(Math.max(220, Math.max(0, layout.sidebar.width - 32)));
      }
    });

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
      this.updateActorPanel(player, layout.stage.x + 16, layout.playerBarY);
    }
    this.state.sideEnemy.forEach((enemyId, index) => {
      const actor = this.state.actors[enemyId];
      if (!actor) return;
      const baseY = layout.enemyBarStart + index * layout.enemySpacing;
      this.updateActorPanel(actor, layout.rightColumnX, baseY);
    });
    this.logPlayer.sync(this.state.log);
  }

  private updateActorPanel(actor: Actor, x: number, baseY: number) {
    const label = this.actorLabels[actor.id];
    const statusLabel = this.statusLabels[actor.id];
    const { stats } = actor;
    if (label) {
      label.setText(`${actor.name} — HP ${Math.max(0, Math.floor(stats.hp))}/${stats.maxHp}  STA ${stats.sta}/${stats.maxSta}  MP ${stats.mp}/${stats.maxMp}`);
    }
    if (statusLabel) {
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
      statusLabel.setText(`Status: ${statuses}`);
    }
    this.drawBars(x, baseY, stats);
  }

  private drawBars(x: number, y: number, stats: Actor['stats']) {
    this.drawBar(x, y, BAR_WIDTH, BAR_HEIGHT, stats.hp / Math.max(1, stats.maxHp), 0xff4f64, '#2b2f45');
    this.drawBar(x, y + 14, BAR_WIDTH, BAR_HEIGHT, stats.sta / Math.max(1, stats.maxSta || 1), 0x3ab0ff, '#2b2f45');
    this.drawBar(x, y + 28, BAR_WIDTH, BAR_HEIGHT, stats.mp / Math.max(1, stats.maxMp || 1), 0x7c5cff, '#2b2f45');
  }

  private drawBar(x: number, y: number, width: number, height: number, pct: number, color: number, background: string) {
    this.barGraphics.fillStyle(Phaser.Display.Color.HexStringToColor(background).color, 1);
    this.barGraphics.fillRect(x, y, width, height);
    this.barGraphics.fillStyle(color, 1);
    const clamped = Math.max(0, Math.min(1, pct));
    this.barGraphics.fillRect(x, y, width * clamped, height);
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
