# Fast mode statistics

## Evidence, not inference

The documented API response field is `usage.speed`, either `"fast"` or `"standard"`. In Claude Code assistant JSONL records it is read at `message.usage.speed`. A recorded response is **Fast** only with an explicit `"fast"` value and **Standard** only with an explicit `"standard"` value. Missing, null, unrecognised or contradictory values are **Unknown**.

The current Fast toggle, requested `speed`, session settings, `service_tier`, effort level, model name, elapsed time and output tokens per second are deliberately ignored. They do not establish which mode actually served a response. No telemetry endpoint, credentials or assistant text are consulted.

Repeated blocks/fork copies of one response are globally deduplicated before classification and pricing. A later copy may fill missing metadata. Conflicting known values set a sticky `speedConflict` flag and remain Unknown, regardless of file order. Token counters still merge cumulatively, rather than being summed twice. Requests in this panel are deduplicated recorded responses, not HTTP attempts, failed retries or user turns.

## Interface

The **Request speed** selector has All speeds, Fast, Standard and Unknown. It is a local presentation filter, persisted with existing preferences. It applies to model totals, day/week bars, selected intervals, API equivalents and CSV. Switching it does not rescan transcripts or send a model request.

A **Request speed** card for the full period and the selected day/quota shows each mode's request count, total tokens and API-equivalent cost. Confirmed-mode coverage is shown as known requests / total requests; Unknown is never included in the Standard count. All four token categories remain separately visible in the existing cards. The monetary estimate is not a weekly quota percentage and does not establish subscription billing.

All seven language catalogues and both themes use the same data. Changes to language, weekly reset or chart metric do not change the request's recorded speed.

## Price snapshot: 2026-10-18

USD per million tokens, current first-party API equivalent:

| Model | Fast input | Fast output | Fast cache read | Fast cache write 5m | Fast cache write 1h |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 | 8 | 40 | 0.40 | 10 | 16 |
| Claude Opus 5 | 10 | 50 | 1 | 12.50 | 20 |
| Claude Opus 4.8 | 10 | 50 | 1 | 12.50 | 20 |

Pricing is applied per deduplicated response, before aggregation. Cache creation TTL uncertainty remains a 5-minute/1-hour interval at the applicable speed's rates. This is a **current price comparison** applied to the local history, not a reconstruction of prices charged on historical dates.

Unknown speed is valued at standard rates to preserve the previous comparison, **with an explicit warning and `assumedStandardTokens` / `assumedStandardRequests` counters**. This assumption can underestimate actual cost; a narrow TTL interval is not a bound on unknown-speed cost. Unsupported Fast/model pairs (including older models without a current verified Fast tariff) remain unpriced and are excluded from the priced subtotal, not guessed at a universal multiplier. No region, tax, Batch, contract or tool-fee modifiers are inferred.

## Safe upgrade

The index remains in `account-stats/v1`; its outer version remains 1. `detailVersion: 3` triggers a one-time incremental reread of existing files, including unchanged files, to recover response speed. Full transcript bytes remain read-only. Archived records and all token/TTL counters survive. Deleted transcripts with no cached speed cannot be recovered: they stay Unknown. Partial or locked scans retain the existing warnings/retry behavior; a snapshot using an old pricing version cannot masquerade as a current snapshot.

The per-response cache adds only an allowlisted speed enum and an optional boolean conflict flag. It does not store prompts, responses, credentials, raw HTTP headers or computed money. Costs and disjoint speed subtotals are derived when producing a snapshot.

CSV keeps its pre-existing columns in order and appends explicit assumption counters and request/token/cost columns prefixed `fast_`, `standard_` and `unknown_`. Each prefix includes cache read, cache write, uncached input, output and total. Unknown is machine-readable, not silently encoded as Standard. Unavailable prices stay blank instead of misleading zero-dollar amounts.

## Sources

Verified 2026-10-18:

- Response `usage.speed`, supported Fast models, tariffs and cache modifiers: https://platform.claude.com/docs/en/build-with-claude/fast-mode
- Standard pricing and model-specific cache-read multipliers: https://platform.claude.com/docs/en/about-claude/pricing
- Claude Code Fast mode and its plan/usage-credit distinction: https://code.claude.com/docs/en/fast-mode

## Validation scope

Run `npm run check`, `npm run check:repository`, `npm test`, `npm run preview`, and optionally `python scripts/test-preview.py` with Playwright/Chromium available. The browser uses fictitious fixtures and the real mod rendering/hooks; it is not Claude Desktop. No live paid requests are made. Actual Desktop and official-loader validation remain a maintainer check.
