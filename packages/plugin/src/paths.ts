import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// CODINGRACE_DIR 供测试与多账号场景覆盖数据目录
export function dataDir(): string {
  return process.env.CODINGRACE_DIR ?? path.join(homedir(), '.codingrace')
}

export const queueDir = (): string => path.join(dataDir(), 'queue')
export const cursorsDir = (): string => path.join(dataDir(), 'cursors')
export const deadLetterDir = (): string => path.join(dataDir(), 'dead')
export const binDir = (): string => path.join(dataDir(), 'bin')
export const configPath = (): string => path.join(dataDir(), 'config.json')
export const lockPath = (): string => path.join(dataDir(), 'worker.lock')
export const errorLogPath = (): string => path.join(dataDir(), 'error.log')

export function claudeSettingsPath(): string {
  return process.env.CODINGRACE_CLAUDE_SETTINGS ?? path.join(homedir(), '.claude', 'settings.json')
}

export function ensureDirs(): void {
  for (const dir of [dataDir(), queueDir(), cursorsDir(), deadLetterDir(), binDir()]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
