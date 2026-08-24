# BaseHalf Plugin CLI

`bh-plugin` is the supported command-line path for creating, validating, packaging, and submitting a BaseHalf plugin.

## Install

```sh
npm install --global @basehalf/plugin-cli
```

## Create a plugin

```sh
bh-plugin init my-plugin \
  --publisher your-publisher \
  --name my-plugin \
  --display-name "My Plugin" \
  --repository https://github.com/your-publisher/my-plugin
cd my-plugin
npm install
```

The default scaffold contributes one main-canvas recipe and one starter template. It registers a small deterministic executor, contains no Webview boilerplate, and returns one `artifact` backed by one ordinary local project file per submission. Its Markdown output is declared as a sealed `file` Result; ordinary Text and Code cards retain their normal editor interaction and are not executable containers.

Use the projection mode only when a file format needs its own card-detail surface:

```sh
bh-plugin init my-project-plugin \
  --publisher your-publisher \
  --name my-project-plugin \
  --display-name "My Project Plugin" \
  --repository https://github.com/your-publisher/my-project-plugin \
  --kind projection \
  --file-extension myproject
```

For compatibility, supplying `--file-extension` without `--kind` also selects the projection scaffold. Open the generated folder in BaseHalf and press `F5` to start a development host with the plugin loaded.

## Validate and package

```sh
npm run check
npm run package
```

Validation checks the manifest, compiled entry point, README, license, and every declared canvas template, model-provider catalog, and video-model catalog resource before packaging. Provider-catalog manifest entries remain strict `{ id, resource }` envelopes: the resource must be canonical UTF-8 JSON within the size bound, while BaseHalf's host-owned parser validates the versioned credential and endpoint contract during admission. Template files must satisfy the complete public template v1 contract; valid JSON alone is not sufficient.

After packaging, the CLI reopens the exact VSIX and checks its identity, manifest, required resources, archive paths, expanded sizes, and CRCs. `validate`, `package`, and `publish` all begin with the same project validation path; publish cannot substitute an unrelated prebuilt VSIX.

## Submit for review

```sh
npm run publish
```

The first publish opens one browser confirmation with the existing BaseHalf
account, then resumes automatically. The manifest Publisher is used as the
publishing namespace; if a matching personal namespace does not exist and is
available, the confirmation creates it.

Publishing uploads an immutable VSIX for automated validation and human review;
it does not make the plugin public immediately. Use `bh-plugin status .` when a
terminal-readable status is useful. Manual `bh-plugin login --publisher <slug>`
is available for automation and credential management, but is not a prerequisite
for publish.

Read the [plugin development guide](https://github.com/Pointa-Labs/basehalf/blob/main/docs/plugin-development.md) for the manifest contract, product boundaries, and review policy.
