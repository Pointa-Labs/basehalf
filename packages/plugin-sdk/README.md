# BaseHalf Plugin SDK

TypeScript contracts for BaseHalf plugin manifests and proposed BaseHalf host APIs.

```sh
npm install --save-dev @basehalf/plugin-sdk
```

Import `@basehalf/plugin-sdk/vscode` for BaseHalf's VS Code API type augmentation:

```ts
import type {} from '@basehalf/plugin-sdk/vscode';
import * as vscode from 'vscode';
```

The SDK is a type and validation package. Plugins still run in BaseHalf's VS Code-compatible Extension Host and use the `vscode` runtime module supplied by the host.

Read the [plugin development guide](https://github.com/Pointa-Labs/basehalf/blob/main/docs/plugin-development.md) before relying on proposed APIs.
