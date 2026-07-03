import { randomBytes } from 'node:crypto'
import { appOrigin, authorizeUrl, isGithubOAuthConfigured } from '@/auth/github'

export function GET(request: Request): Response {
  const origin = appOrigin(request.url)

  // 凭据未配置：回到登录页给出可读提示，不给用户看 500
  if (!isGithubOAuthConfigured()) {
    return new Response(null, {
      status: 302,
      headers: { location: `${origin}/login?error=unavailable` },
    })
  }

  const state = randomBytes(16).toString('hex')
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(origin, state),
      'set-cookie': `cr_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  })
}
