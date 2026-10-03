# aiplanrank
*先看再订 — $10 = 多少 flash token。*
[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950?style=flat-square&labelColor=black)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Finn763/aiplanrank?style=flat-square&logo=github&labelColor=black)](https://github.com/Finn763/aiplanrank/stargazers)
[中文](README.zh-CN.md) | English

> 每家套餐用不同单位报价，不同模型的token也不等价，aiplanrank只留一个数：$10 flash等价Token。
请求数、prompt、credits、AFP——厂商从不说同一种话，按次计费的更不印Token数。aiplanrank把所有AI编程订阅折成一个可比数字（每$10美元的tokens），每个数旁边都带公式和来源。
---
## 为什么做aiplanrank
解决买订阅时必踩的三个坑：
- **#1：单位不可比。** 18000次 vs $60 credits vs 100000 AFP，没法直接比。**解：** 每家只比$10 flash等价Token（按旗舰模型API价折），公式公开。
- **#2：按次套餐藏Token。** Coding Plan只印次数不印Token，实际量看模型、倍率、高峰系数。**解：** 估算值打`*`，假设写在明处。
- **#3：静态表放半个月就烂。** 价格倍率几周一变。**解：** 数据全在`plans.json`，一个带来源链接的PR即更新全榜。
> 种子快照（每 $10，谷时，**按双轴区间的下界排**：入:出混合比 × tokens/请求）：腾讯云 TokenHub Pro 5,737万 `官方直算` > 腾讯云 Max 5,717万 > 腾讯云 Standard 5,664万 > 腾讯云 Lite 5,291万 > 火山 Lite/Pro 3,240万（请求数口径，1 个假设）> OpenCode Go 2,700万（倍数恒 **1.500×**，与你的用法无关）。前四名全是腾讯且极差仅 7.8%，它们之间的名次没有决策意义。在悲观角上，腾讯（0.797×）与火山（0.450×）都**跌破 1.0×**，即不如直接充 API。阿里百炼与 Atlas Cloud 宁可标待查也不猜。锚价与每条假设都能从 `plans.json` 复算。
---
## 怎么跑
四文件，无构建，无后端。
1. **数据** — `plans.json` 存场景（人民币原语锚价、`fx`、混合比上下限、缓存命中率）与每个套餐自己的价格/额度/假设原语——`per10` 从不落盘。
2. **排行** — `index.html` 数据内联（`file://` 可直开），按**双轴区间（入:出混合比 × tokens/请求）的下界**排名，渲染 10 列表格，首行是「直接充 API」的合成基线。
3. **看** — 本地直接打开`index.html`，公开访问开Pages。
---
## 收录规则
| 维度 | 规则 |
|---|---|
| 单位 | 每 $10 flash 等价 Token（锚模型 `deepseek-flash` / DeepSeek-V4.1-Flash，官方 ¥1 入 / ¥4 出每 1M，空闲时段，缓存未命中口径，¥7.2 = $1） |
| 入榜门槛 | 价格与额度都得有官方出处；系数未公开的标`待查`，不猜 |
| 公式 | 每行自带假设与派生出的假设数（`0` = 官方直算）；`per10` 从不落盘——页面与测试跑同一份抽取出来的代码 |
| 来源 | 每行链官方页并各自标注 `verified` 核验日期；无来源链接的 PR 不合 |
| 范围 | 仅收官方明确含deepseek-v4.1-flash的套餐（单厂套餐已剔除） |
| 假设 | 量级包围必须给 `low/base/high`；无公开出处的量必须显式写 `"source": null`，不许留空、不许猜 |
---
**仓库结构**
```
plans.json     # 场景（锚价、汇率、上下限）+ 套餐原语 —— 不含 per10
index.html     # FORMULA 块 + 渲染；数据内联（file:// 可直开）
test_data.js   # 抽取 FORMULA 块，校验同步与回归锚
.github/workflows/check.yml
```
## 贡献
欢迎PR：一行=价格+额度+假设+来源链接，估算打`*`。过期数据直接修。新增套餐必须填假设；按区间下界排序可能让区间更宽的行名次低于区间更紧的行——这是刻意行为。
## 怎么复算

```bash
# 1. 校验页面、数据与公式三者一致（含回归锚）
node test_data.js

# 2. 用页面同一份代码打印全榜
node -e "const fs=require('fs'),h=fs.readFileSync('index.html','utf8'),m=h.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);const F=new Function(m[1]+';return {rank,rowStats,baselinePer10,fmtTokens,fmtMultiple};')();const d=require('./plans.json');console.log('baseline',F.fmtTokens(F.baselinePer10(d.scenario,d.scenario.baseline_mix.in_out)));F.rank(d.plans,d.scenario).forEach(r=>console.log(r.id,r.status,F.fmtTokens(r.per10.low),r.status==='ranked'?F.fmtMultiple(r.multiple.low)+' – '+F.fmtMultiple(r.multiple.high):r.reason,r.count));"
```
## License
[MIT](LICENSE)
*看到数字再下单。*
