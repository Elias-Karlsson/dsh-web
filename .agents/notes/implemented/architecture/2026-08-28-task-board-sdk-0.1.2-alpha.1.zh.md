# Agent Note: Task board host ApiProxy integration

Status: implemented

## Problem

已退役的 Typert 会话网关不再导出任务看板启动和对账执行所需的会话操作。任务无法再通过该网关启动或观察隔离的 DSH 会话。

## Decision

`packages/dsh-task-board` 使用 Host 本地的 `apiProxy` service 及其 session 和 agent-preset 方法。runner 通过 RPC envelope 创建、重命名、提示、列出并读取会话历史；注入的 workspace registry 仍是工作区校验的权威来源。

`workspace-attach-failed` create 响应可能描述已存活的会话。runner 将该响应转为携带返回 session id 的 `SessionLaunchError`，使 ledger 记录并结算会话而不是遗留孤儿会话。

包声明 DSH `>=0.1.0-rc.5`，这是包含该 ApiProxy 表面的首个受支持版本。

## Alternatives considered

保留 Typert 会话网关不可行，因为部署中的 DSH Host 缺少所需的 `session/list`、follow 和 page 操作。

在这个外部 fork 中导入当前 ApiProxy 包不可行，因为其 lockfile 属于旧 SDK cohort。fork 通过注入 service 的收窄本地接口完成集成。

丢弃部分成功的 create 失败不可行，因为 Host 可在工作区附加失败前发布会话；ledger 必须保留返回 id。

## Consequences

历史分页替代已退役的 follow/page stream 路径。runner 将不可用的 list 或 history 读取保持为 pending，并保留有界 scan memo。

工作区和预设校验仍在 prompt 投递前 fail closed。create 后失败（包括已报告的部分 create）仍附着在 execution 记录上并结算为 failed。

浏览器 preset roster 继续使用现有的 client remote API；只有 Host execution 使用 ApiProxy。

## Testing

包 typecheck、包含一个 native-power skip 的 300 个 Vitest 测试以及 tsdown build 都通过。独立 DSH trial 验证了手动和 cron 启动、终态对账以及重启后的 ledger 持久化。
