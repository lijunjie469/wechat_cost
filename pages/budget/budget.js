// 预算管理：总预算 + 分类预算（每月通用）
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');

Page({
  data: {
    month: '',
    totalInput: '',
    catRows: [],
    usedText: '0.00',
    leftText: '0.00',
    pct: 0,
    over: false,
    hasBudget: false
  },

  onShow() {
    this.reload();
  },

  reload() {
    const month = util.curMonth();
    const b = settings.budget();
    const recs = store.all().filter(function (r) {
      return r.type === 'expense' && r.date.slice(0, 7) === month;
    });
    const usedMap = {};
    let used = 0;
    recs.forEach(function (r) {
      used += r.amount;
      usedMap[r.categoryId] = (usedMap[r.categoryId] || 0) + r.amount;
    });

    const rows = cats.EXPENSE.map(function (c) {
      const budget = Number(b.cats[c.id]) || 0;
      const u = usedMap[c.id] || 0;
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        budgetInput: budget ? String(budget) : '',
        usedText: util.fmtMoney(u),
        pct: budget ? Math.min(100, Math.round(u / budget * 100)) : 0,
        over: budget > 0 && u > budget,
        has: budget > 0
      };
    });

    const pct = b.total ? Math.round(used / b.total * 100) : 0;
    this.setData({
      month: month,
      totalInput: b.total ? String(b.total) : '',
      catRows: rows,
      usedText: util.fmtMoney(used),
      leftText: util.fmtMoney(Math.max(0, b.total - used)),
      overText: util.fmtMoney(Math.max(0, used - b.total)),
      pct: Math.min(100, pct),
      over: b.total > 0 && used > b.total,
      hasBudget: b.total > 0
    });
  },

  onTotal(e) {
    this.setData({ totalInput: e.detail.value });
  },

  onCat(e) {
    const id = e.currentTarget.dataset.id;
    const rows = this.data.catRows.map(function (r) {
      if (r.id !== id) return r;
      return Object.assign({}, r, { budgetInput: e.detail.value });
    });
    this.setData({ catRows: rows });
  },

  // 参考上月实际支出，一键填入
  fillLastMonth() {
    const last = util.shiftMonth(util.curMonth(), -1);
    const recs = store.all().filter(function (r) {
      return r.type === 'expense' && r.date.slice(0, 7) === last;
    });
    if (!recs.length) {
      wx.showToast({ title: '上月没有支出记录', icon: 'none' });
      return;
    }
    let total = 0;
    const map = {};
    recs.forEach(function (r) {
      total += r.amount;
      map[r.categoryId] = (map[r.categoryId] || 0) + r.amount;
    });
    const rows = this.data.catRows.map(function (r) {
      const v = map[r.id] || 0;
      return Object.assign({}, r, { budgetInput: v ? String(Math.round(v)) : '' });
    });
    this.setData({
      totalInput: String(Math.round(total)),
      catRows: rows
    });
    wx.showToast({ title: '已按上月数据填入', icon: 'none' });
  },

  save() {
    const total = parseFloat(this.data.totalInput);
    if (this.data.totalInput && (isNaN(total) || total < 0)) {
      wx.showToast({ title: '总预算格式不对', icon: 'none' });
      return;
    }
    const catsBudget = {};
    let invalid = false;
    this.data.catRows.forEach(function (r) {
      const v = parseFloat(r.budgetInput);
      if (r.budgetInput && (isNaN(v) || v < 0)) invalid = true;
      if (v > 0) catsBudget[r.id] = Math.round(v * 100) / 100;
    });
    if (invalid) {
      wx.showToast({ title: '分类预算格式不对', icon: 'none' });
      return;
    }
    settings.setBudget(Math.round((total || 0) * 100) / 100, catsBudget);
    wx.showToast({ title: '预算已保存', icon: 'success' });
    const that = this;
    setTimeout(function () { that.reload(); }, 300);
  },

  clearAll() {
    const that = this;
    wx.showModal({
      title: '清除预算',
      content: '清空总预算和所有分类预算？',
      confirmColor: '#E64340',
      success(res) {
        if (!res.confirm) return;
        settings.setBudget(0, {});
        that.setData({ totalInput: '' });
        that.reload();
      }
    });
  }
});
