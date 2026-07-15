# Local development and testing

## Development host

The generated project includes a BaseHalf extension-development launch
configuration and a separate `test-workspace/`. Open the plugin folder in
BaseHalf and press **F5** to run the plugin without modifying the normal user
profile.

Use the development host to test:

- create, open, save, and external file changes;
- dirty-state navigation and cancellation;
- provider configuration, errors, and interrupted runs;
- Extension Host restart and state restoration;
- disable and uninstall fallback;
- project readability without the plugin installed.

Generated outputs must be ordinary files with project-relative paths. Removing
the plugin must leave those files browsable, searchable, Git-managed, and
openable as source.

## Validate the exact artifact

Before submitting, run:

```bash
npm run check
npm run package
```

`check` compiles, type-checks, and validates the manifest and publish contents.
`package` creates the exact VSIX that can be independently inspected before
upload.

BaseHalf intentionally does not expose arbitrary **Install from VSIX**. Local
code runs through the development host; user distribution goes through the
reviewed publishing path.

Continue with [Publish, review, and update](publishing.md).
