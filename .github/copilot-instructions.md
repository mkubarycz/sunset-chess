# Sunset Chess repository workflow

## Start of each development session

- Discover deployment targets from the current branch's deployment
  configuration, [package scripts](../package.json), and running environment.
  Start with [compose.yaml](../compose.yaml) and the
  [deployment documentation](../README.md#container). Do not assume a version,
  port, container, or database from a previous session is still the target.
- Before app edits, migrations, or deployment, present the discovered target
  (instance, live URL, and database/storage identity) and confirm it with the
  user once per session. An explicit target in the user's request counts as
  confirmation, but still verify it against the configuration and runtime.
  If multiple instances or conflicting details exist, ask rather than guess.
- Keep the confirmed target for this session; reconfirm if it changes. Never
  stop, redeploy, migrate, restore over, or delete another instance or shared
  storage without separate explicit approval. Honor documented preservation
  restrictions even if an instance is not the selected target.
- Before app development, create a consistent database backup of the confirmed
  instance using the documented procedure. Verify that the backup command's
  source matches that instance before running it; do not assume a bundled
  helper supports every target. Adapt and validate target-specific tooling
  when needed rather than backing up a different instance or bypassing guards.
- Verify backup integrity, retain it outside the worktree and live storage,
  and report its path and checks. Back up once per session, not per message,
  and again before a destructive migration. If no verified backup exists,
  stop app changes and deployment and explain the blocker.

## Deliver changes to the confirmed instance

- By default, deploy after completing and validating an app change. Do not
  leave the result only in the worktree or a temporary preview. Honor explicit
  requests for local-only work, a pause, or no deployment.
- Run relevant tests, `npm run build`, and `npm run lint` before deployment.
  Do not run builds concurrently with HTTP integration tests: both use `dist`.
- Use the repository's deployment command only after verifying its resolved
  destination matches the confirmed target. Wait for readiness, check the
  target's health endpoint, and verify the changed behavior at its live URL,
  using browser checks when appropriate. Do not mutate live data to test.
- Preserve persistent storage. Never use `down --volumes`, copy a live SQLite
  file directly, or restore automatically. Use isolated disposable database
  copies for development tests and stop test helpers afterward.
- Documentation/instruction-only changes do not require app redeployment.
- In the final response give the live URL, deployment/verification status, and
  backup path. If deployment fails or is intentionally skipped, say so clearly.
- See [README](../README.md#container) for deployment and restore procedures.

These are agent workflow instructions, not an enforced lifecycle hook. Keep this
file versioned and available on the branch used to start new sessions.
