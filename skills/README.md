# The BaseHalf agent skill

[BaseHalf](https://basehalf.com) is a free and open-source desktop app that
opens a folder as a canvas. Every file is a card, and a line between two cards
says that one builds on the other. This skill tells an agent, such as Claude
Code or Codex, how to read such a folder:

- what a file is for, what it builds on, and what uses it;
- how to move and rename files so that their cards and connections follow;
- what you selected on the canvas, so that "this" means something;
- where a note keeps its files, its formats, and its comments.

## It needs a BaseHalf workspace

A folder is a BaseHalf workspace when it has a hidden `.bh/` folder, which
BaseHalf makes when it shows the folder as a canvas. In any other folder the
skill has nothing to do. Installing it makes no folder a workspace, installs
no app, and changes none of your files.

To get a canvas, [download BaseHalf](https://basehalf.com/download). It runs
on macOS on Apple Silicon. In a folder that someone else's BaseHalf made, such
as a shared repository, the skill works without the app.

## Install

If you use BaseHalf, you need none of this: it offers the skill when you open
a folder, and keeps it up to date with each release.

Without the app, for any agent that reads skills:

```bash
npx skills add Pointa-Labs/basehalf
```

For Claude Code, as a plugin:

```bash
claude plugin install basehalf --marketplace Pointa-Labs/basehalf
```

That command clones the BaseHalf repository to read its list of plugins. To
fetch only the two folders it needs, add the marketplace first:

```bash
claude plugin marketplace add Pointa-Labs/basehalf --sparse .claude-plugin skills
```

```bash
claude plugin install basehalf@basehalf
```

A copy installed this way follows this repository, not your BaseHalf. When you
install BaseHalf later, it offers to replace a copy in your agents' folders by
its own, which it keeps up to date.

## What is here

- `basehalf/SKILL.md`: the skill, the same text BaseHalf installs. It is
  written from BaseHalf's source; do not edit it here.
- `.claude-plugin/plugin.json`: makes this folder a Claude Code plugin.
- `LICENSE`: Apache License 2.0, as the rest of the repository.
