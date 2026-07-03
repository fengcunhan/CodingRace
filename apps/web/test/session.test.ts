import { describe, expect, it } from 'vitest'
import { generateAuthCode } from '../src/auth/codes'
import { createSessionToken, verifySessionToken } from '../src/auth/session'
import { hashAuthCode } from '../src/ingest/auth'

const SECRET = 'test-secret'
const NOW = new Date('2026-07-03T12:00:00Z')

describe('session token — 签名会话', () => {
  it('签发后可验证并取回 userId', () => {
    const token = createSessionToken('user-123', SECRET, NOW)
    expect(verifySessionToken(token, SECRET, NOW)).toBe('user-123')
  })

  it('篡改 payload 后验证失败', () => {
    const token = createSessionToken('user-123', SECRET, NOW)
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ uid: 'user-999', exp: 9999999999 })).toString(
      'base64url'
    )
    expect(verifySessionToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull()
    expect(verifySessionToken(`${payload}.AAAA`, SECRET, NOW)).toBeNull()
  })

  it('密钥不匹配验证失败', () => {
    const token = createSessionToken('user-123', SECRET, NOW)
    expect(verifySessionToken(token, 'other-secret', NOW)).toBeNull()
  })

  it('过期令牌验证失败', () => {
    const token = createSessionToken('user-123', SECRET, NOW)
    const later = new Date(NOW.getTime() + 31 * 24 * 3600 * 1000)
    expect(verifySessionToken(token, SECRET, later)).toBeNull()
  })

  it('畸形令牌返回 null 而不抛错', () => {
    for (const bad of ['', 'no-dot', '.', 'a.b.c..', '%%%.###']) {
      expect(verifySessionToken(bad, SECRET, NOW)).toBeNull()
    }
  })
})

describe('generateAuthCode — 凭证生成', () => {
  it('格式为 cr_live_ + 32 位 hex，hash 与 prefix 一致', () => {
    const generated = generateAuthCode()
    expect(generated.code).toMatch(/^cr_live_[0-9a-f]{32}$/)
    expect(generated.codeHash).toBe(hashAuthCode(generated.code))
    expect(generated.codePrefix).toBe(generated.code.slice(0, 12))
  })

  it('两次生成不重复', () => {
    expect(generateAuthCode().code).not.toBe(generateAuthCode().code)
  })
})
