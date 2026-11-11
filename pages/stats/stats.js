// 统计页：总览 / 交易对手 / 金额分析
const store = require('../../utils/store');
const util = require('../../utils/util');
const cats = require('../../utils/categories');
const analysis = require('../../utils/analysis');

const PALETTE = ['#FF8A65', '#4FC3F7', '#BA68C8', '#81C784', '#FFD54F', '#F06292', '#90A4AE', '#A1887F', '#64B5F6', '#CE93D8'];

Page({
  data: {
    month: '',
    tab: 'overview',
    type: 'expense',
    typeName: '支出',
    total: '0.00',
    count: 0,
    avg: '0.00',
    list: [],
    isEmpty: true,
    // 交易对手
    partyType: 'expense',
    partyTypeName: '支出',
    partyList: [],
    partyKey: '',
    partyMonthly: [],
    partyEmpty: true,
    // 金额分析
    amountRows: [],
    bigThreshold: '100',
    bigList: [],
    bigCount: 0,
    bigSum: '0.00',
    bigPct: 0,
    // 趋势
    trendRows: [],
    mom: { expText: '0', incText: '0', curExp: '0.00', prevExp: '0.00', curInc: '0.00', prevInc: '0.00', upExp: false, upInc: false },
    avgExp: '0.00',
    avgInc: '0.00'
  },

  onShow() {
    if (!this.data.month) {
      this.setData({ month: util.curMonth() });
    }
    this.reload();
  },

  prevMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, -1) });
    this.reload();
  },

  nextMonth() {
    this.setData({ month: util.shiftMonth(this.data.month, 1) });
    this.reload();
  },

  setType(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ type: t, typeName: t === 'income' ? '收入' : '支出' });
    this.reload();
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.reload();
  },

  setPartyType(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ partyType: t, partyTypeName: t === 'income' ? '收入' : '支出', partyKey: '' });
    this.reload();
  },

  pickParty(e) {
    this.setData({ partyKey: e.currentTarget.dataset.name });
    this.buildParty();
  },

  editRec(e) {
    wx.navigateTo({ url: '/pages/add/add?id=' + e.currentTarget.dataset.id });
  },

  onThresholdInput(e) {
    this.setData({ bigThreshold: e.detail.value });
  },

  applyThreshold() {
    const v = Number(this.data.bigThreshold);
    if (!v || v <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    this.buildAmount();
    wx.showToast({ title: '已按 ¥' + v + ' 统计', icon: 'none' });
  },

  reload() {
    const all = store.all();
    const month = this.data.month;
    const recs = analysis.monthRecs(all, month);

    // 总览
    if (this.data.tab === 'overview') {
      const type = this.data.type;
      const list = recs.filter(function (r) { return r.type === type; });
      let total = 0;
      list.forEach(function (r) { total += r.amount; });
      const rows = analysis.categoryRows(recs, type);
      const max = rows.length ? rows[0].sum : 1;
      const rowsV = rows.map(function (r, i) {
        return Object.assign({}, r, {
          sumText: util.fmtMoney(r.sum),
          barW: Math.max(2, Math.round(r.sum / max * 100)),
          color: PALETTE[i % PALETTE.length]
        });
      });
      const days = util.daysInMonth(month);
      this.setData({
        total: util.fmtMoney(total),
        count: list.length,
        avg: util.fmtMoney(total / days),
        list: rowsV,
        isEmpty: rowsV.length === 0
      });
      this.drawPie(rowsV);
    }

    if (this.data.tab === 'party') this.buildParty();
    if (this.data.tab === 'amount') this.buildAmount();
    if (this.data.tab === 'trend') this.buildTrend();
  },

  // 近 6 个月趋势 + 环比
  buildTrend() {
    const all = store.all();
    const rows = analysis.monthSummary(all, this.data.month, 6);
    const max = rows.reduce(function (s, r) {
      return Math.max(s, r.expense, r.income);
    }, 0) || 1;

    const trendRows = rows.map(function (r) {
      return {
        month: r.month,
        label: r.label,
        expLabel: r.expense >= 10000 ? (r.expense / 10000).toFixed(1) + '万' : Math.round(r.expense),
        expText: util.fmtMoney(r.expense),
        incText: util.fmtMoney(r.income),
        hExp: Math.max(2, Math.round(r.expense / max * 220)),
        hInc: Math.max(2, Math.round(r.income / max * 220))
      };
    });

    const cur = rows[rows.length - 1] || { expense: 0, income: 0 };
    const prev = rows[rows.length - 2] || { expense: 0, income: 0 };
    const pct = function (c, p) {
      if (!p) return c > 0 ? 100 : 0;
      return Math.round((c - p) / p * 100);
    };
    const expPct = pct(cur.expense, prev.expense);
    const incPct = pct(cur.income, prev.income);
    const sumExp = rows.reduce(function (s, r) { return s + r.expense; }, 0);
    const sumInc = rows.reduce(function (s, r) { return s + r.income; }, 0);

    this.setData({
      trendRows: trendRows,
      mom: {
        expPct: expPct,
        incPct: incPct,
        expText: (expPct > 0 ? '+' : '') + expPct,
        incText: (incPct > 0 ? '+' : '') + incPct,
        curExp: util.fmtMoney(cur.expense),
        prevExp: util.fmtMoney(prev.expense),
        curInc: util.fmtMoney(cur.income),
        prevInc: util.fmtMoney(prev.income),
        upExp: expPct > 0,
        upInc: incPct > 0
      },
      avgExp: util.fmtMoney(sumExp / 6),
      avgInc: util.fmtMoney(sumInc / 6)
    });
  },

  buildParty() {
    const all = store.all();
    const month = this.data.month;
    const recs = analysis.monthRecs(all, month);
    const type = this.data.partyType;
    const rows = analysis.partyAgg(recs, type).slice(0, 15);
    const max = rows.length ? rows[0].sum : 1;
    const list = rows.map(function (r) {
      return Object.assign({}, r, {
        sumText: util.fmtMoney(r.sum),
        barW: Math.max(2, Math.round(r.sum / max * 100))
      });
    });
    const current = this.data.partyKey;
    const exists = list.some(function (x) { return x.name === current; });
    const key = exists ? current : (list.length ? list[0].name : '');
    this.setData({
      partyList: list,
      partyKey: key,
      partyEmpty: list.length === 0
    }, () => this.buildPartyMonthly(all, key, type));
  },

  buildPartyMonthly(all, name, type) {
    if (!name) {
      this.setData({ partyMonthly: [] });
      return;
    }
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(util.shiftMonth(this.data.month, -i));
    const rows = analysis.partyMonthly(all, name, months, type);
    const max = rows.reduce(function (s, r) { return Math.max(s, r.sum); }, 0) || 1;
    this.setData({
      partyMonthly: rows.map(function (r) {
        return { month: r.month, sumText: util.fmtMoney(r.sum), h: Math.max(8, Math.round(r.sum / max * 220)) };
      })
    });
  },

  buildAmount() {
    const recs = analysis.monthRecs(store.all(), this.data.month);
    const expenses = recs.filter(function (r) { return r.type === 'expense'; });
    const buckets = analysis.bucketStats(expenses);
    const maxSum = buckets.reduce(function (s, b) { return Math.max(s, b.sum); }, 0) || 1;
    const totalExp = expenses.reduce(function (s, r) { return s + r.amount; }, 0) || 1;

    const th = Number(this.data.bigThreshold) || 100;
    const big = analysis.bigExpenses(expenses, th);
    const bigSum = big.reduce(function (s, r) { return s + r.amount; }, 0);

    this.setData({
      amountRows: buckets.map(function (b) {
        return {
          label: b.label,
          sumText: util.fmtMoney(b.sum),
          count: b.count,
          pct: b.pct,
          barW: Math.max(1, Math.round(b.sum / maxSum * 100))
        };
      }),
      bigCount: big.length,
      bigSum: util.fmtMoney(bigSum),
      bigPct: Math.round(bigSum / totalExp * 100),
      bigList: big.slice(0, 20).map(function (r) {
        const c = cats.byId('expense', r.categoryId);
        return {
          id: r.id,
          icon: c.icon,
          note: r.note || c.name,
          date: r.date,
          sumText: util.fmtMoney(r.amount)
        };
      })
    });
  },

  drawPie(rowsV) {
    wx.createSelectorQuery()
      .in(this)
      .select('#pie')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        let dpr = 2;
        try {
          if (wx.getWindowInfo) dpr = wx.getWindowInfo().pixelRatio;
        } catch (e) { /* 忽略，使用默认值 */ }
        const w = res[0].width;
        const h = res[0].height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) / 2 - 8;
        const r = R * 0.62;
        const total = rowsV.reduce(function (s, x) { return s + x.sum; }, 0);

        if (!total) {
          ctx.beginPath();
          ctx.arc(cx, cy, R, 0, Math.PI * 2);
          ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
          ctx.fillStyle = '#F0F1F3';
          ctx.fill();
          return;
        }

        let ang = -Math.PI / 2;
        rowsV.forEach(function (x) {
          const a2 = ang + (x.sum / total) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx, cy, R, ang, a2);
          ctx.arc(cx, cy, r, a2, ang, true);
          ctx.closePath();
          ctx.fillStyle = x.color;
          ctx.fill();
          ang = a2;
        });
      });
  }
});
