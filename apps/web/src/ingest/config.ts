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
