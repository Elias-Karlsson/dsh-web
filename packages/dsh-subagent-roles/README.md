# dsh-subagent-roles — Subagent Role Matrix (settings section for explicit model fallback chains)

English | [中文](README.zh.md)

Adds a **Subagent roles** page to the web GUI's Settings panel: one card per subagent role (`subagent_fast`, `subagent_deep`, …) showing its ordered model fallback chain, with reorder, add, and remove — saved straight into the preset file (`~/.dsh/.agent-presets/model-roles/agent.cordis.yml` by default). Only the `routes:` blocks are rewritten; comments, personas, and every other row survive byte for byte. New subagent spawns pick the change up immediately — no rebuild or restart.

## Why

The role chains decide which model a delegated subagent actually runs on, and in which order quotas are fallen back through. They live as YAML inside the preset, so inspecting or rebalancing them meant hand-editing a long file. The matrix makes the chains a first-class, visual edit — with validation (no empty chains, no duplicate routes, unknown roles rejected) before anything reaches disk.

## How it works

One package, both halves:

- **Host half** mounts loopback-fenced exact-path routes on the host webserver: `GET /subagent-roles/api/status|models|roles` and `POST /subagent-roles/api/role|roles-batch`. Non-loopback peers get 403; wrong methods 405; invalid chains 400. The model catalog comes from `settings.yaml`; writes go through a parse → validate → rewrite → re-validate pipeline that touches only the target role's route lines.
- **Browser half** contributes the settings section (slot `settings.section`, order 30): filter box, per-role save/revert, dirty counters, save-all batch. All edits stage locally until a save posts them.

## Install

```sh
# Option 1: family bundle
dsh plugin --profile web add @linxin666/dsh-web-all@latest

# Option 2: standalone
dsh plugin --profile web add @linxin666/dsh-client-ui-subagent-roles@latest
```

## Config

```yaml
- id: subagent-roles
  name: '@linxin666/dsh-client-ui-subagent-roles'
  config:
    presetId: model-roles        # preset directory under $DSH_HOME/.agent-presets/
    presetFile: agent.cordis.yml # composition filename inside it
    trustedHosts: []             # extra accepted Host headers (exact match, incl. port)
```

## Security

Reads and writes are fenced to literal loopback peers (socket address AND Host header, plus browser same-origin markers; X-Forwarded-For is never trusted). Access through a tailnet or LAN address must be listed explicitly in `trustedHosts`; anything unlisted still answers 403. The wire never accepts a `sessionId`-style graft: routes name provider/model pairs only, and the file surgery rewrites nothing outside the target `routes:` block.
