import fs from 'node:fs'
import { errorLogPath } from './paths'

const MAX_LOG_BYTES = 100 * 1024

export function appendError(context: string, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error)
    const line = `${new Date().toISOString()} [${context}] ${message}\n`
    fs.appendFileSync(errorLogPath(), line)

    const stat = fs.statSync(errorLogPath())
    if (stat.size > MAX_LOG_BYTES) {
      const content = fs.readFileSync(errorLogPath(), 'utf8')
      fs.writeFileSync(errorLogPath(), content.slice(-MAX_LOG_BYTES / 2))
    }
  } catch {
    // 日志失败不影响主流程
  }
}
