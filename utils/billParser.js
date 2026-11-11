// 微信支付账单解析：CSV 与 xlsx 共用「二维表 -> 记账记录」这一层
// 表头行必须包含「交易时间」与「金额(元)」

// 关键词 -> 分类（规则集中在 utils/classify.js，与 web 版同源）
const classify = require('./classify.js');
const EXPENSE_RULES = classify.EXPENSE_RULES;
const INCOME_RULES = classify.INCOME_RULES;
const pickCategory = classify.pickCategory;

// 微信账单里空值常写成 '/'
function cleanCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s === '/' || s === '-' ? '' : s;
}

// 支持双引号包裹与转义逗号的 CSV 行切分
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else { quoted = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// '¥1,234.50' / '1,234.50' / 77.6 -> 77.6
function parseAmount(s) {
  if (s === null || s === undefined || s === '') return NaN;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[¥￥,\s元]/g, '');
  const v = Number(cleaned);
  return isNaN(v) ? NaN : v;
}

// '2026-10-22 12:30:45' -> '2026-10-22'
// xlsx 里日期可能是 Excel 序列号（如 46317.4968），一并支持
function parseDate(s) {
  const str = String(s || '');
  const m = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    const mm = Number(m[2]) < 10 ? '0' + Number(m[2]) : '' + Number(m[2]);
    const dd = Number(m[3]) < 10 ? '0' + Number(m[3]) : '' + Number(m[3]);
    return m[1] + '-' + mm + '-' + dd;
  }
  // Excel 1900 日期系统：序列号 1 = 1900-01-01，25569 = 1970-01-01
  const num = Number(str);
  if (!isNaN(num) && num > 20000 && num < 90000) {
    const d = new Date(Math.round((num - 25569) * 86400000));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const da = d.getUTCDate();
    const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    return y + '-' + p2(mo) + '-' + p2(da);
  }
  return '';
}

// 二维表 -> 记录（CSV 和 xlsx 都走这里）
function parseRows(matrix) {
  if (!matrix || !matrix.length) {
    return { error: '内容为空', records: [], stats: { total: 0 } };
  }

  // 找表头
  let headerIdx = -1;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row) continue;
    const joined = row.join(',');
    if (joined.indexOf('交易时间') >= 0 && joined.indexOf('金额') >= 0) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    return {
      error: '没找到表头行（应包含「交易时间」和「金额(元)」）。请确认导出的是「微信支付账单明细」。',
      records: [],
      stats: { total: 0 }
    };
  }

  const header = (matrix[headerIdx] || []).map(function (h) { return String(h || '').replace(/\s/g, ''); });
  // 微信与支付宝列名不同：微信「交易类型/商品/当前状态/交易单号/支付方式」
  // 支付宝「交易分类/商品说明/交易状态/交易订单号/收付款方式」
  function pick(a, b) {
    if (header.indexOf(a) >= 0) return header.indexOf(a);
    if (header.indexOf(b) >= 0) return header.indexOf(b);
    // 兜底：去掉斜杠等符号后按包含匹配（支付宝写的是「收/付款方式」）
    function norm(h) { return String(h || '').replace(/[\/\·、,，]/g, ''); }
    var na = norm(a);
    var nb = norm(b);
    for (var i = 0; i < header.length; i++) {
      var nh = norm(header[i]);
      if (nh && (nh.indexOf(na) >= 0 || nh.indexOf(nb) >= 0)) return i;
    }
    return -1;
  }
  const isAlipay = header.indexOf('收付款方式') >= 0 || header.indexOf('交易分类') >= 0;
  const col = {
    time: header.indexOf('交易时间'),
    type: pick('交易类型', '交易分类'),
    party: header.indexOf('交易对方'),
    goods: pick('商品', '商品说明'),
    flow: header.indexOf('收/支'),
    amount: -1,
    status: pick('当前状态', '交易状态'),
    tradeNo: pick('交易单号', '交易订单号'),
    note: header.indexOf('备注'),
    payType: pick('支付方式', '收付款方式')
  };
  for (let i = 0; i < header.length; i++) {
    if (header[i].indexOf('金额') === 0) { col.amount = i; break; }
  }
  if (col.time < 0 || col.amount < 0 || col.flow < 0) {
    return { error: '表头缺少「交易时间」「金额(元)」或「收/支」列，无法解析。', records: [], stats: { total: 0 } };
  }

  const records = [];
  const refunds = [];
  let total = 0;
  let skippedFlow = 0;
  let skippedBad = 0;
  let skippedRefund = 0;

  function cell(row, i) {
    if (i < 0) return '';
    return row[i] === undefined || row[i] === null ? '' : String(row[i]);
  }

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row.length) continue;
    const first = String(row[0] || '');
    if (first.indexOf('共 ') === 0 || first.indexOf('笔记录') >= 0) continue;
    total++;

    const flow = cleanCell(cell(row, col.flow));
    const date = parseDate(cell(row, col.time));
    const amount = parseAmount(cell(row, col.amount));
    if (!date || isNaN(amount) || amount <= 0) { skippedBad++; continue; }

    const status = cell(row, col.status);
    const goodsRaw = cleanCell(cell(row, col.goods));
    const noteRaw = cleanCell(cell(row, col.note));

    if (flow !== '支出' && flow !== '收入') {
      // 退款单先收集，稍后从原支出里冲减
      const text = goodsRaw + ' ' + noteRaw;
      if (/退款/.test(status) || /^退款/.test(goodsRaw) || /退款/.test(noteRaw)) {
        refunds.push({
          date: date,
          amount: amount,
          party: cleanCell(cell(row, col.party)),
          text: text,
          order: orderNoOf(text),
          // 支付宝退款行的交易订单号就是原订单的，靠它能精确找回原支出
          trade: tradeKeyOf(cell(row, col.tradeNo))
        });
      }
      skippedFlow++;
      continue;
    }
    // 微信里「已全额退款」的支出行没有独立退款单，直接跳过
    if (/全额退款|已退款|已退还/.test(status) && !/退款成功/.test(status)) {
      skippedRefund++;
      continue;
    }
    const closed = /交易关闭|交易失败|已关闭|还款失败/.test(status);

    const type = flow === '收入' ? 'income' : 'expense';
    const party = cleanCell(cell(row, col.party));
    const goods = cleanCell(cell(row, col.goods));
    const tradeType = cleanCell(cell(row, col.type));
    const tradeNo = cleanCell(cell(row, col.tradeNo));
    const noteExtra = cleanCell(cell(row, col.note));
    const payType = cleanCell(cell(row, col.payType));

    const catText = tradeType + ' ' + party + ' ' + goods;

    let note = goods || party || tradeType;
    if (noteExtra) note = note ? note + ' ' + noteExtra : noteExtra;
    if (note.length > 20) note = note.slice(0, 20);

    const rec = {
      type: type,
      amount: Math.round(amount * 100) / 100,
      categoryId: pickCategory(type, catText),
      note: note,
      date: date,
      extId: tradeNo || (date + '|' + amount + '|' + party + '|' + type),
      source: isAlipay ? 'alipay' : 'wechat',
      party: party,
      tradeType: tradeType,
      payType: payType
    };
    rec._order = orderNoOf(goodsRaw + ' ' + noteRaw);
    rec._trade = tradeKeyOf(tradeNo);
    if (closed) rec._closed = true;
    records.push(rec);
  }

  // 剔除未成交。退款不在这里冲减，交给导入页的 finalize（要看本批里有没有银行流水）
  const closedCount = records.filter(function (r) { return r._closed; }).length;
  const rf = { matched: 0, amount: 0, unmatched: 0, total: refunds.length };
  const finalRecords = [];
  records.forEach(function (r) {
    const drop = !!r._closed;
    delete r._closed;   // _order / _trade 留着，finalize 时按单号把退款对到原支出
    if (!drop) finalRecords.push(r);
  });

  return {
    refunds: refunds,
    records: finalRecords,
    stats: {
      total: total,
      usable: finalRecords.length,
      skippedFlow: skippedFlow,
      skippedBad: skippedBad,
      skippedRefund: skippedRefund,
      skippedClosed: closedCount,
      refundCount: refunds.length,
      refundMatched: rf.matched,
      refundAmount: rf.amount,
      refundUnmatched: rf.unmatched
    }
  };
}

// 一行的分隔符自适应：Tab（从 Excel/PDF 复制）> 逗号（CSV）> 连续空格
function splitRow(line) {
  const s = String(line || '');
  if (s.indexOf('\t') >= 0) {
    return s.split('\t').map(function (x) { return x.trim(); });
  }
  if (s.indexOf(',') >= 0) {
    return splitCsvLine(s).map(function (x) { return x.trim(); });
  }
  // 从 PDF / 网页复制常见「多个空格」分隔
  const parts = s.split(/\s{2,}/).map(function (x) { return x.trim(); });
  const kept = parts.filter(function (x) { return x !== ''; });
  return kept.length > 1 ? kept : [s.trim()];
}

// 商品说明里常带「订单号：2067889184387690556」，退款单和原支出靠它精确对应
function orderNoOf(text) {
  const m = String(text || '').match(/订单号[：:]\s*([0-9]{6,})/);
  return m ? m[1] : '';
}

/* 交易订单号的比对键：支付宝是「2026092623001124751409504593_331707..._2862...」，
 * 退款行和原订单前半段完全相同；微信是纯数字单号。取第一段即可。 */
function tradeKeyOf(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, '');
  if (!s) return '';
  return s.split('_')[0];
}

/* 退款冲减：把退款金额从原支出里扣掉（「退款不计」会让支出偏高，「退款记成收入」会虚增收入）。
 * 只在本次导入不含银行流水时调用（有流水时退款由流水那条入账体现）。
 * 找原交易的顺序：交易订单号 → 商品说明里的订单号 → 同商户且金额完全相同。
 * 绝不按「金额最接近」乱配：那会把 99 元退款冲到别的 189 元订单上。
 */
function applyRefunds(records, refunds) {
  let matched = 0;
  let amount = 0;
  let unmatched = 0;
  (refunds || []).forEach(function (rf) {
    let target = null;
    if (rf.trade) {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type !== 'expense' || r._trade !== rf.trade) continue;
        if (r.amount + 0.001 < rf.amount) continue;
        target = r;
        break;
      }
    }
    if (!target && rf.order) {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type !== 'expense' || r._order !== rf.order) continue;
        if (r.amount + 0.001 < rf.amount) continue;
        target = r;
        break;
      }
    }
    if (!target) {
      let best = null;
      let bestScore = Infinity;
      records.forEach(function (r) {
        if (r.type !== 'expense') return;
        if (Math.abs(r.amount - rf.amount) > 0.011) return;
        if (r.date > rf.date) return;
        const days = (new Date(rf.date).getTime() - new Date(r.date).getTime()) / 86400000;
        if (days > 92) return;
        const sameParty = r.party && rf.party && r.party === rf.party;
        const score = days * 0.1 + (sameParty ? 0 : 1000);
        if (score < bestScore) { bestScore = score; best = r; }
      });
      target = best;
    }
    if (!target) { unmatched++; return; }
    target.amount = Math.round((target.amount - rf.amount) * 100) / 100;
    matched++;
    amount = Math.round((amount + rf.amount) * 100) / 100;
  });
  return { matched: matched, amount: amount, unmatched: unmatched, total: (refunds || []).length };
}

/* 一行 -> 单元格：真 CSV 优先（有逗号且能切出 3 列以上），
 * 否则按 Tab / 连续空格切（从 Excel、PDF 复制出来的）。
 * 注意：支付宝导出的 CSV 订单号后面带制表符，不能一见到 Tab 就按 Tab 切。
 */
function splitAnyRow(line) {
  const s = String(line || '');
  if (s.indexOf(',') >= 0) {
    const csv = splitCsvLine(s);
    if (csv.length >= 3) return csv.map(function (x) { return x.trim(); });
  }
  return splitRow(s);
}

// CSV 文本 -> 记录
function parse(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r\n|\n|\r/);
  const matrix = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    matrix.push(splitAnyRow(lines[i]));
  }
  return parseRows(matrix);
}

module.exports = {
  parse: parse,
  splitAnyRow: splitAnyRow,
  parseRows: parseRows,
  splitRow: splitRow,
  pickCategory: pickCategory,
  parseAmount: parseAmount,
  parseDate: parseDate,
  splitCsvLine: splitCsvLine,
  applyRefunds: applyRefunds,
  tradeKeyOf: tradeKeyOf
};
