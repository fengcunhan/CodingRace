import { createHash } from 'node:crypto'

export interface RequestMeta {
  geoCountry: string | null
  geoCity: string | null
  ipHash: string | null
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || null
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

// 原始 IP 只在请求处理作用域内存在：解析 Geo（Vercel 头）+ 计算当日盐哈希后即丢弃，
// 绝不落库、绝不返回（见设计文档 §5 保留策略）
export function requestMeta(headers: Headers, now: Date, salt: string): RequestMeta {
  const ip = clientIp(headers)
  const country = headers.get('x-vercel-ip-country')
  const city = headers.get('x-vercel-ip-city')
  const day = now.toISOString().slice(0, 10)

  return {
    geoCountry: country && country.length === 2 ? country.toUpperCase() : null,
    geoCity: city ? safeDecode(city) : null,
    ipHash: ip ? createHash('sha256').update(`${ip}:${salt}:${day}`).digest('hex') : null,
  }
}
