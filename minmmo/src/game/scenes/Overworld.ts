import Phaser from 'phaser';
import { CONFIG } from '@config/store';
import { Items, NPCs, Skills } from '@content/registry';
import type { InventoryEntry } from '@engine/battle/types';
import {
  PlayerProfile,
  WorldState,
  MerchantState,
  MerchantStockEntry,
  getProfile,
  setProfile,
  getWorld,
  setWorld,
  resetSave,
  clampInventory,
} from '@game/save';

interface BattleInitData {
  profile: PlayerProfile;
  world: WorldState;
  enemyId: string;
  enemyLevel: number;
}

interface ReturnData {
  summary?: string[];
}

const TEXT_COLOR = '#e6e8ef';
const ACCENT_COLOR = '#7c5cff';
const WARNING_COLOR = '#f08c8c';

export class Overworld extends Phaser.Scene {
  private profile?: PlayerProfile;
  private world: WorldState;
  private ui: Phaser.GameObjects.GameObject[] = [];
  private summaryLines: string[] = [];

  constructor() {
    super('Overworld');
    this.world = getWorld();
  }

  create(data?: ReturnData) {
    this.profile = getProfile();
    this.world = getWorld();
    this.summaryLines = data?.summary ?? [];
    this.cameras.resize(this.scale.width, this.scale.height);
    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
    });
    this.render();
  }

  private clearUi() {
    for (const obj of this.ui) obj.destroy();
    this.ui = [];
  }

  private render() {
    this.clearUi();
    const config = CONFIG();
    const wrapWidth = Math.max(280, this.scale.width - 40);
    let y = 20;
    this.ui.push(this.add.text(20, y, 'MinMMO — Overworld', { color: TEXT_COLOR, fontSize: '20px' }));
    y += 28;

    if (this.summaryLines.length) {
      this.ui.push(
        this.add
          .text(20, y, this.summaryLines.join('\n'), { color: ACCENT_COLOR, wordWrap: { width: wrapWidth } })
          .setDepth(1),
      );
      y += 20 * this.summaryLines.length + 10;
    }

    if (!this.profile) {
      this.renderClassSelection(y, config);
      return;
    }

    y = this.renderProfilePanel(y, config);
    this.renderActions(y);
  }

  private renderClassSelection(startY: number, config = CONFIG()) {
    let y = startY;
    this.ui.push(this.add.text(20, y, 'Choose your class to begin:', { color: TEXT_COLOR }));
    y += 24;
    const classes = Object.entries(config.classes);
    if (!classes.length) {
      this.ui.push(this.add.text(20, y, 'No classes configured. Add one in the Admin.', { color: WARNING_COLOR }));
      return;
    }
    for (const [clazz, preset] of classes) {
      const desc = `${clazz} — HP ${preset.maxHp} / STA ${preset.maxSta} / MP ${preset.maxMp}`;
      const txt = this.add
        .text(20, y, `[${clazz}] ${desc}`, { color: ACCENT_COLOR })
        .setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => {
        this.createProfileForClass(clazz);
      });
      this.ui.push(txt);
      y += 22;
    }
    const reset = this.add
      .text(20, y + 10, '[Reset Save]', { color: WARNING_COLOR })
      .setInteractive({ useHandCursor: true });
    reset.on('pointerdown', () => {
      resetSave();
      this.profile = undefined;
      this.world = getWorld();
      this.summaryLines = ['Save reset.'];
      this.render();
    });
    this.ui.push(reset);
  }

  private renderProfilePanel(startY: number, config = CONFIG()) {
    let y = startY;
    const profile = this.profile!;
    const slots = this.getMaxSkillSlots(profile.level, config.balance.SKILL_SLOTS_BY_LEVEL);
    const infoLines = [
      `${profile.name} the ${profile.clazz} — Lv ${profile.level}`,
      `XP: ${profile.xp.toFixed(0)}  Gold: ${profile.gold.toFixed(0)}`,
      `Stats: HP ${profile.stats.maxHp}  STA ${profile.stats.maxSta}  MP ${profile.stats.maxMp}  ATK ${profile.stats.atk}  DEF ${profile.stats.def}`,
      `Equipped Skills (${profile.equippedSkills.length}/${slots}): ${profile.equippedSkills.join(', ') || 'None'}`,
    ];
    for (const line of infoLines) {
      this.ui.push(this.add.text(20, y, line, { color: TEXT_COLOR }));
      y += 20;
    }

    this.ui.push(this.add.text(20, y, 'Inventory:', { color: TEXT_COLOR }));
    y += 20;
    if (!profile.inventory.length) {
      this.ui.push(this.add.text(32, y, '(Empty)', { color: '#8b8fa3' }));
      y += 20;
    } else {
      for (const entry of profile.inventory) {
        const item = Items()[entry.id];
        const name = item?.name ?? entry.id;
        this.ui.push(this.add.text(32, y, `${name} x${entry.qty}`, { color: '#8b8fa3' }));
        y += 18;
      }
    }

    this.ui.push(this.add.text(20, y, 'Unlocked Skills:', { color: TEXT_COLOR }));
    y += 20;
    if (!profile.unlockedSkills.length) {
      this.ui.push(this.add.text(32, y, '(None)', { color: '#8b8fa3' }));
      y += 20;
    } else {
      for (const id of profile.unlockedSkills) {
        const skill = Skills()[id];
        const equipped = profile.equippedSkills.includes(id);
        const label = `${equipped ? '•' : '○'} ${skill?.name ?? id}`;
        const txt = this.add
          .text(32, y, label, { color: equipped ? ACCENT_COLOR : '#8b8fa3' })
          .setInteractive({ useHandCursor: true });
        txt.on('pointerdown', () => {
          this.toggleSkillEquip(id, slots);
        });
        this.ui.push(txt);
        y += 18;
      }
    }
    y += 10;
    return y;
  }

  private renderActions(startY: number) {
    let y = startY;
    const button = (label: string, color: string, handler: () => void) => {
      const txt = this.add.text(20, y, label, { color }).setInteractive({ useHandCursor: true });
      txt.on('pointerdown', handler);
      this.ui.push(txt);
      y += 24;
    };

    button('[Start Battle]', ACCENT_COLOR, () => this.showEncounterMenu());

    const merchants = Object.values(NPCs()).filter((npc) => npc.kind === 'merchant');
    for (const merchant of merchants) {
      button(`[Visit ${merchant.name}]`, ACCENT_COLOR, () => this.openMerchant(merchant.id));
    }

    const trainers = Object.values(NPCs()).filter((npc) => npc.kind === 'trainer');
    for (const trainer of trainers) {
      button(`[Train with ${trainer.name}]`, ACCENT_COLOR, () => this.openTrainer(trainer.id));
    }

    button('[Reset Save]', WARNING_COLOR, () => {
      resetSave();
      this.profile = undefined;
      this.world = getWorld();
      this.summaryLines = ['Save reset.'];
      this.render();
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    const width = Math.max(1, gameSize.width ?? this.scale.width);
    const height = Math.max(1, gameSize.height ?? this.scale.height);
    this.cameras.resize(width, height);
    this.render();
  }

  private toggleSkillEquip(skillId: string, slots: number) {
    const profile = this.profile!;
    const idx = profile.equippedSkills.indexOf(skillId);
    if (idx >= 0) {
      profile.equippedSkills.splice(idx, 1);
    } else {
      if (profile.equippedSkills.length >= slots) {
        this.summaryLines = [`No free skill slots (max ${slots}).`];
        this.render();
        return;
      }
      profile.equippedSkills.push(skillId);
    }
    setProfile(profile);
    this.summaryLines = [];
    this.render();
  }

  private createProfileForClass(clazz: string) {
    const config = CONFIG();
    const preset = config.classes[clazz];
    if (!preset) {
      this.summaryLines = [`Class ${clazz} is not configured.`];
      this.render();
      return;
    }
    const skillIds = config.classSkills[clazz] ? [...config.classSkills[clazz]] : [];
    const slots = this.getMaxSkillSlots(1, config.balance.SKILL_SLOTS_BY_LEVEL);
    const equipped = skillIds.slice(0, slots);
    const startItems = config.startItems[clazz] ? [...config.startItems[clazz]] : [];
    const profile: PlayerProfile = {
      name: 'Adventurer',
      clazz,
      level: 1,
      xp: 0,
      gold: 0,
      stats: {
        maxHp: preset.maxHp,
        hp: preset.maxHp,
        maxSta: preset.maxSta,
        sta: preset.maxSta,
        maxMp: preset.maxMp,
        mp: preset.maxMp,
        atk: preset.atk,
        def: preset.def,
        lv: 1,
        xp: 0,
        gold: 0,
      },
      unlockedSkills: skillIds,
      equippedSkills: equipped,
      inventory: startItems.map((entry) => ({ id: entry.id, qty: entry.qty ?? 1 })),
    };
    clampInventory(profile.inventory);
    setProfile(profile);
    this.profile = profile;
    this.summaryLines = [`Welcome, ${profile.clazz}!`];
    this.render();
  }

  private getMaxSkillSlots(level: number, slots: number[]): number {
    const lvl = Math.max(1, level || 1);
    if (!slots.length) return 0;
    const index = Math.min(slots.length - 1, Math.max(0, lvl - 1));
    return slots[index] ?? 0;
  }

  private showEncounterMenu() {
    const profile = this.profile;
    if (!profile) return;
    const config = CONFIG();
    const enemyEntries = Object.entries(config.enemies);
    if (!enemyEntries.length) {
      this.summaryLines = ['No enemies configured.'];
      this.render();
      return;
    }
    this.clearUi();
    let y = 20;
    this.ui.push(this.add.text(20, y, 'Choose an enemy:', { color: TEXT_COLOR }));
    y += 26;
    let selectedEnemy: string | null = null;
    let level = Math.max(1, profile.level);
    const levelText = this.add.text(20, 400, `Level: ${level}`, { color: TEXT_COLOR }).setInteractive({ useHandCursor: true });
    levelText.on('pointerdown', () => {
      level = Math.max(1, Math.min(99, level + 1));
      levelText.setText(`Level: ${level}`);
    });
    this.ui.push(levelText);

    const confirm = this.add
      .text(200, 400, '[Start!]', { color: '#555b7a' })
      .setInteractive({ useHandCursor: true });
    confirm.on('pointerdown', () => {
      if (!selectedEnemy) return;
      this.launchBattle(selectedEnemy, level);
    });
    this.ui.push(confirm);

    for (const [id, def] of enemyEntries) {
      const txt = this.add
        .text(20, y, `${def.name ?? id}`, { color: ACCENT_COLOR })
        .setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => {
        selectedEnemy = id;
        confirm.setColor(ACCENT_COLOR);
      });
      this.ui.push(txt);
      y += 22;
    }

    const back = this.add.text(20, 440, '[Back]', { color: TEXT_COLOR }).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.render());
    this.ui.push(back);
  }

  private launchBattle(enemyId: string, level: number) {
    const profile = this.profile;
    if (!profile) return;
    const battleData: BattleInitData = {
      profile,
      world: this.world,
      enemyId,
      enemyLevel: Math.max(1, Math.floor(level)),
    };
    this.scene.start('Battle', battleData);
  }

  private ensureMerchantState(npcId: string): MerchantState {
    const economy = CONFIG().balance.ECONOMY;
    if (!this.world.merchants[npcId]) {
      this.world.merchants[npcId] = { stock: [], restockIn: 0 };
    }
    const state = this.world.merchants[npcId];
    if (state.restockIn <= 0) {
      const npc = NPCs()[npcId];
      const stock: MerchantStockEntry[] = [];
      if (npc?.inventory) {
        for (const entry of npc.inventory) {
          const qty = Number(entry.qty) || 1;
          if (!entry.id || qty <= 0) continue;
          const basePrice = this.resolveBasePrice(entry.price, entry.rarity);
          stock.push({ id: entry.id, qty, basePrice });
        }
      }
      state.stock = stock;
      state.restockIn = Math.max(1, Math.floor(economy.restockTurns || 1));
      setWorld(this.world);
    }
    return state;
  }

  private resolveBasePrice(price: number | undefined, rarity?: string) {
    const economy = CONFIG().balance.ECONOMY;
    if (typeof price === 'number' && Number.isFinite(price)) {
      return Math.max(0, price);
    }
    const table = economy.priceByRarity ?? {};
    if (rarity && typeof table[rarity as keyof typeof table] === 'number') {
      return Math.max(0, table[rarity as keyof typeof table] || 0);
    }
    return Math.max(0, table.common || 0);
  }

  private openMerchant(npcId: string) {
    const profile = this.profile;
    if (!profile) return;
    const economy = CONFIG().balance.ECONOMY;
    const merchant = NPCs()[npcId];
    const state = this.ensureMerchantState(npcId);
    this.clearUi();
    let y = 20;
    this.ui.push(this.add.text(20, y, `${merchant?.name ?? 'Merchant'} — Shop`, { color: TEXT_COLOR }));
    y += 26;
    this.ui.push(this.add.text(20, y, `Gold: ${profile.gold.toFixed(0)}`, { color: ACCENT_COLOR }));
    y += 24;
    this.ui.push(this.add.text(20, y, 'Stock:', { color: TEXT_COLOR }));
    y += 22;
    if (!state.stock.length) {
      this.ui.push(this.add.text(32, y, 'Sold out. Come back later.', { color: '#8b8fa3' }));
      y += 22;
    } else {
      for (const entry of state.stock) {
        const item = Items()[entry.id];
        const name = item?.name ?? entry.id;
        const price = Math.max(1, Math.round(entry.basePrice * (economy.buyMult || 1)));
        const txt = this.add
          .text(32, y, `${name} x${entry.qty} — ${price} gold`, { color: ACCENT_COLOR })
          .setInteractive({ useHandCursor: true });
        txt.on('pointerdown', () => {
          if (entry.qty <= 0) return;
          if (profile.gold < price) {
            this.summaryLines = [`Not enough gold for ${name}.`];
            this.render();
            return;
          }
          entry.qty -= 1;
          profile.gold -= price;
          profile.stats.gold = profile.gold;
          this.mergeInventory(profile.inventory, { id: entry.id, qty: 1 });
          clampInventory(profile.inventory);
          if (entry.qty <= 0) {
            const idx = state.stock.indexOf(entry);
            if (idx >= 0) state.stock.splice(idx, 1);
          }
          setProfile(profile);
          setWorld(this.world);
          this.openMerchant(npcId);
        });
        this.ui.push(txt);
        y += 20;
      }
    }

    y += 10;
    this.ui.push(this.add.text(20, y, 'Sell:', { color: TEXT_COLOR }));
    y += 22;
    if (!profile.inventory.length) {
      this.ui.push(this.add.text(32, y, 'Nothing to sell.', { color: '#8b8fa3' }));
      y += 22;
    } else {
      for (const entry of profile.inventory) {
        const item = Items()[entry.id];
        const name = item?.name ?? entry.id;
        const basePrice = this.resolveBasePrice(
          merchant?.inventory?.find((i) => i.id === entry.id)?.price,
          merchant?.inventory?.find((i) => i.id === entry.id)?.rarity,
        );
        const price = Math.max(1, Math.round(basePrice * (economy.sellMult || 0.5)));
        const txt = this.add
          .text(32, y, `${name} x${entry.qty} — sell ${price} gold`, { color: '#8b8fa3' })
          .setInteractive({ useHandCursor: true });
        txt.on('pointerdown', () => {
          if (entry.qty <= 0) return;
          entry.qty -= 1;
          profile.gold += price;
          profile.stats.gold = profile.gold;
          if (entry.qty <= 0) {
            const idx = profile.inventory.indexOf(entry);
            if (idx >= 0) profile.inventory.splice(idx, 1);
          }
          this.addMerchantStock(state.stock, entry.id, 1, basePrice);
          setProfile(profile);
          setWorld(this.world);
          this.openMerchant(npcId);
        });
        this.ui.push(txt);
        y += 20;
      }
    }

    const back = this.add.text(20, 440, '[Back]', { color: TEXT_COLOR }).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.render());
    this.ui.push(back);
  }

  private openTrainer(npcId: string) {
    const profile = this.profile;
    if (!profile) return;
    const trainer = NPCs()[npcId];
    const economy = CONFIG().balance.ECONOMY;
    if (trainer?.trainer?.clazz && trainer.trainer.clazz !== profile.clazz) {
      this.summaryLines = [`${trainer.name} only trains ${trainer.trainer.clazz}.`];
      this.render();
      return;
    }
    this.clearUi();
    let y = 20;
    this.ui.push(this.add.text(20, y, `${trainer?.name ?? 'Trainer'} — Skills`, { color: TEXT_COLOR }));
    y += 26;
    const teaches = trainer?.trainer?.teaches ?? [];
    if (!teaches.length) {
      this.ui.push(this.add.text(20, y, 'No skills available.', { color: '#8b8fa3' }));
      y += 22;
    } else {
      for (const skillId of teaches) {
        const skill = Skills()[skillId];
        const base = trainer?.trainer?.priceBySkill?.[skillId];
        const basePrice = this.resolveBasePrice(base, 'rare');
        const price = Math.max(1, Math.round(basePrice * (economy.buyMult || 1)));
        const owned = profile.unlockedSkills.includes(skillId);
        const label = `${skill?.name ?? skillId} — ${owned ? 'Learned' : price + ' gold'}`;
        const txt = this.add
          .text(20, y, label, { color: owned ? '#8b8fa3' : ACCENT_COLOR })
          .setInteractive({ useHandCursor: true });
        txt.on('pointerdown', () => {
          if (owned) return;
          if (profile.gold < price) {
            this.summaryLines = [`Not enough gold to learn ${skill?.name ?? skillId}.`];
            this.render();
            return;
          }
          profile.gold -= price;
          profile.stats.gold = profile.gold;
          profile.unlockedSkills.push(skillId);
          setProfile(profile);
          this.openTrainer(npcId);
        });
        this.ui.push(txt);
        y += 22;
      }
    }

    const back = this.add.text(20, 440, '[Back]', { color: TEXT_COLOR }).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.render());
    this.ui.push(back);
  }

  private mergeInventory(inventory: InventoryEntry[], entry: InventoryEntry) {
    if (!entry.id || !Number.isFinite(entry.qty)) return;
    const existing = inventory.find((item) => item.id === entry.id);
    if (existing) {
      existing.qty += entry.qty;
    } else {
      inventory.push({ id: entry.id, qty: entry.qty });
    }
  }

  private addMerchantStock(stock: MerchantStockEntry[], id: string, qty: number, basePrice: number) {
    if (!id || qty <= 0) return;
    const existing = stock.find((entry) => entry.id === id);
    if (existing) {
      existing.qty += qty;
      existing.basePrice = basePrice;
    } else {
      stock.push({ id, qty, basePrice });
    }
    for (let i = stock.length - 1; i >= 0; i -= 1) {
      if (stock[i].qty <= 0) {
        stock.splice(i, 1);
      }
    }
  }
}
