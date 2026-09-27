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
- **#2: Request plans hide tokens.** Coding Plans print requests, not tokens; real yield depends on model, multiplier, peak hours. **Fix:** open estimated conversion (`*` = estimated), assumption in the open, never a hidden number.
- **#3: Static tables rot.** Prices and multipliers change every few weeks. **Fix:** data lives in one `plans.json`; a PR with a source link updates the whole rank.
> Seed snapshot: ChatGPT Plus ~252亿*/$10 (GPT-5.5 ×105) vs MiniMax Max ~188亿* vs Claude Pro ~184亿* — same money. Formulas in `plans.json`, independent re-checks welcome.
---
## How it runs
Three files, no build, zero backend.
1. **Data** — `plans.json` holds price + quota + formula + source per plan.
2. **Rank** — `index.html` fetches it, sorts by flash-equiv tokens, renders one table.
3. **View** — open `index.html` locally or serve the folder; enable Pages for the public URL.
---
## What's inside
| Area | What's pinned down |
|---|---|
| Unit | Flash-equiv tokens per $10 (anchor deepseek-v4.1-flash @ $0.2262/1M blended 1:3) |
| Formula | Every row carries its conversion assumption — no black-box numbers |
| Source | Every row links its vendor page; PRs without a source link don't merge |
| Scope | AI coding subscriptions first (Coding / Token / Membership); IDE plans later |
---
**Repo layout**
```
plans.json   # price + quota + formula + source (the whole dataset)
index.html   # fetch + sort + render, no build step
```
## Contributing
PRs welcome: one row = price + quota + formula + source link. `*` marks anything estimated. Stale rows get fixed, not debated.
## License
[MIT](LICENSE)
*Sub after you see the number.*
