// 数据与设置：备份导出、备份导入、清空
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const settings = require('../../utils/settings');

Page({
  data: {
    count: 0,
    accountCount: 0,
    firstDate: '-',
    lastDate: '-',
    spanDays: 0,
    showImport: false,
    importText: '',
    jsonSize: '0'
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const all = store.all();
    let first = '';
    let last = '';
    all.forEach(function (r) {
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
    });
    let span = 0;
    if (first) {
      span = Math.round((new Date(last + 'T00:00:00') - new Date(first + 'T00:00:00')) / 86400000) + 1;
    }
    const payload = this.buildPayload();
    this.setData({
      count: all.length,
      accountCount: settings.accounts().length,
      firstDate: first || '-',
      lastDate: last || '-',
      spanDays: span,
      jsonSize: (JSON.stringify(payload).length / 1024).toFixed(1)
    });
  },

  buildPayload() {
    return {
      app: 'wechat_cost',
      version: 1,
      exportedAt: new Date().toISOString(),
      records: store.all(),
      settings: settings.get()
    };
  },

  // 导出 JSON 备份到剪贴板
  exportJson() {
    const payload = this.buildPayload();
    wx.setClipboardData({
      data: JSON.stringify(payload),
      success() {
        wx.showModal({
          title: '备份已复制',
          content: '共 ' + payload.records.length + ' 条记录。把它粘贴到微信文件传输助手或备忘录保存；换手机后可在本页「从剪贴板恢复」。',
          showCancel: false
        });
      }
    });
  },

  // 导出 CSV
  exportCsv() {
    const all = store.all().slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    const lines = ['日期,类型,分类,金额,备注,账户'];
    all.forEach(function (r) {
      if (r.type === 'transfer') {
        const from = settings.accountById(r.accountId);
        const to = settings.accountById(r.toAccountId);
        lines.push([
          r.date, '转账',
          (from ? from.name : '') + '→' + (to ? to.name : ''),
          r.amount, '"' + (r.note || '').replace(/"/g, '""') + '"',
          from ? from.name : ''
        ].join(','));
        return;
      }
      const c = cats.byId(r.type, r.categoryId);
      const acc = settings.accountById(r.accountId);
      lines.push([
        r.date,
        r.type === 'income' ? '收入' : '支出',
        c.name,
        r.amount,
        '"' + (r.note || '').replace(/"/g, '""') + '"',
        acc ? acc.name : ''
      ].join(','));
    });
    wx.setClipboardData({
      data: lines.join('\n'),
      success() {
        wx.showToast({ title: 'CSV 已复制到剪贴板', icon: 'none' });
      }
    });
  },

  toggleImport() {
    this.setData({ showImport: !this.data.showImport });
  },

  onImportText(e) {
    this.setData({ importText: e.detail.value });
  },

  // 从剪贴板读取
  pasteFromClipboard() {
    const that = this;
    wx.getClipboardData({
      success(res) {
        that.setData({ importText: res.data || '' });
        wx.showToast({ title: '已粘贴剪贴板内容', icon: 'none' });
      }
    });
  },

  doImport() {
    let data;
    try {
      data = JSON.parse(String(this.data.importText || '').trim());
    } catch (e) {
      wx.showToast({ title: 'JSON 格式不对', icon: 'none' });
      return;
    }
    const records = data && Array.isArray(data.records) ? data.records : (Array.isArray(data) ? data : null);
    if (!records) {
      wx.showToast({ title: '没找到账单数据', icon: 'none' });
      return;
    }
    const that = this;
    wx.showActionSheet({
      itemList: ['合并导入（保留现有记录）', '覆盖导入（清空后替换）'],
      success(res) {
        if (res.tapIndex === 0) {
          const exist = store.all();
          const ids = {};
          exist.forEach(function (r) { ids[r.id] = true; });
          let added = 0;
          records.forEach(function (r) {
            if (!r || !r.id || ids[r.id]) return;
            exist.push(r);
            added++;
          });
          store.replaceAll(exist);
          if (data.settings) settings.replaceAll(data.settings);
          that.refresh();
          wx.showToast({ title: '合并 ' + added + ' 条', icon: 'none' });
        } else if (res.tapIndex === 1) {
          store.replaceAll(records);
          if (data.settings) settings.replaceAll(data.settings);
          that.refresh();
          wx.showToast({ title: '已覆盖导入 ' + records.length + ' 条', icon: 'none' });
        }
      }
    });
  },

  clearData() {
    const that = this;
    wx.showModal({
      title: '清空所有账单',
      content: '将删除全部 ' + this.data.count + ' 条记录，账户与预算设置保留。此操作不可撤销，建议先导出备份。',
      confirmColor: '#E64340',
      success(res) {
        if (!res.confirm) return;
        store.replaceAll([]);
        that.refresh();
        wx.showToast({ title: '已清空', icon: 'success' });
      }
    });
  },

  resetSettings() {
    const that = this;
    wx.showModal({
      title: '恢复默认设置',
      content: '账户、预算、周期模板都会恢复成初始状态（账单不受影响）。',
      success(res) {
        if (!res.confirm) return;
        settings.reset();
        that.refresh();
        wx.showToast({ title: '已恢复默认', icon: 'success' });
      }
    });
  },

  goRecurring() { wx.navigateTo({ url: '/pages/recurring/recurring' }); },
  goAccounts() { wx.navigateTo({ url: '/pages/accounts/accounts' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget' }); }
});
