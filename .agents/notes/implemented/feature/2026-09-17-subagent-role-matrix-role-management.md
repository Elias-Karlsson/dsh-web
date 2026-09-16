# Agent Note: Subagent Role Matrix Gains Role Lifecycle and Filter Editing

Status: implemented

## Problem

The `dsh-subagent-roles` settings section could only read role blocks and rewrite one role's `routes:` chain. Rebalancing the subagent roster — adding a role, retiring one, changing who may spawn a role, or editing a role's persona and `toolFilter`/`contextFilter` lists — still meant hand-editing the preset YAML, with no validation and no stripping of dangling references to a removed role.

## Decision

- **Host surgery** (`packages/dsh-subagent-roles/src/roles-file.ts`): `parseRoleBlocks` now also captures each block's persona literal, `toolFilter.allow`, the three `contextFilter` lists, the `backgroundMode`/`maxDepth`/`codes` scalars, and every surgery line span (plugin row, parents/persona/filter line indices). New line-scoped rewrites sit beside `replaceRoutes`: `replaceParents`, `replacePersona` (empty persona rejected), `replaceFilters` (subset update, absent key untouched), `addRole` (appends after the last `tool-subagent-*` row, clones backgroundMode/maxDepth/filters/codes from a template role, starts with `allowedParentRoles: []` and a single route), and `deleteRole` (removes the row and strips the role's toolName — bare and `tool:`-prefixed — from other blocks' `allow`/`systemSections` lists and the role name from their `allowedParentRoles`). Every rewrite re-parses and re-validates before returning; everything outside the touched lines survives byte for byte.
- **Routes** (`src/routes.ts`): five new POST endpoints under the same loopback fence and 400/403/405 discipline — `/role-create`, `/role-delete`, `/role-parents` (parents must be `main` or an existing role, never the role itself), `/role-persona`, `/role-filters`. The roles payload now carries persona, toolAllow, and contextFilter.
- **Browser half**: each role card gained three tabs — Chains (unchanged), Spawn (parent checkboxes; a role with none cannot be spawned), Filter & prompt (persona textarea plus chip editors with suggestions from the union of tokens used in the file and every role's toolName). The section header gained an add-role form (name, persona, template role, initial model) and each card a confirm-gated delete. Staged drafts live in the store per tab; save-all flushes chains, spawn, and prompt edits sequentially. New zh/en keys in the package, ru mirrored centrally in `dsh-i18n`.

## Alternatives considered

- YAML-AST rewriting for the whole file: the `yaml` parser re-emits formatting and comments unpredictably; the line-scoped surgery keeps the byte-for-byte guarantee the standalone Role Matrix server established, so both tools can edit the same preset interchangeably.
- Server-side suggestion catalog for filter tokens: the union of tokens already present in the file plus every role's toolName is computable from the roles payload the client already holds; a second endpoint would duplicate state for no new information.
- One generic "edit role fields" endpoint: five narrow endpoints keep wire validation explicit per field and reuse the existing parse-then-surgery error discipline instead of growing a polymorphic body.

## Testing

`tests/roles-file.spec.ts` builds the fixture from composable blocks (role A references role B's toolName; B lists A as parent) and asserts byte-exact expectations for replace/add/delete, including reference stripping. `tests/routes.spec.ts` covers the five endpoints' happy paths and 400 rejections plus 403/405 discipline against tmp fixture files; the real-deployment preset guard still parses.

## Consequences

- The full subagent roster lifecycle is editable from the GUI with validation before anything reaches disk; new roles are unspawnable until a parent is explicitly saved, and deletion cannot leave dangling tool or parent references.
- The wire surface widens from chain edits to role lifecycle, still behind the loopback fence; presets written by older matrix versions remain readable because parsing only grew new fields.
