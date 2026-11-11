// 流水明细：多条件筛选 + 分页
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');
const classify = require('../../utils/classify');

const PAGE_SIZE = 50;

Page({
  data: {
    from: '',
    to: '',
    typeOptions: ['全部收支', '仅支出', '仅收入'],
    typeIndex: 0,
    catOptions: ['全部分类'],
    catIds: [''],
    catIndex: 0,
    q: '',
    total: 0,
    shown: 0,
    hasMore: false,
    empty: false,
    summary: { expense: '0.00', income: '0.00', balance: '0.00' },
    list: []
  },

  onLoad(options) {
    const opts = options || {};
    const patch = {};
    if (opts.from) patch.from = opts.from;
    if (opts.to) patch.to = opts.to;
    if (opts.type === 'expense') patch.typeIndex = 1;
    if (opts.type === 'income') patch.typeIndex = 2;

    const options2 = ['全部分类'];
    const ids = [''];
    cats.EXPENSE.forEach(function (c) { options2.push(c.icon + ' ' + c.name); ids.push(c.id); });
    cats.INCOME.forEach(function (c) {
      if (c.id === 'other_in') return;
      options2.push(c.icon + ' ' + c.name);
      ids.push(c.id);
    });
    patch.catOptions = options2;
    patch.catIds = ids;
    this.setData(patch);
    this.filter(true);
  },

  onShow() {
    this.filter();
  },

  onFrom(e) { this.setData({ from: e.detail.value }, () => this.filter(true)); },
  onTo(e) { this.setData({ to: e.detail.value }, () => this.filter(true)); },
  onType(e) { this.setData({ typeIndex: Number(e.detail.value) }, () => this.filter(true)); },
  onCat(e) { this.setData({ catIndex: Number(e.detail.value) }, () => this.filter(true)); },
  onQ(e) { this.setData({ q: e.detail.value }, () => this.filter(true)); },

  reset() {
    this.setData({ from: '', to: '', typeIndex: 0, catIndex: 0, q: '' }, () => this.filter(true));
  },

  // reset 为 true 时回到第一页
  filter(reset) {
    const from = this.data.from;
    const to = this.data.to;
    const typeMap = ['all', 'expense', 'income'];
    const type = typeMap[this.data.typeIndex];
    const catId = this.data.catIds[this.data.catIndex] || '';
    const q = String(this.data.q || '').trim().toLowerCase();

    const rows = store.all().filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (type !== 'all' && r.type !== type) return false;
      if (catId && r.categoryId !== catId) return false;
      if (q) {
        const c = cats.byId(r.type, r.categoryId);
        const accName = r.accountId && settings.accountById(r.accountId) ? settings.accountById(r.accountId).name : '';
        const hay = (r.note || '') + ' ' + (r.party || '') + ' ' + (r.type === 'transfer' ? '转账' : c.name) + ' ' + accName + ' ' + r.amount;
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });

    let exp = 0;
    let inc = 0;
    rows.forEach(function (r) {
      if (r.type === 'expense') exp += r.amount;
      if (r.type === 'income') inc += r.amount;
    });

    const shown = reset ? PAGE_SIZE : Math.max(PAGE_SIZE, this.data.shown);
    this.setData({
      total: rows.length,
      shown: Math.min(shown, rows.length),
      hasMore: rows.length > shown,
      empty: rows.length === 0,
      summary: {
        expense: util.fmtMoney(exp),
        income: util.fmtMoney(inc),
        balance: util.fmtMoney(inc - exp)
      }
    });
    this.renderList(rows);
    this._rows = rows;
  },

  renderList(rows) {
    const shown = this.data.shown;
    const list = rows.slice(0, shown).map(function (r) {
      if (r.type === 'transfer') {
        const from = settings.accountById(r.accountId);
        const to = settings.accountById(r.toAccountId);
        return {
          id: r.id,
          date: r.date,
          icon: '🔄',
          catName: '转账',
          note: r.note || ((from ? from.name : '账户') + ' → ' + (to ? to.name : '账户')),
          party: '',
          source: '',
          type: 'transfer',
          sign: '',
          amountText: '¥' + util.fmtMoney(r.amount)
        };
      }
      const c = cats.byId(r.type, r.categoryId);
      const acc = r.accountId ? settings.accountById(r.accountId) : null;
      return {
        id: r.id,
        date: r.date,
        icon: c.icon,
        catName: c.name,
        note: classify.merchantOf(r) || r.note || c.name,
        party: r.party || '',
        source: r.source === 'wechat' ? '微信' : (r.source === 'recurring' ? '周期' : ''),
        accName: acc ? acc.name : '',
        type: r.type,
        sign: r.type === 'expense' ? '-' : '+',
        amountText: util.fmtMoney(r.amount)
      };
    });
    this.setData({ list: list });
  },

  loadMore() {
    if (!this.data.hasMore) return;
    const next = Math.min(this.data.shown + PAGE_SIZE, this.data.total);
    this.setData({ shown: next, hasMore: this.data.total > next });
    this.renderList(this._rows || []);
  },

  editRec(e) {
    const id = e.currentTarget.dataset.id;
    const row = (this.data.list || []).filter(function (x) { return x.id === id; })[0];
    if (row && row.type === 'transfer') {
      wx.showToast({ title: '转账请到「账户」页管理', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/add/add?id=' + id });
  }
});
