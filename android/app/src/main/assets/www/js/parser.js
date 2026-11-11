/* 微信账单解析：CSV / XLSX -> 记账记录（移植自小程序版，浏览器端用 DecompressionStream 解压 zip） */
(function () {
  'use strict';

  /* 归类规则统一放在 classify.js（与小程序 utils/classify.js 同源），缺失时才用内置兜底 */
  function pickCategory(type, text) {
    if (window.WC && window.WC.classify && window.WC.classify.pickCategory) {
      return window.WC.classify.pickCategory(type, text);
    }
    return type === 'income' ? 'other_in' : 'other';
  }
  function cleanCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return s === '/' || s === '-' ? '' : s;
  }
  function splitCsvLine(line) {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function parseAmount(s) {
    if (s === null || s === undefined || s === '') return NaN;
    if (typeof s === 'number') return s;
    const v = Number(String(s).replace(/[¥￥,\s元]/g, ''));
    return isNaN(v) ? NaN : v;
  }
  function parseDate(s) {
    const str = String(s || '');
    const m = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return m[1] + '-' + WC.p2(Number(m[2])) + '-' + WC.p2(Number(m[3]));
    const num = Number(str);
    if (!isNaN(num) && num > 20000 && num < 90000) {
      const d = new Date(Math.round((num - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + WC.p2(d.getUTCMonth() + 1) + '-' + WC.p2(d.getUTCDate());
    }
    return '';
  }

  /* 二维表 -> 记录 */
  function parseRows(matrix) {
    if (!matrix || !matrix.length) return { error: '内容为空', records: [], stats: { total: 0 } };
    let headerIdx = -1;
    for (let i = 0; i < matrix.length; i++) {
      const joined = (matrix[i] || []).join(',');
      if (joined.indexOf('交易时间') >= 0 && joined.indexOf('金额') >= 0) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      return { error: '没找到表头行（应包含「交易时间」和「金额(元)」）。请确认导出的是「微信支付账单明细」。', records: [], stats: { total: 0 } };
    }
    const header = (matrix[headerIdx] || []).map(h => String(h || '').replace(/\s/g, ''));
    // 微信与支付宝的列名不同：微信叫「交易类型/商品/当前状态/交易单号/支付方式」，
    // 支付宝叫「交易分类/商品说明/交易状态/交易订单号/收付款方式」
    const pick = (a, b) => {
      if (header.indexOf(a) >= 0) return header.indexOf(a);
      if (header.indexOf(b) >= 0) return header.indexOf(b);
      // 兜底：去掉斜杠等符号后按包含匹配（支付宝写的是「收/付款方式」）
      const norm = h => String(h || '').replace(/[\/\·、,，]/g, '');
      const na = norm(a);
      const nb = norm(b);
      return header.findIndex(h => {
        const nh = norm(h);
        return nh && (nh.indexOf(na) >= 0 || nh.indexOf(nb) >= 0);
      });
    };
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
    for (let i = 0; i < header.length; i++) if (header[i].indexOf('金额') === 0) { col.amount = i; break; }
    if (col.time < 0 || col.amount < 0 || col.flow < 0) {
      return { error: '表头缺少「交易时间」「金额(元)」或「收/支」列，无法解析。', records: [], stats: { total: 0 } };
    }
    const cell = (row, i) => (i < 0 || row[i] === undefined || row[i] === null) ? '' : String(row[i]);
    // 未加引号的千分位金额（¥12,800.00）会被 CSV 切成两列，这里向左合并回来
    function normalizeRow(row) {
      const r = row.slice();
      while (col.amount + 1 < r.length &&
        /^[¥￥]?\d{1,3}$/.test(String(r[col.amount]).trim()) &&
        /^\d{3}(\.\d{1,2})?$/.test(String(r[col.amount + 1]).trim())) {
        r.splice(col.amount, 2, String(r[col.amount]) + ',' + String(r[col.amount + 1]));
      }
      return r;
    }
    const records = [];
    const refunds = [];
    let total = 0, skippedFlow = 0, skippedBad = 0, skippedRefund = 0;
    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const raw = matrix[i];
      if (!raw || !raw.length) continue;
      const first = String(raw[0] || '');
      if (first.indexOf('共 ') === 0 || first.indexOf('笔记录') >= 0) continue;
      total++;
      const row = normalizeRow(raw);
      const flow = cleanCell(cell(row, col.flow));
      const date = parseDate(cell(row, col.time));
      const amount = parseAmount(cell(row, col.amount));
      if (!date || isNaN(amount) || amount <= 0) { skippedBad++; continue; }

      const status = cell(row, col.status);
      const goodsRaw = cleanCell(cell(row, col.goods));
      const noteRaw = cleanCell(cell(row, col.note));

      if (flow !== '支出' && flow !== '收入') {
        // 退款单：先收集，稍后从原支出里冲减
        const text = goodsRaw + ' ' + noteRaw;
        if (/退款/.test(status) || /^退款/.test(goodsRaw) || /退款/.test(noteRaw)) {
          refunds.push({
            date: date, amount: amount, party: cleanCell(cell(row, col.party)),
            text: text, order: orderNoOf(text),
            // 支付宝退款行的交易订单号就是原订单的，靠它能精确找回原支出
            trade: tradeKeyOf(cell(row, col.tradeNo))
          });
        }
        skippedFlow++;
        continue;
      }
      // 微信里「已全额退款」的支出行没有独立退款单，直接跳过
      if (/全额退款|已退款|已退还/.test(status) && !/退款成功/.test(status)) { skippedRefund++; continue; }
      // 未成交先保留：被退款冲减干净后会被删掉（确实没扣钱）
      const closed = /交易关闭|交易失败|已关闭|还款失败/.test(status);
      const type = flow === '收入' ? 'income' : 'expense';
      const party = cleanCell(cell(row, col.party));
      const goods = cleanCell(cell(row, col.goods));
      const tradeType = cleanCell(cell(row, col.type));
      const tradeNo = cleanCell(cell(row, col.tradeNo));
      const noteExtra = cleanCell(cell(row, col.note));
      const payType = cleanCell(cell(row, col.payType));
      let note = goods || party || tradeType;
      if (noteExtra) note = note ? note + ' ' + noteExtra : noteExtra;
      if (note.length > 30) note = note.slice(0, 30);
      const rec = {
        type, amount: Math.round(amount * 100) / 100,
        categoryId: pickCategory(type, tradeType + ' ' + party + ' ' + goods),
        note, date,
        extId: tradeNo || (date + '|' + amount + '|' + party + '|' + type),
        source: isAlipay ? 'alipay' : 'wechat', party, tradeType, payType
      };
      rec._order = orderNoOf(goodsRaw + ' ' + noteRaw);
      rec._trade = tradeKeyOf(tradeNo);
      if (closed) rec._closed = true;
      records.push(rec);
    }

    // 清理未成交。退款不在这里冲减，交给 finalize（要看本次导入里有没有银行流水）
    const closedCount = records.filter(function (r) { return r._closed; }).length;
    const final = [];
    records.forEach(function (r) {
      // 交易关闭/失败的一律不计：要么被退款冲成 0，要么根本没扣钱
      const drop = !!r._closed;
      delete r._closed;   // _order 留着，finalize 时按订单号把退款对到原支出
      if (!drop) final.push(r);
    });

    return {
      // refunds 原样带出：同一批里没有银行流水时才冲减（见 app.js finalizePending）
      refunds: refunds,
      records: final,
      stats: {
        total: total, usable: final.length, skippedFlow: skippedFlow, skippedBad: skippedBad, skippedRefund: skippedRefund,
        refundCount: refunds.length, refundMatched: 0, refundAmount: 0, refundUnmatched: 0, skippedClosed: closedCount
      }
    };
  }

  // 商品说明里常带「订单号：2067889184387690556」，退款单和原支出靠它精确对应
  function orderNoOf(text) {
    const m = String(text || '').match(/订单号[：:]\s*([0-9]{6,})/);
    return m ? m[1] : '';
  }

  /* 交易订单号的比对键：
   * 支付宝是「2026092623001124751409504593_331707..._2862...」，退款行和原订单前半段完全相同，
   * 微信是纯数字单号。取第一段即可。
   */
  function tradeKeyOf(text) {
    const s = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!s) return '';
    return s.split('_')[0];
  }

  /* 退款冲减：把退款金额从原支出里扣掉。
   * 「退款不计」会让支出偏高（实测高估 2427 元），而「退款记成收入」又会虚增收入，所以冲减原交易。
   * 只在本次导入不含银行流水时才调用（有流水时退款由流水那条入账体现，见 app.js finalizePending）。
   * 找到原交易的顺序：交易订单号 → 商品说明里的订单号 → 同商户且金额完全相同。
   * 绝不按「金额最接近」乱配：那会把 99 元退款冲到别的 189 元订单上。
   */
  function applyRefunds(records, refunds) {
    let matched = 0;
    let amount = 0;
    let unmatched = 0;
    (refunds || []).forEach(function (rf) {
      let target = null;
      // ① 同一笔交易（最可靠）
      if (rf.trade) {
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (r.type !== 'expense' || r._trade !== rf.trade) continue;
          if (r.amount + 0.001 < rf.amount) continue;
          target = r;
          break;
        }
      }
      // ② 商品说明里的订单号（转转、天猫等平台会写）
      if (!target && rf.order) {
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (r.type !== 'expense' || r._order !== rf.order) continue;
          if (r.amount + 0.001 < rf.amount) continue;
          target = r;
          break;
        }
      }
      // ③ 同商户 + 金额完全一致 + 92 天内（没有单号可对时）
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

  // 一行 -> 单元格：真 CSV 优先，否则按 Tab/连续空格（从 Excel、PDF 复制）
  // 支付宝 CSV 的订单号后面带制表符，不能一见到 Tab 就按 Tab 切
  function splitAnyRow(line) {
    const s = String(line || '');
    if (s.indexOf(',') >= 0) {
      const csv = splitCsvLine(s);
      if (csv.length >= 3) return csv.map(function (x) { return x.trim(); });
    }
    return splitRow(s);
  }

  function parseCsvText(text) {
    const raw = String(text || '').replace(/^﻿/, '');
    const matrix = raw.split(/\r\n|\n|\r/).filter(l => l && l.trim()).map(splitCsvLine);
    return parseRows(matrix);
  }

  /* ---------- 极简 ZIP 读取（优先 DecompressionStream，旧 WebView 回退纯 JS inflate） ---------- */
  async function inflateRaw(data) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        /* 'deflate-raw' 不被支持（旧 WebView）时走下方纯 JS 兜底；其他错误照常抛出 */
        if (!/Unsupported compression format|deflate-raw|not supported|supported compression/i.test(String(e && e.message || e))) throw e;
      }
    }
    return PuffInflate(new Uint8Array(data));
  }
  function zipEntries(buf) {
    const view = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx（zip）文件');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = [];
    const bytes = new Uint8Array(buf);
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, csize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { bytes, view, entries };
  }
  async function readEntry(zip, entry) {
    const { bytes, view } = zip;
    const o = entry.localOffset;
    if (view.getUint32(o, true) !== 0x04034b50) throw new Error('zip 本地头损坏');
    const nameLen = view.getUint16(o + 26, true);
    const extraLen = view.getUint16(o + 28, true);
    const start = o + 30 + nameLen + extraLen;
    const data = bytes.subarray(start, start + entry.csize);
    return entry.method === 0 ? data : inflateRaw(data);
  }

  /* ---------- xlsx XML ---------- */
  function decodeEntities(s) {
    if (!s) return '';
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&amp;/g, '&');
  }
  function parseSharedStrings(xml) {
    const out = [];
    if (!xml) return out;
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml)) !== null) {
      let text = '';
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1])) !== null) text += t[1];
      out.push(decodeEntities(text));
    }
    return out;
  }
  function colIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }
  function parseSheet(xml, shared) {
    const rows = [];
    if (!xml) return rows;
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      const cells = [];
      const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rm[2])) !== null) {
        const attrs = cm[1] || '';
        const inner = cm[3] || '';
        const refM = attrs.match(/\br="([A-Z]+)\d+"/);
        const idx = refM ? colIndex(refM[1]) : cells.length;
        const typeM = attrs.match(/\bt="([^"]+)"/);
        const type = typeM ? typeM[1] : '';
        let value = '';
        if (type === 's') {
          const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) { const i = parseInt(vm[1], 10); value = shared && shared[i] !== undefined ? shared[i] : ''; }
        } else if (type === 'inlineStr') {
          const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          let t;
          while ((t = tRe.exec(inner)) !== null) value += t[1];
          value = decodeEntities(value);
        } else {
          const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) value = decodeEntities(vm[1]);
        }
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      if (cells.some(c => c !== '' && c !== undefined)) rows.push(cells);
    }
    return rows;
  }

  // 失败时回显「它到底看到了什么」：找最像表头的一行，取前几列
  function peekMatrix(matrix) {
    if (!matrix || !matrix.length) return '';
    const looksHeader = row => /日期|时间|金额|摘要|对方|余额|Date|Amount/i.test(row.join(''));
    const row = matrix.find(looksHeader) || matrix.find(r => r.some(c => String(c || '').trim())) || [];
    const txt = row.filter(c => String(c || '').trim()).slice(0, 6).join(' | ');
    return txt.replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  async function parseXlsx(buf) {
    const zip = zipEntries(buf);
    const dec = new TextDecoder('utf-8');
    const find = name => zip.entries.find(e => e.name === name);
    let shared = [];
    if (find('xl/sharedStrings.xml')) {
      shared = parseSharedStrings(dec.decode(await readEntry(zip, find('xl/sharedStrings.xml'))));
    }
    // 有些银行/平台的账单把数据放在第 2、3 个工作表（sheet1 是封面），逐表尝试取记录最多的
    const sheets = zip.entries
      .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!sheets.length) throw new Error('xlsx 里没找到工作表');

    let best = null;
    let bestErr = null;
    let peek = '';
    for (const entry of sheets) {
      const xml = dec.decode(await readEntry(zip, entry));
      const matrix = parseSheet(xml, shared);
      if (!matrix.length) continue;
      const r = parseAuto(matrix);
      if (!r.error && r.records && r.records.length) {
        if (!best || r.records.length > best.records.length) best = r;
      } else if (!bestErr) {
        bestErr = r;
      }
      if (!peek) peek = peekMatrix(matrix);
    }
    if (best) return best;
    const out = bestErr || { error: '这个 Excel 里没有可解析的表格', records: [], stats: { total: 0 } };
    out.error = out.error + (peek ? '（表格里看到的表头是：' + peek + '）' : '');
    return out;
  }

  function decodeCsv(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(buf); }
      catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }

  function csvMatrix(text) {
    const raw = String(text || '').replace(/^﻿/, '');
    return raw.split(/\r\n|\n|\r/).filter(l => l && l.trim()).map(splitCsvLine);
  }

  /* ---------- 通用账单表识别：银行 PDF / 其他平台导出 ---------- */
  const normHeader = s => String(s || '').replace(/\s/g, '');
  function findCol(header, pats) {
    for (let i = 0; i < pats.length; i++) {
      for (let j = 0; j < header.length; j++) {
        if (pats[i].test(header[j])) return j;
      }
    }
    return -1;
  }
  const PAT = {
    time: [/记账日期/, /交易日期/, /交易时间/, /入账日期/, /发生日期/, /日期/, /时间/],
    amount: [/交易金额/, /发生额/, /交易额/, /金额/],
    debit: [/借方金额/, /借方发生额/, /支出金额/, /付出金额/],
    credit: [/贷方金额/, /贷方发生额/, /收入金额/, /存入金额/],
    flow: [/收\/支/, /收支/, /借贷标志/, /借贷/, /交易方向/, /收付标志/, /方向/],
    party: [/交易对方/, /对方户名/, /对方名称/, /对手信息/, /对方信息/, /商户名称/, /商户/, /收款方/, /付款方/],
    memo: [/交易摘要/, /摘要/, /用途/, /附言/, /备注/],
    status: [/当前状态/, /交易状态/, /状态/],
    currency: [/货币/, /币种/, /currency/i]
  };
  const SKIP_ROW = /^(合计|小计|总计|本页合计|承前|转下页|余额|第\s*\d+\s*页)/;
  const REPEAT_HEADER = /记账日期|交易日期|交易时间|Date|Transaction|Balance/;

  // 页眉 / 页脚 / 重复表头等「版面噪音」（只做精确匹配，避免误伤正文）
  const FURN_WORD = /^(记账日期|交易日期|交易时间|账务日期|货币|币种|交易金额|发生额|联机余额|余额|交易摘要|摘要|对手信息|交易对方|Date|Currency|Amount|Transaction|TransactionType|TransactionAmount|Balance|CounterParty|户名|账号|开户行|账户类型|申请时间|验证码|AccountNo|AccountType|SubBranch|VerificationCode)$/;

  function joinText(a, b) {
    if (!a) return b;
    if (!b) return a;
    const needSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
    return a + (needSpace ? ' ' : '') + b;
  }

  // 单元格里取第一个金额：银行流水最后一页常把「温馨提示」叠印在数据行同一 y 上，
  // 会把金额变成 "-13.00和"明细项"信息…" 这种混合物，直接 Number() 会得到 NaN。
  function toAmount(s) {
    let t = String(s === undefined || s === null ? '' : s)
      .replace(/[¥￥,，\s元]/g, '')
      .replace(/[＋]/g, '+')
      .replace(/[－—]/g, '-');
    if (t === '') return NaN;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    const m = t.match(/[-+]?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  function isFurniture(row) {
    const j = row.join('').replace(/\s+/g, '');
    if (!j) return true;
    if (/^\d+\/\d+$/.test(j)) return true;                       // 页码 1/22
    if (/^(第\d+页(共\d+页)?|Page\d+of\d+)$/i.test(j)) return true;
    if (/打印时间|查询时间|电子回单专用章|本页合计|承前页|转下页|以上为本次查询/.test(j)) return true;
    if (FURN_WORD.test(j)) return true;                          // 单个表头词（双语表头拆行）
    if (/记账日期.*货币.*交易金额/.test(j)) return true;          // 整行中文表头
    if (/^DateCurrency/i.test(j)) return true;                   // 整行英文表头
    if (/^(招商银行交易流水|TransactionStatementof)/i.test(j)) return true;
    if (/^户名[：:]|^账号[：:]|^开户行[：:]|^账户类型[：:]|^申请时间[：:]|^验证码[：:]/.test(j)) return true;
    return false;
  }

  /* 折行合并（关键）
   * 银行流水里「对手信息 / 摘要」过长会折成两行，这两行一上一下跨在记录基线两侧，
   * 所以不能一律并入上一条，要按 y 距离归到最近的那条记录，并写回同一列。
   * 另有银行省略重复日期 —— 有金额没日期的行继承上一条日期。
   * ⚠️ y 坐标每页都从头排（780→30），跨页比较会张冠李戴，必须在同页 + 相邻行内挑。
   */
  function foldContinuations(matrix, startIdx, col) {
    const cellOf = (row, i) => (i < 0 || row[i] === undefined || row[i] === null) ? '' : String(row[i]).trim();
    const yOf = function (i) {
      const r = matrix[i];
      return (r && typeof r._y === 'number') ? r._y : null;
    };
    const pageOf = function (i) {
      const r = matrix[i];
      return (r && r._page !== undefined) ? r._page : -1;
    };
    const moneyIn = function (row) {
      const idxs = [];
      if (col.amount >= 0) idxs.push(col.amount);
      if (col.debit >= 0) idxs.push(col.debit);
      if (col.credit >= 0) idxs.push(col.credit);
      for (let i = 0; i < idxs.length; i++) {
        const v = cellOf(row, idxs[i]);
        const n = toAmount(v);
        if (v && !isNaN(n) && n !== 0) return n;
      }
      return null;
    };

    const dataIdx = [];
    for (let i = startIdx; i < matrix.length; i++) {
      const row = matrix[i];
      if (!row || !row.length) continue;
      // 关键：先认「日期 + 金额」，再谈版面噪音。
      // 否则「北京某某科技股份有限公司」这类正常对手方会被当成页脚丢掉。
      if (!parseDate(cellOf(row, col.time))) continue;
      if (moneyIn(row) === null) continue;   // 日期区间行、"第N页"等无金额行
      if (isFurniture(row)) continue;
      dataIdx.push(i);
    }

    let merged = 0;
    let inherited = 0;
    let orphan = 0;

    for (let i = startIdx; i < matrix.length; i++) {
      const row = matrix[i];
      if (!row || !row.length) continue;
      if (!row.join('').trim()) continue;
      if (dataIdx.indexOf(i) >= 0) continue;

      // ① 有金额、没日期：视为省略了日期的新记录
      if (moneyIn(row) !== null) {
        let prev = -1;
        for (let k = 0; k < dataIdx.length; k++) {
          if (dataIdx[k] < i) prev = dataIdx[k]; else break;
        }
        if (prev >= 0) {
          row[col.time] = cellOf(matrix[prev], col.time);
          dataIdx.push(i);
          dataIdx.sort(function (a, b) { return a - b; });
          inherited++;
        } else {
          orphan++;
        }
        continue;
      }

      // ② 纯文字续行：同页、相邻 6 行内，按 y 距离挑最近的数据行
      if (isFurniture(row)) continue;
      let best = -1;
      let bestD = Infinity;
      const my = yOf(i);
      const mp = pageOf(i);
      for (let k = 0; k < dataIdx.length; k++) {
        const j = dataIdx[k];
        if (Math.abs(i - j) > 6) continue;
        if (pageOf(j) !== mp) continue;
        const jy = yOf(j);
        const d = (my !== null && jy !== null) ? Math.abs(my - jy) : Math.abs(i - j) * 24;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) {
        for (let k = 0; k < dataIdx.length; k++) {
          const j = dataIdx[k];
          const d = Math.abs(i - j);
          if (d <= 5 && d < bestD) { bestD = d; best = j; }
        }
      }
      if (best < 0) { orphan++; continue; }

      const target = matrix[best];
      let done = 0;
      for (let c = 0; c < row.length; c++) {
        if (c === col.time) continue;            // 日期列永远不接收续行文字
        const v = String(row[c] === undefined || row[c] === null ? '' : row[c]).trim();
        if (!v) continue;
        target[c] = joinText(String(target[c] || '').trim(), v);
        done++;
      }
      // 单格行（没有表头、按间距切分时常见）：并到备注列 / 对手列
      if (!done) {
        const t = String(row[col.time] === undefined || row[col.time] === null ? '' : row[col.time]).trim();
        const dst = col.memo >= 0 ? col.memo : (col.party >= 0 ? col.party : -1);
        if (t && dst >= 0) {
          target[dst] = joinText(String(target[dst] || '').trim(), t);
          done++;
        }
      }
      if (done) merged++;
    }

    return { rows: dataIdx, merged: merged, inherited: inherited, orphan: orphan };
  }

  function parseStatementRows(matrix) {
    if (!matrix || !matrix.length) return { error: '内容为空', records: [], stats: { total: 0 } };

    let headerIdx = -1;
    let col = null;
    for (let i = 0; i < Math.min(matrix.length, 40); i++) {
      const h = (matrix[i] || []).map(normHeader);
      if (h.length < 3) continue;
      const c = {
        time: findCol(h, PAT.time),
        amount: findCol(h, PAT.amount),
        debit: findCol(h, PAT.debit),
        credit: findCol(h, PAT.credit),
        flow: findCol(h, PAT.flow),
        party: findCol(h, PAT.party),
        memo: findCol(h, PAT.memo),
        status: findCol(h, PAT.status),
        currency: findCol(h, PAT.currency)
      };
      const hasAmount = c.amount >= 0 || (c.debit >= 0 && c.credit >= 0);
      if (c.time >= 0 && hasAmount) { headerIdx = i; col = c; break; }
    }
    if (headerIdx < 0) {
      return {
        error: '没认出表头：需要「日期」列，加「金额」列（或「借方/贷方」两列）。如果是扫描版 PDF（图片），文字提取不到，请改传 Excel/CSV。',
        records: [], stats: { total: 0 }
      };
    }

    const cell = (row, i) => (i < 0 || row[i] === undefined || row[i] === null) ? '' : String(row[i]).trim();
    const num = toAmount;
    const isCny = s => !s || /CNY|RMB|人民币|¥|￥|元/i.test(s);

    // 先做折行合并，得到干净的数据行下标
    const folded = foldContinuations(matrix, headerIdx + 1, col);
    const dataRows = folded.rows;
    if (!dataRows.length) {
      return {
        error: '表格里没读到任何带日期的明细行。如果是扫描件/图片型 PDF，文字提取不到，请改传 Excel/CSV。',
        records: [], stats: { total: 0 }
      };
    }

    // 只有「交易金额」一列时靠正负号分方向：判断整表是否出现负数
    let hasNeg = false;
    for (let k = 0; k < dataRows.length; k++) {
      const v = num(cell(matrix[dataRows[k]], col.amount));
      if (!isNaN(v) && v < 0) { hasNeg = true; break; }
    }

    const records = [];
    let skippedBad = 0, skippedFlow = 0, skippedCur = 0, skippedRefund = 0;
    let seq = 0;

    for (let k = 0; k < dataRows.length; k++) {
      const row = matrix[dataRows[k]] || [];
      if (col.currency >= 0 && !isCny(cell(row, col.currency))) { skippedCur++; continue; }

      const date = parseDate(cell(row, col.time));
      if (!date) { skippedBad++; continue; }

      let amount = NaN;
      let type = '';
      if (col.debit >= 0 && col.credit >= 0) {
        const d = num(cell(row, col.debit));
        const c2 = num(cell(row, col.credit));
        if (d > 0) { amount = d; type = 'expense'; }
        else if (c2 > 0) { amount = c2; type = 'income'; }
      } else {
        amount = num(cell(row, col.amount));
      }
      if (isNaN(amount) || amount === 0) { skippedBad++; continue; }

      // 先看显式的「收/支、借贷标志」列
      if (!type && col.flow >= 0) {
        const flow = cell(row, col.flow);
        if (/支出|借|付出|转出|消费|扣/.test(flow)) type = 'expense';
        else if (/收入|贷|收到|转入|存入/.test(flow)) type = 'income';
      }
      // 再退回「正负号」判断（招行等流水的常见写法）
      if (!type && hasNeg) type = amount < 0 ? 'expense' : 'income';
      if (amount < 0) amount = -amount;
      amount = Math.round(amount * 100) / 100;

      if (!type) { skippedFlow++; continue; }
      const status = cell(row, col.status);
      if (/全额退款|已退款|已退还|交易失败|已撤销|交易取消/.test(status)) { skippedRefund++; continue; }

      const party = cell(row, col.party);
      const memo = cell(row, col.memo);
      let note = memo || party || (type === 'income' ? '收入' : '支出');
      if (note.length > 26) note = note.slice(0, 26);

      // extId 加序号：同一天、同金额、同对手的多笔真实交易不会被误判成重复
      seq++;
      records.push({
        type,
        amount,
        categoryId: pickCategory(type, memo + ' ' + party),
        note,
        date,
        extId: date + '|' + amount + '|' + party + '|' + type + '|' + seq,
        source: 'statement',
        party
      });
    }

    if (!records.length && skippedFlow > 0) {
      return {
        error: '能读到明细，但判断不出「收入还是支出」。这类流水请在表头包含「收/支」「借贷标志」，或让金额带正负号（-5.00 / +100.00）。',
        records: [], stats: { total: dataRows.length, usable: 0, skippedFlow, skippedBad, skippedCur }
      };
    }

    return {
      records,
      stats: {
        total: dataRows.length,
        usable: records.length,
        skippedFlow,
        skippedBad,
        skippedCur,
        skippedHead: 0,
        merged: folded.merged,
        inherited: folded.inherited,
        skippedRefund
      }
    };
  }

  // 先用微信账单的严格规则，认不出来再用通用规则
  function parseAuto(matrix) {
    const strict = parseRows(matrix);
    if (!strict.error && strict.records && strict.records.length) return strict;
    const generic = parseStatementRows(matrix);
    if (!generic.error && generic.records && generic.records.length) return generic;
    if (strict.error && generic.error) {
      // 两个都没认出来：用通用规则的提示（不管什么账单都看得懂），再补一句微信账单的检查点
      const msg = String(generic.error).replace(/。$/, '') + '。微信支付账单应含「交易时间」「金额(元)」两列。';
      return { error: msg, records: [], stats: generic.stats || { total: 0 } };
    }
    if (strict.error) return generic;
    return strict;
  }

  /* 看文件开头的几个字节判断真实格式：
   * 安卓上从聊天/下载里选文件时常拿不到扩展名（file.name 可能是空或没有后缀），
   * 只按名字判断会把 PDF 当文本读，报出「没找到表头行」这种看不懂的错。
   */
  function sniff(head) {
    const b = new Uint8Array(head);
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';   // %PDF
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';   // PK.. → xlsx/docx
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole';   // 老版 .xls/.doc
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image';                   // jpg
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image';  // png
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image';                   // gif
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image';  // webp/heic 里也有 RIFF
    return 'text';
  }

  async function parseFile(file) {
    const name = file.name || '';
    const buf = await file.arrayBuffer();
    const kind = sniff(buf.slice(0, 8));
    const mExt = String(name).match(/\.([a-zA-Z0-9]+)$/);
    const ext = mExt ? mExt[1].toLowerCase() : '';

    if (kind === 'pdf' || ext === 'pdf') {
      if (!window.WCPdf) throw new Error('PDF 解析组件没加载，请刷新页面重试');
      const rows = await window.WCPdf.extractRows(buf);
      if (!rows.length) {
        throw new Error('「' + (name || '这个 PDF') + '」没有文字层（是扫描件/图片），读不出内容。' +
          '可以在 WPS 里「PDF 转 Excel」后再导入，或用「微信-我-服务-钱包-账单」重新下载账单文件。');
      }
      const r = parseAuto(rows);
      if (r.error) r.error = '「' + (name || 'PDF') + '」：' + r.error;
      return r;
    }

    if (kind === 'zip' || ext === 'xlsx' || ext === 'docx') {
      let entries = [];
      try { entries = zipEntries(buf).entries.map(e => e.name); } catch (e) { /* 不是 zip */ }
      if (entries.some(n => /^word\/document\.xml$/.test(n)) || ext === 'docx') {
        throw new Error('Web / APK 版暂不解析 Word（.docx）；请在 WPS 里另存为 Excel（.xlsx）或 CSV 再导入，' +
          '或者用微信小程序版导入（小程序可以直接读 .docx 表格）。');
      }
      const rx = await parseXlsx(buf);
      if (rx.error) rx.error = '「' + (name || '这个 Excel') + '」：' + rx.error;
      return rx;
    }

    if (kind === 'ole' || ext === 'xls' || ext === 'doc') {
      throw new Error('这是老版 Office 文件（.xls / .doc），请用 WPS 或 Excel「另存为」.xlsx 后再导入。');
    }

    if (kind === 'image') {
      throw new Error('「' + (name || '这个文件') + '」是图片（截图 / 照片），不是账单文件。' +
        '账单要从微信「我-服务-钱包-账单-常见问题-下载账单」拿到 .xlsx/.csv，银行流水要下载 PDF 或 Excel 版；' +
        '截图里的数字读不出来。');
    }

    const text = decodeCsv(buf);
    const r = parseAuto(csvMatrix(text));
    if (r.error) {
      // 把文件开头几个字带上：用户一看就知道自己选错文件了，也方便把问题说清楚
      const peek = String(text).replace(/\s+/g, ' ').trim().slice(0, 40);
      r.error = (name ? '「' + name + '」' : '这个文件') + '没认出账单格式。' + r.error +
        (peek ? '（文件开头是：' + peek + '…）' : '');
    }
    return r;
  }

  const WC = window.WC = window.WC || {};
  Object.assign(WC, {
    parseCsvText, parseRows, parseStatementRows, parseAuto, parseFile,
    pickCategory, parseAmount, parseDate, applyRefunds
  });
})();
