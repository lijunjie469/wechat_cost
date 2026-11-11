const classify = require('./classify');
// 本地存储层：账单记录的增删改查
// 数据模型: { id, type: 'expense'|'income', amount, categoryId, note, date: 'YYYY-MM-DD', createdAt }
const KEY = 'wc_records_v1';

function init() {
  try {
    const v = wx.getStorageSync(KEY);
    if (!Array.isArray(v)) wx.setStorageSync(KEY, []);
  } catch (e) {
    wx.setStorageSync(KEY, []);
  }
}

function load() {
  try {
    return wx.getStorageSync(KEY) || [];
  } catch (e) {
    return [];
  }
}

function save(list) {
  wx.setStorageSync(KEY, list);
}

function uid() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}


// 同一笔交易的完整判定键（用于「完全相同的记录」去重）
// 刻意不含 extId —— 微信账单用交易单号、PDF 用「日期|金额|对方|序号」，两者天生不同。
function recKey(r) {
  return [r.date, r.type, Number(r.amount).toFixed(2), String(r.party || ''), String(r.note || '')].join('|');
}

// 跨源匹配用的粗键：同日期 + 同方向 + 同金额
function crossKey(r) {
  return [r.date, r.type, Number(r.amount).toFixed(2)].join('|');
}

// 信息量打分：合并同一笔时保留信息更全的那条（微信账单通常比银行流水更全）
function infoScore(r) {
  var s = 0;
  var m = classify.merchantOf(r);
  if (m && m !== '未标注商家') s += 2;
  if (r.party) s += 1;
  if (r.note && r.note !== m) s += 1;
  if (r.payType) s += 1;
  if (r.tradeType) s += 1;
  if (r.extId) s += 1;
  return s;
}

// 支付方式/文件名里能识别出的银行。只有同一家银行才可能是同一笔钱
var BANK_WORDS = ['招商银行', '邮储银行', '中国邮政储蓄银行', '工商银行', '建设银行', '农业银行',
  '交通银行', '浦发银行', '中信银行', '民生银行', '兴业银行', '光大银行', '平安银行', '广发银行', '华夏银行'];
function bankOf(r) {
  var t = String((r && r.payType) || '') + ' ' + String((r && r._src) || '');
  for (var i = 0; i < BANK_WORDS.length; i++) {
    if (t.indexOf(BANK_WORDS[i]) >= 0) return BANK_WORDS[i];
  }
  if (/招商|cmb/i.test(t)) return '招商银行';
  if (/邮储|邮政储蓄/i.test(t)) return '邮储银行';
  if (/工商|icbc/i.test(t)) return '工商银行';
  if (/建设|ccb/i.test(t)) return '建设银行';
  if (/农业|abc/i.test(t)) return '农业银行';
  if (/交通|bocom/i.test(t)) return '交通银行';
  return '';
}

function isBankCardPay(r) {
  return /银行|储蓄卡|信用卡/.test(String(r.payType || ''));
}

/* 两条来自不同文件的记录，是否大概是同一笔？
 * 微信绑卡消费会同时出现在「微信账单」和「银行流水」里：日期、金额、方向都一样，
 * 但描述不同（微信显示商户昵称，银行显示收款人实名或渠道名）。
 * 判据：商户名一致 → 一方只有渠道信息 → 一方明确是银行卡扣款。
 * 两个不同的真实商户名且无法佐证时，宁可保留两条，也不误删。
 */
function canPair(a, b) {
  var ma = classify.merchantOf(a);
  var mb = classify.merchantOf(b);
  var unknown = function (m) { return !m || m === '未标注商家'; };
  if (ma && mb && ma === mb) return true;
  if (unknown(ma) || unknown(mb)) return true;
  // 「支付方式写明是银行卡」只在「渠道账单 ↔ 银行流水」之间才算数，
  // 微信↔支付宝之间不互相配对，否则会吞掉走花呗的那一笔
  var pa = !!a.payType;
  var pb = !!b.payType;
  if (pa !== pb) {
    var card = pa ? a : b;
    if (isBankCardPay(card)) {
      // 只认同一家银行
      var ba = bankOf(a);
      var bb = bankOf(b);
      if (!ba || !bb || ba === bb) return true;
    }
  }
  return false;
}

/* 「以银行账单为准」：同一笔同时出现在银行流水和渠道账单时，
 * 金额/日期/方向用银行流水的，商户名和分类用渠道账单的 */
function fillFromChannel(bankRec, chanRec) {
  var out = Object.assign({}, bankRec);
  if (chanRec.party) out.party = chanRec.party;
  if (chanRec.note && classify.merchantOf(chanRec) !== '未标注商家') out.note = chanRec.note;
  if (chanRec.categoryId) out.categoryId = chanRec.categoryId;
  if (chanRec.payType) out.payType = chanRec.payType;
  if (chanRec.tradeType) out.tradeType = chanRec.tradeType;
  out._chan = chanRec._src || '';
  return out;
}

function preferBank(a, b) {
  var aBank = a.source === 'statement';
  var bBank = b.source === 'statement';
  if (aBank && !bBank) return fillFromChannel(a, b);
  if (bBank && !aBank) return fillFromChannel(b, a);
  return infoScore(b) > infoScore(a) ? b : a;
}

/* 本次导入里有没有银行流水：有 → 以银行为准；没有 → 微信/支付宝各按自己的来 */
function hasBankSource(records) {
  for (var i = 0; i < (records || []).length; i++) {
    if (records[i] && records[i].source === 'statement') return true;
  }
  return false;
}

/* 合并两份待导入记录（同一文件内的记录一律保留，只在「不同来源」之间配对）：
 * ① 同日期 + 同金额 + 同方向 + 同商户 + 同备注 → 同一笔（重复导入）
 * ② 同日期 + 同金额 + 同方向 + canPair 成立 → 同一笔（微信绑卡消费在两份账单里都有）
 * ③ 其余全部保留
 * 注意：② 只在本次导入含银行流水时才做。只有微信 / 只有支付宝（或两者一起但没有流水）
 * 时各自看成一本书，互不干扰。
 */
function previewMerge(base, add) {
  // 没有银行流水 → 一份都不配对（微信/支付宝各按自己的记录算，互不吞并）。
  // 真正重复导入同一份账单，保存时还会按 extId 再过一遍。
  var allowCross = hasBankSource((base || []).concat(add || []));
  if (!allowCross) {
    return { records: (base || []).concat(add || []), duplicated: 0, crossMerged: 0, bank: false };
  }

  var groups = {};
  var order = [];
  (base || []).concat(add || []).forEach(function (r) {
    var k = crossKey(r);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(r);
  });

  var out = [];
  var duplicated = 0;
  var crossMerged = 0;

  order.forEach(function (k) {
    var items = groups[k];

    // 按来源分桶
    var bySrc = {};
    var srcs = [];
    items.forEach(function (r) {
      var src = r._src || '';
      if (!bySrc[src]) { bySrc[src] = []; srcs.push(src); }
      bySrc[src].push(r);
    });
    // 只有一份来源：原样保留（同一文件里同额同店的多笔就是多笔）
    if (srcs.length === 1) { out = out.concat(items); return; }

    srcs.sort(function (a, b) { return bySrc[b].length - bySrc[a].length; });
    var kept = bySrc[srcs[0]].slice();
    for (var i = 1; i < srcs.length; i++) {
      var other = bySrc[srcs[i]].slice();
      var used = {};
      var rest = [];
      other.forEach(function (o) {
        var j = -1;
        var kind = 'dup';
        for (var ri = 0; ri < kept.length; ri++) {
          if (!used[ri] && recKey(kept[ri]) === recKey(o)) { j = ri; break; }
        }
        if (j < 0 && allowCross) {
          kind = 'cross';
          for (var rj = 0; rj < kept.length; rj++) {
            if (!used[rj] && canPair(kept[rj], o)) { j = rj; break; }
          }
        }
        if (j < 0) { rest.push(o); return; }
        used[j] = true;
        if (kind === 'dup') duplicated++; else crossMerged++;
        kept[j] = preferBank(kept[j], o);
      });
      kept = kept.concat(rest);
    }
    out = out.concat(kept);
  });

  return { records: out, duplicated: duplicated, crossMerged: crossMerged, bank: allowCross };
}

module.exports = {
  init: init,
  all: load,
  get: function (id) {
    const list = load();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },
  add: function (rec) {
    const list = load();
    rec.id = uid();
    rec.createdAt = Date.now();
    list.unshift(rec);
    save(list);
    return rec;
  },
  update: function (id, patch) {
    const list = load();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i] = Object.assign({}, list[i], patch);
        save(list);
        return list[i];
      }
    }
    return null;
  },
  remove: function (id) {
    save(load().filter(function (r) { return r.id !== id; }));
  },

  // 合并两份待导入记录（导入页「合并多份账单」用），返回 { records, duplicated, crossMerged, bank }
  previewMerge: previewMerge,
  hasBankSource: hasBankSource,

  // 整体替换（导入备份 / 批量迁移用）
  replaceAll: function (list) {
    const arr = (list || []).slice();
    arr.sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.date < b.date ? 1 : -1;
    });
    save(arr);
  },

  // 按条件批量修改字段，返回改动条数
  updateWhere: function (match, patch) {
    const list = load();
    let n = 0;
    list.forEach(function (r) {
      if (match(r)) {
        Object.assign(r, patch);
        n++;
      }
    });
    if (n) save(list);
    return n;
  },

  // 批量导入（微信账单等），按 extId 去重
  // 返回 { added, duplicated }
  addMany: function (records) {
    const list = load();
    const seen = {};
    list.forEach(function (r) {
      if (r.extId) seen[r.extId] = true;
    });

    let added = 0;
    let duplicated = 0;
    const now = Date.now();
    records.forEach(function (rec, i) {
      const key = rec.extId;
      if (key && seen[key]) { duplicated++; return; }
      if (key) seen[key] = true;
      const item = Object.assign({}, rec, {
        id: uid() + i.toString(36),
        createdAt: now + i
      });
      list.push(item);
      added++;
    });

    if (added > 0) {
      list.sort(function (a, b) {
        if (a.date === b.date) return (b.createdAt || 0) - (a.createdAt || 0);
        return a.date < b.date ? 1 : -1;
      });
      save(list);
    }
    return { added: added, duplicated: duplicated };
  }
};
