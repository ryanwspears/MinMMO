# MinMMO Admin Portal Guide

This guide explains how to run the MinMMO Admin CMS, how configuration changes are stored, and what every tab, field, and JSON editor controls. Use it as the primary reference while tuning gameplay data or supporting live content authors.

## Getting started

1. **Install dependencies** – Run `npm install` from the repository root. Node.js 18 or newer is recommended for the bundled Vite tooling.
2. **Launch the admin portal** – Start the dev server with `npm run dev` and open [`http://localhost:5173/admin.html`](http://localhost:5173/admin.html) in your browser. The main game client remains available at `index.html` if you need to spot-check changes in play.
3. **Persisting changes** – The CMS reads and writes to the browser's `localStorage`. Saving keeps the latest validated configuration locally, exporting downloads the same payload as JSON, and importing merges a JSON file back into `localStorage`. Reloading discards in-memory edits and reloads what is stored in the browser.

> **Tip:** Always export a JSON backup before clearing site data or switching devices so you can restore your custom content quickly.

## Toolbar workflow

The toolbar at the top of the portal controls persistence and navigation:

- **Save** – Validates every tab, repairs shape issues, and writes the sanitized configuration to `localStorage`. The button is disabled while any validation errors remain.
- **Export JSON** – Downloads the current in-memory configuration as `game-config.json`. Use this for version control check-ins or for sharing presets.
- **Import JSON** – Uploads a JSON file, runs it through the same validation/repair pipeline, then replaces the active configuration and stored copy. You will see a confirmation message near the toolbar once import completes.
- **Reload** – Restores the configuration that is currently stored in `localStorage`, discarding unsaved edits in the form.
- **Tab buttons** – Switch between Skills, Items, Classes, Statuses, Enemies, NPCs, Balance, and World Data. The active tab name is bolded.

Whenever the validator finds an issue, a red banner appears with the message **"Resolve validation errors before saving."** Field-level messages appear directly under the offending inputs so you can fix the exact problems (missing IDs, invalid numbers, malformed JSON, etc.).

## Working with lists

Most tabs share a two-column layout: a list of records on the left and a detail editor on the right. Use the list's **Add** button to create new entries, select an entry to edit it, and **Remove** to delete it. IDs must be unique within each content type; duplicates show validation errors until resolved.

---

## Skills & Items

Skills and items share the same editor because both reuse the `SkillForm` schema internally. Items inherit every skill field and add an item-only toggle.

### Targeting & overview
- **Skill/Item ID & Name** – Unique string identifiers used by other tabs (classes, enemies, etc.).
- **Element** – Free-form string matching the Elements list; affects elemental matrices in Balance.
- **Target Side/Mode/Count** – Configure who the ability can hit (self, ally, enemy, any) and how many targets (single, all, random, lowest/highest by a stat, or conditional). `Count` limits the number of picks; `Target Metric` selects which stat drives highest/lowest targeting; **Include Dead Targets** allows revives or corpse interactions.
- **Description** – Optional flavor text shown to players.

### Costs
Set stamina (STA), mana (MP), cooldown turns, limited charges, or require a consumable item by ID/quantity. Leaving a cost blank removes it from the payload.

### Effects
Each skill or item must have at least one effect card. For every effect:

- **Kind** – Choose from the dropdown (damage, heal, applyStatus, preventAction, etc.). This list mirrors the `EffectKind` union accepted by the engine.
- **Value Type** – Control how the engine interprets the numbers: `flat`, `percent`, or `formula`.
- **Amount / Percent / Formula** – Provide one of these to define magnitude. Formulas use the server-side expression parser (`{ expr: "atk * 1.2" }`).
- **Min / Max** – Optional clamps for randomized effects.
- **Element, Resource, Stat** – Specialize the effect by element, which resource it targets, or which stat it modifies.
- **Status ID & Status Turns** – Attach a status application to the effect (duration in turns). Combine with **Kind = applyStatus** to apply statuses, or use other kinds to define secondary riders.
- **Shield ID** – Reference a shield defined elsewhere.
- **Can Miss / Can Crit** – Toggles for accuracy and critical rolls.

Use the **Add Effect** button to chain multiple behaviors (e.g., damage plus status). The **Remove** button deletes a card.

### Item-only options
- **Consumable** – For items, toggling this to true consumes the item on use. Items otherwise follow the same targeting and effect rules.

---

## Statuses

Statuses govern ongoing effects applied by skills/items.

- **Status ID & Name** – Unique identifiers referenced by skills, enemies, and hooks.
- **Icon** – Optional asset key for UI overlays.
- **Description** – Player-facing explanation.
- **Tags** – Free-form strings used for interaction rules and cleanses.
- **Max Stacks** – Maximum number of concurrent stacks (leave blank for unlimited or implicit handling).
- **Stack Rule** – Controls how reapplications behave:
  - `ignore` – Additional applications are ignored once the status is present.
  - `renew` – Refreshes duration without increasing stack count.
  - `stackCount` – Increments `stacks` without amplifying potency.
  - `stackMagnitude` – Boosts the status' strength proportionally with each stack.
- **Duration Turns** – How long the status persists; `0` means instant effects that expire immediately.
- **Modifiers** – JSON editor for stat deltas or custom flags consumed by runtime logic.
- **Hooks** – JSON editor for trigger-based behaviors (`onApply`, `onExpire`, `onTurnStart`, etc.). Hooks accept arrays of effect objects, so you can reuse anything from the Effects section (including `{ "kind": "preventAction", "message": "Target is paralyzed!" }` to skip a turn). Invalid JSON displays an inline error until corrected.

> **Example:** To make *Paralyze* skip turns, add this to **Hooks → onTurnStart**:
> ```json
> {
>   "onTurnStart": [
>     { "kind": "preventAction", "message": "The target is paralyzed!" }
>   ]
> }
> ```

---

## Classes

Classes define player presets.

- **Base Stats** – Max HP/STA/MP, Attack, and Defense per class.
- **Class Skills** – Ordered list of skill IDs the class knows at start. Validation ensures each entry is filled.
- **Starting Items** – Array of `{ id, qty }` pairs. Quantities can be zero to give ownership without charges, or higher for consumables.

---

## Enemies

Enemy definitions combine stat templates, drops, and AI hints.

- **Base & Scale Stats** – `base` is the starting stat block; `scale` describes per-level growth.
- **Skills** – Skill IDs the enemy can use during combat.
- **Drops** – Loot table entries (`id` and `qty`). Combine with global drop tuning in Balance.
- **Tags** – Strings used by targeting conditions, resist tables, or quest hooks.
- **AI Preferences** – `preferTags` bias targets that carry a tag, while `avoidTags` deprioritize them.
- **Color** – Numeric color tint for rendering.

---

## NPCs

NPCs support merchants, trainers, quest givers, and ambient characters.

- **Kind** – Choose `merchant`, `trainer`, `questGiver`, or `generic` to inform runtime behaviors.
- **Wander Settings** – Optional JSON-like inputs for wander speed and region key to control world movement.
- **Inventory** – List of purchasable items with quantity, price, and optional rarity string. Empty price defaults to global economy rates.
- **Trainer Config** – Assign a class they represent, list skills they can teach, and optionally override prices per skill via the `priceBySkill` record.
- **Dialogue** – Add static lines for idle chatter, and configure interactive `options` via the JSON editor (each option has `text` and an optional `action` object).
- **Respawn Turns** – Number of turns before the NPC respawns after despawning (optional).

---

## Balance

Balance settings expose global tuning knobs. Every numeric field is validated for finite values.

- **Hit/Crit/Defense knobs** – `BASE_HIT`, `BASE_CRIT`, `CRIT_MULT`, `DODGE_FLOOR`, and `HIT_CEIL` govern combat math.
- **Flee & Loot** – `FLEE_BASE`, `LOOT_ROLLS`, and `GOLD_DROP` (mean/variance) control escape odds and loot distribution.
- **Progression** – `LEVEL_UNLOCK_INTERVAL`, `SKILL_SLOTS_BY_LEVEL`, and `XP_CURVE` (base/growth) determine pacing.
- **Economy** – Inside `ECONOMY`, adjust buy/sell multipliers, shop restock cadence, and per-rarity price overrides.
- **Element Matrix** – JSON editor mapping attacker element keys to defender element multipliers (e.g., `{ "fire": { "ice": 1.5 } }`).
- **Resists By Tag** – JSON record applying global damage multipliers to enemies with matching tags.

---

## World Data

Manage shared lookup tables here.

- **Elements** – Ordered list of elemental keys referenced by skills, statuses, and the Balance matrix.
- **Tags** – Global tag catalogue that feeds dropdowns throughout the CMS (statuses, enemies, AI, etc.). Entries must be unique.

---

## Troubleshooting & validation

- **Save button disabled** – Hover over red-highlighted fields to find specific validation messages. All IDs and required numbers must be present before saving.
- **Red banner persists** – Expand each tab and check for inline errors under inputs or inside JSON editors. The forms remember the last field that failed validation.
- **JSON editor errors** – The modifier, hook, dialogue option, and balance editors require valid JSON. The editor clears errors automatically once the text parses.
- **Lost data after reload** – Remember that `Reload` pulls from `localStorage`. If you imported or edited data without saving, reload will revert to the last saved snapshot.

Export frequently and keep backups of `game-config.json` in version control to ensure reproducibility across environments.
