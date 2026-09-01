# Agent Note: Task board host ApiProxy integration

Status: implemented

## Problem

The retired Typert session gateway no longer exposes the session operations needed to launch and reconcile Task Board executions. A task can no longer start or observe an isolated DSH session through that gateway.

## Decision

`packages/dsh-task-board` consumes the host-local `apiProxy` service and its session and agent-preset methods. The runner creates, renames, prompts, lists, and reads session history through RPC envelopes, while the injected workspace registry remains authoritative for workspace validation.

A `workspace-attach-failed` create response can describe a session that is already live. The runner converts that response into `SessionLaunchError` with its returned session id so the ledger records and settles the session rather than orphaning it.

The package declares DSH `>=0.1.0-rc.5`, the first supported release containing this ApiProxy surface.

## Alternatives considered

Keeping the Typert session gateway loses because its required `session/list`, follow, and page operations are absent from the deployed DSH host.

Importing the current ApiProxy package into this external fork loses because its lockfile belongs to an older SDK cohort. The fork uses a narrowed local interface over the injected service instead.

Discarding a partial create failure loses because the host can publish the session before workspace attachment fails; the ledger must retain the returned id.

## Consequences

History pagination replaces the retired follow/page stream path. The runner treats unavailable list or history reads as pending and preserves its bounded scan memo.

Workspace and preset validation remain fail-closed before prompt delivery. Post-create failures, including reported partial creates, remain attached to the execution record and settle as failed.

The browser preset roster continues to use its existing client remote APIs; only host execution uses ApiProxy.

## Testing

The package typecheck, 300-test Vitest suite with one native-power skip, and tsdown build pass. An isolated DSH trial verified manual and cron launches, terminal reconciliation, and ledger persistence across restart.
