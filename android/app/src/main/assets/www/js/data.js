/* 数据层：分类（可自定义）、账户、工具函数、localStorage 存储 */
(function () {
  'use strict';
  const KEY = 'wc_records_v1';
  const SET_KEY = 'wc_settings_v1';

  const DEFAULT_EXPENSE = [
    { id: 'food', name: '餐饮', icon: '🍜', color: '#f2994a' },
    { id: 'transport', name: '交通', icon: '🚌', color: '#4a90e2' },
    { id: 'shopping', name: '购物', icon: '🛍️', color: '#e06a9a' },
    { id: 'fun', name: '娱乐', icon: '🎮', color: '#9b6de0' },
    { id: 'house', name: '住房', icon: '🏠', color: '#5db8a8' },
    { id: 'medical', name: '医疗', icon: '💊', color: '#e0584a' },
    { id: 'edu', name: '学习', icon: '📚', color: '#3fa7d6' },
    { id: 'comm', name: '通讯', icon: '📱', color: '#7a8ba0' },
    { id: 'social', name: '人情', icon: '🧧', color: '#d94f6c' },
    { id: 'other', name: '其他', icon: '📦', color: '#9aa3ad' }
  ];
  const DEFAULT_INCOME = [
    { id: 'salary', name: '工资', icon: '💰', color: '#07c160' },
    { id: 'bonus', name: '奖金', icon: '🎉', color: '#f2b134' },
    { id: 'invest', name: '理财', icon: '📈', color: '#4a90e2' },
    { id: 'parttime', name: '兼职', icon: '💼', color: '#5db8a8' },
    { id: 'hongbao', name: '红包', icon: '🧧', color: '#d94f6c' },
    { id: 'other_in', name: '其他', icon: '📦', color: '#9aa3ad' }
  ];
  const DEFAULT_ACCOUNTS = [
    { id: 'wechat', name: '微信', icon: '💚' },
    { id: 'alipay', name: '支付宝', icon: '💙' },
    { id: 'bank', name: '银行卡', icon: '💳' },
    { id: 'cash', name: '现金', icon: '💵' }
  ];
  const PALETTE = ['#f2994a', '#4a90e2', '#e06a9a', '#9b6de0', '#5db8a8', '#3fa7d6', '#d94f6c', '#f2b134', '#7a8ba0', '#6dbf67'];

  /* ---------- 工具 ---------- */
  const p2 = n => (n < 10 ? '0' + n : '' + n);
  function fmt(n) {
    return (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtShort(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(2) + '万';
    return fmt(v);
  }
  function today() { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function monthOf(date) { return String(date || '').slice(0, 7); }
  function thisMonth() { return today().slice(0, 7); }
  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1);
  }
  function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function monthLabel(month) {
    const [y, m] = month.split('-');
    return y + '年' + Number(m) + '月';
  }
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function dayLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    return m + '月' + d + '日 ' + w + (date === today() ? ' · 今天' : '');
  }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 存储 ---------- */
  function all() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
  function sortList(list) {
    return list.sort((a, b) => a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1));
  }
  const store = {
    all,
    get(id) { return all().find(r => r.id === id) || null; },
    add(rec) {
      const list = all();
      const item = Object.assign({}, rec, { id: uid(), createdAt: Date.now() });
      list.unshift(item);
      save(list);
      return item;
    },
    update(id, patch) {
      const list = all();
      const i = list.findIndex(r => r.id === id);
      if (i < 0) return null;
      list[i] = Object.assign({}, list[i], patch);
      save(list);
      return list[i];
    },
    remove(id) { save(all().filter(r => r.id !== id)); },
    addMany(records) {
      const list = all();
      const seen = new Set(list.filter(r => r.extId).map(r => r.extId));
      let added = 0, duplicated = 0;
      const now = Date.now();
      records.forEach((rec, i) => {
        if (rec.extId && seen.has(rec.extId)) { duplicated++; return; }
        if (rec.extId) seen.add(rec.extId);
        list.push(Object.assign({}, rec, { id: uid() + i.toString(36), createdAt: now + i }));
        added++;
      });
      if (added) save(sortList(list));
      return { added, duplicated };
    },
    replaceAll(records) { save(sortList(records.slice())); },
    clear() { save([]); },
    count() { return all().length; }
  };

  /* ---------- 设置 ---------- */
  function loadSettings() {
    const base = { budgets: {}, theme: 'light', cats: null, accounts: null, defaultAccount: 'wechat' };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); }
    catch (e) { return base; }
  }
  function saveSettings(s) { localStorage.setItem(SET_KEY, JSON.stringify(s)); }
  function catsOf(type) {
    const s = loadSettings();
    const arr = s.cats && s.cats[type];
    if (Array.isArray(arr) && arr.length) return arr;
    return (type === 'income' ? DEFAULT_INCOME : DEFAULT_EXPENSE).map(c => Object.assign({}, c));
  }
  function catById(type, id) {
    const arr = catsOf(type);
    return arr.find(c => c.id === id) || arr.find(c => c.id === (type === 'income' ? 'other_in' : 'other')) || arr[arr.length - 1];
  }
  function accountsOf() {
    const s = loadSettings();
    if (Array.isArray(s.accounts) && s.accounts.length) return s.accounts;
    return DEFAULT_ACCOUNTS.map(a => Object.assign({}, a));
  }
  function accountById(id) {
    const arr = accountsOf();
    return arr.find(a => a.id === id) || arr[0];
  }

  const settings = {
    get: loadSettings,
    set(patch) { const s = Object.assign(loadSettings(), patch); saveSettings(s); return s; },
    budget(month) { const b = loadSettings().budgets || {}; return Number(b[month]) || 0; },
    setBudget(month, value) {
      const s = loadSettings();
      s.budgets = s.budgets || {};
      if (value > 0) s.budgets[month] = value; else delete s.budgets[month];
      saveSettings(s);
    },
    cats: catsOf,
    saveCats(type, arr) {
      const s = loadSettings();
      s.cats = s.cats || { expense: catsOf('expense'), income: catsOf('income') };
      s.cats[type] = arr;
      saveSettings(s);
    },
    resetCats() { const s = loadSettings(); delete s.cats; saveSettings(s); },
    accounts: accountsOf,
    saveAccounts(arr) { const s = loadSettings(); s.accounts = arr; saveSettings(s); },
    defaultAccount() { const s = loadSettings(); return accountById(s.defaultAccount) ? s.defaultAccount : accountsOf()[0].id; },
    setDefaultAccount(id) { settings.set({ defaultAccount: id }); }
  };

  /* ---------- 账户余额 ---------- */
  // 返回 { accountId: 余额 }，支持转账（转出/转入）
  function balances(recs) {
    const map = {};
    accountsOf().forEach(a => { map[a.id] = 0; });
    (recs || all()).forEach(r => {
      if (r.type === 'income') map[r.accountId] = (map[r.accountId] || 0) + r.amount;
      else if (r.type === 'expense') map[r.accountId] = (map[r.accountId] || 0) - r.amount;
      else if (r.type === 'transfer') {
        map[r.accountId] = (map[r.accountId] || 0) - r.amount;
        map[r.toAccountId] = (map[r.toAccountId] || 0) + r.amount;
      }
    });
    return map;
  }

  /* ---------- 示例数据 ---------- */
  const SAMPLES = [
    ['food', '午餐 公司楼下食堂', 18, 'wechat'], ['food', '瑞幸咖啡', 15.9, 'wechat'], ['food', '火锅聚餐', 128, 'alipay'],
    ['transport', '地铁通勤', 6, 'wechat'], ['transport', '滴滴打车', 32.5, 'alipay'],
    ['shopping', '永辉超市', 86.3, 'wechat'], ['shopping', '淘宝 数据线', 19.9, 'alipay'],
    ['fun', '爱奇艺会员', 25, 'wechat'], ['comm', '手机话费充值', 50, 'alipay'],
    ['house', '电费', 76.2, 'wechat'], ['medical', '药店 感冒药', 32, 'cash'],
    ['edu', '当当 技术书', 69, 'alipay'], ['social', '朋友结婚红包', 200, 'wechat'], ['other', '快递费', 12, 'cash']
  ];
  function seed() {
    const recs = [];
    const now = Date.now();
    for (let offset = 0; offset < 3; offset++) {
      const month = shiftMonth(thisMonth(), -offset);
      const dim = offset === 0 ? Math.min(new Date().getDate(), 28) : 28;
      SAMPLES.forEach((s, i) => {
        const day = (i * 2 + offset) % dim + 1;
        recs.push({
          id: uid() + i + '_' + offset, type: 'expense', categoryId: s[0], note: s[1],
          amount: Math.round(s[2] * (1 + offset * 0.05) * 100) / 100,
          date: month + '-' + p2(day), accountId: s[3], createdAt: now - offset * 1000 - i
        });
      });
      [5, 20].forEach((day, k) => {
        recs.push({
          id: uid() + 'in' + k + offset, type: 'income', categoryId: k ? 'bonus' : 'salary',
          note: k ? '季度绩效奖金' : '工资到账', amount: k ? 2500 : 12800,
          date: month + '-' + p2(Math.min(day, dim)), accountId: 'bank', createdAt: now - k
        });
      });
      recs.push({
        id: uid() + 'tr' + offset, type: 'transfer', categoryId: 'other', note: '银行卡 → 微信 零钱补充',
        amount: 1000, date: month + '-' + p2(Math.min(18, dim)), accountId: 'bank', toAccountId: 'wechat', createdAt: now - 99
      });
    }
    store.addMany(recs);
  }

  const WC = window.WC = window.WC || {};
  Object.assign(WC, {
    DEFAULT_EXPENSE, DEFAULT_INCOME, DEFAULT_ACCOUNTS, PALETTE,
    fmt, fmtShort, today, thisMonth, monthOf, shiftMonth, daysInMonth, monthLabel, dayLabel, uid, esc, p2,
    list: catsOf, byId: catById, accounts: accountsOf, accountById, balances,
    store, settings, seed
  });
})();
