interface PauseMenuProps {
  visible: boolean;
  onResume(): void;
  onSave(): void;
  onLogout(): void;
  statusMessage?: string;
  statusTone?: 'info' | 'success' | 'error';
}

export function PauseMenu({
  visible,
  onResume,
  onSave,
  onLogout,
  statusMessage,
  statusTone = 'info',
}: PauseMenuProps) {
  if (!visible) {
    return null;
  }

  const statusClasses = ['pause-menu__status'];
  if (statusTone === 'success') {
    statusClasses.push('pause-menu__status--success');
  } else if (statusTone === 'error') {
    statusClasses.push('pause-menu__status--error');
  }

  return (
    <div className="pause-overlay" role="dialog" aria-modal="true" aria-label="Pause menu">
      <div className="pause-menu">
        <header>
          <h2>Game Paused</h2>
          <p className="pause-menu__subtitle">Take a breather and choose your next action.</p>
        </header>
        <div className={statusClasses.join(' ')}>
          {statusMessage ?? '\u00A0'}
        </div>
        <div className="pause-menu__actions">
          <button type="button" onClick={onResume}>
            Resume Adventure
          </button>
          <button type="button" className="ghost" onClick={onSave}>
            Save Game
          </button>
          <button type="button" className="ghost danger" onClick={onLogout}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
