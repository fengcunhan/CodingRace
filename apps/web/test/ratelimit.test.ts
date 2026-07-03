import { beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimiter } from '../src/ingest/ratelimit'

const T0 = 1_800_000_000_000

describe('checkRateLimit — 固定窗口限流', () => {
  beforeEach(() => {
    resetRateLimiter()
  })

  it('窗口内前 60 次放行，第 61 次拒绝并给出 Retry-After', () => {
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit('key-a', T0 + i * 100).allowed).toBe(true)
    }
    const blocked = checkRateLimit('key-a', T0 + 6100)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('窗口过期后重新放行', () => {
    for (let i = 0; i < 61; i++) {
      checkRateLimit('key-a', T0)
    }
    expect(checkRateLimit('key-a', T0 + 60_000).allowed).toBe(true)
  })

  it('不同 key 互不影响', () => {
    for (let i = 0; i < 61; i++) {
      checkRateLimit('key-a', T0)
    }
    expect(checkRateLimit('key-b', T0).allowed).toBe(true)
  })
})
