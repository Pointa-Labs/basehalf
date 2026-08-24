import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('BaseHalf VS Code API contract', () => {
  it('exposes only Bearer model-service authorization and no custom header name', () => {
    const packageRoot = fileURLToPath(new URL('../', import.meta.url));
    const temporary = mkdtempSync(path.join(packageRoot, '.model-service-contract-'));
    const fixture = path.join(temporary, 'contract.ts');
    try {
      writeFileSync(
        fixture,
        [
          "import type {} from '../src/vscode.js';",
          "import type * as vscode from 'vscode';",
          'declare const service: vscode.basehalf.ModelService;',
          "const authorization: 'bearer' = service.authorization;",
          'void authorization;',
          '// @ts-expect-error Custom authorization headers are not in the public contract.',
          'service.headerName;',
          '',
        ].join('\n'),
      );
      const program = ts.createProgram([fixture], {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
      });
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

      expect(diagnostics).toEqual([]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
