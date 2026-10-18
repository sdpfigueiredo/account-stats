# Changelog

## 1.4.0 — 2026-10-18 (prepared; not published)

- Detect response speed only from transcript `message.usage.speed`; separate Fast, Standard and Unknown. Missing evidence is not guessed from the model, current settings, effort, service tier or latency.
- Add a persisted speed filter and per-period/selected-interval request, token and API-cost breakdowns. Daily/weekly/model totals, pagination and CSV respect the same filter.
- Price confirmed Fast requests with explicit verified model tariffs, including cache reads and 5m/1h writes. Unknown speed retains a visibly labelled standard-equivalent assumption. Unverified Fast/model combinations remain unpriced.
- Enrich unchanged logs once using detail version 3; preserve archived history, all four token counters, TTLs and configurable weekly reset. Contradictory duplicate response speeds remain Unknown regardless of merge order.
- Localize new controls, summaries, warnings and pricing explanations in all seven catalogues, keeping explicit native margins and accessible SVG/terminal descriptions.
- Add parser, migration, pricing, filtering, deduplication, localization, privacy and browser regressions. No runtime dependencies, network/model calls or host API permissions added.

## 1.3.1 — 2026-10-17

- Prepared a single-plugin GitHub repository with the stable `account-stats-marketplace` catalogue and root-relative source.
- Added GitHub publishing / migration instructions, repository checks, source-only CI, Git attributes and privacy-oriented ignore rules.
- Made the optional browser-test executable portable (`CHROMIUM_PATH`, system Chromium, or Playwright-managed Chromium).
- Removed the legacy copy-all Windows installer and generated validation logs / screenshots from the Git source distribution.
- Kept runtime modules, translations, pricing catalogue, command names, persistent usage-index path and preference key unchanged from v1.3.0.
- No ZIP, npm publication or build is required for Git marketplace installation.

## 1.3.0 — 2026-10-17

The sidebar now follows the official merged Claude Code `language` setting via `$.settings.read()`. No independent language preference, OS/browser inference, conversation inspection, external translation, private Desktop settings or model call. Reads on startup/open/refresh and after configuration events. Unset or unsupported languages use explicit English fallback; temporary read failures preserve the last detected locale.

Seven complete message catalogues: English, Portuguese (Portugal/Brazil), Spanish, French, German and Italian. Regional formats follow accepted BCP 47 codes and known language-name aliases. Controls, card text, chart legends, errors, notices, diagnostics and accessible/terminal descriptions use the same per-render language. Dates, numbers, percentages and USD formatting are localized; USD, reset timezone, timestamps, counters, pricing catalogue, history and CSV machine formats remain unchanged. The public `language` setting is the Code response/dictation language; a separate Desktop UI locale is not a documented mod API.

Added conservative SVG text fitting, room for localized currency ticks, and a separate stable CSV quota-label formatter. The standalone preview adds a clearly labelled simulated host-language control. Existing native section spacing and all four category counters are preserved.

196 Node tests and 536 Chromium assertions passed, including live changes, effective-vs-proposed settings, privacy, inherited preferences, data/CSV invariance, eight regional formats, both themes, 390px width and large synthetic counts. No actual Claude Desktop or official loader validation was performed. No new install dependency or data migration from 1.2.0.


## 1.2.0 — 2026-10-16

Fixed missing vertical spacing in the native pane, especially below the selected quota. Each section now uses a non-shrinking host Box with an explicit top margin; the preview reflects these real layout props.

Added standard API-equivalent USD costs for the full period, selected day/quota and each model/category, plus daily/weekly USD charts and CSV cost columns. Bundled official pricing snapshot dated 2026-10-16; per-request Haiku 5.5 tiers, model-specific cache reads, 5m/1h writes, explicit missing-TTL intervals and unpriced/partial coverage. No model or network calls; not a subscription bill.

Preserves v1 history, preferences and reset settings. Existing source logs are automatically enriched with TTL metadata once; archived counters remain available. Added pricing/migration/export and native-spacing regressions. 145 Node tests and 53 browser checks passed. No real Claude Desktop or native Claude plugin validation was executed.

## 1.1.1 — 2026-10-16

Fixed the selected/current weekly quota card omitting uncached Input and Output counters. The card now shows a prominent all-category Total alongside a compact 2×2 breakdown: Cache read, Cache write, Input novo and Output, using the existing colors and both abbreviated and exact counts. Includes explicit zeros, model-filtered values, closed/current/partial-cycle states, and accessible/terminal text. The breakdown remains complete regardless of the chart metric.

No accounting change: the existing Total already included input and output. No scanner, storage format, reset settings or preference changes; existing indexes remain compatible without reindexing.

111 dependency-free Node tests and 34 browser checks passed, including card-specific regressions, every chart metric, model/weekly selection, zero and large synthetic counts, both themes, 390 px layout and SVG text overlap/bounds checks. Preview images and validation records updated. Real Claude Desktop / native plugin validation remains unexecuted in this environment.

## 1.1.0 — 2026-10-16

Added daily/weekly quota grouping, This quota quick filter, exact per-response reset boundaries, selected-cycle totals and model breakdown, 20-cycle history pages, zero-use cycles, explicit current/partial-cycle status, and weekly CSV exports with UTC/local boundaries and reset metadata. Reset weekday and HH:mm are configurable in the sidebar and persisted, defaulting to Thursday 20:00 in Europe/Lisbon. Added `/account-stats quota`, `weeks`, and `settings` command arguments.

DST-safe local reset resolution handles repeated/nonexistent times and avoids fixed-168-hour assumptions. Daily and weekly totals reconcile under all calendar filters. Legacy record caches and preferences are retained. Busy snapshots from another reset/scope are not reused. Future-dated records wait for their timestamp instead of entering the next quota early. Chart labels avoid collisions near the last bar.

96 dependency-free Node tests and 18 browser checks passed; source, documentation, updated fictitious-data preview and test records included. Real Claude Desktop / native plugin validation remains unexecuted in this environment.

## 1.0.0 — 2026-10-16

Initial implementation: custom SVG Desktop sidebar; All time/30d/7d calendar filters; model and day selection; distinct cache read/write/new input/output; inclusive zero-filled daily bars; daily/period model breakdown; 45-day All-time pages; exact numbers and CSV export; optional official account limits; light/dark themes; incremental local Node indexer; response deduplication; optional subagents; configurable timezone/roots/runtime; diagnostics and explicit incomplete/error states.

Source, documented install routes, Windows copy installer, standalone fictitious-data preview and 52 dependency-free tests included. Actual Claude Desktop validation is not claimed; see docs/VALIDATION.md.
