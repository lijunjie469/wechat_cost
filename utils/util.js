// 通用工具：日期与金额格式化

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 今天 'YYYY-MM-DD'
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 当前月 'YYYY-MM'
function curMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

// 月份偏移: shiftMonth('2026-10', -1) -> '2026-09'
function shiftMonth(ym, delta) {
  const parts = ym.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

// 某月天数
function daysInMonth(ym) {
  const parts = ym.split('-');
  return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
}

// 金额格式化: 1234.5 -> '1234.50'
function fmtMoney(n) {
  return Number(n || 0).toFixed(2);
}

// 日期分组标签: 今天/昨天/周X
function dayLabel(dateStr) {
  if (dateStr === today()) return '今天';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yStr = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
  if (dateStr === yStr) return '昨天';
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = new Date(dateStr + 'T00:00:00');
  return w[d.getDay()];
}

module.exports = {
  pad: pad,
  today: today,
  curMonth: curMonth,
  shiftMonth: shiftMonth,
  daysInMonth: daysInMonth,
  fmtMoney: fmtMoney,
  dayLabel: dayLabel
};
