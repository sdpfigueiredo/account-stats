# Validation record · v1.4.0 · 2026-10-18

## Checks executed for response-speed statistics

Executed locally on Linux with Node.js 22.16.0 and Chromium via Python Playwright, using synthetic records rather than the user's transcripts.

- `npm test`: **262 tests passed**, zero failed, skipped or cancelled tests (66 added to the previous 196).
- `npm run check` and `npm run check:repository`: source syntax, manifest versions, relative imports, scanner relocation and repository checks passed. These are not the official Claude validator.
- `npm run preview`: regenerated the standalone fictitious-data preview from the actual hooks and SVG modules.
- `python scripts/test-preview.py`: **1128 assertions passed**, with no page errors, external requests, measured SVG collisions/bounds violations or native-section spacing violations.
- Fast/Standard/Unknown filtering is exercised across date ranges, day/week grouping, model filters, selected buckets, CSV and persisted preferences.
- Tests cover cumulative-response deduplication, conflicting/absent metadata, ignored request intent, model-specific Fast pricing, unknown-speed assumptions, cache TTL ranges, metadata enrichment and deleted-log retention.

The source baseline was verified against upstream commit `47270cd2d9de294bccdf90c7254a7a916d58728b` (tree `b866f0f3cfc0de22a448a6b5cbf268c51e63b22b`), including the user's README screenshots. No real Claude Desktop execution, official loader validation, paid API call or hosted GitHub CI run is claimed for this feature.

## Additional first-run checks

After updating through the marketplace, let the one-time metadata scan finish. Confirm that the **Request speed** selector and both speed cards follow the Code language. Confirm per-mode counts sum to the unfiltered request count, all four token categories are retained, and missing response speed is **Unknown**, not Standard. Unknown-speed cost must show the standard-price assumption. Read-only logs, previous reset settings and history should remain intact. Older logs without response speed cannot retrospectively establish Fast usage.

---

# Historical validation record · v1.3.1 · 2026-10-17

This release changes repository distribution, not the v1.3.0 hook, scanner, translation or calculation code. The price catalogue is unchanged.

## Checks executed for this distribution

Executed on Linux with Node.js 22.16.0, Git 2.47.3 and Chromium via Python Playwright. Tests use synthetic data, not the user's account or local logs.

- `npm test`: **196 tests passed**, no failed or skipped tests.
- `npm run check`: source syntax, manifest identities, version agreement, root-relative imports and installed scanner path checks passed.
- `npm run preview`: generated the exact same standalone HTML bytes as v1.3.0.
- `python scripts/test-preview.py`: **536 assertions passed**; no page errors, external requests, measured SVG collisions/bounds violations or native-section spacing violations.
- Compared all **16 runtime files** under `hooks/`, `lib/` and `scanner/` byte-for-byte with the v1.3.0 source: unchanged.
- Applied the complete plain-text Git patch to a fresh empty repository, compared all resulting source bytes with the distribution and repeated the source checks and 196 tests from that relocated copy. This tests source delivery and relocation, not Claude's cache loader.

The repository's GitHub Actions workflow is supplied for future pushes; these local executions do not claim a hosted workflow run.

## Maintainer commands

```sh
npm run check
npm test
npm run preview
claude plugin validate --strict .
```

`npm run check` validates JavaScript syntax, local manifests, root-relative imports and scanner relocation. It is deliberately **not** named official Claude validation. `npm test` runs the Node regression tests with a simulated host. `npm run preview` regenerates the standalone HTML from the real SVG/hook code with synthetic fixtures.

Optional browser layout tests require Python Playwright and Chromium. Set `CHROMIUM_PATH` to an explicit executable, use a discovered system Chromium, or install Playwright-managed Chromium:

```sh
python scripts/test-preview.py
```

## Not executed or claimed

- Real Claude Desktop installation, the native pane and official `claude plugin validate` / `claude plugin test`.
- GitHub publication, an actual GitHub marketplace install, private-repository authentication or the hosted CI workflow.
- Native Windows execution or real subscription/billing verification.

A local file check, a relocated source test and a patch round-trip do not prove the real Claude loader accepted the plugin. Run the official validator and first-install checklist on the target build before treating it as host-validated.

## First install checklist

Close the existing panel, disable the previous installation or move it out of `skills/`, and install through the GitHub marketplace. Do not delete the separate `account-stats/v1` data directory. Open `/account-stats weeks`, verify the detected language and reset settings, all four token categories, readable card spacing and cost estimates. Check the locally retained preferences after changing installation origin. Export a synthetic or redacted CSV only; never add real usage exports to the source repository.
