// 设置层：账户、预算、周期账单模板、默认账户
// 存储 key: wc_settings_v1
const KEY = 'wc_settings_v1';

const DEFAULT_ACCOUNTS = [
  { id: 'wechat', name: '微信', icon: '💚', init: 0 },
  { id: 'alipay', name: '支付宝', icon: '💙', init: 0 },
  { id: 'bank', name: '银行卡', icon: '💳', init: 0 },
  { id: 'cash', name: '现金', icon: '💵', init: 0 }
];

function blank() {
  return {
    accounts: null,
    budget: null,
    catBudget: null,
    recurring: null,
    defaultAccount: 'wechat'
  };
}

function load() {
  try {
    const v = wx.getStorageSync(KEY);
    if (!v || typeof v !== 'object') return blank();
    return Object.assign(blank(), v);
  } catch (e) {
    return blank();
  }
}

function save(s) {
  try { wx.setStorageSync(KEY, s); } catch (e) { /* 忽略 */ }
}

function cloneDefaults() {
  return DEFAULT_ACCOUNTS.map(function (a) { return Object.assign({}, a); });
}

function accounts() {
  const s = load();
  if (Array.isArray(s.accounts) && s.accounts.length) return s.accounts;
  return cloneDefaults();
}

function saveAccounts(arr) {
  const s = load();
  s.accounts = arr;
  save(s);
}

function accountById(id) {
  const arr = accounts();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i];
  }
  return null;
}

function defaultAccount() {
  const s = load();
  if (accountById(s.defaultAccount)) return s.defaultAccount;
  return accounts()[0].id;
}

function setDefaultAccount(id) {
  const s = load();
  s.defaultAccount = id;
  save(s);
}

// 预算：{ total: 0, cats: { food: 800 } }，每月通用
function budget() {
  const s = load();
  const b = s.budget || {};
  return { total: Number(b.total) || 0, cats: b.cats || {} };
}

function setBudget(total, cats) {
  const s = load();
  s.budget = { total: Number(total) || 0, cats: cats || {} };
  save(s);
}

// 周期账单模板
function recurring() {
  const s = load();
  return Array.isArray(s.recurring) ? s.recurring : [];
}

function saveRecurring(list) {
  const s = load();
  s.recurring = list;
  save(s);
}

// 每个账户余额（含初始余额、转账）
function balances(records, accountsArr) {
  const arr = accountsArr || accounts();
  const map = {};
  arr.forEach(function (a) { map[a.id] = Number(a.init) || 0; });

  const defId = defaultAccount();
  (records || []).forEach(function (r) {
    const id = r.accountId || defId;
    if (map[id] === undefined) map[id] = 0;
    if (r.type === 'income') {
      map[id] += r.amount;
    } else if (r.type === 'expense') {
      map[id] -= r.amount;
    } else if (r.type === 'transfer') {
      map[id] -= r.amount;
      const to = r.toAccountId;
      if (to) {
        if (map[to] === undefined) map[to] = 0;
        map[to] += r.amount;
      }
    }
  });
  return map;
}

function totalAssets(records) {
  const arr = accounts();
  const map = balances(records, arr);
  let sum = 0;
  arr.forEach(function (a) { sum += map[a.id] || 0; });
  return sum;
}

function newAccountId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function newTemplateId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// 备份恢复：整体覆盖 / 恢复默认
function replaceAll(obj) {
  if (!obj || typeof obj !== 'object') return false;
  save(Object.assign(blank(), obj));
  return true;
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* 忽略 */ }
}

module.exports = {
  DEFAULT_ACCOUNTS: DEFAULT_ACCOUNTS,
  get: load,
  accounts: accounts,
  saveAccounts: saveAccounts,
  accountById: accountById,
  defaultAccount: defaultAccount,
  setDefaultAccount: setDefaultAccount,
  budget: budget,
  setBudget: setBudget,
  recurring: recurring,
  saveRecurring: saveRecurring,
  balances: balances,
  totalAssets: totalAssets,
  newAccountId: newAccountId,
  newTemplateId: newTemplateId,
  replaceAll: replaceAll,
  reset: reset
};
