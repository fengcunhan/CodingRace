# CodingRace 数据设计：统一上报事件 Schema 与数据库表结构

> 状态：草案 v0.1（2026-07-03）
> 范围：客户端插件 → Ingest API 的事件协议，以及后端 Postgres 表结构、数据清洗与聚合链路。
> 不含：前端页面、插件各 Agent 适配器的实现细节。

---

## 1. 设计原则

1. **客户端保持"哑"**：插件只负责读数、组包、上报。model 归一化、成本折算、合理性校验全部放在服务端，这样新模型上线、定价变化都不需要用户升级插件。
2. **幂等是协议的一部分**：hook 重复触发、本地队列重发是常态。每条事件自带去重键，服务端对重复上报静默吸收。
3. **隐私最小化**：事件里只有计数和标识符，**永远不出现**对话内容、代码、文件路径、cwd、git 仓库名、主机名、系统用户名。原始 IP 在入库前解析为地理位置后丢弃。
4. **原始层与展示层分离**：`usage_events` 是 append-only 的事实表，榜单永远从聚合表（rollups）读取，清洗规则可以随时调整后重算。
5. **口径可重算**：事件只存 token 数，估算成本在聚合阶段用带版本的定价表折算，定价修正后可全量重算。

---

## 2. 统一上报事件 Schema

### 2.1 传输层

```
POST /v1/ingest
Authorization: Bearer cr_live_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

- 单请求为一个 **batch**，最多 100 条事件，body 上限 256 KB。
- 限流：单 auth-code 60 请求/分钟（超出返回 429，客户端指数退避）。
- 认证失败：401（code 无效）/ 403（code 已吊销或用户被封禁）。

### 2.2 请求信封（Envelope）

```json
{
  "schema_version": 1,
  "batch_id": "0197f3a2-6c1e-7c9a-b1d4-8e2f5a6b7c8d",
  "client": {
    "plugin_name": "codingrace-plugin",
    "plugin_version": "0.1.0",
    "agent": "claude_code",
    "agent_version": "2.1.34",
    "os": "darwin",
    "arch": "arm64"
  },
  "events": [ { "...": "见 2.3" } ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema_version` | int | 是 | 协议版本，当前为 `1`。服务端据此做兼容分支 |
| `batch_id` | uuid | 是 | 客户端生成，用于批次级审计与排查 |
| `client.plugin_name` | string | 是 | 固定标识开源插件 |
| `client.plugin_version` | string | 是 | semver |
| `client.agent` | enum | 是 | `claude_code` \| `codex` \| `gemini_cli` \| `other` |
| `client.agent_version` | string | 否 | Agent 自身版本号 |
| `client.os` / `client.arch` | string | 否 | 仅用于插件兼容性统计 |

### 2.3 事件体（Event）

两种事件类型：

- **`usage`**（首选）：一条 assistant 消息级别的用量。粒度最细，反作弊信号最多。Claude Code 适配器从 transcript JSONL 逐条产出。
- **`usage_summary`**（降级）：一个时间窗的聚合用量。用于拿不到消息级数据的 Agent 适配器。

```json
{
  "event_id": "0197f3a2-9d0b-71c2-a3e4-5f6a7b8c9d0e",
  "event_type": "usage",
  "agent": "claude_code",
  "session_id": "6f9c2e1a-...-claude-session-uuid",
  "message_id": "req_011CRxxxxxxxx",
  "model_raw": "claude-sonnet-5",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 5678,
    "cache_creation_tokens": 20480,
    "cache_read_tokens": 183500
  },
  "occurred_at": "2026-07-03T08:12:33Z",
  "period_start": null,
  "turn_duration_ms": 45210
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `event_id` | uuid | 是 | 客户端生成（建议 UUIDv7），入队时确定，重发不变 |
| `event_type` | enum | 是 | `usage` \| `usage_summary` |
| `agent` | enum | 是 | 冗余一份（与 envelope 一致），事件自描述、便于服务端落库 |
| `session_id` | string | 是 | Agent 的会话标识（Claude Code 的 session UUID；Codex 的 rollout 文件 ID） |
| `message_id` | string | usage 必填 | 消息级去重键。Claude Code 取 transcript 中 assistant 消息的 `requestId`（缺失时取消息 `uuid`）。`usage_summary` 为 `null` |
| `model_raw` | string | 是 | Agent 原样报告的模型 ID，**客户端不做任何归一化** |
| `usage.input_tokens` | int ≥0 | 是 | 四类 token 全部必填，取不到的填 0 |
| `usage.output_tokens` | int ≥0 | 是 | |
| `usage.cache_creation_tokens` | int ≥0 | 是 | 对应 Anthropic 的 `cache_creation_input_tokens` |
| `usage.cache_read_tokens` | int ≥0 | 是 | 对应 `cache_read_input_tokens` |
| `occurred_at` | RFC3339 | 是 | 用量发生时间（取自 transcript 的消息时间戳）。`usage_summary` 时为窗口结束时间 |
| `period_start` | RFC3339 | summary 必填 | `usage_summary` 的窗口起点；`usage` 事件为 `null` |
| `turn_duration_ms` | int | 否 | 本轮耗时，仅用于服务端合理性校验（token/秒上限） |

**禁止字段清单**（协议层面明确写进插件文档和代码 review 清单）：
prompt/completion 文本、工具调用参数、文件路径、cwd、git remote/branch、hostname、本机用户名、环境变量。服务端对未知字段一律丢弃（而不是存储），防止插件 fork 版本夹带私货。

### 2.4 响应

服务端整批返回 200，逐条给出处理结果（部分成功是正常情况）：

```json
{
  "batch_id": "0197f3a2-6c1e-...",
  "results": [
    { "event_id": "...", "status": "accepted" },
    { "event_id": "...", "status": "duplicate" },
    { "event_id": "...", "status": "rejected", "reason": "occurred_at_in_future" }
  ]
}
```

客户端队列策略：`accepted` / `duplicate` / `rejected` 均从本地队列删除（`rejected` 记本地日志）；仅在 429 / 5xx / 网络错误时保留重试。

### 2.5 时间与去重规则（服务端）

| 规则 | 处理 |
|---|---|
| `occurred_at` 超前服务器时钟 > 10 分钟 | rejected（`occurred_at_in_future`） |
| `occurred_at` 落后 > 72 小时 | 接收但标记 `flag_status='late'`：计入总榜，不计入日/周榜（防批量补报刷短期榜） |
| 去重键（usage） | `(user_id, agent, session_id, message_id)` 命中即 `duplicate` |
| 去重键（usage_summary） | `(user_id, event_id)` |
| 单事件 token 上限 | 任一字段 > 50,000,000 直接 rejected（`implausible_value`） |

### 2.6 各 Agent 字段映射（适配器契约）

| 统一字段 | Claude Code（transcript JSONL） | Codex CLI（rollout JSONL） |
|---|---|---|
| `session_id` | 文件名中的 session UUID | rollout 文件 ID |
| `message_id` | assistant 消息 `requestId`（fallback：`uuid`） | token_count 事件序号 + 文件 ID 拼接 |
| `model_raw` | `message.model` | 会话配置中的 model |
| `usage.*` | `message.usage.*` | `info.total_token_usage` 的增量差值 |
| `occurred_at` | 消息 `timestamp` | 事件 `timestamp` |
| 触发时机 | Stop / SessionEnd hook + 增量游标 | notify 回调或定时扫描 |

> 适配器各自维护本地游标文件（记录已上报到 transcript 的哪一行），保证增量解析；游标丢失时最多重发已上报事件，由服务端幂等吸收。

---

## 3. 数据库表结构（Postgres）

### 3.1 总览（ER 关系）

```mermaid
erDiagram
    users ||--o{ auth_codes : "拥有"
    users ||--o{ usage_events : "产生"
    auth_codes ||--o{ usage_events : "上报通道"
    auth_codes ||--o{ ingest_batches : "批次审计"
    models ||--o{ model_aliases : "别名"
    models ||--o{ model_prices : "定价版本"
    models ||--o{ usage_events : "归一化后引用"
    users ||--o{ usage_daily_rollups : "聚合"
    usage_daily_rollups }o--|| models : ""
    users ||--o{ leaderboard_snapshots : "上榜"
```

数据流：`usage_events`（原始层） → 清洗/标记 → `usage_daily_rollups`（聚合层） → Redis ZSET（实时榜） + `leaderboard_snapshots`（历史榜）。

### 3.2 users — 用户

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,                    -- 默认生成随机昵称
  is_public     BOOLEAN NOT NULL DEFAULT false,   -- 公开上榜需显式 opt-in
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','deleted')),
  trust_level   TEXT NOT NULL DEFAULT 'normal'
                CHECK (trust_level IN ('normal','suspect','verified')),
  country_code  CHAR(2),                          -- 用户自选或首次上报时的 Geo，可改
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `trust_level='suspect'` 的用户数据照常入库聚合，但从公开榜隐藏（shadow flag）。
- 登录凭证（密码哈希/OAuth 绑定）另建表，不与本设计耦合。

### 3.3 auth_codes — 上报凭证

```sql
CREATE TABLE auth_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  code_hash    TEXT NOT NULL UNIQUE,   -- SHA-256(明文 code)，明文仅创建时展示一次
  code_prefix  TEXT NOT NULL,          -- 如 'cr_live_a1b2'，仅用于管理界面辨认
  label        TEXT,                   -- 用户自定义：'公司 MBP' / '家里台式机'
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,            -- 非空即吊销，吊销后 ingest 返回 403
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_codes_user ON auth_codes (user_id);
```

- 明文格式：`cr_live_` + 32 位随机字符（前缀便于泄露扫描工具识别）。
- 一个用户可持有多个 code（多设备），支持随时轮换。

### 3.4 models / model_aliases / model_prices — 模型维度与定价

```sql
CREATE TABLE models (
  id           TEXT PRIMARY KEY,        -- 规范名：'claude-sonnet-5'
  vendor       TEXT NOT NULL,           -- 'anthropic' | 'openai' | 'google' | ...
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_aliases (
  alias    TEXT PRIMARY KEY,            -- 'anthropic.claude-sonnet-5-v1:0'（Bedrock 等变体）
  model_id TEXT NOT NULL REFERENCES models(id)
);

CREATE TABLE model_prices (
  model_id                 TEXT NOT NULL REFERENCES models(id),
  effective_from           DATE NOT NULL,          -- 定价生效日，历史可追溯
  input_usd_per_mtok       NUMERIC(10,4) NOT NULL, -- 每百万 token 美元价
  output_usd_per_mtok      NUMERIC(10,4) NOT NULL,
  cache_write_usd_per_mtok NUMERIC(10,4) NOT NULL,
  cache_read_usd_per_mtok  NUMERIC(10,4) NOT NULL,
  PRIMARY KEY (model_id, effective_from)
);
```

- 归一化流程：`model_raw` 先查 `model_aliases`，未命中则尝试规则匹配（去 vendor 前缀/日期后缀），仍未命中的保留 `model_id = NULL` 并进入人工待映射队列（新模型上线的常态路径）。
- 估算成本 = Σ(各类 token × 当日生效价)。定价修正后重跑聚合即可全量纠正。

### 3.5 usage_events — 原始事件（事实表，按天分区）

```sql
CREATE TABLE usage_events (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY,
  event_id              UUID NOT NULL,
  user_id               UUID NOT NULL,
  auth_code_id          UUID NOT NULL,
  agent                 TEXT NOT NULL
                        CHECK (agent IN ('claude_code','codex','gemini_cli','other')),
  agent_version         TEXT,
  plugin_version        TEXT,
  event_type            TEXT NOT NULL DEFAULT 'usage'
                        CHECK (event_type IN ('usage','usage_summary')),
  session_id            TEXT NOT NULL,
  message_id            TEXT,                -- usage_summary 为 NULL
  model_raw             TEXT NOT NULL,
  model_id              TEXT,                -- 清洗阶段回填，REFERENCES models(id)
  input_tokens          BIGINT NOT NULL DEFAULT 0,
  output_tokens         BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens     BIGINT NOT NULL DEFAULT 0,
  occurred_at           TIMESTAMPTZ NOT NULL,
  period_start          TIMESTAMPTZ,         -- 仅 usage_summary
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  turn_duration_ms      INTEGER,
  geo_country           CHAR(2),             -- 入库时由请求 IP 解析，原始 IP 不落库
  geo_city              TEXT,
  ip_hash               TEXT,                -- SHA-256(IP + 当日轮换盐)，仅反滥用关联用，30 天后置空
  flag_status           TEXT NOT NULL DEFAULT 'clean'
                        CHECK (flag_status IN ('clean','late','suspect','rejected')),
  flag_reason           TEXT,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- 幂等去重：分区表的唯一索引必须包含分区键 occurred_at。
-- 同一条消息重发时 occurred_at 相同，因此不影响去重语义。
CREATE UNIQUE INDEX uq_events_message_dedup
  ON usage_events (user_id, agent, session_id, message_id, occurred_at)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX uq_events_event_id
  ON usage_events (user_id, event_id, occurred_at);

CREATE INDEX idx_events_user_time  ON usage_events (user_id, occurred_at DESC);
CREATE INDEX idx_events_needs_norm ON usage_events (received_at) WHERE model_id IS NULL;
```

要点：

- **append-only**：清洗只允许回填 `model_id` 和更新 `flag_*`，绝不改 token 数值。
- 写入用 `INSERT ... ON CONFLICT DO NOTHING`，冲突即向客户端返回 `duplicate`。
- 分区按天（`pg_partman` 或定时任务预建），保留 **90 天**后 DROP 分区；聚合层永久保留。
- `ip_hash` 使用每日轮换盐 → 只能在短窗口内做同源关联（反滥用够用），无法长期反查用户 IP，兼顾隐私。

### 3.6 usage_daily_rollups — 日聚合（榜单唯一数据源）

```sql
CREATE TABLE usage_daily_rollups (
  user_id               UUID NOT NULL,
  day                   DATE NOT NULL,        -- 按 UTC 切日
  agent                 TEXT NOT NULL,
  model_id              TEXT NOT NULL,        -- 未归一化事件暂计入 'unknown'
  input_tokens          BIGINT NOT NULL DEFAULT 0,
  output_tokens         BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens     BIGINT NOT NULL DEFAULT 0,
  total_tokens          BIGINT GENERATED ALWAYS AS
                        (input_tokens + output_tokens
                         + cache_creation_tokens + cache_read_tokens) STORED,
  est_cost_usd          NUMERIC(12,4) NOT NULL DEFAULT 0,
  events_count          INTEGER NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, agent, model_id)
);

CREATE INDEX idx_rollups_day_cost ON usage_daily_rollups (day, est_cost_usd DESC);
```

- 聚合任务每 5 分钟增量运行：取新到达事件（含 late），按维度 UPSERT 累加。
- 只聚合 `flag_status IN ('clean','late')` 的事件；事件被改判 `suspect` 时触发对应 `(user_id, day)` 的重算。
- 所有榜单查询（日/周/月/总，按 agent/model/地区过滤）都是对本表的 `SUM ... GROUP BY user_id`。

### 3.7 leaderboard_snapshots — 榜单快照（历史存档）

实时榜用 Redis Sorted Set（key 形如 `lb:{board}:{period}`，member=user_id，score=metric），本表存**已结算周期**的最终排名，支撑"历史最佳名次""上周冠军"等产品功能：

```sql
CREATE TABLE leaderboard_snapshots (
  board        TEXT NOT NULL,     -- 'overall' | 'agent:claude_code' | 'model:claude-sonnet-5' | 'geo:CN'
  period_type  TEXT NOT NULL CHECK (period_type IN ('daily','weekly','monthly','all_time')),
  period_start DATE NOT NULL,
  metric       TEXT NOT NULL CHECK (metric IN ('est_cost_usd','total_tokens')),
  rank         INTEGER NOT NULL,
  user_id      UUID NOT NULL,
  metric_value NUMERIC(16,4) NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board, period_type, period_start, metric, rank)
);
```

- 主榜 metric 为 `est_cost_usd`（标准化成本），`total_tokens` 作为次级榜单。
- 快照只收录 `is_public = true` 且 `trust_level <> 'suspect'` 的用户。

### 3.8 ingest_batches — 批次审计（反滥用观测）

```sql
CREATE TABLE ingest_batches (
  id               UUID PRIMARY KEY,      -- 即客户端 batch_id
  auth_code_id     UUID NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  events_total     INTEGER NOT NULL,
  events_accepted  INTEGER NOT NULL,
  events_duplicate INTEGER NOT NULL,
  events_rejected  INTEGER NOT NULL,
  geo_country      CHAR(2),
  ip_hash          TEXT,
  plugin_version   TEXT
);
```

保留 30 天，用于排查"某个 code 突然大量 rejected/超频"这类滥用模式。

---

## 4. 数据清洗与聚合链路

```
Ingest API（同步，毫秒级）
  ├─ 认证 auth-code → user
  ├─ Schema 校验 + 时间规则（§2.5）→ rejected 直接回包
  ├─ IP → Geo 解析，丢弃原始 IP
  └─ INSERT ON CONFLICT DO NOTHING → accepted / duplicate

清洗 Worker（异步，分钟级）
  ├─ model 归一化：alias 查表 → 规则匹配 → 待映射队列
  └─ 合理性校验（阈值全部走配置表，不硬编码）：
      · output_tokens / turn_duration_ms 超出该 model 吞吐上限 → suspect
      · 单用户滚动 1h/24h 总量超阈值 → suspect
      · 同一 session 内 occurred_at 非单调 / 大量密集补报 → suspect

聚合 Job（每 5 分钟）
  └─ 新事件 → usage_daily_rollups UPSERT（含成本折算）

榜单刷新
  ├─ 实时：rollup 变更 → 更新 Redis ZSET
  └─ 结算：周期结束后写 leaderboard_snapshots
```

---

## 5. 保留与合规策略汇总

| 数据 | 保留期 | 说明 |
|---|---|---|
| `usage_events` | 90 天 | 按天分区 DROP |
| `usage_daily_rollups` | 永久 | 榜单与个人趋势的数据源 |
| `leaderboard_snapshots` | 永久 | |
| `ingest_batches` | 30 天 | |
| 原始 IP | 0（不落库） | 入库前解析为 geo 后丢弃 |
| `ip_hash` | 30 天 | 每日轮换盐，到期置空 |
| 用户注销 | — | users 标记 deleted，events/rollups 中 user_id 保留但榜单剔除；如需硬删除则级联删 rollups 并从快照匿名化 |

---

## 6. 待定项（不阻塞开发，实现前确认）

1. 切日时区：暂定 UTC；若主要用户在国内，日榜可按 UTC+8 展示层换算。
2. `usage_summary` 的反作弊降权：聚合粒度粗、可校验信号少，是否只计入总榜不计入短期榜。
3. 合理性阈值初始值：各 model 的 token/秒上限、单用户日上限，上线前用真实数据标定。
4. 新模型自动建档：未映射 `model_raw` 累计出现 N 次后自动创建 `models` 草稿记录并告警。
