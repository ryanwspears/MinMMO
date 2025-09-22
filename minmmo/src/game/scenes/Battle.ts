import Phaser from 'phaser';
import { CONFIG } from '@config/store';
import { Items, Skills, Enemies, Statuses } from '@content/registry';
import type { RuntimeItem, RuntimeSkill } from '@content/adapters';
import { createState } from '@engine/battle/state';
import { useItem, useSkill, endTurn } from '@engine/battle/actions';
import type { Actor, BattleState, InventoryEntry } from '@engine/battle/types';
import {
  PlayerProfile,
  WorldState,
  MerchantState,
  saveAll,
  clampInventory,
} from '@game/save';

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

export class Battle extends Phaser.Scene {
  private profile!: PlayerProfile;
  private world!: WorldState;
  private state!: BattleState;
  private playerId = PLAYER_ID;
  private barGraphics!: Phaser.GameObjects.Graphics;
  private actorLabels: Record<string, Phaser.GameObjects.Text> = {};
  private statusLabels: Record<string, Phaser.GameObjects.Text> = {};
  private logText!: Phaser.GameObjects.Text;
  private skillButtons: Phaser.GameObjects.Text[] = [];
  private itemButtons: Phaser.GameObjects.Text[] = [];
  private endTurnButton?: Phaser.GameObjects.Text;
  private targetPrompt?: Phaser.GameObjects.Text;
  private targetButtons: TargetButton[] = [];
  private outcomeHandled = false;

  constructor() {
    super('Battle');
  }

  create(data: BattleInitData) {
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

    this.barGraphics = this.add.graphics();
    this.logText = this.add.text(20, 260, '', { color: '#8b8fa3', wordWrap: { width: 760 } });

    this.buildStaticUi();
    this.renderActions();
    this.renderState();
  }

  private buildStaticUi() {
    this.add.text(20, 20, 'Battle — defeat all enemies!', { color: '#e6e8ef', fontSize: '18px' });
    const enemyCount = this.state.sideEnemy.length;
    this.actorLabels = {};
    this.statusLabels = {};
    const playerText = this.add.text(20, 60, '', { color: '#e6e8ef' });
    const playerStatus = this.add.text(20, 90, '', { color: '#7c5cff', wordWrap: { width: 360 } });
    this.actorLabels[this.playerId] = playerText;
    this.statusLabels[this.playerId] = playerStatus;

    for (let i = 0; i < enemyCount; i += 1) {
      const actorId = this.state.sideEnemy[i];
      const baseY = 60 + i * 80;
      this.actorLabels[actorId] = this.add.text(420, baseY, '', { color: '#f5c6a5' });
      this.statusLabels[actorId] = this.add.text(420, baseY + 24, '', { color: '#7c5cff', wordWrap: { width: 340 } });
    }

    this.endTurnButton = this.add
      .text(650, 420, '[End Turn]', { color: '#7c5cff' })
      .setInteractive({ useHandCursor: true });
    this.endTurnButton.on('pointerdown', () => {
      if (this.state.ended) return;
      endTurn(this.state);
      this.afterAction();
    });
  }

  private renderActions() {
    for (const btn of this.skillButtons) btn.destroy();
    for (const btn of this.itemButtons) btn.destroy();
    this.skillButtons = [];
    this.itemButtons = [];

    let skillY = 320;
    for (const id of this.profile.equippedSkills) {
      const skill = Skills()[id];
      if (!skill) continue;
      const label = `[Skill] ${skill.name}`;
      const text = this.add.text(20, skillY, label, { color: '#7c5cff' }).setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        if (this.state.ended) return;
        this.handleSkill(skill);
      });
      this.skillButtons.push(text);
      skillY += 24;
    }

    let itemY = 320;
    for (const entry of this.state.inventory) {
      const item = Items()[entry.id];
      if (!item) continue;
      const label = `[Item] ${item.name} x${entry.qty}`;
      const text = this.add.text(220, itemY, label, { color: '#7c5cff' }).setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        if (this.state.ended) return;
        this.handleItem(item);
      });
      this.itemButtons.push(text);
      itemY += 24;
    }
  }

  private handleSkill(skill: RuntimeSkill) {
    this.clearTargetPicker();
    const selector = skill.targeting;
    if (this.needsManualTarget(selector)) {
      const targets = this.collectTargets(selector, this.playerId);
      this.promptForTarget(targets, (targetId) => {
        useSkill(this.state, skill, this.playerId, [targetId]);
        this.afterAction();
      });
    } else {
      useSkill(this.state, skill, this.playerId);
      this.afterAction();
    }
  }

  private handleItem(item: RuntimeItem) {
    this.clearTargetPicker();
    const selector = item.targeting;
    if (this.needsManualTarget(selector)) {
      const targets = this.collectTargets(selector, this.playerId);
      this.promptForTarget(targets, (targetId) => {
        useItem(this.state, item, this.playerId, [targetId]);
        this.afterAction();
      });
    } else {
      useItem(this.state, item, this.playerId);
      this.afterAction();
    }
  }

  private needsManualTarget(selector: RuntimeSkill['targeting']): boolean {
    return selector.mode === 'single' && selector.side !== 'self';
  }

  private collectTargets(selector: RuntimeSkill['targeting'], userId: string): string[] {
    const allies = this.state.sidePlayer.includes(userId) ? this.state.sidePlayer : this.state.sideEnemy;
    const enemies = this.state.sidePlayer.includes(userId) ? this.state.sideEnemy : this.state.sidePlayer;
    let pool: string[] = [];
    switch (selector.side) {
      case 'self':
        pool = [userId];
        break;
      case 'ally':
        pool = allies.slice();
        break;
      case 'enemy':
        pool = enemies.slice();
        break;
      case 'any':
        pool = [...allies, ...enemies];
        break;
      default:
        pool = enemies.slice();
        break;
    }
    if (!selector.includeDead) {
      pool = pool.filter((id) => this.state.actors[id]?.alive);
    }
    return pool;
  }

  private promptForTarget(candidates: string[], onPick: (targetId: string) => void) {
    this.clearTargetPicker();
    if (!candidates.length) {
      onPick(this.playerId);
      return;
    }
    this.targetPrompt = this.add.text(420, 300, 'Choose target:', { color: '#e6e8ef' });
    let y = 330;
    for (const id of candidates) {
      const actor = this.state.actors[id];
      if (!actor) continue;
      const text = this.add
        .text(420, y, `${actor.name} (${Math.max(0, actor.stats.hp)}/${actor.stats.maxHp})`, { color: '#7c5cff' })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        this.clearTargetPicker();
        onPick(id);
      });
      this.targetButtons.push({ actorId: id, text });
      y += 22;
    }
    const cancel = this.add.text(420, y + 10, '[Cancel]', { color: '#8b8fa3' }).setInteractive({ useHandCursor: true });
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
  }

  private afterAction() {
    clampInventory(this.state.inventory);
    this.renderActions();
    this.renderState();
    this.checkOutcome();
  }

  private renderState() {
    this.barGraphics.clear();
    const player = this.state.actors[this.playerId];
    if (player) {
      this.updateActorPanel(player, 20, 120);
    }
    for (let i = 0; i < this.state.sideEnemy.length; i += 1) {
      const enemyId = this.state.sideEnemy[i];
      const actor = this.state.actors[enemyId];
      if (actor) {
        const baseY = 120 + i * 80;
        this.updateActorPanel(actor, 420, baseY);
      }
    }
    const recent = this.state.log.slice(-7);
    this.logText.setText(recent.join('\n'));
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
