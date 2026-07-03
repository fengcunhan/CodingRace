// 对 ~/.claude/settings.json 的纯函数式合并/移除，绝不动用户已有的其他配置。
// 以命令中的数据目录路径片段作为归属标记。

export const HOOK_EVENTS = ['Stop', 'SessionEnd'] as const
// 用 bundle 文件名而非数据目录做归属标记：CODINGRACE_DIR 自定义路径也能被 uninstall 识别
export const OWNERSHIP_MARKER = 'codingrace.mjs'

interface HookCommand {
  type: string
  command?: string
  timeout?: number
}

interface HookEntry {
  matcher?: string
  hooks?: HookCommand[]
}

function asArray(value: unknown): HookEntry[] {
  return Array.isArray(value) ? (value as HookEntry[]) : []
}

function entryHasMarker(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => h.command?.includes(OWNERSHIP_MARKER) ?? false)
}

export function mergeHooks(
  settings: Record<string, unknown>,
  command: string
): Record<string, unknown> {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>

  const nextHooks = HOOK_EVENTS.reduce<Record<string, unknown>>(
    (acc, event) => {
      const existing = asArray(acc[event])
      if (existing.some(entryHasMarker)) return acc
      return {
        ...acc,
        [event]: [...existing, { hooks: [{ type: 'command', command, timeout: 10 }] }],
      }
    },
    { ...hooks }
  )

  return { ...settings, hooks: nextHooks }
}

export function removeHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>

  const nextHooks = Object.fromEntries(
    Object.entries(hooks)
      .map(([event, entries]) => {
        const kept = asArray(entries)
          .map((entry) => ({
            ...entry,
            hooks: (entry.hooks ?? []).filter(
              (h) => !(h.command?.includes(OWNERSHIP_MARKER) ?? false)
            ),
          }))
          .filter((entry) => (entry.hooks?.length ?? 0) > 0 || !Array.isArray(entry.hooks))
        return [event, kept] as const
      })
      .filter(([, entries]) => entries.length > 0)
  )

  return { ...settings, hooks: nextHooks }
}
