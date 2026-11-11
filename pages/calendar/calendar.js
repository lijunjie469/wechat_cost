// 日历视图：每天收支一目了然，点日期看当日流水
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');
const classify = require('../../utils/classify');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

Page({
  data: {
    month: '',
    weekLabels: WEEK,
    cells: [],
    summary: { expense: '0.00', income: '0.00' },
    selDate: '',
    selList: [],
    selExpense: '0.00',
    selIncome: '0.00',
    monthTitle: ''
  },

  onLoad(options) {
    const month = (options && options.month) || util.curMonth();
    this.setData({ month: month });
    this.build();
  },

  onShow() {
    if (this.data.month) this.build();
  },

  prevMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, -1), selDate: '' });
    this.build();
  },

  nextMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, 1), selDate: '' });
    this.build();
  },

  build() {
    const month = this.data.month;
    const parts = month.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const dim = util.daysInMonth(month);
    const firstWeekday = new Date(y, m - 1, 1).getDay();

    const recs = store.all().filter(function (r) { return r.date.slice(0, 7) === month; });
    let exp = 0;
    let inc = 0;
    recs.forEach(function (r) {
      if (r.type === 'expense') exp += r.amount;
      else if (r.type === 'income') inc += r.amount;
    });

    const expMap = {};
    const incMap = {};
    recs.forEach(function (r) {
      const d = r.date;
      if (r.type === 'expense') expMap[d] = (expMap[d] || 0) + r.amount;
      if (r.type === 'income') incMap[d] = (incMap[d] || 0) + r.amount;
    });

    const today = util.today();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ blank: true, key: 'b' + i });

    for (let d = 1; d <= dim; d++) {
      const date = month + '-' + util.pad(d);
      const e = expMap[date] || 0;
      const i2 = incMap[date] || 0;
      cells.push({
        key: date,
        day: d,
        date: date,
        exp: e ? util.fmtMoney(e) : '',
        inc: i2 ? util.fmtMoney(i2) : '',
        has: !!(e || i2),
        today: date === today,
        inMonth: true
      });
    }
    // 补满整行
    while (cells.length % 7 !== 0) cells.push({ blank: true, key: 'x' + cells.length });

    const sel = this.data.selDate && this.data.selDate.slice(0, 7) === month
      ? this.data.selDate
      : (today.slice(0, 7) === month ? today : month + '-01');

    this.setData({
      cells: cells,
      monthTitle: y + '年' + m + '月',
      summary: { expense: util.fmtMoney(exp), income: util.fmtMoney(inc) },
      selDate: sel
    });
    this.buildSel(sel);
  },

  buildSel(date) {
    if (!date) {
      this.setData({ selList: [], selExpense: '0.00', selIncome: '0.00' });
      return;
    }
    const rows = store.all().filter(function (r) { return r.date === date; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    let exp = 0;
    let inc = 0;
    const list = rows.map(function (r) {
      if (r.type === 'transfer') {
        const from = settings.accountById(r.accountId);
        const to = settings.accountById(r.toAccountId);
        return {
          id: r.id,
          icon: '🔄',
          name: '转账',
          note: (from ? from.name : '') + ' → ' + (to ? to.name : ''),
          amountText: '¥' + util.fmtMoney(r.amount),
          type: 'transfer'
        };
      }
      const c = cats.byId(r.type, r.categoryId);
      if (r.type === 'expense') exp += r.amount; else inc += r.amount;
      return {
        id: r.id,
        icon: c.icon,
        name: c.name,
        note: (classify.merchantOf(r) || r.note || ''),
        amountText: (r.type === 'expense' ? '-' : '+') + util.fmtMoney(r.amount),
        type: r.type
      };
    });

    this.setData({
      selList: list,
      selExpense: util.fmtMoney(exp),
      selIncome: util.fmtMoney(inc)
    });
  },

  tapDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ selDate: date });
    this.buildSel(date);
  },

  goDayDetail() {
    if (!this.data.selDate) return;
    wx.navigateTo({
      url: '/pages/detail/detail?from=' + this.data.selDate + '&to=' + this.data.selDate
    });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' });
  }
});
