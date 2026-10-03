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
