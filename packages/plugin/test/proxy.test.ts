import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { needsProxyEnv, reporterEnv } from '../src/proxy'

const PROXY_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NODE_USE_ENV_PROXY',
]

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of PROXY_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of PROXY_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('needsProxyEnv / reporterEnv', () => {
  it('无代理环境：不需要注入，返回原 env', () => {
    expect(needsProxyEnv()).toBe(false)
    expect(reporterEnv().NODE_USE_ENV_PROXY).toBeUndefined()
  })

  it('检测到 http_proxy 且未设开关：注入 NODE_USE_ENV_PROXY=1', () => {
    process.env.http_proxy = 'http://127.0.0.1:7897'
    expect(needsProxyEnv()).toBe(true)
    expect(reporterEnv().NODE_USE_ENV_PROXY).toBe('1')
  })

  it('大写 HTTPS_PROXY 同样识别', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897'
    expect(needsProxyEnv()).toBe(true)
  })

  it('已显式设置 NODE_USE_ENV_PROXY：不重复注入', () => {
    process.env.all_proxy = 'socks5://127.0.0.1:7897'
    process.env.NODE_USE_ENV_PROXY = '1'
    expect(needsProxyEnv()).toBe(false)
    expect(reporterEnv()).toBe(process.env)
  })
})
