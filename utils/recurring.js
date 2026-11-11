// 周期账单引擎：把到期模板生成真实账单
// 幂等策略：生成的记录带 extId = 'rc:<模板id>:<日期>'，重复调用不会重复入账
const store = require('./store');
const settings = require('./settings');
const util = require('./util');

// 某月第 day 天（自动收缩到月末，如 2 月 31 日 -> 2 月 28/29 日）
function dateFor(month, day) {
  const dim = util.daysInMonth(month);
  const d = Math.min(Math.max(1, Math.round(day) || 1), dim);
  return month + '-' + util.pad(d);
}

// 补齐所有到期周期账单，返回新增条数
function materialize() {
  const tpls = settings.recurring().filter(function (t) {
    return t && t.enabled !== false && Number(t.amount) > 0;
  });
  if (!tpls.length) return 0;

  const all = store.all();
  const seen = {};
  all.forEach(function (r) { if (r.extId) seen[r.extId] = true; });

  const today = util.today();
  const cur = util.curMonth();
  const toAdd = [];

  tpls.forEach(function (t) {
    const start = t.startMonth || cur;
    let m = start;
    let guard = 0;
    while (m <= cur && guard < 36) {
      const d = dateFor(m, t.day || 1);
      if (d <= today) {
        const key = 'rc:' + t.id + ':' + d;
        if (!seen[key]) {
          seen[key] = true;
          toAdd.push({
            type: t.type || 'expense',
            amount: Math.round(Number(t.amount) * 100) / 100,
            categoryId: t.categoryId || (t.type === 'income' ? 'salary' : 'other'),
            note: t.note || '周期账单',
            date: d,
            accountId: t.accountId || settings.defaultAccount(),
            extId: key,
            source: 'recurring'
          });
        }
      }
      m = util.shiftMonth(m, 1);
      guard++;
    }
  });

  if (!toAdd.length) return 0;
  const res = store.addMany(toAdd);
  return res.added;
}

// 预演：未来 12 个月每个模板会生成多少笔（用于模板管理页展示）
function preview(tpl, months) {
  const n = months || 12;
  const cur = util.curMonth();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const m = util.shiftMonth(cur, i);
    rows.push({ month: m, date: dateFor(m, tpl.day || 1) });
  }
  return rows;
}

module.exports = {
  dateFor: dateFor,
  materialize: materialize,
  preview: preview
};
