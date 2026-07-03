# CodingRace

**Who's burning the most tokens?**

An open-source leaderboard for AI coding token spend. Install the plugin, code with Claude Code as usual, and watch your token burn climb the public ranks.

[![Live site](https://img.shields.io/badge/live-codingrace.fengcunhan.workers.dev-blue)](https://codingrace.fengcunhan.workers.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)

---

## What is this

CodingRace is a public leaderboard that answers one silly-but-real question: **who's burning the most tokens?**

Install the open-source plugin, and your Claude Code token usage is reported automatically after every session. It shows up on a public leaderboard — weekly or all-time, ranked by estimated cost (USD) or raw token count, filterable by model.

Think of it as **Strava for AI coding spend**. Self-deprecating, geeky, and a little bit of a "wall of shame/fame" for burning money on tokens. No serious productivity claims here — just bragging rights (or public humiliation).

The board just launched, and it's empty. Someone has to be first.

## Quick Start

1. **Sign in with GitHub** on the site to claim your auth-code: https://codingrace.fengcunhan.workers.dev
2. **Install the plugin** in your terminal:
   ```bash
   npx github:fengcunhan/codingrace-plugin install --code <your-code>
   ```
3. **Use Claude Code as usual.** When a session ends, your token usage is reported automatically.

## Privacy first

The whole premise of this project only works if it's trustworthy. Here's exactly what that means:

- **Only reports:** token counts, model name, timestamp, and a session hash identifier. Nothing else.
- **Never reads or uploads:** conversation content, code, file paths, or directory names.
- **Unknown protocol fields are dropped**, not forwarded — the plugin doesn't blindly pass through data it doesn't recognize.
- **Zero dependencies, single file.** The plugin is small enough to audit yourself in a few hundred lines.
- **Auth-codes are hashed server-side.** Raw IP addresses are never persisted.
- **Anonymous by default.** Appearing on the public leaderboard with a nickname requires manually opting in.

## How it works

A hook fires when a Claude Code session ends (`Stop`/`SessionEnd`). It reads the transcript incrementally from a saved cursor position, queues the usage delta locally, and hands off to a background process for reporting — so the hook itself returns in under 100ms and never blocks your workflow. The server verifies and deduplicates reports idempotently, runs basic anti-cheat checks (physical token/sec limits, downgrading of late-arriving data), and folds the result into the public leaderboard, priced against an official token rate table (input, output, cache-read, and cache-write tokens are priced separately).

```
Claude Code session
        │  Stop / SessionEnd hook (<100ms, non-blocking)
        ▼
transcript delta parser (cursor checkpoint)
        │
        ▼
   local file queue ──▶ background reporter process
                                   │
                                   ▼
                      CodingRace API (Cloudflare Workers)
                                   │  idempotent dedupe + anti-cheat checks
                                   ▼
                         Postgres (via Drizzle ORM)
                                   │
                                   ▼
                  Public leaderboard (weekly / all-time × cost / tokens × model)
```

Ranking is primarily by **estimated cost (USD)**, with a token-count leaderboard as a secondary view — cache-read tokens are priced at roughly 1/10th of regular input tokens, so ranking by raw token count alone wouldn't be a fair comparison.

## Monorepo structure

```
apps/web/          Next.js 16 app — leaderboard UI, auth, API routes
                    (Drizzle + Postgres, deployed via OpenNext on Cloudflare Workers)
packages/schema/    Shared zod-defined reporting protocol, used by both plugin and server
packages/plugin/    Zero-dependency Node plugin source (bundled with esbuild)
docs/design/        Design docs — protocol, anti-cheat, cost model, and other decisions
```

The plugin is also published as a standalone install target at [fengcunhan/codingrace-plugin](https://github.com/fengcunhan/codingrace-plugin), which is what the `npx github:...` install command pulls from.

## Self-hosting

Want to run your own instance? See [`docs/deploy-cloudflare.md`](./docs/deploy-cloudflare.md) for the Cloudflare Workers deployment guide.

## Roadmap

- Codex / Gemini CLI plugin support
- README badges (SVG) showing your live rank
- Regional leaderboards
- Team leaderboards

## License

MIT

---

## 中文简介

CodingRace 是一个开源的 **AI 编程 Token 消耗排行榜**——"谁烧掉了最多的 Token？" 安装开源插件后，Claude Code 的 token 消耗会在每次会话结束后自动上报，汇总成公开榜单（周榜/总榜 × 按估算成本/按 Token × 按模型筛选）。定位是自嘲式极客娱乐的"烧钱光荣榜"，就像 Strava 之于跑步——不追求严肃的生产力指标，纯粹是排名和吐槽。

**快速开始（3 步）：**
1. 打开 https://codingrace.fengcunhan.workers.dev ，用 GitHub 登录领取 auth-code。
2. 终端运行：`npx github:fengcunhan/codingrace-plugin install --code <你的code>`
3. 正常使用 Claude Code，会话结束后自动上报。

**隐私承诺：** 插件只上报 token 计数、模型名、时间戳、会话哈希标识；绝不读取或上传对话内容、代码、文件路径、目录名；未知字段直接丢弃；插件为零依赖单文件，可审计；auth-code 服务端只存哈希，原始 IP 不落库；昵称默认匿名，公开上榜需手动开启。

**技术栈：** Next.js 16 + Drizzle + Postgres，部署在 Cloudflare Workers（OpenNext）；插件是零依赖 Node 单文件（esbuild 打包）；插件与服务端共享 zod 定义的协议。

Monorepo 结构、自托管指南（`docs/deploy-cloudflare.md`）、Roadmap 详见上方英文部分。

License: MIT
