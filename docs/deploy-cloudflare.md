# Cloudflare 部署手册

架构：Next.js 16 → OpenNext Cloudflare 适配器 → Cloudflare Workers（`nodejs_compat`）。
数据库：任意 Postgres（推荐 Neon 免费档），Workers 直连（`postgres` 驱动，`prepare:false` 兼容连接池）。

## 一次性准备

1. **登录 Cloudflare**（交互式，需人工执行）：

   ```bash
   cd apps/web && pnpm exec wrangler login
   ```

2. **创建 Postgres**（Neon: https://neon.tech，创建项目后复制连接串），本地对生产库执行迁移与 seed：

   ```bash
   cd apps/web
   DATABASE_URL='postgres://...' pnpm db:migrate
   DATABASE_URL='postgres://...' pnpm db:seed
   ```

3. **首次部署**（先拿到 workers.dev 域名）：

   ```bash
   pnpm deploy   # 在 apps/web 下，= opennextjs-cloudflare build && deploy
   ```

   记下输出的 `https://codingrace.<account>.workers.dev`（或绑定自定义域名）。

4. **创建 GitHub OAuth App**（https://github.com/settings/developers → New OAuth App）：
   - Homepage: `https://<domain>`
   - Authorization callback URL: `https://<domain>/api/auth/callback`

5. **配置机密**（在 `apps/web` 下逐个执行，值不落盘）：

   ```bash
   pnpm exec wrangler secret put DATABASE_URL
   pnpm exec wrangler secret put AUTH_SECRET        # openssl rand -hex 32
   pnpm exec wrangler secret put IP_HASH_SALT       # openssl rand -hex 32
   pnpm exec wrangler secret put GITHUB_CLIENT_ID
   pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
   pnpm exec wrangler secret put APP_URL            # https://<domain>，无尾斜杠
   ```

## 日常发布

```bash
cd apps/web && pnpm deploy
```

新增数据库迁移时先 `DATABASE_URL=... pnpm db:migrate` 再部署。

## 上线验收清单

- [ ] `/login` → GitHub OAuth 全流程 → 落到 `/settings`
- [ ] 设置页生成 auth-code，复制 npx 命令在本机安装（`--endpoint https://<domain>`）
- [ ] 跑一次真实 Claude Code 会话，结束后 `npx codingrace status` 队列清零
- [ ] 设置页「我的本周用量」出现数据；开启「公开上榜」后首页可见
- [ ] 重发验证：`node ~/.codingrace/bin/codingrace.mjs worker` 手动跑两次，榜单数值不变

## 已知限制（后续迭代）

- 限流为 Worker isolate 内存级：多 isolate 下限流是"每实例"的。升级路径：Cloudflare Rate Limiting binding 或 Upstash（接口已抽象在 `src/ingest/ratelimit.ts`）。
- 90 天原始事件清理 / ip_hash 置空的定时任务未接：数据量到达前接 Cloudflare Cron Triggers。
- 插件 `DEFAULT_ENDPOINT`（packages/plugin/src/version.ts）需在确定正式域名后更新并发布 npm 包；发布前用 `--endpoint` 参数显式指定。
- 插件 npm 发布：`packages/plugin` 拆独立公开仓库 + `npm publish`（当前 package.json 标记 private，发布时移除）。
