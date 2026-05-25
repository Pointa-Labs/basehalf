# Using this knowledge base (instructions for coding agents)

This repo ships a CLI, `kb`, that is the **only** supported way to change the
knowledge base. Every command is recorded and reversible. Always prefer `--json`,
and always pass `--actor agent` on writes so the audit trail shows who acted.

(While developing, invoke it as `node src/cli.mjs <cmd>`. Once installed, it's `kb <cmd>`.)

## Read before you act

```bash
node src/cli.mjs context "<what you're working on>" --json   # grounded context bundle
node src/cli.mjs search "<query>" --json
node src/cli.mjs get <id> --json
```

## Change things (always --actor agent)

```bash
node src/cli.mjs add "<text>" --source <where-it-came-from> --actor agent --json
node src/cli.mjs edit <id> "<text>" --actor agent --json
node src/cli.mjs move <id> --x <n> --y <n> --actor agent --json   # canvas layout
node src/cli.mjs link <id> --source <s> --actor agent --json
node src/cli.mjs rm  <id> --actor agent --json                    # soft delete
```

## Check / fix

```bash
node src/cli.mjs log --json
node src/cli.mjs undo <eventId|commandId> --actor agent --json    # undo a change or a whole run
```

## Rules

- **Ground your facts.** Attach `--source` to any factual claim. Don't write
  ungrounded assertions.
- **Go through `kb`.** Never edit `.kb/events.jsonl` by hand — that bypasses the
  audit log and undo.
- **You bring the brain.** For high-level requests ("arrange into a circle",
  "summarize these"), *you* compute the result and then issue primitive commands
  (`move`, `add`, …). The software has no high-level/task-specific commands by design.
