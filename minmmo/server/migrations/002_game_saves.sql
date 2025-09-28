CREATE TABLE IF NOT EXISTS account_credentials (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  active_character_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_characters (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account_credentials(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_selected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS character_world_states (
  character_id TEXT PRIMARY KEY REFERENCES account_characters(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_inventories (
  character_id TEXT PRIMARY KEY REFERENCES account_characters(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_characters_account_id ON account_characters(account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_credentials_active_character_fk'
  ) THEN
    ALTER TABLE account_credentials
      ADD CONSTRAINT account_credentials_active_character_fk
      FOREIGN KEY (active_character_id)
      REFERENCES account_characters(id)
      ON DELETE SET NULL;
  END IF;
END$$;
