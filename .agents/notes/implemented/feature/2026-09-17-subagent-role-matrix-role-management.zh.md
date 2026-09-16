# Agent Note: 子代理角色矩阵新增角色生命周期与过滤器编辑

Status: implemented

## Problem

`dsh-subagent-roles` 设置页此前只能读取角色块并重写单个角色的 `routes:` 链。调整子代理名册 —— 新增角色、退役角色、修改谁可以孵化某角色、编辑角色的 persona 与 `toolFilter`/`contextFilter` 列表 —— 仍然意味着手工编辑预设 YAML，没有校验，也不会清理指向被删角色的悬空引用。

## Decision

- **Host 手术**（`packages/dsh-subagent-roles/src/roles-file.ts`）：`parseRoleBlocks` 现在同时捕获每个块的 persona 字面块、`toolFilter.allow`、三个 `contextFilter` 列表、`backgroundMode`/`maxDepth`/`codes` 标量，以及全部手术行区间（插件行、parents/persona/filter 行索引）。新的行级重写与 `replaceRoutes` 并列：`replaceParents`、`replacePersona`（拒绝空 persona）、`replaceFilters`（子集更新，缺席的键不动）、`addRole`（追加到最后一个 `tool-subagent-*` 行之后，从模板角色克隆 backgroundMode/maxDepth/过滤器/codes，初始为 `allowedParentRoles: []` 且只有一条路由）、`deleteRole`（移除整行，并从其他块的 `allow`/`systemSections` 列表中剥离该角色的 toolName —— 裸名与 `tool:` 前缀两种形态 —— 以及从它们的 `allowedParentRoles` 中剥离角色名）。每次重写返回前都重新解析并重新校验；被触碰行之外的所有内容逐字节保留。
- **路由**（`src/routes.ts`）：在同一环回围栏与 400/403/405 纪律下新增五个 POST 端点 —— `/role-create`、`/role-delete`、`/role-parents`（父角色必须是 `main` 或已存在的角色，且不能是角色自身）、`/role-persona`、`/role-filters`。roles 载荷现在携带 persona、toolAllow 与 contextFilter。
- **浏览器半区**：每张角色卡片新增三个标签页 —— 模型链（不变）、孵化权限（父角色复选框；一个都不勾选则无法被任何人孵化）、过滤与提示词（persona 文本框加词条芯片编辑器，可选项取自文件中已使用词条与每个角色 toolName 的并集）。页头新增新建角色表单（角色名、persona、模板角色、初始模型），每张卡片新增带确认的删除按钮。暂存草稿按标签页存放在 store 中；全部保存按顺序冲刷模型链、孵化与提示词编辑。包内新增 zh/en 键，ru 由 `dsh-i18n` 集中镜像。

## Alternatives considered

- 整文件 YAML-AST 重写：`yaml` 解析器重排放格式与注释的行为不可控；行级手术保持了独立 Role Matrix 服务器建立的逐字节保证，两个工具可以互换地编辑同一预设。
- 过滤词条的服务端可选项目录：文件中已出现词条与每个角色 toolName 的并集可以直接从客户端已持有的 roles 载荷计算；再开一个端点只会重复状态而不带来新信息。
- 一个通用的「编辑角色字段」端点：五个窄端点让每个字段的线上校验保持显式，并复用既有的 解析-然后-手术 错误纪律，而不是养出一个多态请求体。

## Testing

`tests/roles-file.spec.ts` 用可组合的块构建 fixture（角色 A 的列表引用角色 B 的 toolName；B 把 A 列为父角色），并对 replace/add/delete 断言逐字节期望，包括引用剥离。`tests/routes.spec.ts` 覆盖五个端点的成功路径与 400 拒绝，外加对 tmp fixture 文件的 403/405 纪律；真实部署预设的守护用例仍可解析。

## Consequences

- 子代理名册的完整生命周期可以在 GUI 中编辑，且任何内容落盘前都经过校验；新角色在显式保存父角色之前无法被孵化，删除不会留下悬空的工具或父角色引用。
- 线上接口从链编辑扩展到角色生命周期，仍位于环回围栏之后；旧版矩阵写出的预设依然可读，因为解析只是新增了字段。
