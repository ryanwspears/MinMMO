import { describe, it, beforeEach, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AdminPortal } from '@cms/AdminPortal';
import { load } from '@config/store';

describe('AdminPortal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the admin portal header', () => {
    render(<AdminPortal />);
    expect(screen.getByText(/MinMMO Admin CMS/i)).toBeDefined();
    const saveButton = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('adds a skill and persists it via save', async () => {
    const user = userEvent.setup();
    render(<AdminPortal />);

    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const [skillButton] = await screen.findAllByRole('button', { name: /^New Skill\b/i });
    await user.click(skillButton);
    const idInput = await screen.findByLabelText('Skill ID');
    await user.clear(idInput);
    await user.type(idInput, 'fireball');

    const [skillButtonAgain] = await screen.findAllByRole('button', { name: /^New Skill\b/i });
    await user.click(skillButtonAgain);
    const nameInput = await screen.findByLabelText('Skill Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Fireball');

    const amountInput = screen.getByLabelText('Effect 1 Amount');
    await user.clear(amountInput);
    await user.type(amountInput, '25');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const cfg = load();
    expect(cfg.skills.fireball).toBeDefined();
    expect(cfg.skills.fireball.name).toBe('Fireball');
    expect(cfg.skills.fireball.effects[0]?.amount).toBe(25);
  });

  it('shows validation errors and disables save for invalid skills', async () => {
    const user = userEvent.setup();
    render(<AdminPortal />);

    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const [skillButton] = await screen.findAllByRole('button', { name: /^New Skill\b/i });
    await user.click(skillButton);
    const idInput = await screen.findByLabelText('Skill ID');
    await user.clear(idInput);

    const [again] = await screen.findAllByRole('button', { name: /^New Skill\b/i });
    await user.click(again);
    expect(await screen.findByText(/ID is required/i)).toBeDefined();
    const saveButton = screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('allows editing classes and persists related data', async () => {
    const user = userEvent.setup();
    render(<AdminPortal />);

    await user.click(screen.getByRole('button', { name: /classes/i }));
    await user.click(screen.getByRole('button', { name: /add class/i }));

    const [classButton] = await screen.findAllByRole('button', { name: /new-class/i });
    await user.click(classButton);

    const classIdInput = await screen.findByLabelText('Class ID');
    await user.clear(classIdInput);
    await user.type(classIdInput, 'warrior');

    const maxHpInput = screen.getByLabelText('Max HP');
    await user.clear(maxHpInput);
    await user.type(maxHpInput, '40');

    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const classSkillInput = await screen.findByLabelText('Class Skill 1');
    await user.type(classSkillInput, 'slash');

    await user.click(screen.getByRole('button', { name: /add item/i }));
    const startItemId = screen.getByLabelText('Start Item 1 ID');
    await user.type(startItemId, 'potion');
    const startItemQty = screen.getByLabelText('Start Item 1 Quantity');
    await user.clear(startItemQty);
    await user.type(startItemQty, '2');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const cfg = load();
    expect(cfg.classes.warrior).toBeDefined();
    expect(cfg.classes.warrior.maxHp).toBe(40);
    expect(cfg.classSkills.warrior).toEqual(['slash']);
    expect(cfg.startItems.warrior).toEqual([{ id: 'potion', qty: 2 }]);
  });

  it('edits statuses with tags and saves them', async () => {
    const user = userEvent.setup();
    render(<AdminPortal />);

    await user.click(screen.getByRole('button', { name: /statuses/i }));
    await user.click(screen.getByRole('button', { name: /add status/i }));

    const statusIdInput = await screen.findByLabelText('Status ID');
    await user.clear(statusIdInput);
    await user.type(statusIdInput, 'burning');

    const statusNameInput = screen.getByLabelText('Status Name');
    await user.clear(statusNameInput);
    await user.type(statusNameInput, 'Burning');

    const maxStacksInput = screen.getByLabelText('Max Stacks');
    await user.clear(maxStacksInput);
    await user.type(maxStacksInput, '3');

    await user.click(screen.getByRole('button', { name: /add tag/i }));
    const tagInput = screen.getByLabelText('Status Tag 1');
    await user.type(tagInput, 'fire');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const cfg = load();
    expect(cfg.statuses.burning).toBeDefined();
    expect(cfg.statuses.burning.name).toBe('Burning');
    expect(cfg.statuses.burning.maxStacks).toBe(3);
    expect(cfg.statuses.burning.tags).toEqual(['fire']);
  });
});
