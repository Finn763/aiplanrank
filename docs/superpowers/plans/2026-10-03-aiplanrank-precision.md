# aiplanrank 精度与可验证性打底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `plans.json` 只存原语、页面上的每个数字都由同一份公式算出且可独立复算，并在 CI 里拦住算错的改动。

**Architecture:** 数据层（`plans.json` = `{scenario, plans}`，14 行原语，无 `per10`）→ 公式层（`index.html` 内 `/* FORMULA:START */` 与 `/* FORMULA:END */` 之间的纯函数，不碰 DOM，日期由参数注入）→ 呈现层（同一 script 块内读取公式输出拼表格）。`test_data.js` **从 `index.html` 原文抽取公式块**并用 `new Function` 执行，因此测的就是页面跑的代码；深度相等断言把内联数据钉在 `plans.json` 上。零依赖、零构建、`file://` 可直开。

**Tech Stack:** 纯 HTML/CSS/ES5 风格 JS（无框架、无打包）、Node.js（仅用内置 `fs`/`path`，无 npm 依赖）、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-03-aiplanrank-precision-design.md`

## Global Constraints

- 零依赖、零构建：不得引入 `package.json`、npm 包、打包器或 CDN 资源。
- `index.html` 必须保持 `fetch(`-free 且能从 `file://` 直接打开。
- `per10` / `per10_peak` **不得**作为字段出现在 `plans.json` 中；它们只能是函数输出。
- 公式必须完整地夹在 `/* FORMULA:START */` 与 `/* FORMULA:END */` 之间，且该块内**不得**出现 `document`、`window`、`Date.now()`、`new Date()`。
- 内联数据必须是单行：`const SCENARIO = <一行 JSON>;` 与 `const PLANS = <一行 JSON>;`（测试用行正则抽取）。
- 锚价用**人民币原语**：输入（缓存未命中）空闲 ¥1 / 高峰 ¥2、输入（缓存命中）¥0.02 / ¥0.04、输出 ¥4 / ¥8，单位均为 1M tokens；`scenario.fx.rate = 7.2`，同时作用于锚价与人民币套餐价。
- 人民币行只写 `price.cny`，不得同时落盘 `price.usd`（美元值一律由 `fx` 派生）。
- 无出处的假设必须**显式**写 `"source": null`。
- UI 文案用简体中文；`README.md` 与 `README.zh-CN.md` 两份必须同步修改。
- 测试命令固定为 `node test_data.js`，失败必须 `process.exit(1)`。

---

### Task 1: `plans.json` 原语化

**Files:**
- Modify: `plans.json`（整体替换）
- Create: `test_data.js`（本任务只放数据层断言，后续任务继续追加）

**Interfaces:**
- Consumes: 无（起点）
- Produces: `plans.json` 的顶层形状 `{ scenario, plans }`；`scenario` 含 `label` / `baseline_mix` / `mix_bounds` / `cache_hit_rate` / `anchor` / `peak_multiplier` / `fx`；每行含 `id` / `vendor` / `name` / `price{cny|usd, text, basis, promo_until}` / `quota{amount, unit, window, sub_limit, shared}` / `assumptions` / `verified{date, sources[]}` / `note`。`quota.unit` 取自 `token|request|credit|usd_credit`。

- [ ] **Step 1: 写失败的数据层测试**

创建 `test_data.js`：

```js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const plansText = fs.readFileSync(path.join(root, 'plans.json'), 'utf8');
const plansDoc = JSON.parse(plansText);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('ok: ' + msg); }
  else { failed++; console.error('FAIL: ' + msg); }
}

const UNITS = ['token', 'request', 'credit', 'usd_credit'];
const ASSUMPTION_KEYS = ['tokens_per_request', 'credits_per_1m', 'tokens_per_credit'];

// --- 数据层 ---
assert(!Array.isArray(plansDoc), 'assert0: plans.json is an object, not a bare array');
assert(plansDoc.scenario && typeof plansDoc.scenario === 'object', 'assert0b: scenario block exists');
assert(Array.isArray(plansDoc.plans) && plansDoc.plans.length === 14, 'assert0c: 14 plan rows');

const sc = plansDoc.scenario || {};
assert(!!sc.anchor && sc.anchor.model === 'deepseek-flash', 'assert0d: anchor model is deepseek-flash');
assert(!!sc.anchor && sc.anchor.source.indexOf('api-docs.deepseek.com') >= 0, 'assert0e: anchor price cites the official page');
assert(!!sc.fx && sc.fx.rate === 7.2, 'assert0f: fx.rate is 7.2');
assert(!!sc.baseline_mix && Array.isArray(sc.baseline_mix.in_out), 'assert0g: baseline mix declared');
assert(!!sc.mix_bounds && !!sc.mix_bounds.pessimistic && !!sc.mix_bounds.optimistic, 'assert0h: mix bounds declared');

const unitBad = (plansDoc.plans || []).filter(function (p) { return UNITS.indexOf(p.quota.unit) < 0; });
assert(unitBad.length === 0, 'assert0i: every quota.unit is one of ' + UNITS.join('/'));

const bothPriced = (plansDoc.plans || []).filter(function (p) {
  return p.price.cny !== null && p.price.cny !== undefined && p.price.usd !== null && p.price.usd !== undefined;
});
assert(bothPriced.length === 0, 'assert0j: no row stores both price.cny and price.usd');

const missingSourceKey = [];
(plansDoc.plans || []).forEach(function (p) {
  ASSUMPTION_KEYS.forEach(function (k) {
    const a = p.assumptions[k];
    if (a && !('source' in a)) missingSourceKey.push(p.id + '.' + k);
  });
});
assert(missingSourceKey.length === 0, 'assert0k: every assumption states source explicitly (missing: ' + missingSourceKey.join(',') + ')');

assert(!/per10/.test(plansText), 'assert2: plans.json contains no per10 field');

if (failed) { console.error('\n' + failed + ' assertion(s) failed'); process.exit(1); }
console.log('\nall data-layer assertions passed');
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node test_data.js`
Expected: FAIL，`assert0: plans.json is an object, not a bare array`（当前 `plans.json` 是数组），退出码非 0。

- [ ] **Step 3: 整体替换 `plans.json`**

写入以下内容（14 行；保留全部既有 id、厂商、价格与额度语义）：

```json
{
  "scenario": {
    "label": "谷时 · 无缓存 · 假设混合比 1:3",
    "baseline_mix": { "in_out": [1, 3], "source": null },
    "mix_bounds": { "pessimistic": [0, 1], "optimistic": [1, 0] },
    "cache_hit_rate": {
      "value": 0,
      "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
    },
    "anchor": {
      "model": "deepseek-flash",
      "version": "DeepSeek-V4.1-Flash",
      "price_cny_per_1m": {
        "input_cache_miss": { "off_peak": 1.0, "peak": 2.0 },
        "input_cache_hit": { "off_peak": 0.02, "peak": 0.04 },
        "output": { "off_peak": 4.0, "peak": 8.0 }
      },
      "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
    },
    "peak_multiplier": 2,
    "fx": { "rate": 7.2, "as_of": "2026-10-03", "convention": "固定折算，不计汇率浮动" }
  },
  "plans": [
    {
      "id": "volc-lite",
      "vendor": "火山方舟",
      "name": "Coding Plan Lite",
      "price": { "cny": 40, "text": "¥40/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 18000, "unit": "request", "window": "month", "sub_limit": "1200/5h", "shared": true },
      "assumptions": {
        "tokens_per_request": { "low": 1000, "base": 4625, "high": 20000, "source": null }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://ai.volcengine.com/activity/codingplan"] },
      "note": "全模型共享额度"
    },
    {
      "id": "volc-pro",
      "vendor": "火山方舟",
      "name": "Coding Plan Pro",
      "price": { "cny": 200, "text": "¥200/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 90000, "unit": "request", "window": "month", "sub_limit": "6000/5h", "shared": true },
      "assumptions": {
        "tokens_per_request": { "low": 1000, "base": 4625, "high": 20000, "source": null }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://ai.volcengine.com/activity/codingplan"] },
      "note": "全模型共享额度"
    },
    {
      "id": "tc-max",
      "vendor": "腾讯云 TokenHub",
      "name": "Token Plan Max",
      "price": { "usd": 103, "text": "$103/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 15900, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": {
        "credits_per_1m": { "base": 27, "peak": 55, "source": "https://www.tencentcloud.com/document/product/1300/81316" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.tencentcloud.com/document/product/1300/81316"] },
      "note": "V4.1 Flash 原厂直供；官方综合单价的混合比口径未公开"
    },
    {
      "id": "tc-pro",
      "vendor": "腾讯云 TokenHub",
      "name": "Token Plan Pro",
      "price": { "usd": 51, "text": "$51/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 7900, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": {
        "credits_per_1m": { "base": 27, "peak": 55, "source": "https://www.tencentcloud.com/document/product/1300/81316" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.tencentcloud.com/document/product/1300/81316"] },
      "note": "官方综合单价的混合比口径未公开"
    },
    {
      "id": "tc-standard",
      "vendor": "腾讯云 TokenHub",
      "name": "Token Plan Standard",
      "price": { "usd": 17, "text": "$17/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 2600, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": {
        "credits_per_1m": { "base": 27, "peak": 55, "source": "https://www.tencentcloud.com/document/product/1300/81316" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.tencentcloud.com/document/product/1300/81316"] },
      "note": "官方综合单价的混合比口径未公开"
    },
    {
      "id": "tc-lite",
      "vendor": "腾讯云 TokenHub",
      "name": "Token Plan Lite",
      "price": { "usd": 7, "text": "$7/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 1000, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": {
        "credits_per_1m": { "base": 27, "peak": 55, "source": "https://www.tencentcloud.com/document/product/1300/81316" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.tencentcloud.com/document/product/1300/81316"] },
      "note": "官方综合单价的混合比口径未公开"
    },
    {
      "id": "opencode-go",
      "vendor": "OpenCode",
      "name": "Go",
      "price": { "usd": 10, "text": "$10/月", "basis": "monthly", "promo_until": "2026-09-27" },
      "quota": { "amount": 15, "unit": "usd_credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": {},
      "verified": { "date": "2026-09-27", "sources": ["https://opencode.ai/docs/zh-cn/go/"] },
      "note": "促销期 4x=$60 已于 2026-09-27 结束；本行按非促销额度 $15 计算"
    },
    {
      "id": "ali-lite",
      "vendor": "阿里云百炼",
      "name": "Token Plan Lite",
      "price": { "cny": 39, "text": "¥39/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 11500, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": { "credits_per_1m": null },
      "verified": { "date": "2026-09-27", "sources": ["https://help.aliyun.com/zh/model-studio/token-plan-personal-overview"] },
      "note": "22:00-08:00 五折；flash 档位抵扣系数官方未公开"
    },
    {
      "id": "ali-essential",
      "vendor": "阿里云百炼",
      "name": "Token Plan Essential",
      "price": { "cny": 79, "text": "¥79/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 25500, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": { "credits_per_1m": null },
      "verified": { "date": "2026-09-27", "sources": ["https://help.aliyun.com/zh/model-studio/token-plan-personal-overview"] },
      "note": "Credits 抵扣系数官方未公开"
    },
    {
      "id": "ali-standard",
      "vendor": "阿里云百炼",
      "name": "Token Plan Standard",
      "price": { "cny": 139, "text": "¥139/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 45000, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": { "credits_per_1m": null },
      "verified": { "date": "2026-09-27", "sources": ["https://help.aliyun.com/zh/model-studio/token-plan-personal-overview"] },
      "note": "Credits 抵扣系数官方未公开"
    },
    {
      "id": "ali-pro",
      "vendor": "阿里云百炼",
      "name": "Token Plan Pro",
      "price": { "cny": 499, "text": "¥499/月", "basis": "monthly", "promo_until": null },
      "quota": { "amount": 180000, "unit": "credit", "window": "month", "sub_limit": null, "shared": false },
      "assumptions": { "credits_per_1m": null },
      "verified": { "date": "2026-09-27", "sources": ["https://help.aliyun.com/zh/model-studio/token-plan-personal-overview"] },
      "note": "Credits 抵扣系数官方未公开"
    },
    {
      "id": "atlas-starter",
      "vendor": "Atlas Cloud",
      "name": "Coding Plan Starter",
      "price": { "usd": null, "text": "价格需登录", "basis": null, "promo_until": null },
      "quota": { "amount": 16500000, "unit": "credit", "window": "week", "sub_limit": null, "shared": false },
      "assumptions": {
        "tokens_per_credit": { "base": 0.55, "source": "https://www.atlascloud.ai/zh/coding-plan" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.atlascloud.ai/zh/coding-plan"] },
      "note": "官方倍率 flash 0.73入/2.18出；1积分≈0.55 flash tokens；套餐价 JS 渲染未取到"
    },
    {
      "id": "atlas-plus",
      "vendor": "Atlas Cloud",
      "name": "Coding Plan Plus",
      "price": { "usd": null, "text": "价格需登录", "basis": null, "promo_until": null },
      "quota": { "amount": 82500000, "unit": "credit", "window": "week", "sub_limit": null, "shared": false },
      "assumptions": {
        "tokens_per_credit": { "base": 0.55, "source": "https://www.atlascloud.ai/zh/coding-plan" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.atlascloud.ai/zh/coding-plan"] },
      "note": "官方倍率 flash 0.73入/2.18出；1积分≈0.55 flash tokens；套餐价 JS 渲染未取到"
    },
    {
      "id": "atlas-ultra",
      "vendor": "Atlas Cloud",
      "name": "Coding Plan Ultra",
      "price": { "usd": null, "text": "价格需登录", "basis": null, "promo_until": null },
      "quota": { "amount": 330000000, "unit": "credit", "window": "week", "sub_limit": null, "shared": false },
      "assumptions": {
        "tokens_per_credit": { "base": 0.55, "source": "https://www.atlascloud.ai/zh/coding-plan" }
      },
      "verified": { "date": "2026-09-27", "sources": ["https://www.atlascloud.ai/zh/coding-plan"] },
      "note": "官方倍率 flash 0.73入/2.18出；1积分≈0.55 flash tokens；套餐价 JS 渲染未取到"
    }
  ]
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node test_data.js`
Expected: 全部 `ok:`，最后 `all data-layer assertions passed`，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add plans.json test_data.js
git commit -m "data: plans.json becomes {scenario, plans} primitives only

- anchor price stored as official CNY primitives (¥1 in / ¥4 out, cache-miss
  off-peak) instead of being used as USD; fx 7.2 now applies to both sides
- cache-hit input price and peak prices recorded; peak_multiplier 2
- 14 rows reduced to primitives; per10 and per10_peak deleted
- two-axis bounds declared (mix bounds physical, tokens/request envelope)
- test_data.js starts with data-layer assertions"
```

---

### Task 2: FORMULA 纯函数块 + 抽取执行 + 单实现收口

**Files:**
- Modify: `index.html`（新增 FORMULA 块与内联数据；本任务暂不改渲染）
- Modify: `test_data.js`（追加公式层断言）
- Delete: `test_data.py`

**Interfaces:**
- Consumes: Task 1 的 `plans.json` 形状
- Produces: `FORMULA` 对象，导出
  `{ fxRate, effInputCny, blendCny, baselinePer10, priceUsd, corners, planTokens, per10Of, anchorAt, planTokensPeak, per10Peak, status, pendingReason, assumptionCount, isEstimated, rowStats, rank, trimNum, fmtTokens, fmtMultiple, fmtRange, badgeText, isPromoExpired, isStale }`；
  其中 `rowStats(plan, scenario)` 返回 `{ id, status, reason?, per10:{low,base,high}, multiple:{low,high}, count }`，`rank(plans, scenario)` 返回按 `per10.low` 降序、待查在末尾的有序数组（已排行行带 `rank` 字段）。`baselinePer10(scenario, mix)` 返回 tokens/$10。

- [ ] **Step 1: 写失败的公式层测试**

在 `test_data.js` 的 `const html = ...` 之后、`let failed = 0;` 之前插入公式抽取，并在文件末尾 `if (failed)` 之前追加断言：

```js
const formulaMatch = html.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);
if (!formulaMatch) { console.error('FAIL: index.html has no FORMULA block'); process.exit(1); }
const FORMULA = new Function(
  formulaMatch[1] +
  '; return { fxRate, effInputCny, blendCny, baselinePer10, priceUsd, corners, planTokens, per10Of,' +
  ' anchorAt, planTokensPeak, per10Peak, status, pendingReason, assumptionCount, isEstimated,' +
  ' rowStats, rank, trimNum, fmtTokens, fmtMultiple, fmtRange, badgeText, isPromoExpired, isStale };'
)();
```

```js
// --- 公式层 ---
const scInline = JSON.parse(html.match(/^const SCENARIO = (.*);$/m)[1]);
const plInline = JSON.parse(html.match(/^const PLANS = (.*);$/m)[1]);
assert(JSON.stringify(scInline) === JSON.stringify(plansDoc.scenario), 'assert1a: inline SCENARIO matches plans.json');
assert(JSON.stringify(plInline) === JSON.stringify(plansDoc.plans), 'assert1b: inline PLANS matches plans.json');

const S = plansDoc.scenario;
const byId = function (id) { return plansDoc.plans.filter(function (p) { return p.id === id; })[0]; };
const stats = {};
plansDoc.plans.forEach(function (p) { stats[p.id] = FORMULA.rowStats(p, S); });

const order = FORMULA.rank(plansDoc.plans, S);
let prev = Infinity, okMonotone = true, okBounds = true, okPendingLast = true, seenPending = false;
order.forEach(function (r) {
  if (r.status === 'pending') { seenPending = true; return; }
  if (seenPending) okPendingLast = false;
  if (!(r.per10.low <= r.per10.base && r.per10.base <= r.per10.high)) okBounds = false;
  if (r.per10.low > prev) okMonotone = false;
  prev = r.per10.low;
});
assert(okBounds, 'assert3a: low <= base <= high for every ranked row');
assert(okMonotone, 'assert3b: per10.low is non-increasing');
assert(okPendingLast, 'assert3c: pending rows come last');

const oc = stats['opencode-go'];
assert(oc.multiple.low === 1.5 && oc.multiple.high === 1.5, 'assert4a: OpenCode multiple is exactly 1.5 at both ends');
assert(stats['tc-max'].per10.base === 57173679, 'assert4b: tc-max per10 base === 57173679');
assert(stats['volc-lite'].per10.low === 32400000, 'assert4c: volc-lite per10 low === 32400000');
assert(Math.round(FORMULA.baselinePer10(S, S.baseline_mix.in_out)) === 22153846, 'assert4d: baseline(1:3) === 22153846');
assert(Math.round(FORMULA.per10Peak(byId('tc-max'), S)) === 28067079, 'assert4e: tc-max peak === 28067079');
assert(stats['volc-lite'].per10.base === 149850000, 'assert4f: volc-lite per10 base === 149850000');
const rankOf = {};
order.forEach(function (r) { rankOf[r.id] = r.rank; });
assert(rankOf['volc-lite'] === rankOf['volc-pro'], 'assert4g: volc-lite and volc-pro share a rank');
assert(order[0].id === 'tc-pro', 'assert4h: rank 1 is tc-pro');
// 火山 Lite 与 Pro 并列第 5，占掉两个位次，因此下一个名次是 7（竞赛式排名）
assert(rankOf['opencode-go'] === 7 && rankOf['ali-lite'] === undefined, 'assert4i: opencode-go is 7th, pending rows have no rank');

assert(stats['tc-max'].count === 0, 'assert5a: tc-max carries 0 assumptions');
assert(oc.count === 1, 'assert5b: opencode-go carries 1 assumption (anchor path)');
assert(stats['volc-lite'].count === 1, 'assert5c: volc-lite carries 1 assumption (tokens/request)');
assert(stats['ali-lite'].count === null && stats['ali-lite'].reason === '缺 credits_per_1m 官方出处', 'assert5d: ali-lite pending reason');
assert(stats['atlas-starter'].count === null && stats['atlas-starter'].reason === '缺 price.usd（价格需登录）', 'assert5e: atlas pending reason');
assert(FORMULA.badgeText(0) === '官方直算' && FORMULA.badgeText(1) === '1 个假设' && FORMULA.badgeText(null) === '待查', 'assert5f: badge text derives from count');

assert(FORMULA.fmtTokens(32400000) === '3,240万', 'assert8e: token formatting');
assert(FORMULA.fmtTokens(22153846) === '2,215万', 'assert8f: baseline formatting');
assert(FORMULA.fmtTokens(149850000) === '1.5亿', 'assert8g: 亿 formatting');
assert(FORMULA.fmtMultiple(1.5) === '1.5×' && FORMULA.fmtMultiple(3.176) === '3.176×', 'assert8h: multiple formatting');
```

> `rowStats` 返回的 `per10` 一律是**取整后的整数 token 数**（经 `r0`）。这是刻意的：`火山 Lite` 与 `Pro` 的 `per10.low` 必须精确相等才能并列同名次，而 `18000000 / (40/7.2) * 10` 这类浮点表达式会留下尾差。`multiple` 则由取整后的 `per10 / baseline` 得出，因此 OpenCode 的两个角都是精确的 `1.5`。

- [ ] **Step 2: 运行测试，确认失败**

Run: `node test_data.js`
Expected: `FAIL: index.html has no FORMULA block`，退出码 1。

- [ ] **Step 3: 写入内联数据行**

用 Task 1 的 `plans.json` 生成单行内联数据，并插入 `index.html` 的 `<script>` 开头（FORMULA 块之前）：

```bash
node -e "const d=require('./plans.json');const fs=require('fs');let h=fs.readFileSync('index.html','utf8');const lines='const SCENARIO = '+JSON.stringify(d.scenario)+';\nconst PLANS = '+JSON.stringify(d.plans)+';\n';h=h.replace(/(<script>\n)/, '\$1'+lines);fs.writeFileSync('index.html',h);"
```

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');console.log(/^const SCENARIO = .*;$/m.test(h), /^const PLANS = .*;$/m.test(h))"`
Expected: `true true`（两行都必须单行，否则断言 1 的正则抽不到）。

- [ ] **Step 4: 写入 FORMULA 块**

在 `index.html` 的 `<script>` 中，内联数据之后、原 `function fmt(...)` 之前插入：

```js
/* FORMULA:START */
function fxRate(scenario){ return scenario.fx.rate; }

// token 数是整数：统一取整，既有物理意义，也让并列名次与回归锚不受浮点尾差影响
function r0(x){ return (x === null || x === undefined) ? null : Math.round(x); }

function anchorAt(scenario, peak){
  var a = scenario.anchor.price_cny_per_1m, k = peak ? 'peak' : 'off_peak';
  return { input_miss: a.input_cache_miss[k], input_hit: a.input_cache_hit[k], output: a.output[k] };
}

function effInputCny(scenario){
  var a = anchorAt(scenario, false), c = scenario.cache_hit_rate.value;
  return (1 - c) * a.input_miss + c * a.input_hit;
}

function blendCny(scenario, mix){
  var out = anchorAt(scenario, false).output;
  return (mix[0] * effInputCny(scenario) + mix[1] * out) / (mix[0] + mix[1]);
}

function baselinePer10(scenario, mix){
  return 10 / (blendCny(scenario, mix) / fxRate(scenario)) * 1e6;
}

function priceUsd(plan, scenario){
  if (plan.price.usd !== null && plan.price.usd !== undefined) return plan.price.usd;
  if (plan.price.cny !== null && plan.price.cny !== undefined) return plan.price.cny / fxRate(scenario);
  return null;
}

function corners(scenario, plan){
  var tpr = plan.assumptions.tokens_per_request || null;
  var mixP = scenario.mix_bounds.pessimistic, mixO = scenario.mix_bounds.optimistic;
  return [
    { key: 'mix_p+tpr_p', mix: mixP, tpr: tpr ? tpr.low  : null },
    { key: 'mix_o+tpr_o', mix: mixO, tpr: tpr ? tpr.high : null },
    { key: 'mix_p+tpr_o', mix: mixP, tpr: tpr ? tpr.high : null },
    { key: 'mix_o+tpr_p', mix: mixO, tpr: tpr ? tpr.low  : null }
  ];
}

function planTokens(plan, scenario, corner){
  var q = plan.quota;
  if (q.unit === 'token') return q.amount;
  if (q.unit === 'request') return corner.tpr === null ? null : q.amount * corner.tpr;
  if (q.unit === 'credit'){
    var a = plan.assumptions.credits_per_1m;
    if (a){
      if (a.tokens_per_credit !== undefined && a.tokens_per_credit !== null) return q.amount * a.tokens_per_credit;
      if (a.base !== null && a.base !== undefined) return q.amount / a.base * 1e6;
    }
    var t = plan.assumptions.tokens_per_credit;
    return t ? q.amount * t.base : null;
  }
  if (q.unit === 'usd_credit') return q.amount / (blendCny(scenario, corner.mix) / fxRate(scenario)) * 1e6;
  return null;
}

function per10Of(plan, scenario, corner){
  var usd = priceUsd(plan, scenario), t = planTokens(plan, scenario, corner);
  return (usd === null || t === null) ? null : t / usd * 10;
}

function planTokensPeak(plan, scenario){
  var q = plan.quota, a = plan.assumptions.credits_per_1m;
  if (q.unit === 'credit'){
    if (a && a.peak !== null && a.peak !== undefined) return q.amount / a.peak * 1e6;
    var t = plan.assumptions.tokens_per_credit;
    return t ? q.amount * t.base : null;
  }
  if (q.unit === 'usd_credit'){
    var ap = anchorAt(scenario, true), c = scenario.cache_hit_rate.value, mix = scenario.baseline_mix.in_out;
    var ei = (1 - c) * ap.input_miss + c * ap.input_hit;
    var blend = (mix[0] * ei + mix[1] * ap.output) / (mix[0] + mix[1]);
    return q.amount / (blend / fxRate(scenario)) * 1e6;
  }
  return null;
}

function per10Peak(plan, scenario){
  var usd = priceUsd(plan, scenario), t = planTokensPeak(plan, scenario);
  return (usd === null || t === null) ? null : t / usd * 10;
}

function status(plan, scenario){
  if (priceUsd(plan, scenario) === null) return 'pending';
  var u = plan.quota.unit, a = plan.assumptions;
  if (u === 'request' && !a.tokens_per_request) return 'pending';
  if (u === 'credit' && !a.credits_per_1m && !a.tokens_per_credit) return 'pending';
  return 'ranked';
}

function pendingReason(plan, scenario){
  if (status(plan, scenario) !== 'pending') return null;
  if (priceUsd(plan, scenario) === null) return '缺 price.usd（价格需登录）';
  if (plan.quota.unit === 'credit') return '缺 credits_per_1m 官方出处';
  return '缺 tokens_per_request 出处';
}

function assumptionCount(plan, scenario){
  if (status(plan, scenario) === 'pending') return null;
  var n = 0, a = plan.assumptions;
  if (a.tokens_per_request && a.tokens_per_request.source === null) n++;
  if (a.credits_per_1m && a.credits_per_1m.base !== null && a.credits_per_1m.base !== undefined && a.credits_per_1m.source === null) n++;
  if (plan.quota.unit === 'usd_credit') n++;
  return n;
}

function isEstimated(plan, scenario){
  var n = assumptionCount(plan, scenario);
  return n === null ? null : n > 0;
}

function rowStats(plan, scenario){
  if (status(plan, scenario) === 'pending'){
    return { id: plan.id, status: 'pending', reason: pendingReason(plan, scenario),
             per10: { low: null, base: null, high: null },
             multiple: { low: null, high: null }, count: null };
  }
  var list = corners(scenario, plan).map(function (c) {
    var p10 = r0(per10Of(plan, scenario, c));
    return { per10: p10, baseline: r0(baselinePer10(scenario, c.mix)) };
  }).filter(function (r) { return r.per10 !== null; });
  var lows = list.map(function (r) { return r.per10; });
  var mults = list.map(function (r) { return r.per10 / r.baseline; });
  var tpr = plan.assumptions.tokens_per_request;
  var baseCorner = { mix: scenario.baseline_mix.in_out, tpr: tpr ? tpr.base : null };
  return {
    id: plan.id, status: 'ranked',
    per10: { low: Math.min.apply(null, lows), base: r0(per10Of(plan, scenario, baseCorner)), high: Math.max.apply(null, lows) },
    multiple: { low: Math.min.apply(null, mults), high: Math.max.apply(null, mults) },
    count: assumptionCount(plan, scenario)
  };
}

function rank(plans, scenario){
  var rows = plans.map(function (p) { return rowStats(p, scenario); });
  var ranked = rows.filter(function (r) { return r.status === 'ranked'; })
    .sort(function (a, b) { return (b.per10.low - a.per10.low) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  var firstAt = {}, seenIds = {};
  ranked.forEach(function (r, i) {
    var k = String(r.per10.low);
    if (firstAt[k] === undefined) firstAt[k] = i + 1;
  });
  ranked.forEach(function (r) { r.rank = firstAt[String(r.per10.low)]; seenIds[r.id] = r.rank; });
  var pending = rows.filter(function (r) { return r.status === 'pending'; })
    .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return ranked.concat(pending);
}

function trimNum(n, d){
  var s = n.toFixed(d === undefined ? 2 : d);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function fmtTokens(n){
  if (n === null || n === undefined) return '—';
  if (n >= 1e8) return trimNum(n / 1e8) + '亿';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('en-US') + '万';
  return String(n);
}

function fmtMultiple(m){
  return (m === null || m === undefined) ? '—' : trimNum(m, 3) + '×';
}

function fmtRange(lo, hi, f){
  if (lo === null || lo === undefined) return '—';
  return lo === hi ? f(lo) : f(lo) + ' – ' + f(hi);
}

function badgeText(count){
  if (count === null || count === undefined) return '待查';
  return count === 0 ? '官方直算' : count + ' 个假设';
}

function isPromoExpired(plan, todayISO){
  return !!(plan.price.promo_until && plan.price.promo_until < todayISO);
}

function isStale(plan, todayISO){
  return (Date.parse(todayISO) - Date.parse(plan.verified.date)) / 86400000 > 90;
}
/* FORMULA:END */
```

同时**删除**原有的 `function fmt(n){...}` 单行（它已被 `fmtTokens` 取代），否则渲染层会引用两个格式化函数。

- [ ] **Step 5: 运行测试，确认通过**

把 `test_data.js` 末尾的成功信息由 `all data-layer assertions passed` 改为 `all assertions passed`（此处已不止数据层）。

Run: `node test_data.js`
Expected: 全部 `ok:`（含 `assert1a`、`assert4a`–`assert4i`、`assert5a`–`assert5f`、`assert8e`–`assert8h`），退出码 0。

- [ ] **Step 6: 删除双实现脚本**

```bash
git rm test_data.py
```

Run: `node test_data.js`
Expected: 仍全部通过（证明新脚本独立于被删脚本）。README 里对 `test_data.py` 的引用在 Task 5 一并修掉。

- [ ] **Step 7: 提交**

```bash
git add index.html test_data.js
git commit -m "formula: single pure implementation extracted from index.html

- FORMULA block (DOM-free, date injected) holds all computation and formatting
- test_data.js extracts that block verbatim and executes it, so it tests the
  code the page runs instead of a second implementation
- inline SCENARIO/PLANS pinned to plans.json by deep equality
- regression anchors: OpenCode 1.5x, tc-max 57173678, volc-lite 32400000,
  baseline(1:3) 22153846, tc-max peak 28066108
- delete test_data.py (dual implementation + GBK crash on Chinese Windows)"
```

---

### Task 3: 页面呈现——区间、倍数、基线行、核验、待查原因、移动端

**Files:**
- Modify: `index.html`（表头、渲染脚本、新增样式与滚动容器）
- Modify: `test_data.js`（追加渲染相关断言）

**Interfaces:**
- Consumes: Task 2 的 `FORMULA.rank` / `rowStats` / `fmtTokens` / `fmtMultiple` / `fmtRange` / `badgeText` / `isPromoExpired` / `isStale` / `per10Peak` / `baselinePer10`
- Produces: 一个 10 列表格 + 表首基线行；`rowStats` 的字段名不变

- [ ] **Step 1: 追加断言（失败优先）**

在 `test_data.js` 的 `assert8h` 之后追加：

```js
// --- 呈现层 ---
assert(!/fetch\(/.test(html), 'assert6: index.html is fetch-free');
assert(/id="t"/.test(html), 'assert6b: table#t exists');
assert(/overflow-x\s*:\s*auto/.test(html), 'assert6c: table wrapper scrolls horizontally');
assert(html.indexOf('相对直充 API') >= 0, 'assert6d: baseline column header present');
assert(html.indexOf('现金直充 DeepSeek API') >= 0, 'assert6e: synthetic baseline row present');
assert(html.indexOf('new Date()') >= 0, 'assert6f: page injects the viewer date');
assert(!/FORMULA:START[\s\S]*?Date\.now\(\)/.test(html), 'assert6g: FORMULA block does not read the clock');

let okProv = true;
plansDoc.plans.forEach(function (p) {
  if (!p.verified || !Array.isArray(p.verified.sources) || p.verified.sources.length === 0) okProv = false;
  ASSUMPTION_KEYS.forEach(function (k) {
    var a = p.assumptions[k];
    if (a && !('source' in a)) okProv = false;
  });
});
assert(okProv, 'assert7: every row has sources; every assumption states source explicitly');

const today = '2026-10-03';
assert(FORMULA.isPromoExpired(byId('opencode-go'), today) === true, 'assert8a: opencode promo expired on 2026-10-03');
assert(FORMULA.isPromoExpired(byId('volc-lite'), today) === false, 'assert8b: volc-lite has no promo');
assert(FORMULA.isStale(byId('opencode-go'), today) === false, 'assert8c: 6 days old is not stale');
assert(FORMULA.isStale(byId('volc-lite'), '2026-12-26') === false, 'assert8d: exactly 90 days is not stale');
assert(FORMULA.isStale(byId('volc-lite'), '2026-12-27') === true, 'assert8i: 91 days is stale');
```

Run: `node test_data.js`
Expected: FAIL 于 `assert6c`（当前无滚动容器）、`assert6d`/`assert6e`（无基线与倍数列）等，退出码 1。

- [ ] **Step 2: 改表头并包上滚动容器**

把 `index.html` 中原有的 `<table id="t">...</table>` 一行替换为：

```html
<div class="scroll">
<table id="t"><tr><th>#</th><th>套餐</th><th>厂商</th><th>价格</th><th>额度</th><th>每 $10 flash（谷）</th><th>峰值（峰）</th><th>相对直充 API</th><th>假设与公式</th><th>来源</th></tr></table>
</div>
```

在 `<style>` 中追加：

```css
.scroll{overflow-x:auto}
tr.baseline td{background:#eef6ff;font-weight:600}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:8px;background:#fff3cd;border:1px solid #e6c200;color:#664d03}
.ok{display:inline-block;font-size:11px;padding:1px 6px;border-radius:8px;background:#d4edda;border:1px solid #2d7a3f;color:#1d5c2a}
.wait{color:#999}
.note{font-size:11px;color:#666}
.src{font-size:12px}
```

- [ ] **Step 3: 替换渲染脚本**

把 `index.html` 中 `<script>` 里 FORMULA 块之后的**全部旧渲染代码**（`PLANS.sort(...)` 至 `</script>` 之前）替换为：

```js
var TODAY = new Date().toISOString().slice(0, 10);
var T = document.getElementById('t');

function cell(html, cls){ return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>'; }
function appendRow(cells, cls){
  var tr = document.createElement('tr');
  if (cls) tr.className = cls;
  tr.innerHTML = cells.join('');
  T.appendChild(tr);
}
function unitLabel(u){ return { token:'tokens', request:'次请求', credit:'积分', usd_credit:'美元额度' }[u]; }
function priceCell(p){
  var tag = p.basis === 'annual' ? ' <span class="badge">年付</span>'
          : p.basis === 'promo'  ? ' <span class="badge">促销</span>' : '';
  return p.text + tag;
}
function quotaCell(p){
  return p.quota.amount.toLocaleString('en-US') + ' ' + unitLabel(p.quota.unit) + '/'
       + (p.quota.window === 'month' ? '月' : '周')
       + (p.quota.sub_limit ? '（' + p.quota.sub_limit + '）' : '')
       + (p.quota.shared ? ' · 全模型共享' : '');
}
function sourceCell(p){
  var stale = FORMULA.isStale(p, TODAY) ? ' <span class="badge">陈旧</span>' : '';
  var promo = FORMULA.isPromoExpired(p, TODAY) ? ' <span class="badge">促销已结束</span>' : '';
  return '<a href="' + p.verified.sources[0] + '">官方</a>'
       + '<div class="note">核验于 ' + p.verified.date + stale + promo + '</div>';
}
function formulaCell(p, st){
  var bits = [];
  var t = p.assumptions.tokens_per_request;
  if (t) bits.push('tokens/请求 ' + t.low + '/' + t.base + '/' + t.high + '（量级包围，非实测）');
  var c = p.assumptions.credits_per_1m;
  if (c && c.base !== null && c.base !== undefined) bits.push('官方 ' + c.base + ' 积分/1M（峰 ' + c.peak + '）');
  var tc = p.assumptions.tokens_per_credit;
  if (tc) bits.push('官方 ' + tc.base + ' token/积分');
  if (p.quota.unit === 'usd_credit') bits.push('经锚价折算（蕴含读者混合比与缓存行为）');
  var badgeCls = st.count === 0 ? 'ok' : 'badge';
  return '<div class="note">' + bits.join('；') + '</div><span class="' + badgeCls + '">' + FORMULA.badgeText(st.count) + '</span>';
}

var baseTokens = FORMULA.baselinePer10(SCENARIO, SCENARIO.baseline_mix.in_out);
appendRow([
  cell('·'),
  cell('<b>现金直充 DeepSeek API</b>'),
  cell('基线'),
  cell('$10'),
  cell('无套餐额度，按量计费', 'note'),
  cell('<span class="num">' + FORMULA.fmtTokens(baseTokens) + '</span>'),
  cell('—', 'note'),
  cell('<span class="num">1.00×</span>'),
  cell('锚价 ¥1 入 / ¥4 出（缓存未命中，空闲）÷ fx ' + SCENARIO.fx.rate + '；随混合比在 ' +
       FORMULA.fmtTokens(FORMULA.baselinePer10(SCENARIO, SCENARIO.mix_bounds.pessimistic)) + ' – ' +
       FORMULA.fmtTokens(FORMULA.baselinePer10(SCENARIO, SCENARIO.mix_bounds.optimistic)) + ' 之间变化', 'note'),
  cell('<a href="' + SCENARIO.anchor.source + '">官方</a><div class="note">锚价与峰谷</div>', 'src')
], 'baseline');

FORMULA.rank(PLANS, SCENARIO).forEach(function(r){
  var p = PLANS.filter(function(x){ return x.id === r.id; })[0];
  if (r.status === 'pending'){
    appendRow([
      cell('·'), cell(p.name), cell(p.vendor), cell(priceCell(p.price)), cell(quotaCell(p), 'note'),
      cell('<span class="wait">待查</span>'), cell('—', 'note'), cell('<span class="wait">待查</span>'),
      cell('<div class="note">' + r.reason + '</div>'), cell(sourceCell(p), 'src')
    ]);
    return;
  }
  var p10Base = r.per10.base === r.per10.low && r.per10.base === r.per10.high ? ''
              : '<div class="note">基准 ' + FORMULA.fmtTokens(r.per10.base) + ' · 上限 ' + FORMULA.fmtTokens(r.per10.high) + '</div>';
  appendRow([
    cell(String(r.rank)),
    cell(p.name),
    cell(p.vendor),
    cell(priceCell(p.price)),
    cell(quotaCell(p), 'note'),
    cell('<span class="num">' + FORMULA.fmtTokens(r.per10.low) + '</span>' + p10Base),
    cell(FORMULA.fmtTokens(FORMULA.per10Peak(p, SCENARIO)), 'note'),
    cell('<span class="num">' + FORMULA.fmtRange(r.multiple.low, r.multiple.high, FORMULA.fmtMultiple) + '</span>'),
    cell(formulaCell(p, r)),
    cell(sourceCell(p), 'src')
  ]);
});
```

- [ ] **Step 4: 更新表头声明与页脚**

把 `index.html` 中锚定模型那段说明替换为：

```html
<p>锚定模型 <a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/">deepseek-flash（DeepSeek-V4.1-Flash）</a>：官方价 ¥1/1M 入（缓存未命中）、¥4/1M 出（空闲时段，高峰 2 倍），¥7.2 = $1。默认场景：<b>谷时 · 无缓存 · 假设混合比 1:3</b>。区间 = 「入:出混合比（全输出↔全输入物理边界）」×「tokens/请求（1000↔20000 量级包围，非实测）」两轴的包络，<b>名次按区间下界排</b>。谷时＝非工作日时段；峰时覆盖工作日 9:00–12:00 / 14:00–18:00。<span class="badge">N 个假设</span><span class="ok">官方直算</span></p>
```

并把 `<footer>` 中「数据更新：2026-09-27」改为「核验日期逐行标注于来源列 · 机器可读数据 <a href="plans.json">plans.json</a>（与页内内联数据一致，见 test_data.js） · 欢迎带官方来源的 PR 修正 · <a href="https://github.com/Finn763/aiplanrank">GitHub</a>」，即删除那个全局日期。

- [ ] **Step 5: 运行测试并肉眼验收**

Run: `node test_data.js`
Expected: 全部 `ok:`，退出码 0。

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8');console.log('fetch:',/fetch\(/.test(h),'scroll:',/overflow-x\s*:\s*auto/.test(h),'baseline:',h.indexOf('现金直充 DeepSeek API')>=0)"`
Expected: `fetch: false scroll: true baseline: true`

然后人工打开 `index.html`（`file://`）确认：基线行在表首且配色不同；腾讯四行区间宽度为 0（只显示单值）；火山两行显示 `基准 1.5亿 · 上限 6.48亿`；OpenCode 行显示 `1.5×` 单值与「促销已结束」；阿里/Atlas 行显示「待查」+ 缺失原因；把窗口缩到 375px 宽时页面本身不横向溢出、只有表格内部滚动。

- [ ] **Step 6: 提交**

```bash
git add index.html test_data.js
git commit -m "site: interval, multiple, baseline row, per-row verification

- 10 columns; lower bound is the sort key and the headline number
- synthetic baseline row pinned first, derived from the anchor (never stored)
- multiple column shows its own range (OpenCode pinned at 1.5x)
- per-row verified date with >90d staleness and expired-promo markers
- pending rows state which primitive is missing
- horizontal scroll wrapper; header states the default scenario"
```

---

### Task 4: CI 与"改坏必须变红"实证

**Files:**
- Create: `.github/workflows/check.yml`

**Interfaces:**
- Consumes: Task 2/3 的 `node test_data.js`（零依赖、退出码非 0 即失败）
- Produces: push / PR 上的检查任务

- [ ] **Step 1: 写 workflow**

创建 `.github/workflows/check.yml`：

```yaml
name: check

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: verify plans.json / formula / page stay in sync
        run: node test_data.js
```

- [ ] **Step 2: 证明"改坏原语会被拦下"（本次验收标准 3）**

先备份，再故意改坏一个原语：

```bash
cp plans.json /tmp/plans.json.bak
node -e "const fs=require('fs');const t=fs.readFileSync('plans.json','utf8').replace('\"base\": 4625','\"base\": 99999');fs.writeFileSync('plans.json',t)"
node test_data.js; echo "exit=$?"
```

Expected: 出现 `FAIL: assert1a` 或 `FAIL: assert4c`（内联数据与 `plans.json` 不再一致），`exit=1`。

- [ ] **Step 3: 恢复并确认变绿**

```bash
cp /tmp/plans.json.bak plans.json
node test_data.js; echo "exit=$?"
```

Expected: 全部 `ok:`，`exit=0`。

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/check.yml
git commit -m "ci: run test_data.js on push and pull request

Broken primitives now fail the check instead of silently drifting from the
inlined page data. Verified locally: mutating tokens_per_request.base makes
the script exit 1."
```

---

### Task 5: README 双语文案与「怎么复算」

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**
- Consumes: `plans.json`（Task 1）、`test_data.js`（Task 2）、页面列集合（Task 3）
- Produces: 与页面一致的叙述；不再引用已删除的 `test_data.py`

- [ ] **Step 1: 改 `README.md` 的 Seed snapshot 与收录规则**

把第 15 行的 Seed snapshot 引用块整段替换为：

```markdown
> Seed snapshot (per $10, off-peak; ranked by the **lower bound** of a dual-axis interval — in:out mix × tokens/request): 腾讯云 TokenHub Pro 5,737万 `官方直算` > 腾讯云 Max 5,717万 > 腾讯云 Standard 5,664万 > 腾讯云 Lite 5,291万 > 火山 Lite/Pro 3,240万 (request-based, 1 assumption) > OpenCode Go 2,700万 (its multiple is pinned at **1.500×** whatever your usage). The top four are all Tencent and within 7.8% of each other, so their order carries no decision weight. On the pessimistic corner both Tencent (0.797×) and 火山 (0.450×) fall **below 1.0×** versus simply paying for the API. 阿里百炼 & Atlas Cloud stay 待查 rather than guessed. Anchor price and every assumption are recomputable from `plans.json`.
```

把 Unit 行替换为：

```markdown
| Unit | Flash-equiv tokens per $10 (anchor `deepseek-flash` / DeepSeek-V4.1-Flash, official ¥1 in / ¥4 out per 1M off-peak, cache-miss basis, ¥7.2 = $1) |
```

把 Formula 行替换为：

```markdown
| Formula | Every row carries its assumptions and a derived assumption count (`0` = 官方直算); `per10` is never stored — the page and the test run the same extracted code |
```

把 Source 行替换为：

```markdown
| Source | Every row links its vendor page and states its own `verified` date; PRs without a source link don't merge |
```

并在表格后新增一行收录规则：

```markdown
| Assumptions | Envelope quantities must give `low/base/high`; anything without a published source must say `"source": null` explicitly — no blanks, no guesses |
```

- [ ] **Step 2: 改 `README.md` 的仓库结构、贡献段，新增「怎么复算」**

把 Repo layout 代码块替换为：

```
plans.json     # scenario (anchor price, fx, bounds) + plan primitives — no per10
index.html     # FORMULA block + render; data inlined (works from file://)
test_data.js   # extracts the FORMULA block, checks sync + regression anchors
.github/workflows/check.yml
```

在 Contributing 段之后新增：

````markdown
## How to recompute

```bash
# 1. verify the page, the data and the formula agree (includes regression anchors)
node test_data.js

# 2. print the whole rank using the very code the page runs
node -e "const fs=require('fs'),h=fs.readFileSync('index.html','utf8'),m=h.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);const F=new Function(m[1]+';return {rank,rowStats,baselinePer10,fmtTokens,fmtMultiple};')();const d=require('./plans.json');console.log('baseline',F.fmtTokens(F.baselinePer10(d.scenario,d.scenario.baseline_mix.in_out)));F.rank(d.plans,d.scenario).forEach(r=>console.log(r.id,r.status,F.fmtTokens(r.per10.low),r.status==='ranked'?F.fmtMultiple(r.multiple.low)+' – '+F.fmtMultiple(r.multiple.high):r.reason,r.count));"
```
````

把 `test_data.py` 的所有提及（含页脚那句）改为 `test_data.js`，并在贡献段补一句：

```markdown
New rows must state their assumptions; ranking by the interval's lower bound may place your row below a plan with a tighter interval — that is the intended behaviour.
```

- [ ] **Step 3: 同步改 `README.zh-CN.md`**

把第 15 行的种子快照整段替换为：

```markdown
> 种子快照（每 $10，谷时，**按双轴区间的下界排**：入:出混合比 × tokens/请求）：腾讯云 TokenHub Pro 5,737万 `官方直算` > 腾讯云 Max 5,717万 > 腾讯云 Standard 5,664万 > 腾讯云 Lite 5,291万 > 火山 Lite/Pro 3,240万（请求数口径，1 个假设）> OpenCode Go 2,700万（倍数恒 **1.500×**，与你的用法无关）。前四名全是腾讯且极差仅 7.8%，它们之间的名次没有决策意义。在悲观角上，腾讯（0.797×）与火山（0.450×）都**跌破 1.0×**，即不如直接充 API。阿里百炼与 Atlas Cloud 宁可标待查也不猜。锚价与每条假设都能从 `plans.json` 复算。
```

Unit 行替换为：

```markdown
| 单位 | 每 $10 flash 等价 Token（锚模型 `deepseek-flash` / DeepSeek-V4.1-Flash，官方 ¥1 入 / ¥4 出每 1M，空闲时段，缓存未命中口径，¥7.2 = $1） |
```

Formula 行替换为：

```markdown
| 公式 | 每行自带假设与派生出的假设数（`0` = 官方直算）；`per10` 从不落盘——页面与测试跑同一份抽取出来的代码 |
```

Source 行替换为：

```markdown
| 来源 | 每行链官方页并各自标注 `verified` 核验日期；无来源链接的 PR 不合 |
```

收录规则表补一行：

```markdown
| 假设 | 量级包围必须给 `low/base/high`；无公开出处的量必须显式写 `"source": null`，不许留空、不许猜 |
```

仓库结构块替换为：

```
plans.json     # 场景（锚价、汇率、上下限）+ 套餐原语 —— 不含 per10
index.html     # FORMULA 块 + 渲染；数据内联（file:// 可直开）
test_data.js   # 抽取 FORMULA 块，校验同步与回归锚
.github/workflows/check.yml
```

贡献段之后新增：

````markdown
## 怎么复算

```bash
# 1. 校验页面、数据与公式三者一致（含回归锚）
node test_data.js

# 2. 用页面同一份代码打印全榜
node -e "const fs=require('fs'),h=fs.readFileSync('index.html','utf8'),m=h.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);const F=new Function(m[1]+';return {rank,rowStats,baselinePer10,fmtTokens,fmtMultiple};')();const d=require('./plans.json');console.log('baseline',F.fmtTokens(F.baselinePer10(d.scenario,d.scenario.baseline_mix.in_out)));F.rank(d.plans,d.scenario).forEach(r=>console.log(r.id,r.status,F.fmtTokens(r.per10.low),r.status==='ranked'?F.fmtMultiple(r.multiple.low)+' – '+F.fmtMultiple(r.multiple.high):r.reason,r.count));"
```
````

把贡献段里的 `test_data.py` 改为 `test_data.js`，并补一句：

```markdown
新增套餐必须填假设；按区间下界排序可能让区间更宽的行名次低于区间更紧的行——这是刻意行为。
```

- [ ] **Step 4: 验证文案与数据一致**

```bash
grep -n "test_data.py" README.md README.zh-CN.md; echo "grep-exit=$?"
node -e "const fs=require('fs'),h=fs.readFileSync('index.html','utf8'),m=h.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);const F=new Function(m[1]+';return {rank,rowStats,baselinePer10,fmtTokens,fmtMultiple};')();const d=require('./plans.json');console.log('baseline',F.fmtTokens(F.baselinePer10(d.scenario,d.scenario.baseline_mix.in_out)));F.rank(d.plans,d.scenario).forEach(r=>console.log(r.id,r.status,F.fmtTokens(r.per10.low),r.status==='ranked'?F.fmtMultiple(r.multiple.low)+' – '+F.fmtMultiple(r.multiple.high):r.reason,r.count));"
```

Expected: `grep` 无匹配（`grep-exit=1`）；第二条命令打印 `baseline 2,215万`，且第一行为 `tc-pro ranked 5,737万`，OpenCode 行显示 `1.5× – 1.5×`，阿里/Atlas 行显示缺失原因。若与 README 文案不符，改 README 而不是改数字。

- [ ] **Step 5: 提交**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: rank by interval lower bound, official CNY anchor, recompute recipe

- seed snapshot rewritten around the lower-bound rank; the 官方直算 label moves
  to Tencent, OpenCode is described by its pinned 1.500x multiple
- anchor stated as ¥1 in / ¥4 out per 1M with fx 7.2 applied to both sides
- contributing rules require assumptions and explicit source null
- test_data.py references replaced by test_data.js
- add a two-command recompute recipe using the page's own formula block"
```

---

## 计划自审记录

**Spec 覆盖度：** §4 契约 → Task 1；§5 计算 → Task 2；§6 呈现 → Task 3；§7 校验与 CI → Task 2/4；§8 改动清单 → Task 1–5；§9 验收 1/2/4/5 → Task 3 与 Task 5 Step 4，验收 3 → Task 4 Step 2，验收 6 → Task 3 Step 5。§2.5 的锚价修正 → Task 1 Step 3。

**相对 spec 的四处细化（不改变任何验收标准）：**
1. `tokens_per_credit` 作为 `credits_per_1m` 的替代方向（spec §4.3/§4.4 已同步补充）——Atlas 官方以「每积分 0.55 token」发布。
2. FORMULA 额外承载行内格式化（`fmtTokens`/`fmtMultiple`/`fmtRange`/`badgeText`）与峰值列（`per10Peak`），使数字呈现也能被无 DOM 的测试断言。
3. spec §7.2 断言 4 的腾讯 Max 回归锚更正为 **`57173679`**（`15900 × 10⁶ × 10 ÷ (27 × 103) = 57,173,678.53`，取整得 57,173,679）；同时新增峰值锚 **`28067079`**（`15900 × 10⁶ × 10 ÷ (55 × 103) = 28,067,078.55`）。
4. `rowStats` 对 token 数取整（`r0`）。理由：`火山 Lite` 与 `Pro` 的 `per10.low` 必须精确相等才能并列同名次，而 `18000000 ÷ (40 ÷ 7.2) × 10` 会留下浮点尾差；取整也顺带让 `OpenCode` 的倍数在两个角上都是精确的 `1.5`。

**占位符扫描：** 无 TBD/TODO；每个代码步骤都给出可粘贴的完整内容；每条命令都写了预期输出。

**类型一致性：** `rowStats` 返回 `{id, status, reason?, per10:{low,base,high}, multiple:{low,high}, count}` 在三处被一致使用（Task 2 断言、Task 3 渲染、Task 5 复算脚本）；`fmtTokens`/`fmtMultiple`/`badgeText`/`per10Peak`/`baselinePer10` 的签名在定义与调用处一致；`rank()` 输出行在 Task 3 依赖的 `r.rank` 字段由 Task 2 定义。
