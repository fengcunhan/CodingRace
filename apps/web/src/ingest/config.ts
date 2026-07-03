// 第一期阈值以常量下发；第二期迁到配置表（见实现计划 §4）
export const INGEST_LIMITS = {
  // occurred_at 允许的最大时钟超前
  maxFutureSkewMs: 10 * 60_000,
  // 超过此时长的迟到数据标记 late：计入总榜，不计入短期榜
  lateThresholdMs: 72 * 3_600_000,
  // 单轮输出 token 速率物理上限，超出标记 suspect
  maxOutputTokensPerSecond: 500,
  rateLimitPerMinute: 60,
} as const

// 未能归一化的模型在聚合表中的占位键
export const UNKNOWN_MODEL_KEY = 'unknown'

// fail closed：用公开常量做盐等于 ip_hash 可被字典反查，
// 只有明确的 development/test 环境才允许回退，NODE_ENV 缺失一律视为生产
export function getIpHashSalt(): string {
  const salt = process.env.IP_HASH_SALT
  if (salt) return salt
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return 'codingrace-dev-salt'
  }
  throw new Error('IP_HASH_SALT must be configured')
}
