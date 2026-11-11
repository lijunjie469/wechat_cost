// 周期账单：模板管理 + 到期自动记账
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');
const recurring = require('../../utils/recurring');

Page({
  data: {
    list: [],
    type: 'expense',
    categories: [],
    catIndex: 0,
    amountStr: '',
    dayStr: '1',
    note: '',
    names: [],
    accIndex: 0
  },

  onShow() {
    const accs = settings.accounts();
    this.setData({
      names: accs.map(function (a) { return a.icon + ' ' + a.name; }),
      categories: cats.list(this.data.type),
      accIndex: Math.min(this.data.accIndex, Math.max(0, accs.length - 1))
    });
    this.reload();
  },

  reload() {
    const tpls = settings.recurring();
    const list = tpls.map(function (t) {
      const c = cats.byId(t.type, t.categoryId);
      const acc = settings.accountById(t.accountId);
      return {
        id: t.id,
        icon: c.icon,
        catName: c.name,
        note: t.note || c.name,
        day: t.day,
        amountText: util.fmtMoney(t.amount),
        typeName: t.type === 'income' ? '收入' : '支出',
        type: t.type,
        accName: acc ? acc.name : '默认账户',
        enabled: t.enabled !== false
      };
    });
    this.setData({ list: list });
  },

  setType(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ type: t, categories: cats.list(t), catIndex: 0 });
  },

  onCat(e) { this.setData({ catIndex: Number(e.detail.value) }); },
  onAmount(e) { this.setData({ amountStr: e.detail.value }); },
  onDay(e) { this.setData({ dayStr: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onAcc(e) { this.setData({ accIndex: Number(e.detail.value) }); },

  addTemplate() {
    const amount = parseFloat(this.data.amountStr);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    const day = parseInt(this.data.dayStr, 10);
    if (!day || day < 1 || day > 31) {
      wx.showToast({ title: '日期填 1-31', icon: 'none' });
      return;
    }
    const cat = this.data.categories[this.data.catIndex];
    const accs = settings.accounts();
    const acc = accs[this.data.accIndex] || accs[0];

    const list = settings.recurring();
    if (list.length >= 20) {
      wx.showToast({ title: '最多 20 个模板', icon: 'none' });
      return;
    }
    list.push({
      id: settings.newTemplateId(),
      type: this.data.type,
      amount: Math.round(amount * 100) / 100,
      categoryId: cat.id,
      note: String(this.data.note || '').trim() || cat.name,
      day: day,
      accountId: acc.id,
      enabled: true,
      startMonth: util.curMonth()
    });
    settings.saveRecurring(list);
    this.setData({ amountStr: '', note: '', dayStr: '1' });
    this.reload();

    // 立刻补记本月已到期的
    const n = recurring.materialize();
    wx.showToast({ title: n > 0 ? '已添加并补记 ' + n + ' 笔' : '模板已添加', icon: 'none' });
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    const list = settings.recurring().map(function (t) {
      if (t.id !== id) return t;
      return Object.assign({}, t, { enabled: t.enabled === false });
    });
    settings.saveRecurring(list);
    this.reload();
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '删除模板',
      content: '删除后不再自动生成（已生成的账单保留）',
      confirmColor: '#E64340',
      success(res) {
        if (!res.confirm) return;
        settings.saveRecurring(settings.recurring().filter(function (t) { return t.id !== id; }));
        that.reload();
      }
    });
  },

  runNow() {
    const n = recurring.materialize();
    wx.showToast({ title: n > 0 ? '补记了 ' + n + ' 笔' : '没有到期的账单', icon: 'none' });
  }
});
