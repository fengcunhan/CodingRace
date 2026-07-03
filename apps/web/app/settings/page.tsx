import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/auth/user'
import { getDb } from '@/db/client'
import { authCodes, usageDailyRollups } from '@/db/schema'
import { weeklySince } from '@/leaderboard/query'
import { revokeAuthCode, updateProfile } from './actions'
import { CreateCodeForm } from './create-code-form'

export const dynamic = 'force-dynamic'

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const db = getDb()
  const endpoint = process.env.APP_URL ?? 'http://localhost:3000'

  const [codes, usage] = await Promise.all([
    db
      .select({
        id: authCodes.id,
        codePrefix: authCodes.codePrefix,
        label: authCodes.label,
        lastUsedAt: authCodes.lastUsedAt,
        revokedAt: authCodes.revokedAt,
        createdAt: authCodes.createdAt,
      })
      .from(authCodes)
      .where(eq(authCodes.userId, user.id))
      .orderBy(desc(authCodes.createdAt)),
    db
      .select({
        day: usageDailyRollups.day,
        modelId: usageDailyRollups.modelId,
        cost: sql<string>`sum(${usageDailyRollups.estCostUsd})`,
        tokens: sql<string>`sum(${usageDailyRollups.totalTokens})`,
      })
      .from(usageDailyRollups)
      .where(
        and(
          eq(usageDailyRollups.userId, user.id),
          gte(usageDailyRollups.day, weeklySince(new Date()))
        )
      )
      .groupBy(usageDailyRollups.day, usageDailyRollups.modelId)
      .orderBy(desc(usageDailyRollups.day)),
  ])

  return (
    <main>
      <h1 style={{ fontSize: 24 }}>设置</h1>

      <section className="card">
        <h2>个人资料</h2>
        <form action={updateProfile}>
          <label htmlFor="displayName">昵称（榜单展示名）</label>
          <input
            type="text"
            id="displayName"
            name="displayName"
            defaultValue={user.displayName}
            maxLength={32}
            required
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <input type="checkbox" name="isPublic" defaultChecked={user.isPublic} />
            公开上榜（默认关闭；开启后昵称与用量出现在公开排行榜）
          </label>
          <button type="submit">保存</button>
        </form>
      </section>

      <section className="card">
        <h2>Auth Codes</h2>
        <p className="hint">每台设备一个 code，泄露或换机时吊销旧的即可，历史数据不受影响。</p>
        {codes.length > 0 && (
          <table className="board" style={{ margin: '12px 0' }}>
            <thead>
              <tr>
                <th>Code</th>
                <th>备注</th>
                <th>最近上报</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.id}>
                  <td>
                    <code>{code.codePrefix}…</code>
                  </td>
                  <td>{code.label ?? '—'}</td>
                  <td className="tokens">{formatDate(code.lastUsedAt)}</td>
                  <td>{code.revokedAt ? '已吊销' : '有效'}</td>
                  <td>
                    {!code.revokedAt && (
                      <form action={revokeAuthCode} style={{ margin: 0 }}>
                        <input type="hidden" name="codeId" value={code.id} />
                        <button className="ghost" type="submit">
                          吊销
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <CreateCodeForm endpoint={endpoint} />
      </section>

      <section className="card">
        <h2>安装指引</h2>
        <ol className="hint" style={{ paddingLeft: 18, lineHeight: 2 }}>
          <li>上面生成一个 auth-code（明文只显示一次）</li>
          <li>在终端运行生成的 npx 命令（需要 Node ≥ 18 与 Claude Code）</li>
          <li>正常使用 Claude Code，会话结束后自动上报 token 计数</li>
          <li>
            用 <code>npx codingrace status</code> 查看队列，用{' '}
            <code>npx codingrace uninstall</code> 干净移除
          </li>
        </ol>
        <p className="hint">
          隐私：插件开源，只上报 token 计数、模型名与时间戳，绝不读取对话内容、代码或文件路径。
        </p>
      </section>

      <section className="card">
        <h2>我的本周用量</h2>
        {usage.length === 0 ? (
          <p className="hint">还没有数据。安装插件并完成一次 Claude Code 会话后，这里会出现记录。</p>
        ) : (
          <table className="board">
            <thead>
              <tr>
                <th>日期（UTC）</th>
                <th>模型</th>
                <th>估算成本</th>
                <th>Token</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((row) => (
                <tr key={`${row.day}-${row.modelId}`}>
                  <td>{row.day}</td>
                  <td>{row.modelId}</td>
                  <td className="cost">${Number(row.cost).toFixed(2)}</td>
                  <td className="tokens">{Number(row.tokens).toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
