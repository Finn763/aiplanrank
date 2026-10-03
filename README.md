# aiplanrank
*Look before you sub — $10 = how many flash tokens.*
[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950?style=flat-square&labelColor=black)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Finn763/aiplanrank?style=flat-square&logo=github&labelColor=black)](https://github.com/Finn763/aiplanrank/stargazers)
[中文](README.zh-CN.md) | English

> Every plan quotes a different unit, and different models' tokens aren't worth the same. aiplanrank converts them to one: deepseek-flash-equivalent tokens per $10.
Requests, prompts, credits, AFP — vendors never speak the same unit, and request-based plans never print token counts at all. aiplanrank normalizes every AI coding subscription to a single comparable number, each with its formula and source beside it.
---
## Why aiplanrank exists
Built to fix three failure modes every subscription buyer has met:
- **#1: Units don't compare.** 18,000 requests vs $60 credits vs 100,000 AFP — no common denominator. **Fix:** one number per plan (flash-equiv tokens per $10, flagship-model priced), formula shown.
- **#2: Request plans hide tokens.** Coding Plans print requests, not tokens; real yield depends on model, multiplier, peak hours. **Fix:** open estimated conversion (estimates carry a derived assumption count), assumption in the open, never a hidden number.
- **#3: Static tables rot.** Prices and multipliers change every few weeks. **Fix:** data lives in one `plans.json`; a PR with a source link updates the whole rank.
> Seed snapshot (per $10, off-peak; ranked by the **lower bound** of a dual-axis interval — in:out mix × tokens/request): 腾讯云 TokenHub Pro 5,737万 `官方直算` > 腾讯云 Max 5,717万 > 腾讯云 Standard 5,664万 > 腾讯云 Lite 5,291万 > 火山 Lite/Pro 3,240万 (request-based, 1 assumption) > OpenCode Go 2,700万 (its multiple is pinned at **1.500×** whatever your usage). The top four are all Tencent and within 7.8% of each other, so their order carries no decision weight. On the pessimistic corner both Tencent (0.797×) and 火山 (0.450×) fall **below 1.0×** versus simply paying for the API. 阿里百炼 & Atlas Cloud stay 待查 rather than guessed. Anchor price and every assumption are recomputable from `plans.json`.
---
## How it runs
Four files, no build, zero backend.
1. **Data** — `plans.json` holds the scenario (anchor price in official CNY primitives, `fx`, mix bounds, cache-hit rate) plus each plan's own price/quota/assumption primitives — never a `per10`.
2. **Rank** — `index.html` carries the data inline (so it opens from `file://`), ranks every plan by the **lower bound** of a dual-axis interval (in:out mix × tokens/request) and renders a 10-column table whose first row is a synthetic "pay the API directly" baseline.
3. **View** — open `index.html` locally or serve the folder; enable Pages for the public URL.
---
## What's inside
| Area | What's pinned down |
|---|---|
| Unit | Flash-equiv tokens per $10 (anchor `deepseek-flash` / DeepSeek-V4.1-Flash, official ¥1 in / ¥4 out per 1M off-peak, cache-miss basis, ¥7.2 = $1) |
| Ranked vs held | A plan ranks only with a published price + quota; unpublished credit coefficients stay 待查, never guessed |
| Formula | Every row carries its assumptions and a derived assumption count (`0` = 官方直算); `per10` is never stored — the page and the test run the same extracted code |
| Source | Every row links its vendor page and states its own `verified` date; PRs without a source link don't merge |
| Scope | Only plans officially shipping deepseek-v4.1-flash (single-vendor plans excluded) |
| Assumptions | Envelope quantities must give `low/base/high`; anything without a published source must say `"source": null` explicitly — no blanks, no guesses |
---
**Repo layout**
```
plans.json     # scenario (anchor price, fx, bounds) + plan primitives — no per10
index.html     # FORMULA block + render; data inlined (works from file://)
test_data.js   # extracts the FORMULA block, checks sync + regression anchors
.github/workflows/check.yml
```
## Contributing
PRs welcome: one row = price + quota + assumptions + source link. Estimates carry their derived assumption count (`N 个假设`); `官方直算` means zero assumptions. Stale rows get fixed, not debated. New rows must state their assumptions; ranking by the interval's lower bound may place your row below a plan with a tighter interval — that is the intended behaviour.
## How to recompute

```bash
# 1. verify the page, the data and the formula agree (includes regression anchors)
node test_data.js

# 2. print the whole rank using the very code the page runs
node -e "const fs=require('fs'),h=fs.readFileSync('index.html','utf8'),m=h.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);const F=new Function(m[1]+';return {rank,rowStats,baselinePer10,fmtTokens,fmtMultiple};')();const d=require('./plans.json');console.log('baseline',F.fmtTokens(F.baselinePer10(d.scenario,d.scenario.baseline_mix.in_out)));F.rank(d.plans,d.scenario).forEach(r=>console.log(r.id,r.status,F.fmtTokens(r.per10.low),r.status==='ranked'?F.fmtMultiple(r.multiple.low)+' – '+F.fmtMultiple(r.multiple.high):r.reason,r.count));"
```
## License
[MIT](LICENSE)
*Sub after you see the number.*
