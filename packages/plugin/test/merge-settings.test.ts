import { describe, expect, it } from 'vitest'
import { mergeHooks, removeHooks } from '../src/merge-settings'

const COMMAND = 'node "/Users/x/.codingrace/bin/codingrace.mjs" hook'

describe('mergeHooks — 保留式合并', () => {
  it('空 settings：注册 Stop 与 SessionEnd 两个事件', () => {
    const merged = mergeHooks({}, COMMAND)
    const hooks = merged.hooks as Record<string, unknown[]>
    expect(hooks.Stop).toHaveLength(1)
    expect(hooks.SessionEnd).toHaveLength(1)
  })

  it('保留用户已有的其他 hooks', () => {
    const settings = {
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }],
      },
    }
    const merged = mergeHooks(settings, COMMAND)
    const hooks = merged.hooks as Record<string, unknown[]>
    expect(merged.model).toBe('opus')
    expect(hooks.Stop).toHaveLength(2)
    expect(hooks.PreToolUse).toHaveLength(1)
    expect(JSON.stringify(hooks.Stop![0])).toContain('my-own-hook.sh')
  })

  it('幂等：重复安装不产生重复条目', () => {
    const once = mergeHooks({}, COMMAND)
    const twice = mergeHooks(once, COMMAND)
    const hooks = twice.hooks as Record<string, unknown[]>
    expect(hooks.Stop).toHaveLength(1)
  })

  it('不修改传入对象（不可变）', () => {
    const settings: Record<string, unknown> = { hooks: { Stop: [] } }
    mergeHooks(settings, COMMAND)
    expect((settings.hooks as Record<string, unknown[]>).Stop).toHaveLength(0)
  })
})

describe('removeHooks — 精确移除', () => {
  it('只移除带归属标记的条目，保留用户条目', () => {
    const merged = mergeHooks(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] } },
      COMMAND
    )
    const removed = removeHooks(merged)
    const hooks = removed.hooks as Record<string, unknown[]>
    expect(hooks.Stop).toHaveLength(1)
    expect(JSON.stringify(hooks.Stop![0])).toContain('my-own-hook.sh')
    expect(hooks.SessionEnd).toBeUndefined()
  })

  it('merge 后 remove 恢复原状（空 settings 往返）', () => {
    const removed = removeHooks(mergeHooks({}, COMMAND))
    expect((removed.hooks as Record<string, unknown>) ?? {}).toEqual({})
  })
})
