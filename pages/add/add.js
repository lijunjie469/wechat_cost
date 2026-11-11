// 记一笔：支持新增与编辑（带 id 参数进入时为编辑模式）
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');

Page({
  data: {
    id: null,
    type: 'expense',
    categories: [],
    categoryId: '',
    amountStr: '',
    note: '',
    date: '',
    accounts: [],
    accountNames: [],
    accountIndex: 0
  },

  onLoad(options) {
    const accs = settings.accounts();

    if (options && options.id) {
      const rec = store.get(options.id);
      if (rec && rec.type === 'transfer') {
        wx.showToast({ title: '转账记录请到账户页管理', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 600);
        return;
      }
      if (rec) {
        const accId = rec.accountId || settings.defaultAccount();
        let ai = 0;
        accs.forEach(function (a, i) { if (a.id === accId) ai = i; });
        this.setData({
          id: rec.id,
          type: rec.type,
          categories: cats.list(rec.type),
          categoryId: rec.categoryId,
          amountStr: String(rec.amount),
          note: rec.note || '',
          date: rec.date,
          accounts: accs,
          accountNames: accs.map(function (a) { return a.icon + ' ' + a.name; }),
          accountIndex: ai
        });
        wx.setNavigationBarTitle({ title: '编辑记录' });
        return;
      }
    }

    // 新增：默认账户
    const defId = settings.defaultAccount();
    let defIndex = 0;
    accs.forEach(function (a, i) { if (a.id === defId) defIndex = i; });
    this.setData({
      date: util.today(),
      categories: cats.list('expense'),
      accounts: accs,
      accountNames: accs.map(function (a) { return a.icon + ' ' + a.name; }),
      accountIndex: defIndex
    });
  },

  switchType(e) {
    const t = e.currentTarget.dataset.t;
    if (t === 'transfer') return;
    this.setData({
      type: t,
      categories: cats.list(t),
      categoryId: ''
    });
  },

  pickCat(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id });
  },

  onAccount(e) {
    this.setData({ accountIndex: Number(e.detail.value) });
  },

  onKey(e) {
    const k = e.currentTarget.dataset.k;
    let s = this.data.amountStr;
    if (k === 'back') {
      s = s.slice(0, -1);
    } else if (k === '.') {
      if (!s) s = '0.';
      else if (s.indexOf('.') < 0) s += '.';
    } else {
      if (s === '0') {
        s = k;
      } else {
        const dot = s.indexOf('.');
        // 小数最多两位，整数部分最多 7 位
        if (dot >= 0 && s.length - dot > 2) return;
        if (dot < 0 && s.length >= 7) return;
        s += k;
      }
    }
    this.setData({ amountStr: s });
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  onDate(e) {
    this.setData({ date: e.detail.value });
  },

  save() {
    const amount = parseFloat(this.data.amountStr);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    if (!this.data.categoryId) {
      wx.showToast({ title: '请选择分类', icon: 'none' });
      return;
    }
    const acc = this.data.accounts[this.data.accountIndex];
    const rec = {
      type: this.data.type,
      amount: Math.round(amount * 100) / 100,
      categoryId: this.data.categoryId,
      note: this.data.note.trim(),
      date: this.data.date || util.today(),
      accountId: acc ? acc.id : settings.defaultAccount()
    };

    // 预算超支提醒（仅新增支出时提示，避免编辑时反复打扰）
    let overTip = '';
    if (!this.data.id && this.data.type === 'expense') {
      const b = settings.budget();
      if (b.total > 0) {
        const month = rec.date.slice(0, 7);
        let used = 0;
        store.all().forEach(function (r) {
          if (r.type === 'expense' && r.date.slice(0, 7) === month) used += r.amount;
        });
        if (used + rec.amount > b.total) {
          overTip = '本月预算已超支 ¥' + util.fmtMoney(used + rec.amount - b.total);
        }
      }
    }

    if (this.data.id) {
      store.update(this.data.id, rec);
    } else {
      store.add(rec);
    }

    const that = this;
    if (overTip) {
      wx.showModal({
        title: '⚠️ 预算提醒',
        content: overTip,
        showCancel: false,
        confirmText: '知道了',
        success() { that.backAfterSave(); }
      });
    } else {
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(function () { that.back(); }, 400);
    }
  },

  backAfterSave() {
    this.back();
  },

  onDelete() {
    const that = this;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条记录吗？',
      confirmColor: '#E64340',
      success(res) {
        if (res.confirm) {
          store.remove(that.data.id);
          that.back();
        }
      }
    });
  },

  back() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  }
});
