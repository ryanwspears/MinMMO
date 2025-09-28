import type { PlayerProfile, WorldState } from '../save'

declare const __MINMMO_API_BASE__: string | undefined

type RequestOptions = RequestInit & { expect?: 'json' | 'empty' }

const DEFAULT_API_BASE = 'http://localhost:3001'
const HOST_PATTERN = /^[\w.-]+(:\d+)?$/i

let apiBase = resolveDefaultBase()

function resolveDefaultBase(): string {
  if (typeof __MINMMO_API_BASE__ === 'string' && __MINMMO_API_BASE__) {
    return normalizeBase(__MINMMO_API_BASE__)
  }
  const origin = getWindowOrigin()
  if (origin) {
    return normalizeBase(origin)
  }
  return DEFAULT_API_BASE
}

function getWindowOrigin(): string | undefined {
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin) {
    return window.location.origin
  }
  return undefined
}

function getWindowProtocol(): 'http:' | 'https:' {
  if (typeof window !== 'undefined' && typeof window.location?.protocol === 'string') {
    const protocol = window.location.protocol
    if (protocol === 'http:' || protocol === 'https:') {
      return protocol
    }
  }
  return DEFAULT_API_BASE.startsWith('https') ? 'https:' : 'http:'
}

function normalizeBase(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return DEFAULT_API_BASE
  }
  const protocol = getWindowProtocol()
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).origin
    }
    if (trimmed.startsWith('//')) {
      return new URL(`${protocol}${trimmed}`).origin
    }
    if (HOST_PATTERN.test(trimmed)) {
      return new URL(`${protocol}//${trimmed}`).origin
    }
    const origin = getWindowOrigin() ?? DEFAULT_API_BASE
    return new URL(trimmed, origin).origin
  } catch {
    return DEFAULT_API_BASE
  }
}

function resolveUrl(path: string): string {
  return new URL(path, apiBase).toString()
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
