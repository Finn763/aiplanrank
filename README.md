<div align="center">

# aiplanrank
*Look before you sub — ¥10 = how many tokens.*
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square&labelColor=black)](LICENSE)

[中文](README.zh-CN.md) | English
</div>

> One table: theoretical tokens per ¥10 for every AI coding plan. Metered plans exact, request-based plans with open formula.

## How it runs
1. `plans.json` holds price + quota + formula.
2. `index.html` sorts by ¥10 tokens. No build.
3. Open `index.html` or enable Pages.

## What's inside
| file | fact |
|---|---|
| `plans.json` | 3 seed plans, each with formula + source |
| `index.html` | static rank, fetch + sort only |

<details><summary>Structure</summary>

```
plans.json
index.html
```
</details>

## Contributing
PRs with `source` link + formula. `*` = estimated.

## License
MIT.
