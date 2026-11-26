# basehalf

Installs [BaseHalf](https://basehalf.com), opens the folder you are in as a
canvas, and installs BaseHalf's skill for your agents.

```bash
npx basehalf
```

Run it in the folder you want to see, or tell your agent to run it there.

The command needs Node 20.3 or later, on a computer that BaseHalf
[is released for](https://basehalf.com/download).

## What it does

1. Looks for BaseHalf in `/Applications` and in `~/Applications`. One that is
   there is used as it is: BaseHalf updates itself.
2. Otherwise downloads the latest release from
   [GitHub](https://github.com/Pointa-Labs/basehalf/releases), checks its
   signature as an installed BaseHalf checks an update, and puts it into
   `/Applications`, or into `~/Applications` when you may not write there.
3. Opens the folder in BaseHalf. Your home folder and the root of a disk are
   not opened as a canvas.
4. Has BaseHalf install its skill for Claude Code and for Codex, which tells
   them how to read a canvas. The skill is added to the agents' own settings,
   not to your folder.

It asks nothing while it runs, prints one line for each thing it did, and
sends nothing but its two requests for files.

## Options

```text
npx basehalf [folder] [--no-skill]

  folder       The folder to open. Without it, the folder you are in.
  --no-skill   Leave the skill as it is.
  --help       Print the usage.
  --version    Print the version of this command.
```

## Source

[`packages/install`](https://github.com/Pointa-Labs/basehalf/tree/main/packages/install)
of BaseHalf's repository, under the Apache License 2.0. What the command does
in every case is written down in
[the install command](https://github.com/Pointa-Labs/basehalf/blob/main/docs/specs/install-command.md).
