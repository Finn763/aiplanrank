const fs = require('fs');
const path = require('path');

const root = __dirname;
const plansText = fs.readFileSync(path.join(root, 'plans.json'), 'utf8');
const plansDoc = JSON.parse(plansText);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const formulaMatch = html.match(/\/\* FORMULA:START \*\/([\s\S]*?)\/\* FORMULA:END \*\//);
if (!formulaMatch) { console.error('FAIL: index.html has no FORMULA block'); process.exit(1); }
const FORMULA = new Function(
  formulaMatch[1] +
  '; return { fxRate, effInputCny, blendCny, baselinePer10, priceUsd, corners, planTokens, per10Of,' +
  ' anchorAt, planTokensPeak, per10Peak, status, pendingReason, assumptionCount, isEstimated,' +
  ' rowStats, rank, trimNum, fmtTokens, fmtMultiple, fmtRange, fmtUsd, fmtFormula, fmtScenarioLine,' +
  ' badgeText, isPromoExpired, isStale };'
)();

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

// I2：peak_multiplier 与锚价里的峰价是同一事实的两份表示，必须钉住关系而不是各写各的（spec §5.1）
assert(typeof sc.peak_multiplier === 'number' && sc.peak_multiplier > 1, 'assert0l: peak_multiplier is a declared number > 1');
const ANCHOR_PARTS = ['input_cache_miss', 'input_cache_hit', 'output'];
const skewBad = ANCHOR_PARTS.filter(function (k) {
  const a = sc.anchor.price_cny_per_1m[k];
  return a.peak !== a.off_peak * sc.peak_multiplier;
});
assert(skewBad.length === 0, 'assert0m: every anchor peak price === off_peak × peak_multiplier (offenders: ' + skewBad.join(',') + ')');

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

// I1：无出处的 tokens_per_credit 也是假设。合成一行来钉住这条路径（spec §9.4：任一徽章对应具体的 source: null）
const syntheticTpc = {
  id: 'synthetic-tpc', vendor: '合成', name: 'Synthetic',
  price: { usd: 10, text: '$10/月', basis: 'monthly', promo_until: null },
  quota: { amount: 1000, unit: 'credit', window: 'month', sub_limit: null, shared: false },
  assumptions: { tokens_per_credit: { base: 0.55, source: null } },
  verified: { date: '2026-09-27', sources: ['https://example.invalid/'] },
  note: ''
};
const syntheticStats = FORMULA.rowStats(syntheticTpc, S);
assert(syntheticStats.status === 'ranked' && syntheticStats.count === 1, 'assert5g: an unsourced tokens_per_credit counts as 1 assumption (got ' + syntheticStats.count + ')');
assert(FORMULA.badgeText(syntheticStats.count) === '1 个假设', 'assert5h: that row badges as 1 个假设, not 官方直算');

// C1：可复算的公式串（spec §6.1）——三种单位各一例，数字全部现算
assert(FORMULA.fmtFormula(byId('volc-lite'), S) === '18000 次 × 4625 tokens/次 ÷ $5.56 × 10', 'assert9a: request 行的公式串');
assert(FORMULA.fmtFormula(byId('tc-max'), S) === '15900 积分 ÷ 27 积分/1M × 10⁶ ÷ $103 × 10', 'assert9b: credit 行的公式串');
assert(FORMULA.fmtFormula(byId('opencode-go'), S) === '$15 额度 ÷ 锚价 $0.4514/1M × 10⁶ ÷ $10 × 10', 'assert9c: usd_credit 行的公式串');
assert(FORMULA.fmtFormula(byId('ali-lite'), S) === null, 'assert9d: 待查行的公式串为 null（不编数字）');
const formulaNoPriceStep = FORMULA.rank(plansDoc.plans, S).filter(function (r) { return r.status === 'ranked'; })
  .filter(function (r) {
    const f = FORMULA.fmtFormula(byId(r.id), S);
    return !f || !/ ÷ \$\S+ × 10$/.test(f);
  }).map(function (r) { return r.id; });
assert(formulaNoPriceStep.length === 0, 'assert9e: 每个已排行行的公式串都以价格步收尾（不符: ' + formulaNoPriceStep.join(',') + '）');

assert(FORMULA.fmtTokens(32400000) === '3,240万', 'assert8e: token formatting');
assert(FORMULA.fmtTokens(22153846) === '2,215万', 'assert8f: baseline formatting');
assert(FORMULA.fmtTokens(149850000) === '1.5亿', 'assert8g: 亿 formatting');
assert(FORMULA.fmtMultiple(1.5) === '1.5×' && FORMULA.fmtMultiple(3.176) === '3.176×', 'assert8h: multiple formatting');

// --- 呈现层 ---
assert(!/fetch\(/.test(html), 'assert6: index.html is fetch-free');
assert(/id="t"/.test(html), 'assert6b: table#t exists');
assert(/overflow-x\s*:\s*auto/.test(html), 'assert6c: table wrapper scrolls horizontally');
assert(html.indexOf('相对直充 API') >= 0, 'assert6d: baseline column header present');
assert(html.indexOf('现金直充 DeepSeek API') >= 0, 'assert6e: synthetic baseline row present');
assert(html.indexOf('new Date()') >= 0, 'assert6f: page injects the viewer date');
assert(!/FORMULA:START[\s\S]*?Date\.now\(\)/.test(html), 'assert6g: FORMULA block does not read the clock');
// I3：抽取机制的意义在于块内是纯函数——所以直接检查被抽取的那段文本本身（spec §7.1、全局约束）
const PURITY_TOKENS = ['new Date(', 'Date.now(', 'document', 'window', 'fetch('];
const purityBad = PURITY_TOKENS.filter(function (t) { return formulaMatch[1].indexOf(t) >= 0; });
assert(purityBad.length === 0, 'assert6h: FORMULA 块内不含 DOM/时钟引用（发现: ' + purityBad.join(' / ') + '）');

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

// --- 渲染层：用最小 document 桩真跑一遍页面脚本，断言单元格里确实出现了派生出来的文本 ---
// 只做「页面脚本取 DOM 的方式」这一件事，不复制 assertions；渲染的验收门槛在工作区的 dom-stub-check.js
const rendered = (function () {
  const out = [];
  function makeEl(tag) {
    return {
      tagName: tag, className: '', innerHTML: '', title: '', children: [],
      appendChild: function (c) { this.children.push(c); out.push(c); }
    };
  }
  const table = makeEl('table');
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  if (blocks.length !== 1) return out;
  const body = blocks[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  new Function('document', body)({
    getElementById: function (id) { return id === 't' ? table : null; },
    createElement: makeEl
  });
  return out;
})();
const ranked = order.filter(function (r) { return r.status === 'ranked'; });
// 页面按 FORMULA.rank 的顺序渲染，rendered[0] 是合成基线行
const rankIndex = order.map(function (r) { return r.id; });
const rowEl = function (id) { return rendered[rankIndex.indexOf(id) + 1]; };
const rowHtml = function (id) { const el = rowEl(id); return el ? String(el.innerHTML) : ''; };

const formulaNotRendered = ranked.filter(function (r) {
  return rowHtml(r.id).indexOf(FORMULA.fmtFormula(byId(r.id), S)) < 0;
}).map(function (r) { return r.id; });
assert(formulaNotRendered.length === 0, 'assert9f: 每个已排行行的公式串都渲染进了 假设与公式 单元格（缺失: ' + formulaNotRendered.join(',') + '）');

// C2：per-row note 必须上页面，不能再是「只维护、不显示」的字段（spec §5.4、§6.1）
const tcProNote = byId('tc-pro').note;
assert(tcProNote.length > 0 && rowHtml('tc-pro').indexOf(tcProNote) >= 0, 'assert9g: 腾讯的保留意见渲染进了该行的单元格');
const tcProRow = rowEl('tc-pro');
assert(!!tcProRow && tcProRow.title === tcProNote, 'assert9h: 该行 tr.title 也带上了 note');

// I5：表头声明的默认场景句由 SCENARIO 派生（spec §6.6）
const scenarioLine = FORMULA.fmtScenarioLine(S, plansDoc.plans);
const lineNeedles = [S.label, '¥1', '¥4', '7.2', '1:3', '1000', '20000', '0:1', '1:0'];
const lineMissing = lineNeedles.filter(function (n) { return scenarioLine.indexOf(n) < 0; });
assert(lineMissing.length === 0, 'assert14a: 表头声明句由 SCENARIO 派生（缺失: ' + lineMissing.join(',') + '）');
assert(html.indexOf('官方价 ¥1/1M') < 0 && html.indexOf('1000↔20000') < 0, 'assert14b: 表头不再手抄场景原语（锚价 / 量级包围）');

// --- 文案层：两份 README 印的数字必须等于页面算出来的数字（spec §8.1、I4） ---
const readmes = [
  { file: 'README.md', text: fs.readFileSync(path.join(root, 'README.md'), 'utf8') },
  { file: 'README.zh-CN.md', text: fs.readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8') }
];
const readmeMissingTokens = [];
readmes.forEach(function (rm) {
  ranked.forEach(function (r) {
    const t = FORMULA.fmtTokens(r.per10.low);
    if (rm.text.indexOf(t) < 0) readmeMissingTokens.push(rm.file + ' 缺 ' + r.id + '=' + t);
  });
});
assert(readmeMissingTokens.length === 0, 'assert13a: 两份 README 都印了每个已排行行的下界（' + readmeMissingTokens.join('; ') + '）');

const pinnedMultiple = ['opencode-go', 'volc-lite'];
const readmeMissingMult = [];
readmes.forEach(function (rm) {
  pinnedMultiple.forEach(function (id) {
    const st = stats[id];
    [st.multiple.low, st.multiple.high].forEach(function (m) {
      const t = FORMULA.fmtMultiple(m);
      if (rm.text.indexOf(t) < 0) readmeMissingMult.push(rm.file + ' 缺 ' + id + '=' + t);
    });
  });
});
assert(readmeMissingMult.length === 0, 'assert13b: 两份 README 都印了 OpenCode 与火山的倍数端点（' + readmeMissingMult.join('; ') + '）');

if (failed) { console.error('\n' + failed + ' assertion(s) failed'); process.exit(1); }
console.log('\nall assertions passed');
