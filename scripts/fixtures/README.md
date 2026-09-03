# Fixture / UAT scripts

Ad-hoc scripts that create throwaway users, insert manuals, mutate workflow state, force
checklist results, or delete fixture data.

## Rules (Phase 8A.5 — Supabase environment isolation)

- **DEV/Preview only.** These scripts must never run against Production
  (`smartin-manual-builder-prod`, ref `wotidyhpbltoxmzvdqkj`). Production has no demo/UAT data.
- Every script MUST import and call the guard before its first write:

  ```js
  import { assertDevFixtureTarget, loadEnvFile } from "./_guard.mjs";

  const env = loadEnvFile(".env.local");
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  assertDevFixtureTarget(url); // throws "ABORT — …" unless the target is provably DEV
  ```

- The guard passes only when **all** hold:
  1. target project ref === `tmrwhkhydkjaubpuegqa` (DEV), and
  2. `APP_ENV` is not `production`, and
  3. `ALLOW_DESTRUCTIVE_FIXTURES=yes-dev` is set in the environment.

Run example:

```bash
APP_ENV=development ALLOW_DESTRUCTIVE_FIXTURES=yes-dev \
  node --experimental-websocket scripts/fixtures/<script>.mjs
```
