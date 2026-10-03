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
  ' rowStats, rank, trimNum, fmtTokens, fmtMultiple, fmtRange, badgeText, isPromoExpired, isStale };'
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

if (failed) { console.error('\n' + failed + ' assertion(s) failed'); process.exit(1); }
console.log('\nall assertions passed');
