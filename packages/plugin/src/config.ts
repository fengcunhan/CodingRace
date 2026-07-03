import fs from 'node:fs'
import { configPath } from './paths'

export interface PluginConfig {
  authCode: string
  endpoint: string
}

export function readConfig(): PluginConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.authCode === 'string' && typeof parsed.endpoint === 'string') {
      return { authCode: parsed.authCode, endpoint: parsed.endpoint }
    }
    return null
  } catch {
    return null
  }
}

export function writeConfig(config: PluginConfig): void {
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}
