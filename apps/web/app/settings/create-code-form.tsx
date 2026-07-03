'use client'

import { useActionState } from 'react'
import { createAuthCode, type CreateCodeState } from './actions'

export function CreateCodeForm({ endpoint }: { endpoint: string }) {
  const [state, action, pending] = useActionState<CreateCodeState, FormData>(createAuthCode, {})

  return (
    <form action={action}>
      <label htmlFor="label">设备备注（可选）</label>
      <input type="text" id="label" name="label" maxLength={64} placeholder="例如：公司 MacBook" />
      <div>
        <button type="submit" disabled={pending}>
          {pending ? '生成中…' : '生成新的 auth-code'}
        </button>
      </div>
      {state.error && <p style={{ color: '#f85149', fontSize: 13 }}>{state.error}</p>}
      {state.code && (
        <div className="code-reveal">
          <p style={{ margin: '0 0 8px', fontSize: 13 }}>
            ⚠️ 明文只显示这一次。复制下面的命令在终端运行即可完成安装：
          </p>
          <pre className="snippet">
            npx github:fengcunhan/codingrace-plugin install --code {state.code} --endpoint{' '}
            {endpoint}
          </pre>
        </div>
      )}
    </form>
  )
}
