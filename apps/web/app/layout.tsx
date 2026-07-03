import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getSessionUser } from '@/auth/user'
import './globals.css'

export const metadata: Metadata = {
  title: 'CodingRace — AI 编程 Token 消耗排行榜',
  description: '看看谁是最能烧 token 的 AI 编程选手',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser().catch(() => null)

  return (
    <html lang="zh-CN">
      <body>
        <div className="container">
          <header className="site-header">
            <Link href="/" className="logo">
              Coding<span>Race</span>
            </Link>
            <nav className="nav">
              <Link href="/">排行榜</Link>
              {user ? (
                <>
                  <Link href="/settings">{user.displayName}</Link>
                  <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
                    <button className="ghost" type="submit">
                      退出
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/login">登录</Link>
              )}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
