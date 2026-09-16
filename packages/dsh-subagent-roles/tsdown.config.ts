/**
 * Standalone build config for the dsh-subagent-roles plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * the node half (role-matrix routes + preset file surgery) builds to lib/,
 * and the browser half is auto-detected at src/client/index.ts and emitted
 * as lib/client.js. Runtime @deepseek-ai/* peers stay external;
 * schemastery and yaml are declared dependencies and ride the host install.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-subagent-roles', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    'schemastery',
    'yaml',
  ],
})
