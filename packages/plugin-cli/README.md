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

Open the generated folder in BaseHalf and press `F5` to start a development host with the plugin loaded. The scaffold keeps durable plugin output in ordinary local project files.

## Validate and package

```sh
npm run check
npm run package
```

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
