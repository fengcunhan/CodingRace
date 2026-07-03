import { INGEST_LIMITS } from './config'

// 第一期：进程内固定窗口限流。serverless 多实例下限流是"每实例"的，
// 上线（M4）换 Upstash 实现，本接口不变。
const WINDOW_MS = 60_000
const MAX_TRACKED_KEYS = 10_000

const windows = new Map<string, { start: number; count: number }>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkRateLimit(
  key: string,
  nowMs: number,
  limit: number = INGEST_LIMITS.rateLimitPerMinute
): RateLimitResult {
  const current = windows.get(key)

  if (!current || nowMs - current.start >= WINDOW_MS) {
    if (windows.size >= MAX_TRACKED_KEYS) {
      pruneExpired(nowMs)
      evictOldest(MAX_TRACKED_KEYS - 1)
    }
    windows.set(key, { start: nowMs, count: 1 })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const next = { start: current.start, count: current.count + 1 }
  windows.set(key, next)

  if (next.count > limit) {
    const retryAfterSeconds = Math.ceil((current.start + WINDOW_MS - nowMs) / 1000)
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

function pruneExpired(nowMs: number): void {
  for (const [key, value] of windows) {
    if (nowMs - value.start >= WINDOW_MS) {
      windows.delete(key)
    }
  }
}

// prune 后仍满（大量活跃 key，如轮换 code 撞库）时按插入序淘汰最旧的
function evictOldest(target: number): void {
  for (const key of windows.keys()) {
    if (windows.size <= target) break
    windows.delete(key)
  }
}

export function resetRateLimiter(): void {
  windows.clear()
}
