import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { writeConfig } from './config'
import { mergeHooks, removeHooks } from './merge-settings'
import { binDir, claudeSettingsPath, ensureDirs } from './paths'
import { DEFAULT_ENDPOINT } from './version'

function parseArgs(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>()
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg?.startsWith('--')) {
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        parsed.set(arg.slice(2), value)
        i += 1
      }
    }
  }
  return parsed
}

async function promptForCode(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await rl.question('粘贴你的 auth-code（cr_live_...）：')
    return answer.trim()
  } finally {
    rl.close()
  }
}

function installBundle(): string {
  const selfPath = process.argv[1]
  if (!selfPath) throw new Error('cannot locate plugin bundle path')
  const target = path.join(binDir(), 'codingrace.mjs')
  fs.copyFileSync(selfPath, target)
  return target
}

function readSettings(settingsPath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeSettings(settingsPath: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  if (fs.existsSync(settingsPath)) {
    fs.copyFileSync(settingsPath, `${settingsPath}.codingrace-bak`)
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
}

export async function runInstall(args: string[]): Promise<void> {
  const parsed = parseArgs(args)
  const code = parsed.get('code') ?? (await promptForCode())
  if (!code.startsWith('cr_')) {
    throw new Error('auth-code 格式不正确（应以 cr_ 开头），请从设置页复制')
  }

  ensureDirs()
  writeConfig({ authCode: code, endpoint: parsed.get('endpoint') ?? DEFAULT_ENDPOINT })

  // 把当前单文件 bundle 固化到数据目录，hook 命令不依赖 npx 缓存路径
  const bundlePath = installBundle()
  const hookCommand = `node "${bundlePath}" hook`

  const settingsPath = claudeSettingsPath()
  const settings = readSettings(settingsPath)
  writeSettings(settingsPath, mergeHooks(settings, hookCommand))

  process.stderr.write(
    [
      '✓ CodingRace 插件安装完成',
      `  - 配置：auth-code 已保存（仅本机，0600 权限）`,
      `  - hook：已写入 ${settingsPath}（原文件备份为 settings.json.codingrace-bak）`,
      '  - 隐私：只上报 token 计数与模型名，绝不上传对话内容或路径',
      '  下一次 Claude Code 会话结束后，数据将自动上报。',
      '',
    ].join('\n')
  )
}

export function runUninstall(): void {
  const settingsPath = claudeSettingsPath()
  const settings = readSettings(settingsPath)
  writeSettings(settingsPath, removeHooks(settings))
  process.stderr.write(
    ['✓ 已从 Claude Code 移除 CodingRace hooks', `  数据目录保留，可手动删除 ~/.codingrace`, ''].join(
      '\n'
    )
  )
}
