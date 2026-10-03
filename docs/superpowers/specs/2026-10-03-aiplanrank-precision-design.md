# aiplanrank 精度与可验证性打底 — 设计文档

- 日期：2026-10-03
- 状态：待用户评审
- 范围：`plans.json` 数据契约重写、锚价单位修正、页面区间与基线行、公式单一实现、CI、文案后果
- 不在范围：峰谷默认反转、缓存列、补齐 7 行待查、跨模型能力归一、来源自动 diff

## 1. 目标与成功标准

本次改动只解决一件事：**让页面上的每个数字都能被外部人从 `plans.json` 独立复算出来，并且它有多不准是看得见的。**

成功标准两条并列，缺一不算完成：

1. **数据可信**：`per10` 不再是 `plans.json` 里的字段，而是原语的函数输出；任何原语被改坏，`node test_data.js` 与 CI 必须变红。
2. **阅读可用**：页面有现金直充 API 基线行、有区间、有相对基线的倍数、有逐行核验日期，读者 3 秒内能判断"比直接买 API 值不值"。

## 2. 背景：三类不确定必须分开处理

| 种类 | 例子 | 处理方式 |
|---|---|---|
| ① 假设不确定 | `tokens/请求`、入:出混合比 | 拉上下限做区间（本次主线） |
| ② 官方未公开 | 阿里 Credits 系数、Atlas 价格 | 保持 `null`／待查，禁止猜测 |
| ③ 时效不确定 | OpenCode 促销、随时改价 | 不是区间，是 `verified.date` + `promo_until` |

把 ① 和 ② 混在一起讲，是当前"精度幻觉"的来源；把 ③ 当成区间讲，是来源腐烂被掩盖的原因。

## 2.5 本次顺带修正的三个既有数据缺陷

核对 DeepSeek 官方价目表（`https://api-docs.deepseek.com/zh-cn/quick_start/pricing/`）后确认：

**缺陷 1：锚价单位错误。** 官方价格单位是**人民币**：`deepseek-flash` 输入（缓存未命中）空闲 **¥1**/1M、高峰 ¥2；输出空闲 **¥4**/1M、高峰 ¥8。仓库按 `$0.15` / `$0.60` 使用，等价于隐含汇率 **6.667**，而 [README.md](../../../README.md) 声明的是 **¥7.2 = $1**。同一数据集两套汇率，误差直接乘进每个倍数。本次把锚价改为 ¥ 原语，与 ¥ 套餐价共用 `scenario.fx`，该不一致消失。

**缺陷 2：缓存命中价缺失。** 官方同时公布输入（缓存命中）空闲 **¥0.02**/1M、高峰 ¥0.04，比未命中价便宜 **50 倍**。仓库「不计缓存命中」等于全程按最贵的输入价计算。

**缺陷 3：高峰时段已官方确认覆盖工作日。** 北京时间为**周一至周五（不含法定节假日）9:00–12:00、14:00–18:00**，其余时段（含周末与节假日全天）为空闲时段。即"谷时"恰好排除工作日常规写码时段，而页面目前以谷时数字作头条。

缺陷 1 在本次修复；缺陷 2、3 记录为已知弱点（见 §10），不夹带进本次范围。

## 3. 已确认的决定

| # | 决定 | 取舍 |
|---|---|---|
| D1 | 数据可信与阅读可用**两者都要** | 实现量最大，验收标准最严 |
| D2 | 区间语义 = **基准值 + 敏感性区间** | 不是场景双档，也不是纯假设敏感性 |
| D3 | 名次按**区间下界**排 | 榜一易主，README 文案必须跟着改 |
| D4 | 上下限用**量级包围 + 明标无出处** | 过渡方案；区间本身不是证据 |
| D5 | `plans.json` **只存原语，删除 `per10`** | `plans.json` 不再自带答案；PR 者须填假设 |
| D6 | 区间覆盖**双轴**：混合比 × `tokens/请求` | 单轴会让腾讯/OpenCode 区间宽度为 0，制造假象 |
| D7 | 主排序 = **`per10` 下界** | 与站点单一单位、现表结构连续；"倍数下界"另列展示 |

### D6 的理由（数据）

锚价是 `¥1 入 / ¥4 出`（缓存未命中，空闲时段）按混合比混出来的。混合比一变，**基线跟着变**：

| 混合比 | 混合价（空闲，缓存未命中） | 基线（$10 直充） |
|---|---|---|
| 全输入 | ¥1/1M | 7,200万 |
| 1:3（历史默认） | ¥3.25/1M | 2,215万 |
| 全输出 | ¥4/1M | 1,800万 |

若区间只覆盖 `tokens/请求`，腾讯与 OpenCode 的 `per10` 区间宽度为 0，页面会出现"这两个数没有误差"的错误暗示。

## 4. 数据契约

### 4.1 文件形态

`plans.json` 从数组变为「场景 + 行」，因为默认场景是数据集的一部分，页面必须能引用：

```json
{
  "scenario": { "...": "见 4.2" },
  "plans": [ { "...": "见 4.3" } ]
}
```

### 4.2 `scenario`

```json
{
  "label": "谷时 · 无缓存 · 假设混合比 1:3",
  "baseline_mix": { "in_out": [1, 3], "source": null },
  "mix_bounds": { "pessimistic": [0, 1], "optimistic": [1, 0] },
  "cache_hit_rate": { "value": 0, "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" },
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
  "fx": { "rate": 7.2, "as_of": "2026-10-03", "convention": "固定折算，不计汇率浮动" }
}
```

- **混合比轴用物理边界** `[0,1]` 全输出与 `[1,0]` 全输入。这是数学边界，**不需要出处**，也不存在"编数"问题。
- `cache_hit_rate` 固定为 0（= 最贵的输入价），其**价格**有官方出处；这是场景选择而非缺口，故不计入假设数。
- `fx` 是项目固定约定，同时作用于锚价与 ¥ 套餐价，因此 **¥ 计价行的倍数与汇率无关**；只有美元计价行（腾讯、OpenCode）的倍数依赖 `fx`。
- 锚价以 **¥ 原语**存储，不预折美元：`usd = cny / fx.rate`。

### 4.3 plan 行

```json
{
  "id": "volc-lite",
  "vendor": "火山方舟",
  "name": "Coding Plan Lite",
  "price": { "cny": 40, "text": "¥40/月", "basis": "monthly", "promo_until": null },
  "quota": {
    "amount": 18000, "unit": "request", "window": "month",
    "sub_limit": "1200/5h", "shared": true
  },
  "assumptions": {
    "tokens_per_request": { "low": 1000, "base": 4625, "high": 20000, "source": null }
  },
  "verified": { "date": "2026-09-27", "sources": ["https://ai.volcengine.com/activity/codingplan"] },
  "note": ""
}
```

字段规则：

| 字段 | 规则 |
|---|---|
| `price.cny` / `price.usd` | **二者择一，只存一个**：¥ 行给 `cny`（`usd` 一律由 `fx` 派生，不落盘），$ 行给 `usd`。同一行同时写两个即构成第二份事实 |
| `price.basis` | `monthly` / `annual` / `promo`；非 `monthly` 必须在页面标注 |
| `price.promo_until` | ISO 日期或 `null`；过期即触发陈旧标记 |
| `quota.unit` | `token` / `request` / `credit` / `usd_credit` |
| `quota.sub_limit` | 结构化保留，**本次不参与计算** |
| `assumptions.tokens_per_request` | 量级包围：`{low, base, high, source}`，无出处必须**显式** `"source": null` |
| `assumptions.credits_per_1m` | 官方费率：`{base, peak, source}`，无区间 |
| `assumptions.tokens_per_credit` | 厂商以「每积分多少 token」发布时的替代方向：`{base, source}`；与 `credits_per_1m` 二者择一，同时存在时以本字段优先 |
| `verified.sources` | 非空数组；已排行的行必须有至少一个官方链接 |
| `estimated` | **不再是字段**，由 5.4 派生 |

`usd_credit` 是本次新增的第四种单位，用于 OpenCode 的「月额度 $15」。缺它则该行无处安放。

### 4.4 单位与算法对应

| `unit` | token 产出 | 需要的假设 |
|---|---|---|
| `token` | `amount` | 无 |
| `request` | `amount × tokens_per_request[k]` | `tokens_per_request` |
| `credit` | `amount ÷ credits_per_1m × 10⁶`，或以 `amount × tokens_per_credit` 替代 | `credits_per_1m` 或 `tokens_per_credit`（官方系数） |
| `usd_credit` | `amount ÷ blend × 10⁶` | 经锚价，蕴含混合比与缓存假设 |

## 5. 计算规则

### 5.1 混合价与基线

```
eff_input(mix) = (1 - cache_hit_rate) × anchor.input_cache_miss + cache_hit_rate × anchor.input_cache_hit
blend(mix)     = (mix.in × eff_input + mix.out × anchor.output) / (mix.in + mix.out)   // ¥/1M，空闲
blend_peak     = 用 anchor 的 peak 价格按同一混合比重算
                 // peak 价格是原语；peak_multiplier 只是声明式的一致性关系，
                 // 由 7.2 断言 peak === off_peak × peak_multiplier 钉住，避免同一事实两份各自漂移
baseline(mix)  = 10 / (blend / fx.rate) × 10⁶                                            // tokens per $10
```

### 5.2 token 产出与 per10

```
tokens(plan, k) = 按 4.4 表计算，缺必需原语时返回 null
per10(plan, k)  = tokens(plan, k) / plan.price.usd × 10        // price.usd = price.cny / fx.rate（¥ 行）
```

### 5.3 区间与倍数：**同角计算，禁止交叉**

区间是「混合比 × `tokens/请求`」构成的矩形。`per10` 的下界取矩形内使 `per10` 最小的角，上界取最大的角。**倍数必须在同一个角上取分子分母**，不得用 `per10` 下界除以基线上界：

```
multiple(plan, corner) = per10(plan, corner) / baseline(corner.mix)
```

`per10` 低点与倍数低点**不在同一个角**，这是刻意的；页面上两者各自独立成列，不做配对展示。

### 5.4 假设数与 `estimated`（机械定义）

> `assumption_count` = 该行 `per10` 计算中**实际读取且无出处**的量的个数。全局用法参数在同一行内最多计一次，避免同一个全局缺口在多行被重复放大。

封闭清单，只有四项参与计数（credit 行按 `credits_per_1m` 与 `tokens_per_credit` 择一，同一行只计一次）：

| 计数量 | 无出处的理由 |
|---|---|
| `assumptions.tokens_per_request` | 请求→token 换算，无量级来源 |
| `assumptions.credits_per_1m` | 若系数无官方出处则计数（本次腾讯四行有出处，故不计数） |
| `assumptions.tokens_per_credit` | credit 收益的替代方向；无官方出处时同样计数，否则 Atlas 那种「每积分 0.55 token」会绕开来源规则 |
| **锚价折算路径** | 该路径蕴含读者的混合比与缓存行为两个未发表的用法参数，整体计为一 |

`fx`、`anchor.price_cny_per_1m`、`cache_hit_rate` 的价格部分**有出处，不计数**。

由此得出（**这是对第 2 节初稿的修正，且修正后"官方直算"归属改变**）：

| 行 | 读取的无出处的量 | 计数 | 徽章 |
|---|---|---|---|
| 腾讯 ×4 | 无（额度与系数皆官方，不经锚价） | **0** | `官方直算` |
| 火山 ×2 | `tokens_per_request` | 1 | `1 个假设` |
| OpenCode ×1 | 锚价折算路径 | 1 | `1 个假设` |
| 阿里 ×4 / Atlas ×3 | 缺必需原语 | — | `待查` |

`estimated = (assumption_count ?? 0) > 0`；`assumption_count` 为 `null`（待查）时 `estimated` 为 `null`，页面显示 `待查` 而非 `*`。

腾讯的计数为 0 **但在页面提示一个保留意见**：官方给的「综合单价 27 积分/1M」是在一个未公开的混合比下定义的，若该基准与读者用法不同，实际 token 产出会偏离。该保留意见**不计入假设数**，因为它不是我们读取的量，而是对来源的口径说明。

### 5.5 排序

1. 已排行的行按 `per10` 下界降序；
2. `per10` 下界相等时按 `id` 稳定排序并显示并列名次（火山 Lite 与 Pro 即为此例）；并列**占用两个位次**，其后名次继续递增（竞赛式排名：`1,2,3,4,5,5,7`）；
3. `per10` 下界为 `null`（待查）的行排在最后，名次列显示 `·`；
4. 合成基线行不参与名次，固定钉在表首。

### 5.6 展开验证（全部为 5.1–5.4 的输出）

锚价 `¥1 入 / ¥4 出`（缓存未命中，空闲），缓存命中率 0，`fx = 7.2`，峰时 2×。
基线：全输入 7,200万，1:3 为 **2,215万**，全输出 1,800万。

| 行 | per10 区间 | per10 下界 | 倍数区间 | 假设数 |
|---|---|---|---|---|
| 腾讯 Pro `$51 / 7900 credit` | 5,737万（定值） | **5,737万** | 0.797× – 3.187× | 0 |
| 腾讯 Max `$103 / 15900 credit` | 5,717万（定值） | 5,717万 | 0.794× – 3.176× | 0 |
| 腾讯 Standard `$17 / 2600 credit` | 5,664万（定值） | 5,664万 | 0.787× – 3.147× | 0 |
| 腾讯 Lite `$7 / 1000 credit` | 5,291万（定值） | 5,291万 | 0.735× – 2.939× | 0 |
| 火山 Lite `¥40 / 18000 req` | 3,240万 – 6.48亿 | 3,240万 | 0.45× – 36× | 1 |
| 火山 Pro `¥200 / 90000 req` | 3,240万 – 6.48亿 | 3,240万 | 0.45× – 36× | 1 |
| OpenCode Go `$10 / $15 usd_credit` | 2,700万 – 1.08亿 | 2,700万 | **1.5× – 1.5×** | 1 |
| 阿里 ×4 / Atlas ×3 | — | 待查 | — | — |

三条由此暴露、需要写进文案的事实：

1. **腾讯的 `per10` 是定值**：额度与系数皆为官方数，纯算术。所以它的区间宽度在 `per10` 上为 0，不确定性全部体现在倍数上（0.794×–3.176×）——即"这些 token 值多少钱"不确定，而"有多少 token"确定。
2. **OpenCode 的倍数恒为 1.5×**：美元额度，倍数 = `$15 ÷ $10`，与混合比、与 `tokens/请求` 全然无关。它是全榜唯一保底划算的行。
3. **腾讯与火山在"读为主"角上都跌破 1.0×**（0.797× / 0.45×）：该场景下买套餐不如直接充 API。

名次（按 5.5）：腾讯 Pro > 腾讯 Max > 腾讯 Standard > 腾讯 Lite > 火山 Lite = 火山 Pro > OpenCode Go。
**前 4 名全是腾讯，极差 7.8%，其中 Pro 与 Max 仅差 0.34%**——该区间内的名次没有决策意义，必须在页面注明。

## 6. 页面呈现

### 6.1 列布局（10 列，现为 9 列，新增倍数列）

| 列 | 内容 |
|---|---|
| # | 名次（并列同名次；待查为 `·`） |
| 套餐 | 不变 |
| 厂商 | 不变 |
| 价格 | 原文 + `basis` 标注（`年付`／`促销至 <date>`） |
| 额度 | 原文 + `sub_limit` |
| 每 $10 flash（谷） | **下界**大字 + 次行小字 `基准 X · 上限 Y`（区间折叠进本列，不加列） |
| 峰值场景（峰） | 沿用现列 |
| **相对直充 API** | `倍数区间`（如 `0.794× – 3.176×`，三位小数去尾零）；区间宽度为 0 时显示单值 |
| 假设与公式 | 原语清单 + 可复算的公式串 + 假设数徽章 + 腾讯的保留意见 |
| 来源 | 官方链接 + `核验于 <date>` |

### 6.2 基线行（合成）

- 固定在表首，独立配色，**不写进 `plans.json`**，由 `scenario.anchor` + `fx` 派生
- 内容：`现金直充 DeepSeek API` / `2,215万` / `1.00×` / 来源指向官方价目表
- 区间列显示 `—`：它不依赖 `tokens/请求`；tooltip 说明它随混合比在 **1,800万 – 7,200万** 之间变化

### 6.3 徽章

| 徽章 | 条件 |
|---|---|
| `官方直算` | `assumption_count === 0` |
| `N 个假设` | `assumption_count > 0` |
| `待查` | 缺必需原语，`assumption_count === null` |

### 6.4 核验与陈旧

- 每行显示 `核验于 <verified.date>`；距页面打开时间 **> 90 天**转黄
- `promo_until` 已过期转红并标注"促销已结束"
- 判定用浏览时的当前日期，因此该静态文件在未来被打开时会自动显示全表陈旧
- **首个真实案例**：OpenCode `promo_until` 为 `2026-09-27`，而今天已是 `2026-10-03`，过期 6 天。其 `per10` 本身按非促销额度 `$15` 计算故数值不变，但促销文案必须转为"已结束"。此例作为验收样例。

### 6.5 待查行

显示 `待查` + 具体缺哪个原语：阿里四行为 `缺 credits_per_1m 官方出处`，Atlas 三行为 `缺 price.usd（价格需登录）`。

### 6.6 表头声明

一行，不可省：默认场景（谷时 · 无缓存 · 假设混合比 1:3）+ `区间来自假设量级包围与物理边界，非实测` + `谷时＝非工作日常规时段，峰时覆盖工作日 9:00–12:00 / 14:00–18:00`。

### 6.7 移动端

宽表外层加横向滚动容器；375px 宽下页面本身不得横向溢出。

## 7. 校验与 CI

### 7.1 公式单一实现

`index.html` 中的公式写成不触碰 DOM 的纯函数，夹在 `/* FORMULA:START */` 与 `/* FORMULA:END */` 之间，入参只有 `scenario`、`plans`、`todayISO`。导出形状固定为：

```
FORMULA = { fxRate, effInputCny, blendCny, baselinePer10, priceUsd, corners, planTokens, per10Of,
            anchorAt, planTokensPeak, per10Peak, status, pendingReason, assumptionCount, isEstimated,
            rowStats, rank, trimNum, fmtTokens, fmtMultiple, fmtRange, fmtUsd, fmtFormula,
            fmtScenarioLine, badgeText, isPromoExpired, isStale }
```

`test_data.js` **从 `index.html` 原文抽取该段文本**并用 `new Function` 执行——测的就是页面运行的那份代码，不是重写的第二份。这是本次改动的核心机制：双实现是"精度幻觉"的病根。

### 7.2 `test_data.js` 断言（零依赖）

| # | 断言 |
|---|---|
| 1 | `index.html` 内联的 `SCENARIO`/`PLANS` 与 `plans.json` 深度相等 |
| 2 | `plans.json` 全文中不存在 `per10` 字段（守住 D5，防回潮） |
| 3 | 每个已排行：`low ≤ base ≤ high`；`per10` 下界序列非递增；待查行在末尾 |
| 4 | 回归锚：OpenCode 倍数三角均 `=== 1.5`；腾讯 Max `per10` 基准 `=== 57173679`（token 数取整后）；火山 Lite `per10` 下界 `=== 32400000`；基线（1:3）`=== 22153846` |
| 5 | 徽章计数 == 计算出的 `assumption_count` == 派生 `estimated` 的依据 |
| 6 | `index.html` 不含 `fetch(` |
| 7 | 已排行行的 `verified.sources` 非空；每个无出处假设显式写了 `"source": null` |
| 8 | 陈旧判定：注入 `todayISO` 后，OpenCode 的 `promo_until` 判为已过期。**测试不得使用真实当前日期**，否则结果不确定 |

### 7.3 CI

新增 `.github/workflows/check.yml`：`actions/setup-node` + `node test_data.js`，无需 `npm install`（零依赖）。这是"算错会被卡下"的唯一兑现方式。仓库目前没有 `.github/`。

### 7.4 删除 `test_data.py`

同一套校验 Node 全可做，保留它即构成双实现，且它在中文 Windows 上因 `open("plans.json")` 缺 `encoding="utf-8"` 直接崩溃（实测 `UnicodeDecodeError: 'gbk' codec`，加 `PYTHONUTF8=1` 才通过）。**代价：习惯 Python 的贡献者需改用 `node test_data.js`**，README 必须写明。

## 8. 仓库改动清单

| 文件 | 改动 |
|---|---|
| `plans.json` | 重写为 `{scenario, plans}`；锚价改为 ¥ 原语（含缓存命中价与峰谷）；14 行改为原语；删除全部 `per10` / `per10_peak` |
| `index.html` | 新增 FORMULA 纯函数块；渲染改为派生；新增基线行、倍数列、核验日期；移除页脚全局日期；加横向滚动容器 |
| `test_data.js` | 新增（7.2 的八条断言） |
| `test_data.py` | **删除** |
| `.github/workflows/check.yml` | 新增 |
| `README.md` / `README.zh-CN.md` | 见 8.1 |
| `docs/superpowers/specs/2026-10-03-aiplanrank-precision-design.md` | 本文件 |

### 8.1 文案后果（属实现范围）

1. 开头「火山 Lite/Pro ~1.5亿* 排第一」→ 改为按 `per10` 下界的真实名次，并点明前四名是腾讯、极差 7.8%
2. 「OpenCode Go 3,077万 **exact**」→ 改为「倍数恒 1.5×，与用途无关」；`官方直算` 帽子移交腾讯
3. 锚价说明从 `$0.15/$0.60` 改为 `¥1/¥4（缓存未命中，空闲）`，并声明 `fx = 7.2` 同时作用于锚价与套餐价
4. 「一行 = 价格 + 额度 + **公式** + 来源」→「…+ **假设** + 来源」
5. 「What's inside」的 Formula 行 → 改为讲假设数与双轴区间
6. 收录规则表增收：假设必须给 `low/base/high`；无出处必须显式 `source: null`
7. 新增「怎么复算」小节：两条命令从 `plans.json` 得到页面上的数
8. 贡献段：PR 者须填假设，且须接受区间下界排序可能压低其名次
9. 仓库结构块：`plans.json` 描述改为「场景 + 原语」，补 `test_data.js` 与 `.github/`

## 9. 验收标准

1. 页面任一有数字的行，外部人能按 README「怎么复算」独立算出
2. `plans.json` 中 grep 不到 `per10`
3. **故意改坏一个原语，`node test_data.js` 与 CI 必须变红**（实施时实际执行一次并展示输出）
4. 任一徽章能对应到 `plans.json` 中具体的 `source: null`
5. 375px 宽下页面不横向溢出
6. OpenCode 行显示促销已结束（6.4 的实例）

## 10. 已知弱点

1. `tokens/请求` 的 `1000 / 20000` 是**量级包围，不是证据**，`source` 为 `null`。它是占位，等实测来源出现后收紧。
2. 90 天陈旧阈值是拍的，无依据。
3. 混合比轴两端取物理边界（全输入/全输出），比任何真实工作负载都宽，因此区间偏保守。
4. `fx` 固定 7.2，不计汇率浮动，且不计入假设数；美元计价行的倍数依赖它。
5. 腾讯「综合单价」的基准混合比未公开，5.4 的保留意见只是提示，未被建模。
6. **缓存轴仍未建模，而官方价已就位**：输入缓存命中 ¥0.02/1M 比未命中 ¥1 便宜 50 倍。若按 `混合比 1:3 + 99.93% 输入命中` 计算，基线升到 **9,584万**（无缓存时 2,215万，差 4.3 倍），腾讯倍数降到 **0.597×**、火山降到 **0.338×**，而 OpenCode 仍是 **1.5×**。也就是说，一旦缓存进模型，全榜只剩美元额度行保底划算。这是最值得优先做的下一项。
7. 头条数字用谷时，而峰值时段覆盖工作日常规写码时间（2.5 缺陷 3）。
8. 阿里四行与 Atlas 三行的待查状态未解决，半张榜仍是空的。
9. 请求数行的峰值列为 `null`（无官方依据），显示 `—`。

### 10.1 整支审查后的遗留项（不阻塞合并，来自最终审查与修复波复审）

10. **渲染层在仓库内没有任何自动化守护。** 验收用的 DOM 桩检查器（17 项断言，含 `NaN`/`Infinity` 扫描）位于 gitignore 的 `.superpowers/` 工作区；把它提升进仓库并接入 CI 超出本 spec §7 的范围，留给作者决定。它是最高价值的后续项：开发期间它抓到过 `FORMULA is not defined`（页面渲染 0 行而 49 条断言全绿）与 `per10.base` 的 NaN 一族。
11. **`fmtFormula` 在契约外数据上抛异常。** 请求数行若缺 `tokens_per_request.base`，`trimNum(t.base, 0)` 抛 `TypeError` 并中止整表渲染（此前该行渲染为 NaN）。§7.2 只断言 `source` 键存在，没有断言 `base` 必须存在。
12. **价格与系数没有正数保护。** `price.usd: 0` 或 `credits_per_1m.base: 0` 仍评为 `ranked`，页面会打印 `Infinity亿` 与 `÷ $0 × 10` 这类公式串。`peak_multiplier` 是唯一被检查了正数的量。
13. **`fmtFormula` 覆盖不全。** `token` 分支与两个非 base 的 credit 分支没有夹具；`assert14a` 断言的是 `fmtScenarioLine` 的返回值而非表头接线，因此删掉表头那行赋值后测试仍然全绿。
14. **7 个待查行的 `note` 仍不渲染。** C2 只把已排行行的 `note` 送上了页面；待查行（4 个阿里 + 3 个 Atlas）的 `note` 依旧只存在于 `plans.json`——与 C2 同类的"维护了但不生效"的字段。


## 11. 风险

| 风险 | 说明 |
|---|---|
| `plans.json` diff 巨大 | 14 行全部重写；历史 `per10` 值在 git 历史中可追溯，不回填 |
| 名次与文案同时改变 | README 开头是项目门面，本次改动会改写它；这是 D3 的诚实代价 |
| 删除 `test_data.py` | 可能让偏好 Python 的贡献者不适；README 需明确替代命令 |
| 区间偏宽 | 物理边界 + 量级包围叠加后区间很宽，可能被读成"这数没用"；页面须明确"下界是悲观包络，基准值才是对照历史默认的口径" |
| 锚价改 ¥ 后全表数值变化 | 倍数整体移动约 8%（基线 2,051万 → 2,215万）；这是修正缺陷 1 的必然结果，需在提交信息里说明 |
