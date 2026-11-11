// 账单首页：月度汇总 + 预算进度 + 按日分组的账单列表
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');
const classify = require('../../utils/classify');
const recurring = require('../../utils/recurring');

// 连续记账天数（今天没记就从昨天往前算）
function calcStreak(all) {
  const days = {};
  all.forEach(function (r) { days[r.date] = true; });
  const d = new Date();
  if (!days[util.today()]) d.setDate(d.getDate() - 1);
  let count = 0;
  for (let i = 0; i < 500; i++) {
    const s = d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate());
    if (!days[s]) break;
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

Page({
  data: {
    month: '',
    summary: { expense: '0.00', income: '0.00', balance: '0.00' },
    groups: [],
    isEmpty: true,
    budget: { total: '0.00', used: '0.00', left: '0.00', pct: 0, over: false, overText: '0.00', has: false },
    streak: 0
  },

  onShow() {
    if (!this.data.month) {
      this.setData({ month: util.curMonth() });
    }
    // 跨天后确保周期账单补齐
    try { recurring.materialize(); } catch (e) { /* 忽略 */ }
    this.reload();
  },

  onPullDownRefresh() {
    this.reload();
    wx.stopPullDownRefresh();
  },

  prevMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, -1) });
    this.reload();
  },

  nextMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, 1) });
    this.reload();
  },

  reload() {
    const all = store.all();
    const month = this.data.month;
    const list = all.filter(function (r) { return r.date.slice(0, 7) === month; });

    let exp = 0;
    let inc = 0;
    const map = {};
    list.forEach(function (r) {
      if (r.type === 'income') inc += r.amount;
      else if (r.type === 'expense') exp += r.amount;
      if (!map[r.date]) map[r.date] = [];
      map[r.date].push(r);
    });

    const dates = Object.keys(map).sort().reverse();
    const groups = dates.map(function (date) {
      let de = 0;
      let di = 0;
      const items = map[date]
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
        .map(function (r) {
          if (r.type === 'income') di += r.amount;
          else if (r.type === 'expense') de += r.amount;
          if (r.type === 'transfer') {
            const from = settings.accountById(r.accountId) || { name: '账户' };
            const to = settings.accountById(r.toAccountId) || { name: '账户' };
            return {
              id: r.id,
              type: 'transfer',
              icon: '🔄',
              catName: '转账',
              note: from.name + ' → ' + to.name,
              amountText: '¥' + util.fmtMoney(r.amount)
            };
          }
          const c = cats.byId(r.type, r.categoryId);
          const acc = r.accountId ? settings.accountById(r.accountId) : null;
          // 只有「非默认账户」才在列表里标注，保持默认账户下的列表样式与以前一致
          const accTag = acc && acc.id !== settings.defaultAccount() ? ' · ' + acc.name : '';
          return {
            id: r.id,
            type: r.type,
            icon: c.icon,
            catName: c.name,
            note: (classify.merchantOf(r) || r.note || '') + accTag,
            amountText: (r.type === 'income' ? '+' : '-') + util.fmtMoney(r.amount)
          };
        });
      return {
        date: date,
        label: util.dayLabel(date),
        items: items,
        dayExpense: util.fmtMoney(de),
        dayIncome: util.fmtMoney(di)
      };
    });

    // 预算进度（只统计支出，本月通用预算）
    const b = settings.budget();
    const pctRaw = b.total > 0 ? Math.round(exp / b.total * 100) : 0;
    const budget = {
      has: b.total > 0,
      total: util.fmtMoney(b.total),
      used: util.fmtMoney(exp),
      left: util.fmtMoney(Math.max(0, b.total - exp)),
      pct: Math.min(100, pctRaw),
      over: b.total > 0 && exp > b.total,
      overText: util.fmtMoney(Math.max(0, exp - b.total))
    };

    this.setData({
      groups: groups,
      isEmpty: list.length === 0,
      summary: {
        expense: util.fmtMoney(exp),
        income: util.fmtMoney(inc),
        balance: util.fmtMoney(inc - exp)
      },
      budget: budget,
      streak: calcStreak(all)
    });
  },

  goAdd() { wx.navigateTo({ url: '/pages/add/add' }); },
  goImport() { wx.navigateTo({ url: '/pages/import/import' }); },
  goDetail() { wx.navigateTo({ url: '/pages/detail/detail' }); },
  goCalendar() { wx.navigateTo({ url: '/pages/calendar/calendar?month=' + this.data.month }); },
  goAccounts() { wx.navigateTo({ url: '/pages/accounts/accounts' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget' }); },
  goRecurring() { wx.navigateTo({ url: '/pages/recurring/recurring' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },

  editItem(e) {
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    if (type === 'transfer') {
      wx.showToast({ title: '转账请到「账户」页管理', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/add/add?id=' + id });
  },

  onLongItem(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showActionSheet({
      itemList: ['删除这条记录'],
      success(res) {
        if (res.tapIndex === 0) {
          store.remove(id);
          that.reload();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  }
});
