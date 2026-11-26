#!/usr/bin/env node
// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(
    `This command needs Node 20 or later, and this is Node ${process.versions.node}. Nothing was changed.`,
  );
  process.exit(1);
}

const { main } = await import('../src/main.js');
process.exitCode = await main(process.argv.slice(2));
