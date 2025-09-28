import { vi } from 'vitest'
import { validateAndRepair } from '@game-config/validate'
import type { GameConfig } from '@game-config/schema'

let serverPayload: unknown = validateAndRepair({})

function buildResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

export function useConfigApiMock(initial?: Partial<GameConfig>) {
  serverPayload = validateAndRepair(initial ?? {})

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
    if (!url.endsWith('/api/config') && url !== '/api/config') {
      return new Response('Not Found', { status: 404 })
    }
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      return buildResponse(serverPayload)
    }
    if (method === 'PUT') {
      const rawBody = init?.body
      let parsed: unknown = {}
      if (typeof rawBody === 'string') {
        parsed = JSON.parse(rawBody)
      } else if (rawBody instanceof Blob) {
        parsed = JSON.parse(await rawBody.text())
      } else if (rawBody) {
        const text = await new Response(rawBody as BodyInit).text()
        parsed = JSON.parse(text)
      }
      serverPayload = validateAndRepair(parsed)
      return buildResponse(serverPayload)
    }
    return new Response('Method Not Allowed', { status: 405 })
  })

  global.fetch = mock as typeof fetch

  return {
    getConfig: () => validateAndRepair(serverPayload),
    setConfig: (next: Partial<GameConfig>) => {
      serverPayload = validateAndRepair(next)
    },
    setRawConfig: (value: unknown) => {
      serverPayload = value
    },
    fetchMock: mock,
  }
}

export function restoreConfigApiMock() {
  vi.restoreAllMocks()
}
