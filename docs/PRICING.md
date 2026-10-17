# API-equivalent token cost · price snapshot 2026-10-16

This is a local **standard Claude API token-cost comparison in USD**, not an account bill, a historical invoice, a subscription charge, or a quota percentage. Historical token records are valued at the bundled price snapshot, not at prices inferred for the day they were recorded. The calculator makes no model calls or HTTP requests.

## Official sources

Verified on 2026-10-16:

- Pricing, standard model rates and cache multipliers: https://platform.claude.com/docs/en/about-claude/pricing
- Haiku 5.5 request-length tiers: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- Cache usage semantics: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Sonnet 4.5 current published window: https://platform.claude.com/docs/en/models/sonnet-4-5/overview

The executable catalog is `lib/pricing.js` (`API_RATES`). It stores USD **per million tokens**, with explicit read prices. In particular, the current read rates are not uniformly 10% of input: Opus 5.5 uses $0.20/MTok, Sonnet 5.5 $0.10/MTok, and Fable/Mythos 5.1 $0.25/MTok. These prices are a dated snapshot, not a live price feed.

## Request calculation

After global response deduplication, but **before** daily or weekly aggregation:

```text
input_cost = uncached_input_tokens × input_rate / 1,000,000
output_cost = output_tokens × output_rate / 1,000,000
read_cost = cache_read_tokens × read_rate / 1,000,000
write_cost = (write_5m_tokens × write_5m_rate
            + write_1h_tokens × write_1h_rate) / 1,000,000
```

Cache writes use the separate 5-minute and 1-hour prices. The top-level `cache_creation_input_tokens` already contains both durations; the split is **not** added again to token totals. It is retained only to price the existing write total. Invalid/conflicting splits are treated as unknown, not allowed to create extra or negative tokens.

For Haiku 5.5, each response is evaluated against a 100,000-input-token threshold using **read + write + uncached input**. A larger prompt uses the higher tariff for all its token categories, including output. The calculator never applies the threshold to a daily total or a daily average.

Amounts are accumulated on a nanodollar grid while its integer units fit JavaScript's safe integer range; larger amounts fall back to finite double arithmetic. There is no per-request rounding to cents. Display formatting uses cents, four decimals for small costs, or `<$0.0001`; CSV stores nine decimal places. This is not an arbitrary-precision accounting ledger.

## Missing information is visible

When a write's TTL is absent, the calculator shows an interval: unknown write tokens priced at 5 minutes form the lower endpoint and at 1 hour form the upper endpoint. Known TTL portions keep their actual rates. The interval describes missing metadata, not statistical confidence or uncertainty in published prices. The USD chart uses a translucent segment for the difference.

Only explicit, verified model versions and known provider wrapper forms resolve to the catalog. Bare moving aliases such as `opus`, unknown models and unsupported variants do not inherit the price of a guessed model. Their tokens remain in all usage totals but are excluded from the **priced subtotal**. The cost card says `Sem preço` if nothing is priced, or flags a partial subtotal and missing token count. A question mark marks incomplete chart buckets. Diagnostics names affected model IDs. Legacy Sonnet 4/4.5 prompts above the currently verified 200k window are also excluded rather than assigned an unverified historical long-context beta tariff.

A model row lacking per-request-derived cost data is unpriced; a day is never treated as one giant request to fill the gap.

## Deliberate scope

The equivalent assumes standard synchronous first-party API token rates. It does **not** reproduce Fast mode premiums, Batch/contract discounts, region/data-residency supplements, partner cloud invoices, taxes, server-tool/search fees or non-token products. It is not a claim of subscription savings or of the exact amount a different provider would charge. Ordinary tool-related tokens already present in usage are included once; no extra estimated tool-token overhead is added.

## Upgrade and refresh

The cache directory and outer version remain `account-stats/v1`. Per-file records now have `detailVersion: 2`, with `write5m` and `write1h`. On the first scan after upgrading, extant older transcripts are read again incrementally to enrich retained records. Already-observed counters and pruned records are **not** discarded. An archived transcript with no recoverable TTL remains in the totals with an explicit cost interval.

Money is derived from retained numeric records at aggregation time, not persisted into every response. Snapshots carry `pricing.version`, `pricing.asOf`, currency and basis. A busy snapshot made with another price edition is rejected. Replacing the catalog requires changing `PRICING_VERSION`, rebuilding the preview, running the tests and reloading the plugin. This version does not fetch or scrape prices at runtime.

## UI and export

The period card is independent of graph pagination. The selected day/quota has its own cost card, and each model shows both token counts and category costs. Selecting a token metric does not remove input/output or monetary totals. The new chart mode is `Custo equivalente API · USD`.

Existing CSV columns are retained, with appended columns for status, USD, price date, total lower/upper bounds, read, write lower/upper bounds, input, output, priced/unpriced token counts and unknown-TTL write tokens. `unavailable` rows use **blank monetary cells**, not a misleading zero. `partial` rows contain only their explicitly marked priced subtotal.
