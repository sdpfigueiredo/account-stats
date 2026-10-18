# Account Stats for Claude Code

**Version 1.4.0 · GitHub-installable marketplace and mod · no build required**

A local-first statistics sidebar for **local sessions in the Code tab of Claude Desktop**. The repository contains the complete editable JavaScript source, a local Node.js transcript indexer, tests and a synthetic-data browser preview. It is not a ZIP wrapper, an MCP server or an application that replaces Claude Desktop.

This is an independent plugin, not an Anthropic product.

## Install from this GitHub repository

Replace `YOUR_GITHUB_USER/account-stats` with the actual owner/repository after publishing it. No owner or repository URL is hardcoded in either manifest.

In a local Claude Code session:

```text
/plugin marketplace add YOUR_GITHUB_USER/account-stats
/plugin install account-stats@account-stats-marketplace
```

Review the plugin and choose **User** scope in the details view. Then run:

```text
/reload-plugins
/account-stats
```

On versions that support the combined command:

```text
/plugin install account-stats --marketplace YOUR_GITHUB_USER/account-stats
```

Alternatively, from your shell:

```sh
claude plugin marketplace add YOUR_GITHUB_USER/account-stats
claude plugin install account-stats@account-stats-marketplace --scope user
```

In Desktop the plugin browser is under **+ → Plugins → Add plugin**. Local Desktop sessions and the CLI on the same computer share user-scope plugin settings.[1][2]

**Requirements:** a Claude Desktop build with Mods support, a **local Code session**, and **Node.js 20+** accessible to the host. The existing mod targets the 2.1.290-or-newer API surface; check the bundled Claude Code version with `/status`. There is no runtime `npm install`, API key, build step or separate server to configure. Set the Node executable in the panel if it is not discoverable. This package is not intended for Cowork, browser/cloud sessions or Desktop WSL sessions.[2][3]

### Moving from the previous manually copied edition

Close the pane with `/account-stats close`. Before installing through this marketplace, move the old `~/.claude/skills/account-stats` directory **outside** `skills/`, or disable the previous installation in its plugin manager. Do not leave two enabled installations of the same mod. Merely renaming the directory inside `skills/` does not disable discovery.

Do **not** delete `~/.claude/account-stats/v1/`: it is the usage index, not the plugin source. The runtime still uses the same plugin name, index location and preference key. Back up the existing Claude configuration before switching installation source; preference retention across installation origins is ultimately controlled by Claude's store implementation and should be checked on first run.

## Features

| View | Included |
|---|---|
| Time ranges | All time, 30 days, 7 days and current weekly quota |
| Charts | Custom SVG bars, grouped by day or subscription-reset cycle |
| Tokens | Cache read, cache write, fresh input and output, separately |
| Breakdown | Per-model totals for the selected period, day or quota |
| Weekly reset | Configurable weekday, local time and IANA time zone; default Thursday 20:00, Europe/Lisbon |
| Request speed | Fast, Standard and Unknown; per-mode requests, tokens, API equivalents and a persistent filter |
| API equivalent | Response-speed-aware USD estimates with a dated price catalogue, cache TTL uncertainty and explicit unknown-speed assumptions |
| Language | Follows Claude Code's merged `language` setting; English, Portuguese (PT/BR), Spanish, French, German and Italian |
| Utilities | Dark/light themes, local CSV exports, source diagnostics and available session rate limits |

All time charts are paginated without dropping the selected period's totals. Days without usage remain visible. Quota boundaries use response timestamps and respect daylight-saving transitions. Language changes do not alter numerical aggregation or reset configuration.

The Code `language` setting is not a separately documented Desktop UI locale. Unsupported or unset languages fall back to English. Formatting follows the supported regional locale; API estimates remain in USD.

### What the numbers mean

**Local records are not a global account billing ledger.** The index can contain different accounts/providers used in the same local profile. It cannot automatically include other machines, deleted unindexed logs, browser conversations or cloud sessions. Rate limits exposed by the session appear separately and are not inferred from token counts.

```text
Total = cache read + cache write + fresh input + output
```

API equivalent is an estimate using the catalogue shipped in `lib/pricing.js`, not the subscription price or an extra charge. The price snapshot was verified on 2026-10-18. Explicit response `usage.speed` selects Fast or Standard pricing; missing or contradictory metadata stays **Unknown**, valued using a clearly labelled standard-rate assumption. That assumption can underestimate actual cost. Unverified model/speed combinations are unpriced, not guessed. Unknown cache-write TTL yields a range; that range does not bound the cost of unknown-speed requests. See [Fast mode evidence and limitations](docs/FAST_MODE.md) and [pricing assumptions](docs/PRICING.md).

## Commands

```text
/account-stats
/account-stats all
/account-stats 30d
/account-stats 7d
/account-stats quota
/account-stats weeks
/account-stats settings
/account-stats refresh
/account-stats close
```

These are function-hook commands; opening the panel does not request a model response.

## Develop and test

```sh
npm run check
npm test
npm run preview
```

No dependency install is needed for those commands. Open `preview/index.html` for the browser simulation, which uses fictitious data. Optional browser layout tests use Python Playwright and Chromium; see [validation](docs/VALIDATION.md).

Validate against your installed Claude Code build before distributing:

```sh
claude plugin validate --strict .
claude --plugin-dir .
```

The local checks and simulated host tests are not the official Claude loader or a real Desktop test. GitHub Actions runs source checks, Node tests and preview reproducibility on push/PR; no account credentials or Claude subscription are needed by that workflow.

## Repository structure

```text
.claude-plugin/
  marketplace.json        # Catalogue for installing from this Git repository
  plugin.json             # Mod identity, version and configuration
hooks/
  hooks.json              # Function-hook module declaration
  register.js             # Commands, lifecycle and sidebar rendering
lib/
  locales/                # Translation catalogues
  i18n.js                 # Language resolution / regional formatting
  pricing.js              # Dated model/speed price catalogue and estimates
  speed.js                # Response-only speed evidence and conflict handling
  speed-i18n.js           # Localized Fast/Standard/Unknown feature strings
  quota.js                # Weekly reset and DST handling
  usage.js                # Token normalization and aggregation
  view-model.js           # Filtered daily/weekly projections
  visuals.js              # SVG cards and charts
scanner/index.mjs         # Local Node.js transcript indexer
scripts/                  # Source validation and synthetic preview tools
tests/                    # Regression tests, synthetic fixtures and host harness
preview/                  # Preview application and generated standalone HTML
docs/                     # Architecture, pricing, publishing and validation
.github/workflows/ci.yml  # Source/test workflow
```

The marketplace entry uses `"source": "./"`: the plugin lives at the repository root. Claude's GitHub/Git marketplace source fetches this repository and resolves that path locally. Add **the repository**, not the `raw` URL of `marketplace.json`, because a JSON-URL marketplace alone cannot resolve relative plugin sources.[4]

## Publish and update

See [publishing instructions](docs/PUBLISHING.md) for creating the GitHub repository, testing a fresh install, migrating a manual installation and shipping updates.

After each code release, increase the `version` in `.claude-plugin/plugin.json` and `package.json`. Leave the marketplace entry without a duplicate version. Users can refresh this marketplace with:

```text
/plugin marketplace update account-stats-marketplace
/reload-plugins
```

Auto-update is enabled by the user from the marketplace's settings; it is not silently forced on by this repository.[5]

## Privacy and security

The scanner reads local JSONL transcripts and writes derived usage metadata to the local Claude configuration directory. The mod invokes Node and reads merged settings to obtain `language`; it retains only that language field. Its source makes no model calls, sends no prompts and performs no HTTP/telemetry calls. Installation and updates from GitHub still require Claude/Git's normal network access.

The persistent index does not retain prompt or response text. Do not commit real transcripts, cache files, exported usage reports, credentials or your personal `.claude` configuration; `.gitignore` excludes common accidental additions. A Git ignore file is a safeguard, not a security scanner.

Mods execute with the host user's permissions. Review the source and run the official plugin validator before enabling any mod.[3]

## License and validation status

MIT; see [LICENSE](LICENSE). Version 1.4.0 adds response-speed statistics, filtering and API-equivalent pricing. Existing preferences and the separate usage-history directory are retained; available logs receive one metadata-enrichment pass. See [executed checks and limitations](docs/VALIDATION.md). Local tests do not establish a real Desktop installation or a successful hosted CI run.

## Official references

[1]: https://code.claude.com/docs/en/plugins/install
[2]: https://code.claude.com/docs/en/desktop#install-plugins
[3]: https://code.claude.com/docs/en/plugins/mods/overview
[4]: https://code.claude.com/docs/en/plugins/marketplace-reference
[5]: https://code.claude.com/docs/en/plugins/host-marketplace

## Screenshots:
<img width="726" height="1009" alt="image" src="https://github.com/user-attachments/assets/0df87840-ff63-4172-993a-062cbafb73d8" />

weekly quota usage:
<img width="708" height="997" alt="image" src="https://github.com/user-attachments/assets/de3cafac-38ad-4506-8642-c7f17aee125a" />

