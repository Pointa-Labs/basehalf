#!/usr/bin/env node
// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 3)) {
  console.error(
    `This command needs Node 20.3 or later, and this is Node ${process.versions.node}. Nothing was changed.`,
  );
  process.exit(1);
}

const { main } = await import('../src/main.js');
process.exitCode = await main(process.argv.slice(2));
