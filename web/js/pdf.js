/* pdf.js 适配层：把 PDF 文字层还原成「二维表」，再交给 parser 解析
 *
 * PDF 没有行列结构，只有文字坐标；而且**空单元格不会产生任何文字**，
 * 所以不能只按间距切 \t（一列空了后面全体左移）。
 * 做法：
 *   1) 每页 getTextContent() 取每个文字块的 x/y/宽度
 *   2) y 相近（±2pt）归为同一行，行内按 x 排序
 *   3) 在本页里找「表头行」（含 日期/时间 + 金额/摘要/交易 等关键词），
 *      用表头每个词的 x 中心作为列锚点
 *   4) 数据行里每个文字块按最近的列锚点归位——空列自然保留空字符串
 *   5) 找不到表头时退回「按间距切分」，兼容普通文本型 PDF
 */
(function () {
  'use strict';

  var loaded = false;
  function ensureLib() {
    if (loaded) return true;
    if (!window.pdfjsLib) return false;
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    } catch (e) { /* 忽略 */ }
    loaded = true;
    return true;
  }

  var HEADER_HINT = /(交易)?日期|时间|金额|摘要|收\/支|收支|借贷|余额|对方|商户|用途|备注/;

  // 文字块 -> 行（每行是 [{s,x,xc,w,y}]）
  function groupLines(items) {
    var pts = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string') continue;
      var s = it.str.replace(/\u00a0/g, ' ');
      if (!s.trim()) continue;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var w = it.width || 0;
      pts.push({ s: s.trim(), x: tr[4], xc: tr[4] + w / 2, w: w, y: tr[5] });
    }
    if (!pts.length) return [];

    pts.sort(function (a, b) {
      if (Math.abs(a.y - b.y) > 2) return b.y - a.y; // 自上而下
      return a.x - b.x;
    });

    var lines = [];
    var cur = [pts[0]];
    var curY = pts[0].y;
    for (var k = 1; k < pts.length; k++) {
      if (Math.abs(pts[k].y - curY) <= 2) {
        cur.push(pts[k]);
      } else {
        lines.push(cur);
        cur = [pts[k]];
        curY = pts[k].y;
      }
    }
    lines.push(cur);
    lines.forEach(function (l) { l.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }

  // 间距切分（无表头时的兜底）
  function lineToCellsByGap(line) {
    var text = '';
    var prevEnd = null;
    for (var j = 0; j < line.length; j++) {
      var it = line[j];
      if (prevEnd !== null) {
        var gap = it.x - prevEnd;
        if (gap > 8) text += '\t';
        else if (gap > 1.5) text += ' ';
      }
      text += it.s;
      prevEnd = it.x + it.w;
    }
    return text.split('\t').map(function (c) { return c.trim(); });
  }

  function looksLikeHeader(line) {
    if (!line || line.length < 2) return false;
    var joined = line.map(function (p) { return p.s; }).join('');
    if (!HEADER_HINT.test(joined)) return false;
    var hasDate = /日期|时间/.test(joined);
    var hasAmount = /金额|发生额|借方|贷方|收入|支出|余额/.test(joined);
    return hasDate && hasAmount;
  }

  // 有表头：按列锚点归位
  function cellsByAnchors(line, anchors) {
    var cells = [];
    for (var i = 0; i < anchors.length; i++) cells.push('');
    for (var j = 0; j < line.length; j++) {
      var p = line[j];
      var best = 0;
      var bestD = Infinity;
      for (var a = 0; a < anchors.length; a++) {
        var d = Math.abs(p.xc - anchors[a]);
        if (d < bestD) { bestD = d; best = a; }
      }
      cells[best] = cells[best] ? cells[best] + ' ' + p.s : p.s;
    }
    return cells;
  }

  // 单页 items -> matrix
  function pageToRows(items) {
    var lines = groupLines(items);
    if (!lines.length) return [];

    var headerIdx = -1;
    for (var i = 0; i < Math.min(lines.length, 12); i++) {
      if (looksLikeHeader(lines[i])) { headerIdx = i; break; }
    }

    if (headerIdx < 0) {
      // 没有表头：退回间距切分
      return lines.map(lineToCellsByGap);
    }

    var anchors = lines[headerIdx].map(function (p) { return p.xc; });
    // 双语表头（中文行 + 英文行）会产生同一列的两个锚点，先按 x 合并，避免列错位
    anchors.sort(function (a, b) { return a - b; });
    var merged = [];
    for (var ai = 0; ai < anchors.length; ai++) {
      var last = merged.length ? merged[merged.length - 1] : null;
      if (last !== null && anchors[ai] - last < 16) {
        merged[merged.length - 1] = (last + anchors[ai]) / 2;
      } else {
        merged.push(anchors[ai]);
      }
    }
    anchors = merged;
    var out = [];
    for (var k = 0; k < lines.length; k++) {
      var row;
      if (k < headerIdx) {
        row = [lines[k].map(function (p) { return p.s; }).join(' ')];
      } else {
        row = cellsByAnchors(lines[k], anchors);
      }
      // 保留基线 y（PDF 坐标，向上为正），parser 用它判断折行归属
      row._y = lines[k].length ? lines[k][0].y : null;
      out.push(row);
    }
    return out;
  }

  // ArrayBuffer -> matrix（逐页拼接）
  var extractRows = function (arrayBuffer) {
    if (!ensureLib()) return Promise.reject(new Error('PDF 解析库未加载'));
    var task = window.pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true
    });
    return task.promise.then(function (pdf) {
      var out = [];
      var chain = Promise.resolve();
      var maxPage = Math.min(pdf.numPages, 60); // 账单一般不会太多页，兜底防卡死
      for (var p = 1; p <= maxPage; p++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return pdf.getPage(pageNo).then(function (page) {
              return page.getTextContent().then(function (tc) {
                var rows = pageToRows(tc.items || []);
                for (var i = 0; i < rows.length; i++) {
                  rows[i]._page = pageNo;   // 折行归属只在本页内比较 y
                  out.push(rows[i]);
                }
              });
            });
          });
        })(p);
      }
      return chain.then(function () {
        try { pdf.destroy(); } catch (e) { /* 忽略 */ }
        return out;
      });
    });
  };

  window.WCPdf = {
    extractRows: extractRows,
    pageToRows: pageToRows,
    groupLines: groupLines,
    ensureLib: ensureLib
  };
})();
