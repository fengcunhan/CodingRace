# codingrace-plugin

The Claude Code plugin for [CodingRace](https://github.com/fengcunhan/CodingRace) — the open-source "who's burning the most tokens?" leaderboard.

[![Live leaderboard](https://img.shields.io/badge/leaderboard-codingrace.fengcunhan.workers.dev-blue)](https://codingrace.fengcunhan.workers.dev)

## What is this

This plugin reports your Claude Code token usage to [CodingRace](https://codingrace.fengcunhan.workers.dev) automatically, after each session ends. That's it — no dashboards to check, no manual exporting. Install once, then keep coding.

## Install in one command

1. Sign in with GitHub at https://codingrace.fengcunhan.workers.dev to get your auth-code.
2. Run:
   ```bash
   npx github:fengcunhan/codingrace-plugin install --code <your-code>
   ```
3. Use Claude Code as usual. Reporting happens automatically when a session ends.

## Privacy promise

This is the most important part of this README, so it goes right up top.

| We report | We never touch |
|---|---|
| Token counts (input / output / cache-read / cache-write) | Conversation content |
| Model name | Your code |
| Timestamp | File paths |
| Session hash identifier | Directory names |

- Unknown protocol fields are **dropped**, never forwarded.
- The plugin is **zero-dependency, single-file** — you can audit the whole thing yourself in a few hundred lines.
- The auth-code service stores only a **hash** server-side; raw IP addresses are never persisted.
- Your leaderboard nickname is **anonymous by default** — appearing publicly requires manually opting in.

## Commands

- `npx github:fengcunhan/codingrace-plugin install --code <your-code>` — link the plugin to your CodingRace account using the auth-code from the website, and enable automatic reporting.
- `npx github:fengcunhan/codingrace-plugin status` — check whether reporting is active and see the status of recent uploads.
- `npx github:fengcunhan/codingrace-plugin uninstall` — remove the plugin and stop all reporting.

## How it works

1. A `Stop`/`SessionEnd` hook fires when your Claude Code session ends and parses only the new transcript delta since the last checkpoint.
2. The usage delta is queued locally and handed off to a background process, so the hook itself returns in under 100ms and never blocks your work.
3. The background process reports to the CodingRace server, which verifies and deduplicates the data before it hits the public leaderboard.

## Learn more

This plugin is one piece of the full open-source stack. For the web app, shared protocol, and design docs, see the main repo: **https://github.com/fengcunhan/CodingRace**

---

## 中文说明

这是 [CodingRace](https://github.com/fengcunhan/CodingRace)（"谁烧掉了最多的 Token？" 开源排行榜）的 Claude Code 插件。

### 这是什么

插件会在每次 Claude Code 会话结束后，自动把你的 token 消耗上报给 CodingRace 排行榜。装一次，之后正常写代码即可，无需手动导出或维护。

### 一条命令安装

1. 打开 https://codingrace.fengcunhan.workers.dev，用 GitHub 登录领取 auth-code。
2. 终端运行：
   ```bash
   npx github:fengcunhan/codingrace-plugin install --code <你的code>
   ```
3. 正常使用 Claude Code，会话结束会自动上报。

### 隐私承诺

| 上报什么 | 绝不碰什么 |
|---|---|
| Token 计数（输入 / 输出 / 缓存读 / 缓存写） | 对话内容 |
| 模型名 | 你的代码 |
| 时间戳 | 文件路径 |
| 会话哈希标识 | 目录名 |

- 协议层未知字段直接**丢弃**，不会转发。
- 插件为**零依赖单文件**，可在几百行内自行审计。
- auth-code 服务端**只存哈希**，原始 IP 不落库。
- 昵称**默认匿名**，公开上榜需手动开启。

### 三个命令

- `install --code <你的code>` — 用网站领取的 auth-code 关联账号，开启自动上报。
- `status` — 查看上报是否生效，以及最近上传状态。
- `uninstall` — 卸载插件，停止一切上报。

### 工作原理（三句话）

1. 会话结束触发 `Stop`/`SessionEnd` hook，只解析上次断点之后新增的 transcript。
2. 数据先进本地队列，交给后台进程上报，hook 本身 100ms 内返回，不阻塞 Claude Code。
3. 后台进程上报到服务端，服务端校验、去重后才计入公开榜单。

### 了解更多

完整开源全栈（网页应用、共享协议、设计文档）在主仓库：**https://github.com/fengcunhan/CodingRace**
