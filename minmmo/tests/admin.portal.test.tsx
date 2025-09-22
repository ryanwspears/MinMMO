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
});
