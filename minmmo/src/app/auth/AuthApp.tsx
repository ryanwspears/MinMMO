import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG } from '@config/store';
import type { Stats } from '@engine/battle/types';
import type { AccountSummary, ActiveSelection, CharacterRecord, PlayerProfile, WorldState } from '@game/save';
import {
  authenticateAccount,
  createAccount,
  createDefaultWorld,
  getActiveSelection,
  listAccounts,
  listCharacters,
  selectActiveCharacter,
  upsertCharacter,
} from '@game/save';

interface AuthAppProps {
  selection: ActiveSelection;
  isGameRunning: boolean;
  onSelectionChange(selection: ActiveSelection): void;
  onStartGame(): void;
  onLogout(): void;
}

type ViewState =
  | 'landing'
  | 'signup'
  | 'login'
  | 'character-create'
  | 'character-select'
  | 'ready';

interface ClassSummary {
  id: string;
  stats: Stats;
}

function buildInitialStats(clazz: string): Stats {
  const preset = CONFIG().classes?.[clazz];
  const fallback = { maxHp: 10, maxSta: 10, maxMp: 0, atk: 3, def: 1 };
  const source = preset ?? fallback;
  return {
    maxHp: Number(source.maxHp) || fallback.maxHp,
    hp: Number(source.maxHp) || fallback.maxHp,
    maxSta: Number(source.maxSta) || fallback.maxSta,
    sta: Number(source.maxSta) || fallback.maxSta,
    maxMp: Number(source.maxMp) || fallback.maxMp,
    mp: Number(source.maxMp) || fallback.maxMp,
    atk: Number(source.atk) || fallback.atk,
    def: Number(source.def) || fallback.def,
    lv: 1,
    xp: 0,
    gold: 0,
  };
}

function buildProfile(name: string, clazz: string): PlayerProfile {
  const config = CONFIG();
  const stats = buildInitialStats(clazz);
  const classSkills = Array.isArray(config.classSkills?.[clazz]) ? config.classSkills[clazz] : [];
  const startItems = Array.isArray(config.startItems?.[clazz]) ? config.startItems[clazz] : [];
  const equippedSlots = config.balance?.SKILL_SLOTS_BY_LEVEL?.[0] ?? 2;
  const equippedSkills = classSkills.slice(0, equippedSlots);

  return {
    name: name.trim() || 'Adventurer',
    clazz,
    level: 1,
    xp: 0,
    gold: 0,
    stats,
    unlockedSkills: Array.from(new Set(classSkills)),
    equippedSkills: Array.from(new Set(equippedSkills)),
    inventory: startItems
      .map((entry) => ({ id: String(entry.id ?? ''), qty: Number(entry.qty) || 0 }))
      .filter((entry) => entry.id && entry.qty > 0),
  };
}

export function AuthApp({ selection, isGameRunning, onSelectionChange, onStartGame, onLogout }: AuthAppProps) {
  const [view, setView] = useState<ViewState>(() => {
    if (selection.accountId && selection.characterId) return 'ready';
    if (selection.accountId) return 'character-select';
    return 'landing';
  });
  const [activeAccountId, setActiveAccountId] = useState<string | undefined>(selection.accountId);
  const [signupId, setSignupId] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signupError, setSignupError] = useState('');

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [charName, setCharName] = useState('Adventurer');
  const [charClass, setCharClass] = useState<string>('');
  const [charError, setCharError] = useState('');
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAccounts()
      .then((entries) => {
        if (!cancelled) {
          setAccounts(entries);
        }
      })
      .catch((error) => {
        console.error('Failed to load accounts', error);
        if (!cancelled) {
          setAccounts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCounter, selection.accountId]);

  useEffect(() => {
    if (!activeAccountId) {
      setCharacters([]);
      return;
    }
    let cancelled = false;
    listCharacters(activeAccountId)
      .then((entries) => {
        if (!cancelled) {
          setCharacters(entries);
        }
      })
      .catch((error) => {
        console.error('Failed to load characters', error);
        if (!cancelled) {
          setCharacters([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, refreshCounter]);

  const config = CONFIG();
  const classSummaries = useMemo<ClassSummary[]>(() => {
    const entries: ClassSummary[] = [];
    for (const key of Object.keys(config.classes ?? {})) {
      entries.push({ id: key, stats: buildInitialStats(key) });
    }
    return entries;
  }, [config]);

  useEffect(() => {
    if (selection.accountId && selection.characterId) {
      setView('ready');
    } else if (selection.accountId) {
      setView('character-select');
    } else {
      setView('landing');
    }
    setActiveAccountId(selection.accountId);
  }, [selection.accountId, selection.characterId]);

  useEffect(() => {
    if (!charClass && classSummaries.length) {
      setCharClass(classSummaries[0].id);
    }
  }, [charClass, classSummaries]);

  const resetAuthForms = useCallback(() => {
    setSignupError('');
    setLoginError('');
    setCharError('');
  }, []);

  const handleCreateAccount = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetAuthForms();
      if (!signupId.trim()) {
        setSignupError('Choose an account ID.');
        return;
      }
      if (signupPassword !== signupConfirm) {
        setSignupError('Passwords do not match.');
        return;
      }
      try {
        const account = await createAccount(signupId, signupPassword);
        await selectActiveCharacter(account.id, null);
        setActiveAccountId(account.id);
        setView('character-create');
        setRefreshCounter((x) => x + 1);
        onSelectionChange(getActiveSelection());
      } catch (error) {
        setSignupError(error instanceof Error ? error.message : 'Could not create account.');
      }
    },
    [onSelectionChange, resetAuthForms, signupConfirm, signupId, signupPassword],
  );

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetAuthForms();
      const trimmed = loginId.trim();
      if (!trimmed) {
        setLoginError('Enter your account ID.');
        return;
      }
      const ok = await authenticateAccount(trimmed, loginPassword);
      if (!ok) {
        setLoginError('Invalid credentials.');
        return;
      }
      setActiveAccountId(trimmed);
      setView('character-select');
      setRefreshCounter((x) => x + 1);
      onSelectionChange(getActiveSelection());
    },
    [loginId, loginPassword, onSelectionChange, resetAuthForms],
  );

  const handleCreateCharacter = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetAuthForms();
      if (!activeAccountId) {
        setCharError('No active account.');
        return;
      }
      if (!charClass) {
        setCharError('Choose a class.');
        return;
      }
      try {
        const profile = buildProfile(charName, charClass);
        const world: WorldState = createDefaultWorld();
        const record = await upsertCharacter(activeAccountId, { profile, world });
        await selectActiveCharacter(activeAccountId, record.id);
        setCharName('Adventurer');
        setView('ready');
        setRefreshCounter((x) => x + 1);
        onSelectionChange(getActiveSelection());
      } catch (error) {
        setCharError(error instanceof Error ? error.message : 'Could not create character.');
      }
    },
    [activeAccountId, charClass, charName, onSelectionChange, resetAuthForms],
  );

  const handleSelectCharacter = useCallback(
    async (characterId: string) => {
      if (!activeAccountId) return;
      try {
        await selectActiveCharacter(activeAccountId, characterId);
        setView('ready');
        setRefreshCounter((x) => x + 1);
        onSelectionChange(getActiveSelection());
      } catch (error) {
        setCharError(error instanceof Error ? error.message : 'Could not select character.');
      }
    },
    [activeAccountId, onSelectionChange],
  );

  const handleLogout = useCallback(async () => {
    await selectActiveCharacter(null);
    setActiveAccountId(undefined);
    setView('landing');
    setRefreshCounter((x) => x + 1);
    onSelectionChange(getActiveSelection());
    onLogout();
  }, [onLogout, onSelectionChange]);

  const activeCharacter = useMemo(() => {
    if (!selection.accountId || !selection.characterId) return undefined;
    return characters.find((character) => character.id === selection.characterId);
  }, [characters, selection.accountId, selection.characterId]);

  return (
    <div className="auth-app">
      {view === 'landing' && (
        <div className="auth-landing">
          <h2>Welcome to MinMMO</h2>
          <p className="small">Sign up to create a new hero or log in to continue your journey.</p>
          <div className="row">
            <button type="button" onClick={() => setView('signup')}>
              Sign Up
            </button>
            <button type="button" onClick={() => setView('login')}>
              Log In
            </button>
          </div>
        </div>
      )}

      {view === 'signup' && (
        <form className="auth-form" onSubmit={handleCreateAccount}>
          <h2>Create Account</h2>
          <label>
            Account ID
            <input value={signupId} onChange={(event) => setSignupId(event.target.value)} placeholder="adventurer123" />
          </label>
          <label>
            Password
            <input type="password" value={signupPassword} onChange={(event) => setSignupPassword(event.target.value)} />
          </label>
          <label>
            Confirm Password
            <input type="password" value={signupConfirm} onChange={(event) => setSignupConfirm(event.target.value)} />
          </label>
          {signupError && <div className="error">{signupError}</div>}
          <div className="row">
            <button type="submit">Continue</button>
            <button type="button" className="ghost" onClick={() => setView('landing')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {view === 'login' && (
        <form className="auth-form" onSubmit={handleLogin}>
          <h2>Log In</h2>
          <label>
            Account ID
            <input value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="adventurer123" />
          </label>
          <label>
            Password
            <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
          </label>
          {loginError && <div className="error">{loginError}</div>}
          <div className="row">
            <button type="submit">Continue</button>
            <button type="button" className="ghost" onClick={() => setView('landing')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {view === 'character-create' && (
        <form className="auth-form" onSubmit={handleCreateCharacter}>
          <h2>Character Setup</h2>
          <label>
            Name
            <input value={charName} onChange={(event) => setCharName(event.target.value)} placeholder="Adventurer" />
          </label>
          <label>
            Class
            <select value={charClass} onChange={(event) => setCharClass(event.target.value)}>
              {classSummaries.map((clazz) => (
                <option key={clazz.id} value={clazz.id}>
                  {clazz.id}
                </option>
              ))}
            </select>
          </label>
          {charClass && (
            <div className="small">
              <strong>Starting Stats:</strong> HP {classSummaries.find((clazz) => clazz.id === charClass)?.stats.maxHp ?? '-'} · STA{' '}
              {classSummaries.find((clazz) => clazz.id === charClass)?.stats.maxSta ?? '-'} · MP{' '}
              {classSummaries.find((clazz) => clazz.id === charClass)?.stats.maxMp ?? '-'}
            </div>
          )}
          {charError && <div className="error">{charError}</div>}
          <div className="row">
            <button type="submit">Save Hero</button>
            <button type="button" className="ghost" onClick={() => setView('landing')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {view === 'character-select' && (
        <div className="auth-form">
          <h2>Select Character</h2>
          {characters.length === 0 && (
            <>
              <p>No characters yet. Create one to begin your adventure.</p>
              <button type="button" onClick={() => setView('character-create')}>
                Create Character
              </button>
            </>
          )}
          {characters.length > 0 && (
            <div className="character-list">
              {characters.map((character) => (
                <div key={character.id} className="character-card">
                  <div>
                    <strong>{character.profile.name}</strong>
                    <div className="small">
                      {character.profile.clazz} · Level {character.profile.level}
                    </div>
                  </div>
                  <button type="button" onClick={() => handleSelectCharacter(character.id)}>
                    Play
                  </button>
                </div>
              ))}
            </div>
          )}
          {charError && <div className="error">{charError}</div>}
          <div className="row">
            <button type="button" onClick={() => setView('character-create')}>
              New Character
            </button>
            <button type="button" className="ghost" onClick={() => setView('landing')}>
              Back
            </button>
          </div>
        </div>
      )}

      {view === 'ready' && (
        <div className="auth-form">
          <h2>Ready to Play</h2>
          {activeCharacter ? (
            <>
              <div>
                <strong>{activeCharacter.profile.name}</strong>
                <div className="small">
                  {activeCharacter.profile.clazz} · Level {activeCharacter.profile.level}
                </div>
              </div>
            </>
          ) : (
            <p>Select a character to begin.</p>
          )}
          <div className="row">
            <button type="button" disabled={!activeCharacter} onClick={onStartGame}>
              {isGameRunning ? 'Resume Game' : 'Start Game'}
            </button>
            <button type="button" onClick={() => setView('character-select')}>
              Switch Character
            </button>
            <button type="button" className="ghost" onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </div>
      )}

      {view !== 'landing' && accounts.length > 0 && (
        <div className="account-list">
          <div className="small">Accounts</div>
          <ul>
            {accounts.map((account) => (
              <li key={account.id} className={account.id === activeAccountId ? 'active' : ''}>
                <button
                  type="button"
                  onClick={() => {
                    if (account.id === activeAccountId) {
                      setView(selection.characterId ? 'ready' : 'character-select');
                      return;
                    }
                    resetAuthForms();
                    setLoginId(account.id);
                    setLoginPassword('');
                    setView('login');
                  }}
                >
                  {account.id} ({account.characterCount})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default AuthApp;
