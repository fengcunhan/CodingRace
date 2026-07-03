import { randomBytes } from 'node:crypto'
import { appOrigin, authorizeUrl } from '@/auth/github'

export function GET(request: Request): Response {
  const state = randomBytes(16).toString('hex')
  const origin = appOrigin(request.url)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(origin, state),
      'set-cookie': `cr_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  })
}
