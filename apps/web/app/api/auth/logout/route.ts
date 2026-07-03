import { appOrigin } from '@/auth/github'
import { clearSessionCookie } from '@/auth/session'

export function POST(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: `${appOrigin(request.url)}/`,
      'set-cookie': clearSessionCookie(),
    },
  })
}
