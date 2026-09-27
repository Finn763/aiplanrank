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
> 种子快照：火山 Lite/Pro约1.5亿*/$10（共享请求数）vs OpenCode Go谷1.23亿精确（官方单价表）——阿里Standard待查（credits系数未知）。公式见`plans.json`，欢迎独立复算。
---
## 怎么跑
三文件，无构建，无后端。
1. **数据** — `plans.json` 存价格+额度+公式+来源。
2. **排行** — `index.html` 拉取后按flash等价排序渲染。
3. **看** — 本地直接打开`index.html`，公开访问开Pages。
---
## 收录规则
| 维度 | 规则 |
|---|---|
| 单位 | 每家只比$10 flash等价Token（锚deepseek-v4.1-flash $0.2262/1M混合1:3）；按量精确，按次`*`估算 |
| 公式 | 每行自带折算假设，不收黑盒数字 |
| 来源 | 每行链官方页；无来源链接的PR不合 |
| 范围 | 仅收官方明确含deepseek-v4.1-flash的套餐（单厂套餐已剔除） |
---
**仓库结构**
```
plans.json   # 价格+额度+公式+来源（全部数据）
index.html   # 拉取+排序+渲染，无构建
```
## 贡献
欢迎PR：一行=价格+额度+公式+来源链接，估算打`*`。过期数据直接修。
## License
[MIT](LICENSE)
*看到数字再下单。*
