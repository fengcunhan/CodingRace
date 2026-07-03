import { isGithubOAuthConfigured } from '@/auth/github'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const configured = isGithubOAuthConfigured()

  return (
    <main className="hero">
      <h1>登录 CodingRace</h1>
      <p>使用 GitHub 账号登录，领取 auth-code 后即可开始上报</p>

      {(params.error || !configured) && (
        <p
          style={{
            margin: '16px auto',
            maxWidth: 420,
            padding: '10px 16px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-dim)',
            fontSize: 14,
          }}
        >
          ⚙️ 登录功能正在配置中，稍后开放。你现在可以先浏览排行榜。
        </p>
      )}

      {configured ? (
        <a className="button" href="/api/auth/github">
          使用 GitHub 登录
        </a>
      ) : (
        <a className="button" href="/" style={{ opacity: 0.9 }}>
          先去看看排行榜
        </a>
      )}

      <p className="hint" style={{ marginTop: 24, color: 'var(--text-dim)', fontSize: 13 }}>
        登录仅用于身份标识。昵称默认不公开上榜，可在设置中开启。
      </p>
    </main>
  )
}
