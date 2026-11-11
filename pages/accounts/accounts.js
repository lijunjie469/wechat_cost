// 账户管理：余额总览、新增/编辑账户、账户间转账
const store = require('../../utils/store');
const util = require('../../utils/util');
const settings = require('../../utils/settings');

const ICONS = ['💚', '💙', '💳', '💵', '🏦', '📱', '🪙', '🎁', '📈', '🐷'];

Page({
  data: {
    accounts: [],
    total: '0.00',
    defaultId: '',
    icons: ICONS,
    iconIndex: 0,
    newName: '',
    showAdd: false,
    // 转账
    fromIndex: 0,
    toIndex: 1,
    amountStr: '',
    date: '',
    note: '',
    names: []
  },

  onShow() {
    this.setData({ date: this.data.date || util.today() });
    this.reload();
  },

  reload() {
    const accs = settings.accounts();
    const map = settings.balances(store.all(), accs);
    const rows = accs.map(function (a) {
      return {
        id: a.id,
        name: a.name,
        icon: a.icon,
        initText: util.fmtMoney(a.init || 0),
        balance: util.fmtMoney(map[a.id] || 0),
        negative: (map[a.id] || 0) < 0
      };
    });
    let total = 0;
    accs.forEach(function (a) { total += map[a.id] || 0; });
    const to = this.data.toIndex;
    this.setData({
      accounts: rows,
      total: util.fmtMoney(total),
      defaultId: settings.defaultAccount(),
      names: accs.map(function (a) { return a.icon + ' ' + a.name; }),
      toIndex: Math.min(to, Math.max(0, accs.length - 1))
    });
  },

  toggleAdd() {
    this.setData({ showAdd: !this.data.showAdd, newName: '' });
  },

  onNewName(e) { this.setData({ newName: e.detail.value }); },
  onIcon(e) { this.setData({ iconIndex: Number(e.detail.value) }); },
  onFrom(e) { this.setData({ fromIndex: Number(e.detail.value) }); },
  onTo(e) { this.setData({ toIndex: Number(e.detail.value) }); },
  onAmount(e) { this.setData({ amountStr: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onDate(e) { this.setData({ date: e.detail.value }); },

  addAccount() {
    const name = String(this.data.newName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入账户名称', icon: 'none' });
      return;
    }
    const accs = settings.accounts();
    if (accs.length >= 12) {
      wx.showToast({ title: '最多 12 个账户', icon: 'none' });
      return;
    }
    accs.push({
      id: settings.newAccountId(),
      name: name,
      icon: ICONS[this.data.iconIndex] || '💳',
      init: 0
    });
    settings.saveAccounts(accs);
    this.setData({ showAdd: false, newName: '' });
    this.reload();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  // 点账户：更多操作
  onAccountTap(e) {
    const id = e.currentTarget.dataset.id;
    const acc = settings.accountById(id);
    if (!acc) return;
    const that = this;
    wx.showActionSheet({
      itemList: ['设为默认账户', '修改初始余额', '重命名', '删除账户'],
      success(res) {
        if (res.tapIndex === 0) {
          settings.setDefaultAccount(id);
          that.reload();
          wx.showToast({ title: '已设为默认', icon: 'success' });
        } else if (res.tapIndex === 1) {
          that.editInit(acc);
        } else if (res.tapIndex === 2) {
          that.rename(acc);
        } else if (res.tapIndex === 3) {
          that.removeAccount(acc);
        }
      }
    });
  },

  editInit(acc) {
    const that = this;
    wx.showModal({
      title: '初始余额',
      editable: true,
      placeholderText: '例如 1200.50（可为负数）',
      content: String(acc.init || 0),
      success(res) {
        if (!res.confirm) return;
        const v = parseFloat(res.content);
        if (isNaN(v)) {
          wx.showToast({ title: '请输入数字', icon: 'none' });
          return;
        }
        const accs = settings.accounts();
        accs.forEach(function (a) { if (a.id === acc.id) a.init = Math.round(v * 100) / 100; });
        settings.saveAccounts(accs);
        that.reload();
        wx.showToast({ title: '已更新', icon: 'success' });
      }
    });
  },

  rename(acc) {
    const that = this;
    wx.showModal({
      title: '重命名账户',
      editable: true,
      placeholderText: '账户名称',
      content: acc.name,
      success(res) {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) return;
        const accs = settings.accounts();
        accs.forEach(function (a) { if (a.id === acc.id) a.name = name.slice(0, 8); });
        settings.saveAccounts(accs);
        that.reload();
      }
    });
  },

  removeAccount(acc) {
    const accs = settings.accounts();
    if (accs.length <= 1) {
      wx.showToast({ title: '至少保留一个账户', icon: 'none' });
      return;
    }
    const that = this;
    wx.showModal({
      title: '删除账户',
      content: '「' + acc.name + '」下的账单会迁移到默认账户，确定删除吗？',
      confirmColor: '#E64340',
      success(res) {
        if (!res.confirm) return;
        const keep = accs.filter(function (a) { return a.id !== acc.id; });
        settings.saveAccounts(keep);
        const defId = keep[0].id;
        // 迁移历史记录
        store.updateWhere(function (r) { return r.accountId === acc.id; }, { accountId: defId });
        store.updateWhere(function (r) { return r.toAccountId === acc.id; }, { toAccountId: defId });
        if (settings.defaultAccount() === acc.id) settings.setDefaultAccount(defId);
        that.reload();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  submitTransfer() {
    const accs = settings.accounts();
    const from = accs[this.data.fromIndex];
    const to = accs[this.data.toIndex];
    const amount = parseFloat(this.data.amountStr);
    if (!from || !to) {
      wx.showToast({ title: '请选择账户', icon: 'none' });
      return;
    }
    if (from.id === to.id) {
      wx.showToast({ title: '转出和转入不能是同一账户', icon: 'none' });
      return;
    }
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入转账金额', icon: 'none' });
      return;
    }
    store.add({
      type: 'transfer',
      amount: Math.round(amount * 100) / 100,
      categoryId: 'transfer',
      note: String(this.data.note || '').trim() || (from.name + ' → ' + to.name),
      date: this.data.date || util.today(),
      accountId: from.id,
      toAccountId: to.id
    });
    this.setData({ amountStr: '', note: '' });
    this.reload();
    wx.showToast({ title: '转账已记录', icon: 'success' });
  }
});
