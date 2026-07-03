// GitHub OAuth 的纯逻辑部分（无框架依赖，便于测试与在 Workers 运行）

export interface GithubProfile {
  githubId: string
  login: string
  email: string
  avatarUrl: string | null
}

export function getGithubClientId(): string {
  const id = process.env.GITHUB_CLIENT_ID
  if (!id) throw new Error('GITHUB_CLIENT_ID is not configured')
  return id
}

function getGithubClientSecret(): string {
  const secret = process.env.GITHUB_CLIENT_SECRET
  if (!secret) throw new Error('GITHUB_CLIENT_SECRET is not configured')
  return secret
}

export function appOrigin(requestUrl: string): string {
  return process.env.APP_URL?.replace(/\/+$/, '') ?? new URL(requestUrl).origin
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getGithubClientId(),
    redirect_uri: `${origin}/api/auth/callback`,
    scope: 'read:user user:email',
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

async function exchangeCode(origin: string, code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: getGithubClientId(),
      client_secret: getGithubClientSecret(),
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    }),
  })
  if (!response.ok) throw new Error(`github token exchange failed: ${response.status}`)
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('github token exchange returned no token')
  return data.access_token
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'codingrace',
    },
  })
  if (!response.ok) throw new Error(`github api ${path} failed: ${response.status}`)
  return (await response.json()) as T
}

export async function fetchGithubProfile(origin: string, code: string): Promise<GithubProfile> {
  const accessToken = await exchangeCode(origin, code)

  const user = await githubApi<{
    id: number
    login: string
    email: string | null
    avatar_url: string | null
  }>('/user', accessToken)

  const email = user.email ?? (await primaryEmail(accessToken, user))

  return {
    githubId: String(user.id),
    login: user.login,
    email: email.toLowerCase(),
    avatarUrl: user.avatar_url,
  }
}

async function primaryEmail(
  accessToken: string,
  user: { id: number; login: string }
): Promise<string> {
  try {
    const emails = await githubApi<Array<{ email: string; primary: boolean; verified: boolean }>>(
      '/user/emails',
      accessToken
    )
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
    if (primary) return primary.email
  } catch {
    // 邮箱不可见时回退 noreply 地址
  }
  return `${user.id}+${user.login}@users.noreply.github.com`
}
