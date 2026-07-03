import { randomBytes } from 'node:crypto'
import { hashAuthCode } from '../ingest/auth'

export interface GeneratedAuthCode {
  code: string
  codeHash: string
  codePrefix: string
}

// cr_live_ + 32 位 hex（128bit 熵），明文只在生成时返回一次
export function generateAuthCode(): GeneratedAuthCode {
  const code = `cr_live_${randomBytes(16).toString('hex')}`
  return {
    code,
    codeHash: hashAuthCode(code),
    codePrefix: code.slice(0, 12),
  }
}
