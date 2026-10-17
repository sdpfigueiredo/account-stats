# Publishing Account Stats to GitHub

Version 1.3.1. Distribution changes only; the v1.3.0 runtime is preserved.

## The three names

| Name | Value | Meaning |
|---|---|---|
| GitHub repository | Any `OWNER/REPOSITORY` you control | Where Git fetches this project |
| Marketplace name | `account-stats-marketplace` | Stable catalogue ID from `.claude-plugin/marketplace.json` |
| Plugin name | `account-stats` | Stable identity from `.claude-plugin/plugin.json` |

The GitHub repository may be named anything. It does not have to match the marketplace name. No repository URL needs to be edited into the manifests: `source: "./"` points to the plugin in this repository. Change only the examples in README to your actual repository. Owner/author attribution can be customized before your first commit.

## Start from the plain-text source patch

The separately supplied `account-stats-source.patch` contains **all repository files**, not a delta that requires a previous plugin version. It is an ordinary uncompressed Git patch with no binary payload. Apply it to a new empty repository, not over an existing installation:

```powershell
New-Item -ItemType Directory account-stats
Set-Location account-stats
git init -b main
git apply --check --whitespace=nowarn ..\account-stats-source.patch
git apply --whitespace=nowarn ..\account-stats-source.patch
npm run check
npm test
```

Before committing, replace `YOUR_GITHUB_USER/account-stats` in README with your intended owner/repo. Do not change the source path to that URL.

```powershell
git add .
git commit -m "Initial Account Stats marketplace release"
```

If you already have all the individual source files, start at `git init -b main`; no patch is needed. Copy **the contents** of the source directory to the repository root. The path on GitHub must be `.claude-plugin/marketplace.json`, not `some-extra-wrapper/.claude-plugin/marketplace.json`.

## Push to a new repository

Create an **empty** GitHub repository. Do not initialize it with a README, license or .gitignore, because this source already includes them. Decide whether the repository should be public or private before creating it. Authenticate Git through your normal credential helper; never put a token in these files or the remote URL.

From the local source repository:

```powershell
git remote add origin https://github.com/YOUR_GITHUB_USER/account-stats.git
git push -u origin main
```

For a repository that already has commits, use a separate branch and a normal merge/PR instead of a force push.

## Install from GitHub in Claude Code

First disable or move any previous manual copy out of the skills directory as described in README. Then, in a **local** Code session in Claude Desktop:

```text
/plugin marketplace add YOUR_GITHUB_USER/account-stats
/plugin install account-stats@account-stats-marketplace
```

The install command opens the plugin's detail view. Review it and choose User scope; allow the mod only after reviewing its capabilities. Then:

```text
/reload-plugins
/account-stats
```

The combined form is also supported on recent Claude Code versions:

```text
/plugin install account-stats --marketplace YOUR_GITHUB_USER/account-stats
```

When the UI offers a repository/marketplace source field, use the **Git repository URL**:

```text
https://github.com/YOUR_GITHUB_USER/account-stats.git
```

Do not supply the URL of a ZIP, the raw marketplace.json file, a blob page, the `.claude-plugin` directory page or `preview/index.html`. A catalogue fetched as a JSON URL does not include the source files needed by `source: "./"`.

Private repositories use Git credentials already available to the host. Confirm `git ls-remote` works without an interactive credential prompt on the same machine first. Do not distribute GitHub tokens with this mod.

## Validate and test the actual loader

From a clone of the repository:

```sh
claude plugin validate --strict .
claude --plugin-dir .
```

Then test a fresh GitHub marketplace installation in Desktop. Check the panel opens, Node is found from its installed location, language follows Code, quota boundaries match your reset, and the four token categories and estimates are present. These host checks are not replaced by `npm test` or the browser preview.

## Ship later releases

1. Change `.claude-plugin/plugin.json` `version` and `package.json` `version` together.
2. Update CHANGELOG and, when applicable, the dated price catalogue.
3. Run `npm run check`, `npm test`, `npm run preview` and the official validator.
4. Commit and push to the default branch.
5. Users update the marketplace/plugin and reload open sessions.

Keep `version` out of the marketplace entry: the plugin manifest is authoritative. Pushing new source without increasing its version can leave users on their cached old copy. A release ZIP and an npm publication are **not required** for a relative-source Git marketplace.

In Claude:

```text
/plugin marketplace update account-stats-marketplace
/reload-plugins
```

Shell alternative:

```sh
claude plugin update account-stats@account-stats-marketplace --scope user
```

Users can opt in to automatic updates under the marketplace's settings. Do not rename the marketplace or plugin casually after publication: those names are installation identities.

## Primary documentation

- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/plugins/marketplace-reference
- https://code.claude.com/docs/en/plugins/install
- https://code.claude.com/docs/en/plugins/host-marketplace
- https://code.claude.com/docs/en/plugins/mods/overview
- https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
- https://git-scm.com/docs/git-apply
