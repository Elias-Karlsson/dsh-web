# dsh-subagent-roles — 子代理角色矩阵（显式模型回退链的设置页）

[English](README.md) | 中文

在 Web GUI 的设置面板中新增 **子代理角色** 页面：每个子代理角色（`subagent_fast`、`subagent_deep` …）一张卡片，展示其按序回退的模型链，支持调整顺序、增删路由 —— 保存时直接写入预设文件（默认 `~/.dsh/.agent-presets/model-roles/agent.cordis.yml`）。只有 `routes:` 块被重写；注释、persona 和其余所有行逐字节保留。新孵化的子代理立即生效 —— 无需重新构建或重启。

## 为什么

角色链决定被委派的子代理实际运行在哪个模型上，以及配额耗尽时按什么顺序回退。它们以 YAML 形式存放在预设里，检查或再平衡意味着手工编辑一个长文件。矩阵把角色链变成一等的可视化编辑 —— 任何内容落盘前都经过校验（链不能为空、路由不能重复、未知角色被拒绝）。

## 工作原理

一个包，两个半区：

- **Host 半区** 在 host webserver 上挂载仅环回可达的精确路径路由：`GET /subagent-roles/api/status|models|roles` 与 `POST /subagent-roles/api/role|roles-batch`。非环回对端返回 403；方法错误返回 405；链非法返回 400。模型目录来自 `settings.yaml`；写入经过 解析 → 校验 → 重写 → 再校验 的管线，只触碰目标角色的路由行。
- **浏览器半区** 贡献设置页（slot `settings.section`，order 30）：筛选框、按角色保存/还原、未保存计数、全部保存的批量提交。所有编辑先在本地暂存，保存时才提交。

## 安装

```sh
# 方式 1：家族聚合包
dsh plugin --profile web add @linxin666/dsh-web-all@latest

# 方式 2：独立安装
dsh plugin --profile web add @linxin666/dsh-client-ui-subagent-roles@latest
```

## 配置

```yaml
- id: subagent-roles
  name: '@linxin666/dsh-client-ui-subagent-roles'
  config:
    presetId: model-roles        # $DSH_HOME/.agent-presets/ 下的预设目录
    presetFile: agent.cordis.yml # 其中的组合文件名
    trustedHosts: []             # 额外放行的 Host 头（精确匹配，含端口）
```

## 安全

读取与写入仅限字面环回对端（socket 地址 AND Host 头，外加浏览器同源标记；永不信任 X-Forwarded-For）。经 tailnet 或局域网地址访问时，必须在该地址显式列入 `trustedHosts`，未列出者一律返回 403。线上协议不接受任何嫁接式字段：路由只命名 provider/model 对，文件手术不会重写目标 `routes:` 块之外的任何内容。
