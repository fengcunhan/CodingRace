# CodingRace 第一期实现规划

> 状态：草案 v0.1（2026-07-03）
> 前置文档：[event-schema-and-database.md](./event-schema-and-database.md)（事件协议与表结构，本文引用其编号如 §2.5）
> 目标读者：第一期的实现者（含 AI 结对），按里程碑逐个交付。

---

## 1. 第一期目标与成功标准

**目标**：跑通最小闭环——注册 → 领 auth-code → 一条命令装插件 → 正常使用 Claude Code → 数据出现在公开榜单。

量化验收标准：

| # | 标准 | 度量方式 |
|---|---|---|
| S1 | 新用户从注册到装完插件 ≤ 3 分钟 | 真人实测（找 2–3 个朋友内测） |
| S2 | 用量数据端到端延迟 ≤ 5 分钟可见于榜单 | E2E 测试 + 生产抽查 |
| S3 | hook 对 Claude Code 无感知：入口进程 < 100ms 退出 | 插件单测计时断言 |
| S4 | 幂等：同一批事件重发 10 次，榜单数值不变 | 集成测试 |
| S5 | 插件仓库公开、代码量小到可被一眼审计（核心逻辑 < 1000 行） | 发布前 review |

## 2. 范围

**做（In）：**

- Claude Code 单一 Agent，`usage` 消息级事件（Stop/SessionEnd hook + transcript 增量解析）
- GitHub OAuth 注册登录（目标用户全是开发者，不做邮箱密码）
- auth-code 生成 / 吊销 / 多设备
- Ingest API：认证、zod 校验、时间规则（§2.5）、幂等、限流、单事件 token 上限
- model 归一化 + 成本折算（同步、内存缓存别名与定价表）
- 日聚合 rollups
- 榜单页：总榜 + model 榜；时间窗：周榜 + 总榜；主指标估算成本、次指标总 token
- 设置页：昵称、`is_public` 开关、auth-code 管理、安装指引、"我的本周用量"（用于用户自验闭环）

**不做（Out，已排入后续）：**

- Codex / Gemini 适配器、`usage_summary` 事件路径（schema 保留，服务端直接返回 `rejected: unsupported_in_phase1`）
- README 徽章、地域榜、日/月榜、个人公开主页、团队榜、公开查询 API
- OTel 直连采集
- 高级反作弊（行为特征、shadow flag 运营流程）——第一期只保留：限流、单事件上限、token/秒物理上限标记
- 榜单快照结算（`leaderboard_snapshots` 建表但不写入）

## 3. 技术选型（推荐方案）

| 层 | 选型 | 理由 / 备选 |
|---|---|---|
| 站点 + API | Next.js（App Router）单体，TypeScript | 页面与 ingest 同仓同部署，第一期量级完全够；备选：ingest 拆 Hono 独立服务（第二期再说） |
| ORM / 迁移 | Drizzle | 迁移即 SQL、贴近设计文档 DDL；备选 Prisma |
| 校验 | zod | 事件 schema 单一来源，插件与服务端共享同一包 |
| 数据库 | Postgres（托管：Neon 或 Supabase） | 本地开发 docker compose |
| 限流 | Upstash Redis（免费档） | serverless 下内存限流不可靠；榜单**不**依赖 Redis |
| 登录 | better-auth（GitHub OAuth） | 备选 Auth.js |
| 部署 | Vercel + Neon + Upstash | 全部免费/低价档起步；备选 Railway 单平台全包 |
| 定时任务 | Vercel Cron | 仅两个：90 天事件清理、每日分区外健康巡检 |
| 插件运行时 | Node ≥ 18 单文件脚本（esbuild 打包，零 npm 依赖） | 用户已装 Claude Code 必有 Node；零依赖降低供应链疑虑、便于审计 |
| 插件分发 | npm 包 `codingrace`（`npx codingrace install`）+ Claude Code plugin marketplace 双通道 | marketplace 是长期正道，npx 是保底 |

## 4. 相对设计文档的第一期简化（重要，防止实现时纠结）

| 设计文档 | 第一期简化 | 回收时机 |
|---|---|---|
| `usage_events` 按天分区（§3.5） | **普通表**，唯一索引 `(user_id, agent, session_id, message_id)` 不再需要带 `occurred_at`；90 天清理用 Cron `DELETE` | 事件量 > ~500 万行或删除变慢时迁分区（第二期评估） |
| 清洗异步 Worker（§4） | **ingest 同步完成**：model 归一化（别名表内存缓存，未命中记 `model_id=NULL` 入待映射）、token/秒校验、成本折算、rollup UPSERT，全在一个事务内 | ingest P95 > 200ms 或写入 QPS 明显上升时拆异步 |
| 聚合 Job 每 5 分钟 | 不需要独立 Job（聚合已同步） | 随异步化一并回收 |
| Redis ZSET 实时榜 | 榜单直接 `SUM ... GROUP BY` 查 rollups，HTTP 层缓存 60s | 榜单查询变慢时引入 |
| `leaderboard_snapshots` 写入 | 建表不写入 | 第二期做"上周冠军"时启用 |
| `ingest_batches` | 照常写入（成本极低，排查滥用必需） | — |

这些简化都不改**协议与表结构**，只改服务端内部执行方式——插件和数据不受影响，后续演进无迁移成本。

## 5. 仓库与代码结构

pnpm monorepo（插件先在 monorepo 孵化，M4 发布时拆到独立公开仓库 `codingrace-plugin`，主站仓库可保持私有）：

```
CodingRace/
├── apps/web/                 # Next.js：页面 + API
│   ├── app/(site)/           # 榜单页、设置页
│   ├── app/api/v1/ingest/    # 上报入口
│   ├── app/api/v1/leaderboard/
│   ├── src/ingest/           # 认证、校验、归一化、成本折算、rollup upsert
│   ├── src/db/               # drizzle schema + migrations + seed
│   └── src/leaderboard/      # 榜单查询
├── packages/schema/          # 事件协议：zod schema + TS 类型（插件/服务端共用，随插件开源）
├── packages/plugin/          # 插件（发布名 codingrace）
│   ├── src/hook.ts           # hook 入口：读 stdin → 落 spool → detach 后台进程 → 立即退出
│   ├── src/parser.ts         # transcript 增量解析 + 游标
│   ├── src/queue.ts          # 本地文件队列
│   ├── src/sender.ts         # 批量上报 + 退避重试
│   ├── src/cli.ts            # install / status / uninstall
│   └── test/fixtures/        # 多版本 transcript 样本
└── docs/design/
```

## 6. 里程碑与任务拆解

> 按用户全局规范执行 TDD：每个任务先写测试（表格中"测试"列即最低要求），核心模块覆盖率 ≥ 80%。

### M0 — 脚手架（约 0.5 周）

| 任务 | 交付物 |
|---|---|
| monorepo 初始化（pnpm + turbo 可选）、TS/ESLint/Prettier/vitest 统一配置 | 可跑 `pnpm test` 的空工程 |
| Next.js 应用 + docker compose（Postgres）+ Drizzle 接线 | 本地 `pnpm dev` 起服务连库 |
| CI（GitHub Actions）：lint + typecheck + test | PR 门禁 |

### M1 — 数据通道（约 1 周）｜依赖 M0

| 任务 | 要点 | 测试 |
|---|---|---|
| `packages/schema`：envelope/event 的 zod 定义 | 与设计文档 §2 逐字段对齐；禁止字段用 `.strict()` 剥离 | 合法/非法样本表驱动测试 |
| Drizzle migrations：全部 8 张表（§3，含简化后的 `usage_events` 普通表） | 一次建全，快照表先空置 | 迁移可重放 |
| seed：`models` / `model_aliases` / `model_prices` 初始数据（Claude 系列现役模型 + 常见 Bedrock/Vertex 别名） | 定价核对官方价目页 | 成本折算样例断言 |
| Ingest API：Bearer 认证（code hash 查表 + 短 TTL 内存缓存）、时间规则（§2.5）、幂等 `ON CONFLICT DO NOTHING`、逐条 results 回包 | 事务内同步：归一化 → token/秒校验（阈值走配置表）→ rollup UPSERT | **重点测试**：幂等重发（S4）、`occurred_at` 未来/迟到、超限值拒收、部分成功回包 |
| 限流：Upstash 滑动窗口 60 req/min/code | 429 + `Retry-After` | 集成测试 |
| `ingest_batches` 落库 | — | — |

### M2 — Claude Code 插件（约 1 周）｜仅依赖 `packages/schema`，可与 M1 并行

| 任务 | 要点 | 测试 |
|---|---|---|
| parser：transcript JSONL 增量解析 | 游标文件 `~/.codingrace/cursors/`；提取 `requestId`（fallback `uuid`）、`message.model`、`usage.*`、`timestamp`；对未知行/坏行容错跳过 | fixture 覆盖：正常会话、subagent、compact 后、坏行、超长文件；游标断点续读 |
| queue + sender：文件队列、批量 ≤100 条、退避重试、按 results 清理 | 队列目录加简单文件锁防并发 hook 竞争 | 断网重发、`duplicate`/`rejected` 清理行为 |
| hook 入口：Stop + SessionEnd | 读 stdin 拿 `transcript_path` → 写触发记录 → `spawn(detached, unref)` 后台进程 → 退出；后台进程扫描**所有**游标（顺带补报上次崩溃/Ctrl-C 遗留的会话） | 入口 < 100ms 计时断言（S3） |
| CLI：`npx codingrace install`（写 `~/.claude/settings.json` hooks + 保存 code 到 `~/.codingrace/config.json`）、`status`（队列/游标/最近上报）、`uninstall`（干净移除） | 对 settings.json 做**保留式合并**，绝不覆盖用户已有 hooks | install→uninstall 幂等往返测试 |
| esbuild 打包单文件、零运行时依赖 | — | 打包产物冒烟测试 |

### M3 — 站点（约 1 周）｜依赖 M1 的表与查询层

| 任务 | 要点 | 测试 |
|---|---|---|
| better-auth + GitHub OAuth | 首登生成随机昵称、`is_public=false` | 登录回调集成测试 |
| auth-code 管理（设置页 + API） | 生成时明文只显示一次；吊销即时生效（认证缓存失效） | 吊销后 ingest 403 |
| 榜单查询层 + `GET /v1/leaderboard` | `board=overall\|model:<id>`、`period=weekly\|all_time`、`metric=cost\|tokens`；只含 `is_public AND trust_level<>'suspect'`；HTTP 缓存 60s | 查询正确性（含边界：跨周、无数据用户） |
| 榜单页（首页） | 周/总切换、model 筛选、名次+昵称+成本+token；空态引导注册 | E2E（Playwright） |
| 设置页 | 昵称、公开开关、code 管理、安装指引（复制即用的一条命令）、"我的本周用量"小卡片 | E2E |

### M4 — 联调、上线与开源（约 0.5–1 周）｜依赖 M1+M2+M3

| 任务 | 要点 |
|---|---|
| 端到端联调 | 真实 Claude Code 会话 → 5 分钟内榜单可见（S2）；两台设备双 code 验证 |
| E2E 关卡场景（Playwright + 脚本化插件） | 注册→领码→模拟上报→榜单出现；重发幂等；吊销后拒收 |
| 部署 | Vercel + Neon + Upstash；域名 + HTTPS；环境变量清单文档化 |
| 监控告警 | ingest 错误率/延迟（Vercel 日志 + 简单告警）、待映射 model 数量、拒收原因分布 |
| Cron | 90 天事件清理、`ip_hash` 30 天置空 |
| 安全自查 | 按全局安全清单过一遍：无硬编码密钥、code 只存哈希、错误信息不泄内部细节、全端点限流 |
| 插件开源发布 | 拆 `codingrace-plugin` 独立仓库：README（隐私承诺 + 禁止字段清单置顶）、LICENSE（MIT）、npm 发布、marketplace 提交 |
| 内测 | 自用 3–5 天 + 2–3 名外部用户，盯 S1–S5 |

**排期汇总（单人全职）**：M0 0.5 周 → M1 与 M2 并行 1.5 周 → M3 1 周 → M4 1 周，**合计约 4–4.5 周**。M1/M2 的并行以 `packages/schema` 先行定稿为前提（M1 第一个任务）。

## 7. 接口清单（第一期冻结面）

对外冻结（改动需过协议版本）：
- `POST /v1/ingest` — 见设计文档 §2
- `GET /v1/leaderboard?board&period&metric` — 公开只读

站内（可随迭代调整）：
- better-auth 路由（`/api/auth/*`）
- `POST /api/me/auth-codes`、`DELETE /api/me/auth-codes/:id`、`GET /api/me/usage?days=7`、`PATCH /api/me`（昵称/公开开关）

插件 CLI：`codingrace install [--code <code>] [--endpoint <url>]` / `status` / `uninstall`

## 8. 第一期风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| transcript JSONL 非官方稳定格式，Claude Code 升级可能变动 | 采集中断 | parser 防御式解析（未知行跳过不崩）；fixture 覆盖多版本；上报 `agent_version`，服务端监控"某版本解析产出骤降"即告警 |
| Stop hook 未触发（崩溃、Ctrl-C、终端直接关闭） | 漏报 | 后台进程每次运行都扫描全部游标补报历史会话；SessionEnd 双保险 |
| 用户 settings.json 已有 hooks，install 写坏配置 | 极伤口碑 | 保留式 JSON 合并 + 写前备份 `settings.json.bak` + uninstall 精确移除自己那一条 |
| Vercel serverless 与同步事务的延迟叠加 | ingest 变慢 | 第一期 QPS 极低无虞；埋 P95 指标，超 200ms 触发 §4 的异步化预案 |
| 定价表数据不准 | 榜单公信力 | seed 时对照官方价目页人工核对；`model_prices` 带生效日期，纠错后重算 rollups 脚本纳入 M4 |
| npm 供应链疑虑（要用户装东西还给 token 数据） | 转化率低 | 零依赖单文件 + 独立开源仓库 + README 隐私承诺置顶 + 可 `--dry-run` 查看将上报内容 |

## 9. 第一期完成定义（DoD）

- [ ] S1–S5 全部达标
- [ ] 核心模块（schema / parser / ingest / 成本折算 / rollup）测试覆盖 ≥ 80%
- [ ] E2E 三场景（闭环、幂等、吊销）在 CI 常绿
- [ ] 插件独立仓库公开、npm 可安装
- [ ] 生产环境跑通 ≥ 3 名真实用户 ≥ 3 天，榜单数据与用户本地 ccusage 对账误差可解释
- [ ] 安全自查清单通过；文档：README、安装指引、隐私说明

## 10. 遗留给第二期的钩子

README 徽章（SVG）、Codex 适配器、日/月榜与快照结算、异步清洗、事件表分区、shadow flag 运营、个人公开主页。
