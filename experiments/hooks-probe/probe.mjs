// Sprint 0 probe: verify Claude Code hooks can inject context via
// hookSpecificOutput.additionalContext (see docs/memory/m-boot-006).
// Logs the raw stdin payload (schema evidence) and emits a canary token.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const logPath = join(dirname(fileURLToPath(import.meta.url)), 'log.jsonl');

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  payload = { parse_error: true, raw };
}
appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), payload }) + '\n');

const event = payload.hook_event_name ?? 'unknown';
const token =
  event === 'SessionStart'
    ? 'HAIDO_SESSION_CANARY_73194'
    : event === 'PostToolUse'
      ? 'HAIDO_POST_CANARY_88251'
      : null;

if (token) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: `${token} (probe: if you can read this, quote the token verbatim in your reply)`,
      },
    }),
  );
}
