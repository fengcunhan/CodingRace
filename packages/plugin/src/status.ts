import fs from 'node:fs'
import { readConfig } from './config'
import { listCursors } from './cursors'
import { deadLetterDir, errorLogPath } from './paths'
import { listQueueFiles } from './queue'

function deadLetterCount(): number {
  try {
    return fs.readdirSync(deadLetterDir()).filter((f) => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

function lastErrorLines(): string {
  try {
    const lines = fs.readFileSync(errorLogPath(), 'utf8').trim().split('\n')
    return lines.slice(-3).join('\n  ')
  } catch {
    return '(none)'
  }
}

export function runStatus(): void {
  const config = readConfig()
  const output = [
    'CodingRace plugin status',
    `  config:   ${config ? `endpoint=${config.endpoint} code=${config.authCode.slice(0, 12)}…` : 'NOT CONFIGURED (run: codingrace install)'}`,
    `  sessions: ${listCursors().length} tracked`,
    `  queue:    ${listQueueFiles().length} pending batch(es)`,
    `  dead:     ${deadLetterCount()} dead-lettered batch(es)`,
    `  errors:   ${lastErrorLines()}`,
    '',
  ].join('\n')
  process.stderr.write(output)
}
