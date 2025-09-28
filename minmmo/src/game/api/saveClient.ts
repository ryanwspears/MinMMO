import type { PlayerProfile, WorldState } from '../save'

declare const __MINMMO_API_BASE__: string | undefined

type RequestOptions = RequestInit & { expect?: 'json' | 'empty' }

let apiBase = resolveDefaultBase()

function resolveDefaultBase(): string {
  if (typeof __MINMMO_API_BASE__ === 'string' && __MINMMO_API_BASE__) {
    return normalizeBase(__MINMMO_API_BASE__)
  }
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, host } = window.location
    if (protocol === 'https:') {
      return `https://${host}`
    }
    if (host) {
      return `https://${host}`
    }
  }
  return 'https://localhost:3001'
}

function normalizeBase(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'https://localhost:3001'
  }
  const url = new URL(trimmed, 'https://localhost')
  url.protocol = 'https:'
  return url.origin
}

function resolveUrl(path: string): string {
  const base = new URL(apiBase)
  base.protocol = 'https:'
  const target = new URL(path.replace(/^(\/)+/, ''), base)
  target.protocol = 'https:'
  return target.toString()
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { expect = 'json', headers, ...rest } = options
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  }
  const response = await fetch(resolveUrl(path), init)
  if (!response.ok) {
    const message = `Request failed with status ${response.status}`
    throw new Error(message)
  }
  if (expect === 'empty' || response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export function setSaveApiBase(base: string) {
  apiBase = normalizeBase(base)
}

export async function listAccountsRequest(): Promise<unknown> {
  return request('/api/accounts')
}

export async function createAccountRequest(id: string, password: string): Promise<unknown> {
  return request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ id, password }),
  })
}

export async function authenticateAccountRequest(
  id: string,
  password: string,
): Promise<{ success: boolean }> {
  return request('/api/accounts/authenticate', {
    method: 'POST',
    body: JSON.stringify({ id, password }),
  })
}

export async function selectActiveCharacterRequest(accountId: string, characterId: string | null) {
  await request(`/api/accounts/${encodeURIComponent(accountId)}/selection`, {
    method: 'POST',
    body: JSON.stringify({ characterId }),
    expect: 'empty',
  })
}

export async function listCharactersRequest(accountId: string): Promise<unknown> {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/characters`)
}

export async function getCharacterRequest(accountId: string, characterId: string): Promise<unknown> {
  return request(
    `/api/accounts/${encodeURIComponent(accountId)}/characters/${encodeURIComponent(characterId)}`,
  )
}

export async function upsertCharacterRequest(
  accountId: string,
  payload: { id?: string; profile: PlayerProfile; world: WorldState },
): Promise<unknown> {
  const target = payload.id
    ? `/api/characters/${encodeURIComponent(payload.id)}`
    : '/api/characters'
  const method = payload.id ? 'PUT' : 'POST'
  return request(target, {
    method,
    body: JSON.stringify({ ...payload, accountId }),
  })
}
