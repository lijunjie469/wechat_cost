// 导入账单（支持 CSV / Excel .xlsx / Word .docx；PDF 需先转档）
const parser = require('../../utils/billParser');
const xlsx = require('../../utils/xlsx');
const docx = require('../../utils/docx');
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const classify = require('../../utils/classify');
const gbk = require('../../utils/gbk');

/* 导入口径（与 web 版一致）：
 * 本批含银行流水 → 以银行为准，退款不冲减（退到卡的钱由流水那条「收入」体现）；
 * 只有微信 / 只有支付宝（或两者一起但没有流水）→ 按账单自己的口径，退款冲减原支出。
 * 每次都从原始 records 复制一份重算，反复合并不会重复冲减。
 */
function finalize(records, refunds) {
  const work = (records || []).map(function (r, i) {
    return Object.assign({}, r, { _ri: i });
  });
  const bank = store.hasBankSource(work);
  const rf = { matched: 0, amount: 0, unmatched: 0, total: (refunds || []).length };
  if (!bank && refunds && refunds.length) {
    Object.assign(rf, parser.applyRefunds(work, refunds));
  }
  const out = [];
  work.forEach(function (r) {
    delete r._order;
    delete r._trade;
    // 冲减到 0 的支出：钱确实回来了，不再计入
    if (r.type === 'expense' && r.amount <= 0.001) return;
    out.push(r);
  });
  return { records: out, bank: bank, refund: rf };
}

// 退款口径的说明文案（放在 JS 里算，避免 WXML 里堆太多表达式）
function refundNote(fin) {
  const n = fin.refund.total;
  if (!n) return '';
  if (fin.bank) {
    return '识别到 ' + n + ' 笔退款：本批含银行流水，退到卡的钱由流水体现，这里按原始支出记账，不重复扣减';
  }
  if (fin.refund.amount > 0) {
    return '识别到 ' + n + ' 笔退款：本批没有银行流水，按账单自己的口径，已从原支出里冲减 ¥' +
      util.fmtMoney(fin.refund.amount) +
      (fin.refund.unmatched ? '（另 ' + fin.refund.unmatched + ' 笔原单未成交或不在本期，本就没记账）' : '');
  }
  return '识别到 ' + n + ' 笔退款：对应的原单都是未成交/未扣款，本就没记账，无需再冲减';
}

function extOf(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

Page({
  data: {
    text: '',
    parsed: null,
    preview: [],
    error: '',
    fileName: '',
    importing: false,
    reading: false,
    importCount: 0,
    mergeMode: true,   // 合并多份账单：开启后再选一份会累加到预览
    files: [],
    ignored: 0
  },

  onMergeChange(e) {
    this.setData({ mergeMode: e.detail.value });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  // ① 从聊天记录选账单文件（CSV / xlsx / docx）
  chooseFile() {
    const that = this;
    if (!wx.chooseMessageFile) {
      this.setData({ error: '当前环境不支持选择文件，请用下面的粘贴方式（电脑上可直接复制 CSV 文本）' });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt', 'xlsx', 'docx', 'doc', 'pdf'],
      success(res) {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        that.setData({ fileName: f.name || '账单', error: '' });
        const ext = extOf(f.name || f.path);
        if (ext === 'xlsx') {
          that.readXlsx(f.path);
        } else if (ext === 'docx') {
          that.readDocx(f.path);
        } else if (ext === 'doc') {
          that.setData({ error: '旧版 Word（.doc）不支持直接解析。请在 WPS / Word 里「另存为 → .docx」或「导出为 Excel」后再导入。' });
        } else if (ext === 'pdf') {
          that.setData({
            error: 'PDF 不支持直接读取（PDF 里的表格是排版图形，小程序端无法稳定还原行列）。两个替代办法：\n① 用 WPS 打开 PDF → 分享/另存为 Excel 或 CSV，再回来导入；\n② 在 WPS 里长按表格「复制」，粘贴到下面文本框，点「解析粘贴的文本」。'
          });
        } else if (ext === 'xls') {
          that.setData({ error: '旧版 .xls 暂不支持，请用 Excel 另存为 .xlsx 或 CSV 再导入' });
        } else {
          that.readCsv(f.path);
        }
      },
      fail() {
        wx.showToast({ title: '已取消或不可用，可用下面的粘贴方式', icon: 'none' });
      }
    });
  },

  readCsv(filePath) {
    const fsys = wx.getFileSystemManager();
    this.setData({ reading: true });
    try {
      // 支付宝导出的 CSV 是 GBK 编码，微信的是 UTF-8：先按 UTF-8 读，发现乱码再用内置 GBK 表解码
      let text = '';
      try { text = fsys.readFileSync(filePath, 'utf-8'); } catch (e) { text = ''; }
      if (!text || gbk.looksGarbled(text)) {
        const buf = fsys.readFileSync(filePath);
        text = gbk.decode(buf);
      }
      this.setData({ reading: false });
      this.doParseText(text);
    } catch (e) {
      this.setData({ reading: false, error: '读取文件失败，请改用粘贴方式' });
    }
  },

  // xlsx 本质是 zip：解压后读 sharedStrings + 第一个 sheet 的 xml
  readXlsx(filePath) {
    const that = this;
    const fsys = wx.getFileSystemManager();
    const target = wx.env.USER_DATA_PATH + '/bill_xlsx_' + Date.now();
    this.setData({ reading: true, error: '' });
    wx.showLoading({ title: '解析 Excel', mask: true });

    fsys.unzip({
      zipFilePath: filePath,
      targetPath: target,
      success() {
        try {
          let shared = [];
          try {
            const sst = fsys.readFileSync(target + '/xl/sharedStrings.xml', 'utf-8');
            shared = xlsx.parseSharedStrings(sst);
          } catch (e) {
            shared = [];
          }

          // 取第一个工作表
          let sheetXml = '';
          try {
            const list = fsys.readdirSync(target + '/xl/worksheets');
            const files = list.filter(function (n) { return /\.xml$/i.test(n); }).sort();
            if (!files.length) throw new Error('no sheet');
            sheetXml = fsys.readFileSync(target + '/xl/worksheets/' + files[0], 'utf-8');
          } catch (e) {
            throw new Error('没找到工作表，可能不是标准 xlsx');
          }

          const matrix = xlsx.parseSheet(sheetXml, shared);
          that.applyMatrix(matrix);
        } catch (e) {
          wx.hideLoading();
          that.setData({ reading: false, error: 'Excel 解析失败：' + (e.message || e) });
          return;
        }
        try { fsys.rmdirSync(target, true); } catch (e) {}
        wx.hideLoading();
        that.setData({ reading: false });
      },
      fail() {
        wx.hideLoading();
        that.setData({ reading: false, error: '解压失败，可能不是有效的 .xlsx 文件' });
      }
    });
  },

  // docx 也是 zip：解压后读 word/document.xml，把表格转成二维数组
  readDocx(filePath) {
    const that = this;
    const fsys = wx.getFileSystemManager();
    const target = wx.env.USER_DATA_PATH + '/bill_docx_' + Date.now();
    this.setData({ reading: true, error: '' });
    wx.showLoading({ title: '解析 Word', mask: true });

    fsys.unzip({
      zipFilePath: filePath,
      targetPath: target,
      success() {
        try {
          let xml = '';
          const candidates = ['/word/document.xml', '/word/document2.xml'];
          for (let i = 0; i < candidates.length; i++) {
            try {
              xml = fsys.readFileSync(target + candidates[i], 'utf-8');
              if (xml) break;
            } catch (e) { /* 试下一个 */ }
          }
          if (!xml) throw new Error('没找到正文，可能不是标准 .docx');

          const doc = docx.parseDocument(xml);
          const table = docx.pickBillTable(doc.tables);
          if (!table) {
            wx.hideLoading();
            that.setData({
              reading: false,
              error: '文档里没找到表格。账单需要是表格形式；可以另存为 Excel，或把表格内容复制粘贴到下面的文本框。'
            });
            return;
          }
          that.applyMatrix(table);
        } catch (e) {
          wx.hideLoading();
          that.setData({ reading: false, error: 'Word 解析失败：' + (e.message || e) });
          return;
        }
        try { fsys.rmdirSync(target, true); } catch (e) {}
        wx.hideLoading();
        that.setData({ reading: false });
      },
      fail() {
        wx.hideLoading();
        that.setData({ reading: false, error: '解压失败，可能不是有效的 .docx 文件（.doc 请先另存为 .docx）' });
      }
    });
  },

  // ② 解析粘贴的 CSV 文本
  parseText() {
    if (!this.data.text || this.data.text.trim().length < 10) {
      wx.showToast({ title: '先粘贴账单文本', icon: 'none' });
      return;
    }
    this.doParseText(this.data.text);
  },

  doParseText(text) {
    this.applyResult(parser.parse(text));
  },

  applyMatrix(matrix) {
    this.applyResult(parser.parseRows(matrix));
  },

  applyResult(r) {
    if (r.error) {
      this.setData({ parsed: null, preview: [], files: [], ignored: 0, error: r.error });
      return;
    }
    if (!r.records.length) {
      this.setData({
        parsed: null,
        preview: [],
        files: [],
        ignored: 0,
        error: '没解析出可导入的记录（可能全是「不计收支」、退款或金额异常）'
      });
      return;
    }

    const srcName = this.data.fileName || '粘贴的文本';
    // 打来源标记：合并时要靠它区分「同一份里的多笔」与「两份里的同一笔」
    const incoming = r.records.map(function (rec) {
      return Object.assign({}, rec, { _src: srcName });
    });

    const merging = this.data.mergeMode && this.data.parsed && this.data.parsed.records && this.data.parsed.records.length;
    let records = incoming;
    let files = [{ name: srcName, count: incoming.length }];
    let stats = Object.assign({}, r.stats);
    let refunds = (r.refunds || []).slice();
    let dup = 0;
    let dupCross = 0;

    if (merging) {
      // 两份账单区间重叠时，同一笔按出现次数取较大值，不会翻倍
      const m = store.previewMerge(this.data.parsed.records, incoming);
      records = m.records;
      dup = m.duplicated;
      dupCross = m.crossMerged || 0;
      files = (this.data.files || []).concat(files);
      refunds = (this.data.parsed.refunds || []).concat(refunds);
      const base = this.data.parsed.stats || {};
      stats = {
        total: (base.total || 0) + (r.stats.total || 0),
        usable: records.length,
        skippedFlow: (base.skippedFlow || 0) + (r.stats.skippedFlow || 0),
        skippedRefund: (base.skippedRefund || 0) + (r.stats.skippedRefund || 0),
        skippedBad: (base.skippedBad || 0) + (r.stats.skippedBad || 0),
        skippedClosed: (base.skippedClosed || 0) + (r.stats.skippedClosed || 0),
        refundCount: (base.refundCount || 0) + (r.stats.refundCount || 0),
        refundAmount: (base.refundAmount || 0) + (r.stats.refundAmount || 0)
      };
    }

    const fin = finalize(records, refunds);
    const preview = fin.records.slice(0, 8).map(function (rec) {
      const c = cats.byId(rec.type, rec.categoryId);
      return Object.assign({}, rec, {
        icon: c.icon,
        catName: c.name,
        merchant: classify.merchantOf(rec),
        amountText: (rec.type === 'income' ? '+' : '-') + util.fmtMoney(rec.amount)
      });
    });

    const ignored = (stats.skippedFlow || 0) + (stats.skippedRefund || 0) + (stats.skippedBad || 0) + (stats.skippedClosed || 0);
    stats.refundCount = refunds.length;
    stats.refundAmount = fin.refund.amount;
    stats.refundMatched = fin.refund.matched;
    stats.refundUnmatched = fin.refund.unmatched;
    stats.refundAmountText = util.fmtMoney(stats.refundAmount || 0);
    stats.refundNote = refundNote(fin);
    stats.bank = fin.bank;
    stats.crossMerged = dupCross;

    // final 放实例上，别塞进 setData（几百条记录会白白翻倍传输）
    this._final = fin;

    this.setData({
      parsed: { records: records, refunds: refunds, stats: stats },
      importCount: fin.records.length,
      preview: preview,
      files: files,
      ignored: ignored,
      error: ''
    });

    wx.showToast({
      title: (merging ? '已合并，共 ' : '解析到 ') + fin.records.length + ' 条' + (dup ? '（去重 ' + dup + '）' : ''),
      icon: 'none'
    });
  },

  doImport() {
    if (!this.data.parsed || this.data.importing) return;
    const fin = this._final || finalize(this.data.parsed.records, this.data.parsed.refunds);
    const records = fin.records;
    this.setData({ importing: true });
    wx.showLoading({ title: '导入中', mask: true });

    try {
      const clean = records.map(function (rec) {
        const c = Object.assign({}, rec);
        delete c._src;
        delete c._chan;
        delete c._ri;
        delete c._order;
        delete c._trade;
        return c;
      });
      const res = store.addMany(clean);
      wx.hideLoading();
      this._final = null;
      this.setData({ importing: false, parsed: null, preview: [], files: [], ignored: 0, importCount: 0, text: '', fileName: '' });
      wx.showModal({
        title: '导入完成',
        content: '新增 ' + res.added + ' 条，跳过重复 ' + res.duplicated + ' 条。',
        showCancel: false,
        success() {
          wx.navigateBack({ delta: 1 });
        }
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ importing: false });
      wx.showToast({ title: '导入出错：' + (e.message || e), icon: 'none' });
    }
  }
});
