// 统计分析：交易对手 / 金额区间 / 大额支出 / 月度汇总
const util = require('./util');
const cats = require('./categories');

// 某月的记录
function monthRecs(all, month) {
  return all.filter(function (r) { return r.date.slice(0, 7) === month; });
}

function sumBy(list, type) {
  let s = 0;
  list.forEach(function (r) { if (r.type === type) s += r.amount; });
  return s;
}

// 对手名：优先微信的「交易对方」，手工记账用备注
// 对手/商家名：优先真实商户名，交易对方只是「支付宝」「微信支付」这类渠道时退回备注
const classify = require('./classify');
function partyName(r) {
  const raw = classify.merchantOf(r);
  return String(raw || '未命名').trim().slice(0, 20);
}

// 交易对手聚合（按类型），返回 [{name, sum, count, pct}]
function partyAgg(recs, type) {
  const map = {};
  recs.forEach(function (r) {
    if (r.type !== type) return;
    const k = partyName(r);
    const o = map[k] || (map[k] = { name: k, sum: 0, count: 0, ids: [] });
    o.sum += r.amount;
    o.count++;
    o.ids.push(r.id);
  });
  const total = Object.keys(map).reduce(function (s, k) { return s + map[k].sum; }, 0) || 1;
  return Object.keys(map).map(function (k) {
    const o = map[k];
    o.pct = Math.round(o.sum / total * 100);
    return o;
  }).sort(function (a, b) { return b.sum - a.sum; });
}

// 某个对手近 N 个月的金额（按月）
function partyMonthly(all, name, months, type) {
  return months.map(function (m) {
    let sum = 0;
    all.forEach(function (r) {
      if (r.type !== type) return;
      if (r.date.slice(0, 7) !== m) return;
      if (partyName(r) !== name) return;
      sum += r.amount;
    });
    return { month: m.slice(5), sum: sum };
  });
}

const BUCKETS = [
  { label: '0-10', min: 0, max: 10 },
  { label: '10-50', min: 10, max: 50 },
  { label: '50-100', min: 50, max: 100 },
  { label: '100-500', min: 100, max: 500 },
  { label: '500-1000', min: 500, max: 1000 },
  { label: '1000-5000', min: 1000, max: 5000 },
  { label: '5000+', min: 5000, max: Infinity }
];

// 金额区间分布
function bucketStats(expenses) {
  const total = expenses.reduce(function (s, r) { return s + r.amount; }, 0) || 1;
  return BUCKETS.map(function (b) {
    const list = expenses.filter(function (r) { return r.amount >= b.min && r.amount < b.max; });
    const sum = list.reduce(function (s, r) { return s + r.amount; }, 0);
    return {
      label: b.label,
      sum: sum,
      count: list.length,
      pct: Math.round(sum / total * 100)
    };
  });
}

// 大额支出，按金额降序
function bigExpenses(expenses, threshold) {
  return expenses.filter(function (r) { return r.amount >= threshold; })
    .sort(function (a, b) { return b.amount - a.amount; });
}

// 近 N 个月的收支汇总
function monthSummary(all, endMonth, n) {
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = util.shiftMonth(endMonth, -i);
    const rs = monthRecs(all, m);
    rows.push({
      month: m,
      label: Number(m.slice(5)) + '月',
      expense: sumBy(rs, 'expense'),
      income: sumBy(rs, 'income'),
      count: rs.length
    });
  }
  return rows;
}

// 分类明细（排行用）
function categoryRows(recs, type) {
  const byCat = {};
  let total = 0;
  recs.forEach(function (r) {
    if (r.type !== type) return;
    total += r.amount;
    byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount;
  });
  return Object.keys(byCat).map(function (id) {
    const c = cats.byId(type, id);
    return { id: id, name: c.name, icon: c.icon, sum: byCat[id], pct: total ? Math.round(byCat[id] / total * 100) : 0 };
  }).sort(function (a, b) { return b.sum - a.sum; });
}

module.exports = {
  monthRecs: monthRecs,
  sumBy: sumBy,
  partyName: partyName,
  partyAgg: partyAgg,
  partyMonthly: partyMonthly,
  bucketStats: bucketStats,
  bigExpenses: bigExpenses,
  monthSummary: monthSummary,
  categoryRows: categoryRows
};
