import Phaser from 'phaser';
import { CONFIG } from '@config/store';
import { Items, Skills, Enemies, Statuses } from '@content/registry';
import type { RuntimeItem, RuntimeSkill, RuntimeCost } from '@content/adapters';
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
  targetX: number;
  commandPanel: LayoutRect;
  commandTabs: LayoutRect;
  commandContent: LayoutRect;
  commandTabSpacing: number;
  commandRowHeight: number;
  commandRowSpacing: number;
  commandIconWidth: number;
  commandTextPadding: number;
  playerCard: LayoutRect;
  enemyCard: { x: number; startY: number; width: number; height: number; spacing: number };
  cardLayout: CardLayoutMetrics;
}

type CommandTab = 'actions' | 'skills' | 'items';

interface CommandTabButton {
  key: CommandTab;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  hitArea: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface CommandRow {
  tab: CommandTab;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  hitArea: Phaser.GameObjects.Rectangle;
  iconBackground: Phaser.GameObjects.Graphics;
  iconText: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  detail?: Phaser.GameObjects.Text;
  onClick?: () => void;
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
  private commandTab: CommandTab = 'actions';
  private commandTabButtons: CommandTabButton[] = [];
  private commandPanelBackground?: Phaser.GameObjects.Graphics;
  private commandContentBackground?: Phaser.GameObjects.Graphics;
  private commandRows: CommandRow[] = [];
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
    for (const row of this.commandRows) {
      row.container.destroy(true);
    }
    this.commandRows = [];

    if (!this.commandPanelBackground) {
      this.commandPanelBackground = this.add.graphics().setDepth(2).setScrollFactor(0);
    }
    if (!this.commandContentBackground) {
      this.commandContentBackground = this.add.graphics().setDepth(3).setScrollFactor(0);
    }

    if (!this.commandTabButtons.length) {
      const tabDefs: Array<{ key: CommandTab; label: string }> = [
        { key: 'actions', label: 'Actions' },
        { key: 'skills', label: 'Skills' },
        { key: 'items', label: 'Items' },
      ];
      for (const def of tabDefs) {
        const container = this.add.container(0, 0);
        container.setDepth(4).setScrollFactor(0);
        const background = this.add.graphics();
        container.add(background);
        const hitArea = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0, 0);
        hitArea.setInteractive({ useHandCursor: true });
        container.add(hitArea);
        const label = this.add.text(0, 0, def.label, {
          color: '#e6e8ef',
          fontSize: '14px',
          fontStyle: 'bold',
        });
        container.add(label);
        hitArea.on('pointerdown', () => {
          if (!hitArea.input?.enabled) return;
          if (this.commandTab === def.key) return;
          this.commandTab = def.key;
          const currentLayout = this.layout ?? this.computeLayout();
          this.layoutCommandPanel(currentLayout);
          this.refreshCommandAvailability();
        });
        this.commandTabButtons.push({ key: def.key, container, background, hitArea, label });
      }
    }

    const actions: Array<{ label: string; icon: string; handler: () => void }> = [
      { label: 'End Turn', icon: 'ACT', handler: () => void this.handleEndTurn() },
      { label: 'Flee', icon: 'ACT', handler: () => void this.handleFlee() },
    ];
    for (const action of actions) {
      this.createCommandRow('actions', action.label, action.icon, undefined, action.handler);
    }

    const skillsRegistry = Skills();
    for (const id of this.profile.equippedSkills) {
      const skill = skillsRegistry[id];
      if (!skill) continue;
      const detail = this.describeCost(skill.costs);
      this.createCommandRow('skills', skill.name, 'SKL', detail, () => {
        void this.handleSkill(skill);
      });
    }

    const itemsRegistry = Items();
    for (const entry of this.state.inventory) {
      if (entry.qty <= 0) continue;
      const item = itemsRegistry[entry.id];
      if (!item) continue;
      const detail = `x${entry.qty}`;
      this.createCommandRow('items', item.name, 'ITM', detail, () => {
        void this.handleItem(item);
      });
    }

    const layout = this.layout ?? this.computeLayout();
    this.layoutCommandPanel(layout);
    this.refreshCommandAvailability();
  }

  private createCommandRow(
    tab: CommandTab,
    label: string,
    icon: string,
    detail?: string,
    onClick?: () => void,
  ) {
    const container = this.add.container(0, 0);
    container.setDepth(5).setScrollFactor(0);
    const background = this.add.graphics();
    container.add(background);
    const hitArea = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0, 0);
    if (onClick) {
      hitArea.setInteractive({ useHandCursor: true });
    }
    container.add(hitArea);
    const iconBackground = this.add.graphics();
    container.add(iconBackground);
    const iconText = this.add.text(0, 0, icon.toUpperCase(), {
      color: '#cfd3ec',
      fontSize: '12px',
      fontStyle: 'bold',
      align: 'center',
    });
    container.add(iconText);
    const text = this.add.text(0, 0, label, {
      color: '#e6e8ef',
      fontSize: '14px',
    });
    container.add(text);
    let detailText: Phaser.GameObjects.Text | undefined;
    if (detail) {
      detailText = this.add.text(0, 0, detail, {
        color: '#8b8fa3',
        fontSize: '12px',
      });
      container.add(detailText);
    }
    if (onClick) {
      hitArea.on('pointerdown', () => {
        if (!hitArea.input?.enabled) return;
        onClick();
      });
    }
    const row: CommandRow = {
      tab,
      container,
      background,
      hitArea,
      iconBackground,
      iconText,
      label: text,
      detail: detailText,
      onClick,
    };
    this.commandRows.push(row);
    return row;
  }

  private describeCost(costs: RuntimeCost): string {
    const parts: string[] = [];
    if (costs.mp > 0) parts.push(`MP ${costs.mp}`);
    if (costs.sta > 0) parts.push(`STA ${costs.sta}`);
    if (costs.cooldown > 0) parts.push(`${costs.cooldown}t CD`);
    if (typeof costs.charges === 'number' && costs.charges > 0) {
      parts.push(`${costs.charges} use${costs.charges > 1 ? 's' : ''}`);
    }
    return parts.length ? parts.join(' · ') : 'Free';
  }

  private layoutCommandPanel(layout: LayoutMetrics) {
    if (!this.commandPanelBackground || !this.commandContentBackground) {
      return;
    }
    const panelRect = layout.commandPanel;
    const hasPanel = panelRect.width > 0 && panelRect.height > 0;
    this.commandPanelBackground.setVisible(hasPanel);
    this.commandPanelBackground.clear();
    if (hasPanel) {
      const panelRadius = 16;
      this.commandPanelBackground.fillStyle(0x161b33, 0.94);
      this.commandPanelBackground.fillRoundedRect(
        panelRect.x,
        panelRect.y,
        panelRect.width,
        panelRect.height,
        panelRadius,
      );
      this.commandPanelBackground.lineStyle(2, 0x272f52, 0.7);
      this.commandPanelBackground.strokeRoundedRect(
        panelRect.x,
        panelRect.y,
        panelRect.width,
        panelRect.height,
        panelRadius,
      );
    }

    const contentRect = layout.commandContent;
    const hasContent = contentRect.width > 0 && contentRect.height > 0;
    this.commandContentBackground.setVisible(hasContent);
    this.commandContentBackground.clear();
    if (hasContent) {
      const contentRadius = 12;
      this.commandContentBackground.fillStyle(0x10142b, 0.92);
      this.commandContentBackground.fillRoundedRect(
        contentRect.x,
        contentRect.y,
        contentRect.width,
        contentRect.height,
        contentRadius,
      );
      this.commandContentBackground.lineStyle(1.5, 0x21284b, 0.7);
      this.commandContentBackground.strokeRoundedRect(
        contentRect.x,
        contentRect.y,
        contentRect.width,
        contentRect.height,
        contentRadius,
      );
    }

    const tabsRect = layout.commandTabs;
    const tabCount = this.commandTabButtons.length;
    const spacing = Math.max(0, Math.min(layout.commandTabSpacing, tabsRect.width));
    const tabHeight = Math.max(0, tabsRect.height);
    if (!hasPanel || tabCount === 0 || tabHeight <= 0 || tabsRect.width <= 0) {
      for (const button of this.commandTabButtons) {
        button.container.setVisible(false);
      }
    } else {
      let x = tabsRect.x;
      const widthAvailable = Math.max(0, tabsRect.width - spacing * (tabCount - 1));
      const baseWidth = tabCount > 0 ? widthAvailable / tabCount : widthAvailable;
      const tabWidth = Math.max(1, baseWidth);
      for (const [index, button] of this.commandTabButtons.entries()) {
        button.container.setVisible(true);
        button.container.setPosition(x, tabsRect.y);
        button.container.setDepth(4);
        button.background.clear();
        const radius = {
          tl: index === 0 ? 12 : 6,
          bl: index === 0 ? 12 : 6,
          tr: index === tabCount - 1 ? 12 : 6,
          br: index === tabCount - 1 ? 12 : 6,
        };
        const active = button.key === this.commandTab;
        const fill = active ? 0x2f3659 : 0x1a1f3d;
        const stroke = active ? 0x7c5cff : 0x2a3052;
        button.background.fillStyle(fill, active ? 1 : 0.9);
        button.background.fillRoundedRect(0, 0, tabWidth, tabHeight, radius);
        button.background.lineStyle(1.5, stroke, active ? 1 : 0.7);
        button.background.strokeRoundedRect(0, 0, tabWidth, tabHeight, radius);
        button.hitArea.setPosition(0, 0);
        button.hitArea.setSize(tabWidth, tabHeight);
        button.hitArea.setDisplaySize(tabWidth, tabHeight);
        button.label.setColor(active ? '#e6e8ef' : '#8b8fa3');
        button.label.setPosition(tabWidth / 2 - button.label.width / 2, tabHeight / 2 - button.label.height / 2);
        x += tabWidth + spacing;
      }
    }

    const activeRows = this.commandRows.filter((row) => row.tab === this.commandTab);
    const rowHeight = Math.max(32, layout.commandRowHeight);
    const rowSpacing = Math.max(4, layout.commandRowSpacing);
    const iconWidth = Math.max(
      32,
      Math.min(layout.commandIconWidth, Math.max(0, contentRect.width - textPadding * 3)),
    );
    const textPadding = Math.max(8, layout.commandTextPadding);
    let y = contentRect.y + textPadding;

    for (const row of activeRows) {
      const visible = hasContent && hasPanel;
      row.container.setVisible(visible);
      if (!visible) continue;
      row.container.setPosition(contentRect.x, y);
      row.container.setDepth(5);
      row.background.clear();
      const rowRadius = 12;
      row.background.fillStyle(0x1b2140, 0.95);
      row.background.fillRoundedRect(0, 0, contentRect.width, rowHeight, rowRadius);
      row.background.lineStyle(1.5, 0x2a3154, 0.7);
      row.background.strokeRoundedRect(0, 0, contentRect.width, rowHeight, rowRadius);
      row.hitArea.setPosition(0, 0);
      row.hitArea.setSize(contentRect.width, rowHeight);
      row.hitArea.setDisplaySize(contentRect.width, rowHeight);
      const iconHeight = Math.max(24, rowHeight - textPadding * 2);
      const iconX = textPadding;
      const iconY = (rowHeight - iconHeight) / 2;
      row.iconBackground.clear();
      row.iconBackground.fillStyle(0x252c4b, 1);
      row.iconBackground.fillRoundedRect(iconX, iconY, iconWidth, iconHeight, 8);
      row.iconText.setPosition(
        iconX + iconWidth / 2 - row.iconText.width / 2,
        iconY + iconHeight / 2 - row.iconText.height / 2,
      );
      const labelMaxWidth = Math.max(
        0,
        contentRect.width - iconX - iconWidth - textPadding * 3 - (row.detail ? row.detail.width : 0),
      );
      row.label.setMaxWidth(labelMaxWidth);
      row.label.setWordWrapWidth(Math.max(0, labelMaxWidth));
      row.label.setPosition(iconX + iconWidth + textPadding, rowHeight / 2 - row.label.height / 2);
      if (row.detail) {
        row.detail.setPosition(
          contentRect.width - textPadding - row.detail.width,
          rowHeight / 2 - row.detail.height / 2,
        );
      }
      y += rowHeight + rowSpacing;
    }

    for (const row of this.commandRows) {
      if (row.tab !== this.commandTab) {
        row.container.setVisible(false);
      }
    }
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

    const commandPanelPadding = 16;
    const commandPanel: LayoutRect = {
      x: footerRect.x + commandPanelPadding,
      y: footerRect.y + commandPanelPadding,
      width: Math.max(0, footerRect.width - commandPanelPadding * 2),
      height: Math.max(0, footerRect.height - commandPanelPadding * 2),
    };
    const baseTabHeight = 36;
    const commandTabsHeight = Math.min(commandPanel.height, Math.max(30, Math.min(40, baseTabHeight)));
    const commandTabs: LayoutRect = {
      x: commandPanel.x,
      y: commandPanel.y,
      width: commandPanel.width,
      height: commandTabsHeight,
    };
    const commandTabSpacing = Math.max(10, Math.min(18, Math.round(commandPanel.width * 0.05)));
    const contentGap = Math.max(12, Math.round(commandPanel.height * 0.06));
    const commandContentTop = commandTabs.y + commandTabs.height + contentGap;
    const commandContent: LayoutRect = {
      x: commandPanel.x,
      y: commandContentTop,
      width: commandPanel.width,
      height: Math.max(0, commandPanel.y + commandPanel.height - commandContentTop),
    };
    const commandRowHeight = Math.max(42, Math.min(60, Math.round(Math.max(44, commandPanel.height * 0.28))));
    const commandRowSpacing = Math.max(8, Math.round(commandRowHeight * 0.25));
    const commandIconWidth = Math.max(48, Math.min(96, Math.round(commandPanel.width * 0.22)));
    const commandTextPadding = 14;
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
    const rightColumnX = sidebarRect.width > 0 ? sidebarRect.x + 16 : stageRight + 16;

    return {
      header: headerRect,
      stage: stageRect,
      sidebar: sidebarRect,
      footer: footerRect,
      rightColumnX,
      logWidth,
      logY,
      targetX,
      commandPanel,
      commandTabs,
      commandContent,
      commandTabSpacing,
      commandRowHeight,
      commandRowSpacing,
      commandIconWidth,
      commandTextPadding,
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
    this.layoutCommandPanel(layout);
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
    const canUseCommands =
      !this.state.ended && this.isPlayerTurn() && !this.busy && !this.targetSelectionActive;
    const canSwitchTabs = !this.state.ended && !this.busy && !this.targetSelectionActive;
    for (const button of this.commandTabButtons) {
      if (canSwitchTabs) {
        if (!button.hitArea.input?.enabled) {
          button.hitArea.setInteractive({ useHandCursor: true });
        }
        button.container.setAlpha(1);
      } else {
        button.hitArea.disableInteractive();
        button.container.setAlpha(button.key === this.commandTab ? 0.8 : 0.6);
      }
    }
    for (const row of this.commandRows) {
      const interactive = !!row.onClick && canUseCommands && row.tab === this.commandTab;
      if (interactive) {
        if (!row.hitArea.input?.enabled) {
          row.hitArea.setInteractive({ useHandCursor: true });
        }
        row.container.setAlpha(1);
      } else {
        row.hitArea.disableInteractive();
        if (row.tab === this.commandTab) {
          row.container.setAlpha(row.onClick ? 0.6 : 0.75);
        } else {
          row.container.setAlpha(0.5);
        }
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
