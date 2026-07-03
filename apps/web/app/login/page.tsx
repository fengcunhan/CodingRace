export default function LoginPage() {
  return (
    <main className="hero">
      <h1>登录 CodingRace</h1>
      <p>使用 GitHub 账号登录，领取 auth-code 后即可开始上报</p>
      <a className="button" href="/api/auth/github">
        使用 GitHub 登录
      </a>
      <p className="hint" style={{ marginTop: 24, color: 'var(--text-dim)', fontSize: 13 }}>
        登录仅用于身份标识。昵称默认不公开上榜，可在设置中开启。
      </p>
    </main>
  )
}
