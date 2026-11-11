/* 应用主逻辑：路由、账单、统计、导入、设置 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const WC = window.WC;
  const { store, settings, fmt, esc } = WC;

  const state = {
    view: 'home',
    month: WC.thisMonth(),
    period: 'month',
    year: WC.thisMonth().slice(0, 4),
    q: '', ftype: 'all', fcat: 'all', facct: 'all',
    statsType: 'expense',
    statsTab: 'overview',
    statDay: null,
    _heatPerDay: null,
    partyType: 'expense',
    partyKey: null,
    bigThreshold: 100,
    detail: { from: '', to: '', type: 'all', cat: 'all', acct: 'all', min: '', max: '', q: '', sortKey: 'date', sortDir: 'desc', page: 1, pageSize: 50 },
    pending: null,
    editingId: null,
    etype: 'expense',
    ecat: 'food',
    amountStr: '',
    catType: 'expense'
  };
  const VIEW_TITLES = { home: '', stats: '收支统计', detail: '流水明细', import: '导入账单', settings: '数据与设置' };

  /* ---------- 通用 ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function confirmBox(title, text) {
    return new Promise(resolve => {
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      const dlg = $('confirmDialog');
      const done = v => { dlg.close(); $('btnConfirmYes').onclick = $('btnConfirmNo').onclick = null; resolve(v); };
      $('btnConfirmYes').onclick = () => done(true);
      $('btnConfirmNo').onclick = () => done(false);
      dlg.oncancel = () => resolve(false);
      dlg.showModal();
    });
  }
  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function shiftDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' + WC.p2(d.getMonth() + 1) + '-' + WC.p2(d.getDate());
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    const t = settings.get().theme || 'light';
    document.documentElement.setAttribute('data-theme', t);
    $('btnTheme').textContent = t === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式';
    $('themeText').textContent = t === 'dark' ? '当前：深色' : '当前：浅色';
  }
  function toggleTheme() {
    settings.set({ theme: settings.get().theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
    if (state.view === 'stats') renderStats();
  }

  /* ---------- 视图 ---------- */
  function switchView(view) {
    state.view = view;
    document.body.dataset.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $('view-' + view).classList.remove('hidden');
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    $('viewTitle').textContent = VIEW_TITLES[view];
    const hideNav = view === 'import' || view === 'settings' || view === 'detail';
    $('monthNav').style.visibility = hideNav ? 'hidden' : 'visible';
    $('btnAddTop').style.visibility = hideNav ? 'hidden' : 'visible';
    if (view === 'stats') renderStats();
    if (view === 'settings') renderSettings();
    if (view === 'detail') renderDetail();
    if (view === 'home') renderHome();
  }

  /* ---------- 期间 ---------- */
  function periodRecords() {
    return store.all().filter(r =>
      state.period === 'year'
        ? r.date.slice(0, 4) === state.year
        : WC.monthOf(r.date) === state.month
    ).sort((a, b) => a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1));
  }
  function renderMonth() {
    const yearly = state.view === 'stats' && state.period === 'year';
    $('monthTitle').textContent = yearly ? state.year + '年' : WC.monthLabel(state.month);
    const n = yearly
      ? store.all().filter(r => r.date.slice(0, 4) === state.year).length
      : store.all().filter(r => WC.monthOf(r.date) === state.month).length;
    $('monthSub').textContent = n ? n + ' 笔记录' : '暂无记录';
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    state.period = 'month';
    renderMonth();
    const recs = store.all().filter(r => WC.monthOf(r.date) === state.month)
      .sort((a, b) => a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1));
    const exp = recs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const inc = recs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    $('sumExpense').textContent = fmt(exp);
    $('sumIncome').textContent = fmt(inc);
    $('sumBalance').textContent = fmt(inc - exp);

    const budget = settings.budget(state.month);
    $('budgetCard').classList.toggle('hidden', budget <= 0);
    if (budget > 0) {
      const pct = Math.min(100, (exp / budget) * 100);
      $('budgetText').textContent = '预算 ¥' + fmt(budget) + ' · 已用 ' + pct.toFixed(0) + '%' +
        (exp > budget ? ' · 超支 ¥' + fmt(exp - budget) : ' · 剩余 ¥' + fmt(budget - exp));
      $('budgetBar').style.width = pct + '%';
      $('budgetBar').classList.toggle('over', exp > budget);
    }

    const q = state.q.trim().toLowerCase();
    const filtered = recs.filter(r => {
      if (state.ftype !== 'all' && r.type !== state.ftype) return false;
      if (state.fcat !== 'all' && r.categoryId !== state.fcat) return false;
      if (state.facct !== 'all' && r.accountId !== state.facct && r.toAccountId !== state.facct) return false;
      if (q) {
        const cat = WC.byId(r.type, r.categoryId);
        const acc = WC.accountById(r.accountId);
        const hay = (r.note + ' ' + (r.party || '') + ' ' + cat.name + ' ' + acc.name + ' ' + r.amount).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    const listEl = $('recordList');
    const empty = $('homeEmpty');
    if (!filtered.length) {
      listEl.innerHTML = '';
      empty.classList.remove('hidden');
      $('emptyText').textContent = recs.length ? '没有符合筛选条件的记录' : '这个月还没有记录';
      $('btnEmptyAdd').textContent = recs.length ? '清除筛选' : '记第一笔';
      $('btnSeedDemo').classList.toggle('hidden', !!recs.length);
      return;
    }
    empty.classList.add('hidden');

    const groups = [];
    filtered.forEach(r => {
      let g = groups[groups.length - 1];
      if (!g || g.date !== r.date) { g = { date: r.date, items: [], exp: 0, inc: 0 }; groups.push(g); }
      g.items.push(r);
      if (r.type === 'expense') g.exp += r.amount;
      if (r.type === 'income') g.inc += r.amount;
    });

    listEl.innerHTML = groups.map(g => {
      const rows = g.items.map(r => {
        const isTr = r.type === 'transfer';
        const c = WC.byId(r.type, r.categoryId);
        const acc = WC.accountById(r.accountId);
        const accTo = isTr ? WC.accountById(r.toAccountId) : null;
        const icon = isTr ? '🔁' : c.icon;
        // 主标题用「商家」：银行流水里 note 常是「快捷支付」这类摘要，说了等于没说是谁
        const merchant = isTr ? '' : merchantOf(r);
        const title = isTr ? (acc.name + ' → ' + accTo.name) : (merchant || r.note || c.name);
        const sub = isTr
          ? [r.note, '账户转账'].filter(Boolean).join(' · ')
          : [c.name, channelOf(r), acc.name, srcTag(r)].filter(Boolean).join(' · ');
        const amount = isTr ? fmt(r.amount) : (r.type === 'expense' ? '-' : '+') + fmt(r.amount);
        return '<div class="rec ' + r.type + '" data-id="' + r.id + '">' +
          '<div class="rec-icon">' + icon + '</div>' +
          '<div class="rec-main"><div class="rec-note">' + esc(title) + (isTr ? '<span class="transfer-tag">转账</span>' : '') + '</div>' +
          '<div class="rec-sub">' + esc(sub) + '</div></div>' +
          '<div class="rec-amount ' + r.type + '">' + amount + '</div>' +
          '<button class="rec-del" data-del="' + r.id + '">删除</button></div>';
      }).join('');
      const sub = [g.exp ? '支出 ' + fmt(g.exp) : '', g.inc ? '收入 ' + fmt(g.inc) : ''].filter(Boolean).join(' / ');
      return '<div class="day-group"><div class="day-head"><b>' + WC.dayLabel(g.date) + '</b><span>' + sub + '</span></div>' +
        '<div class="day-card">' + rows + '</div></div>';
    }).join('');
  }

  /* ---------- 编辑器 ---------- */
  function renderEditorCats() {
    $('editCats').innerHTML = WC.list(state.etype).map(c =>
      '<button type="button" class="cat-item' + (c.id === state.ecat ? ' active' : '') + '" data-cat="' + c.id + '">' +
      '<span>' + c.icon + '</span>' + esc(c.name) + '</button>').join('');
  }
  function renderAccountOptions() {
    const opts = WC.accounts().map(a => '<option value="' + a.id + '">' + a.icon + ' ' + esc(a.name) + '</option>').join('');
    $('editAccount').innerHTML = opts;
    $('editFrom').innerHTML = opts;
    $('editTo').innerHTML = opts;
    const def = settings.defaultAccount();
    $('editAccount').value = def;
    $('editFrom').value = def;
    const arr = WC.accounts();
    $('editTo').value = (arr.find(a => a.id !== def) || arr[0]).id;
  }
  function setEditorType(type) {
    state.etype = type;
    document.querySelectorAll('#editorTypeSeg button').forEach(b => b.classList.toggle('active', b.dataset.etype === type));
    const isTr = type === 'transfer';
    $('catSection').classList.toggle('hidden', isTr);
    $('accountSection').classList.toggle('hidden', isTr);
    $('transferSection').classList.toggle('hidden', !isTr);
    if (!isTr) {
      if (!WC.list(type).some(c => c.id === state.ecat)) state.ecat = WC.list(type)[0].id;
      renderEditorCats();
    }
  }
  function setAmount(str) {
    let s = String(str).replace(/[^\d.]/g, '');
    const dot = s.indexOf('.');
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    if (s.indexOf('.') >= 0) {
      const [i, d] = s.split('.');
      s = i.slice(0, 8) + '.' + (d || '').slice(0, 2);
    } else {
      s = s.slice(0, 8);
    }
    state.amountStr = s;
    $('editAmount').value = s;
  }
  function keypad(key) {
    if (key === 'del') { setAmount(state.amountStr.slice(0, -1)); return; }
    if (key === '.' && (state.amountStr.indexOf('.') >= 0 || !state.amountStr)) { if (!state.amountStr) setAmount('0.'); return; }
    setAmount(state.amountStr + key);
  }
  function openEditor(rec) {
    state.editingId = rec ? rec.id : null;
    $('editorTitle').textContent = rec ? '编辑记录' : '记一笔';
    $('btnDeleteRec').classList.toggle('hidden', !rec);
    renderAccountOptions();
    const type = rec ? rec.type : 'expense';
    state.ecat = rec && rec.categoryId && WC.list(type).some(c => c.id === rec.categoryId) ? rec.categoryId : WC.list(type)[0].id;
    setEditorType(type);
    setAmount(rec ? String(rec.amount) : '');
    if (rec && rec.type === 'transfer') {
      $('editFrom').value = rec.accountId || WC.accounts()[0].id;
      $('editTo').value = rec.toAccountId || WC.accounts()[1].id;
    } else if (rec) {
      $('editAccount').value = rec.accountId || settings.defaultAccount();
    }
    $('editDate').value = rec ? rec.date : (WC.monthOf(WC.today()) === state.month ? WC.today() : state.month + '-01');
    $('editNote').value = rec ? (rec.note || '') : '';
    $('editorDialog').showModal();
  }
  function saveEditor(e) {
    e.preventDefault();
    const amount = Math.round(Number(state.amountStr) * 100) / 100;
    const date = $('editDate').value;
    if (!amount || amount <= 0) { toast('请输入正确的金额'); return; }
    if (!date) { toast('请选择日期'); return; }
    let patch;
    if (state.etype === 'transfer') {
      const from = $('editFrom').value, to = $('editTo').value;
      if (from === to) { toast('转出和转入不能是同一个账户'); return; }
      patch = {
        type: 'transfer', amount, date, accountId: from, toAccountId: to, categoryId: 'other',
        note: $('editNote').value.trim() || (WC.accountById(from).name + ' → ' + WC.accountById(to).name)
      };
    } else {
      patch = {
        type: state.etype, amount, categoryId: state.ecat, date,
        accountId: $('editAccount').value || settings.defaultAccount(),
        note: $('editNote').value.trim() || WC.byId(state.etype, state.ecat).name
      };
    }
    if (state.editingId) {
      store.update(state.editingId, patch);
      toast('已保存');
    } else {
      store.add(patch);
      toast(state.etype === 'transfer' ? '已记录转账 ¥' + fmt(amount) : '已记账 ¥' + fmt(amount));
    }
    $('editorDialog').close();
    state.month = WC.monthOf(date);
    state.period = 'month';
    renderHome();
    if (state.view === 'stats') renderStats();
  }

  /* ---------- 统计 ---------- */
  function sumBy(list, type) { return list.filter(r => r.type === type).reduce((s, r) => s + r.amount, 0); }

  function renderStats() {
    renderMonth();
    $('stMonthLabel').textContent = state.period === 'year' ? state.year + ' 年' : WC.monthLabel(state.month);
    const recs = periodRecords();
    const exp = sumBy(recs, 'expense');
    const inc = sumBy(recs, 'income');
    $('stExpense').textContent = fmt(exp);
    $('stIncome').textContent = fmt(inc);

    // 环比
    let prevExp = 0, prevInc = 0, prevLabel = '';
    if (state.period === 'month') {
      const pm = WC.shiftMonth(state.month, -1);
      const pr = store.all().filter(r => WC.monthOf(r.date) === pm);
      prevExp = sumBy(pr, 'expense'); prevInc = sumBy(pr, 'income');
      prevLabel = '较上月';
    } else {
      const py = String(Number(state.year) - 1);
      const pr = store.all().filter(r => r.date.slice(0, 4) === py);
      prevExp = sumBy(pr, 'expense'); prevInc = sumBy(pr, 'income');
      prevLabel = '较去年';
    }
    const delta = (now, prev) => {
      if (!prev) return now ? prevLabel + ' —' : '';
      const d = (now - prev) / prev * 100;
      return prevLabel + ' ' + (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    };
    const dExp = $('stExpenseDelta'), dInc = $('stIncomeDelta');
    dExp.textContent = delta(exp, prevExp);
    dInc.textContent = delta(inc, prevInc);
    dExp.className = 'delta ' + (exp > prevExp ? 'up' : 'down');
    dInc.className = 'delta ' + (inc >= prevInc ? 'down' : 'up');

    const dim = state.period === 'month' ? WC.daysInMonth(state.month) : (isLeap(state.year) ? 366 : 365);
    const passed = state.period === 'month'
      ? (state.month === WC.thisMonth() ? new Date().getDate() : dim)
      : (state.year === String(new Date().getFullYear()) ? dayOfYear() : dim);
    $('stAvg').textContent = fmt(exp / Math.max(1, passed));
    $('stCount').textContent = recs.length;

    // 分类构成
    const typed = recs.filter(r => r.type === state.statsType);
    const total = typed.reduce((s, r) => s + r.amount, 0);
    const byCat = {};
    typed.forEach(r => { byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount; });
    const data = Object.keys(byCat).map(id => {
      const c = WC.byId(state.statsType, id);
      return { id, name: c.name, icon: c.icon, color: c.color, value: byCat[id] };
    }).sort((a, b) => b.value - a.value);

    $('statsEmpty').classList.toggle('hidden', data.length > 0);
    $('donutChart').style.visibility = data.length ? 'visible' : 'hidden';
    WC.charts.donut($('donutChart'), data, state.statsType === 'expense' ? '总支出' : '总收入', '¥' + fmt(total));
    $('donutLegend').innerHTML = data.map(d =>
      '<div class="legend-item"><i class="dot" style="background:' + d.color + '"></i>' +
      '<span class="lg-name">' + d.icon + ' ' + esc(d.name) + '</span>' +
      '<span class="lg-pct">' + (total ? (d.value / total * 100).toFixed(1) : 0) + '%</span>' +
      '<span class="lg-amt">' + fmt(d.value) + '</span></div>').join('');

    const max = data.length ? data[0].value : 1;
    $('rankList').innerHTML = data.length ? data.map(d =>
      '<div class="rank-row"><span class="rk-icon">' + d.icon + '</span><span class="rk-name">' + esc(d.name) + '</span>' +
      '<div class="rk-bar"><i style="width:' + (d.value / max * 100) + '%;background:' + d.color + '"></i></div>' +
      '<span class="rk-amt">' + fmt(d.value) + '</span></div>').join('') : '<div class="empty small">暂无数据</div>';

    // 趋势：月度看近 6 月，年度看 12 个月
    const labels = [], ev = [], iv = [];
    if (state.period === 'month') {
      for (let i = 5; i >= 0; i--) {
        const m = WC.shiftMonth(state.month, -i);
        labels.push(Number(m.slice(5)) + '月');
        const rs = store.all().filter(r => WC.monthOf(r.date) === m);
        ev.push(sumBy(rs, 'expense')); iv.push(sumBy(rs, 'income'));
      }
      $('trendTitle').textContent = '近 6 个月收支';
    } else {
      for (let m = 1; m <= 12; m++) {
        const mm = state.year + '-' + WC.p2(m);
        labels.push(m + '月');
        const rs = store.all().filter(r => WC.monthOf(r.date) === mm);
        ev.push(sumBy(rs, 'expense')); iv.push(sumBy(rs, 'income'));
      }
      $('trendTitle').textContent = state.year + ' 年各月收支';
    }
    WC.charts.bars($('trendChart'), labels, [
      { name: '支出', color: '#e0584a', values: ev },
      { name: '收入', color: '#07c160', values: iv }
    ]);

    // 热力图 / 每日折线：仅月度
    const monthly = state.period === 'month';
    $('heatPanel').classList.toggle('hidden', !monthly);
    $('dailyPanel').classList.toggle('hidden', !monthly);
    if (monthly) {
      const dim2 = WC.daysInMonth(state.month);
      const perDay = Array(dim2).fill(0);
      recs.filter(r => r.type === 'expense').forEach(r => {
        const d = Number(r.date.slice(8));
        if (d >= 1 && d <= dim2) perDay[d - 1] += r.amount;
      });
      const [yy, mm] = state.month.split('-').map(Number);
      state._heatPerDay = perDay;
      renderHeatGrid(perDay, yy, mm);
      renderDayDetail();
      WC.charts.line($('dailyChart'), Array.from({ length: dim2 }, (_, i) => (i + 1) + '日'), perDay, '#07c160');
      $('dailyTitle').textContent = WC.monthLabel(state.month) + ' 每日支出';
    } else {
      state.statDay = null;
    }

    // 分类趋势 Top 4
    const top4 = data.slice(0, 4);
    const trendLabels = [];
    const monthsBack = [];
    for (let i = 5; i >= 0; i--) {
      const m = WC.shiftMonth(state.month, -i);
      monthsBack.push(m);
      trendLabels.push(Number(m.slice(5)) + '月');
    }
    const series = top4.map(d => ({
      name: d.name, color: d.color,
      values: monthsBack.map(m => typed.filter(r => WC.monthOf(r.date) === m && r.categoryId === d.id)
        .reduce((s, r) => s + r.amount, 0))
    }));
    if (series.length) WC.charts.multiLine($('catTrend'), trendLabels, series);

    // 其余三个标签页
    renderTrendTab(recs);
    renderPartyTab(recs);
    renderAmountTab(recs);
    renderPivot(recs);
  }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dayOfYear() {
    const now = new Date();
    return Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  }

  /* ---------- 导入 ---------- */
  // 商家名 / 支付渠道：优先用 classify 里的规则；旧缓存里没有该函数时退化为原始字段，避免白屏
  function merchantOf(r) {
    try {
      if (WC.classify && WC.classify.merchantOf) return WC.classify.merchantOf(r);
    } catch (e) { /* 忽略 */ }
    return (r && (r.party || r.note)) || '';
  }

  // 来源标签：让用户一眼看出这条是从哪份账单来的
  function srcTag(r) {
    if (!r) return '';
    if (r.source === 'wechat') return '微信导入';
    if (r.source === 'alipay') return '支付宝导入';
    if (r.source === 'statement') return '银行流水';
    if (r.source === 'recurring') return '周期';
    return '';
  }

  function channelOf(r) {
    try {
      if (WC.classify && WC.classify.channelOf) return WC.classify.channelOf(r);
    } catch (e) { /* 忽略 */ }
    return '';
  }

  // 同一笔交易的完整判定键（用于「完全相同的记录」去重）
  // 刻意不含 extId —— 微信账单用交易单号，PDF 用「日期|金额|对方|序号」，两者天生不同。
  function recKey(r) {
    return [r.date, r.type, Number(r.amount).toFixed(2), String(r.party || ''), String(r.note || '')].join('|');
  }

  // 跨源匹配用的粗键：同日期 + 同方向 + 同金额
  function crossKey(r) {
    return [r.date, r.type, Number(r.amount).toFixed(2)].join('|');
  }

  // 信息量打分：合并同一笔时保留信息更全的那条（微信账单通常比银行流水更全）
  function infoScore(r) {
    let s = 0;
    const m = merchantOf(r);
    if (m && m !== '未标注商家') s += 2;
    if (r.party) s += 1;
    if (r.note && r.note !== m) s += 1;
    if (r.payType) s += 1;      // 微信账单带支付方式，能看出走的哪张卡
    if (r.tradeType) s += 1;
    if (r.extId) s += 1;
    return s;
  }

  // 支付方式/文件名里能识别出的银行。只有同一家银行才可能是同一笔钱
  const BANK_WORDS = ['招商银行', '邮储银行', '中国邮政储蓄银行', '工商银行', '建设银行', '农业银行',
    '交通银行', '浦发银行', '中信银行', '民生银行', '兴业银行', '光大银行', '平安银行', '广发银行', '华夏银行'];
  function bankOf(r) {
    const t = String((r && r.payType) || '') + ' ' + String((r && r._src) || '');
    for (let i = 0; i < BANK_WORDS.length; i++) {
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

  const isBankCardPay = r => /银行|储蓄卡|信用卡/.test(String(r.payType || ''));

  /* 两条来自不同文件的记录，是否大概是同一笔？
   * 微信绑卡消费会同时出现在「微信账单」和「银行流水」里：日期、金额、方向都一样，
   * 但描述不同（微信显示商户昵称，银行显示收款人实名或渠道名）。
   * 判据：商户名一致 → 一方只有渠道信息 → 一方明确是银行卡扣款。
   * 两个不同的真实商户名且无法佐证时，宁可保留两条，也不误删。
   * （实测：真实账单里 103 笔重叠全部由前两条命中，"当天该金额唯一"这条兜底用不上，反而容易误杀，故不采用）
   */
  function canPair(a, b) {
    const ma = merchantOf(a);
    const mb = merchantOf(b);
    const unknown = m => !m || m === '未标注商家';
    if (ma && mb && ma === mb) return true;              // 商户名一致
    if (unknown(ma) || unknown(mb)) return true;          // 一方只有渠道信息
    // 「支付方式写明是银行卡」只在「渠道账单 ↔ 银行流水」之间才算数：
    // 微信↔支付宝之间不互相配对（同一笔钱不会在两个 App 里各记一次），
    // 否则「微信走招行卡 13 元」会把「支付宝走花呗的 13 元」吞掉。
    const pa = !!a.payType;
    const pb = !!b.payType;
    if (pa !== pb) {
      const card = pa ? a : b;
      if (isBankCardPay(card)) {
        // 只认同一家银行：支付宝走「邮储信用卡」的记录不能配到招行流水上
        const ba = bankOf(a);
        const bb = bankOf(b);
        if (!ba || !bb || ba === bb) return true;
      }
    }
    return false;
  }

  /* 「以银行账单为准」：同一笔交易同时出现在银行流水和渠道账单时，
   * 金额 / 日期 / 方向用银行流水的（资金实际发生），商户名和分类用渠道账单的（信息更全）。
   * 两边都不是银行流水时，保留信息更全的那条。
   */
  function fillFromChannel(bankRec, chanRec) {
    const out = Object.assign({}, bankRec);
    if (chanRec.party) out.party = chanRec.party;
    if (chanRec.note && merchantOf(chanRec) !== '未标注商家') out.note = chanRec.note;
    if (chanRec.categoryId) out.categoryId = chanRec.categoryId;
    if (chanRec.payType) out.payType = chanRec.payType;
    if (chanRec.tradeType) out.tradeType = chanRec.tradeType;
    out._chan = chanRec._src || '';
    return out;
  }

  function preferBank(a, b) {
    const aBank = a.source === 'statement';
    const bBank = b.source === 'statement';
    if (aBank && !bBank) return fillFromChannel(a, b);
    if (bBank && !aBank) return fillFromChannel(b, a);
    return infoScore(b) > infoScore(a) ? b : a;
  }

  /* 合并两份记录（同一文件内的记录一律保留，只在「不同来源」之间配对）：
   * ① 同日期 + 同金额 + 同方向 + 同商户 + 同备注 → 同一笔（重复导入）
   * ② 同日期 + 同金额 + 同方向 + canPair 判定成立 → 同一笔（微信绑卡消费在两份账单里都有一份）
   * ③ 其余全部保留
   * 注意：「跨来源配对」只在本次导入里含银行流水时才做。
   * 只有微信 / 只有支付宝（或两者一起但没有流水）时，各自看成一本书，互不干扰。
   */
  function hasBankSource(records) {
    return (records || []).some(r => r && r.source === 'statement');
  }

  function mergeRecords(base, add) {
    // 没有银行流水 → 一份都不配对（微信/支付宝各按自己的记录算，互不吞并）。
    // 真正重复导入同一份账单，保存时还会按 extId 再过一遍。
    const allowCross = hasBankSource(base.concat(add));
    if (!allowCross) return { records: base.concat(add), duplicated: 0, crossMerged: 0, bank: false };

    const groups = {};
    const order = [];
    base.concat(add).forEach(r => {
      const k = crossKey(r);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });

    const out = [];
    let duplicated = 0;
    let crossMerged = 0;

    order.forEach(k => {
      const items = groups[k];

      // 按来源分桶
      const bySrc = {};
      const srcs = [];
      items.forEach(r => {
        const src = r._src || '';
        if (!bySrc[src]) { bySrc[src] = []; srcs.push(src); }
        bySrc[src].push(r);
      });
      // 只有一份来源：原样保留（同一文件里同额同店的多笔就是多笔）
      if (srcs.length === 1) { out.push.apply(out, items); return; }

      // 以记录最多的来源为基准，其余来源逐条往上配
      srcs.sort((a, b) => bySrc[b].length - bySrc[a].length);
      let kept = bySrc[srcs[0]].slice();
      for (let i = 1; i < srcs.length; i++) {
        const other = bySrc[srcs[i]].slice();
        const used = {};
        const rest = [];
        other.forEach(o => {
          let j = kept.findIndex((r, ri) => !used[ri] && recKey(r) === recKey(o));
          let kind = 'dup';
          if (j < 0 && allowCross) {
            j = kept.findIndex((r, ri) => !used[ri] && canPair(r, o));
            kind = 'cross';
          }
          if (j < 0) { rest.push(o); return; }
          used[j] = true;
          if (kind === 'dup') duplicated++; else crossMerged++;
          kept[j] = preferBank(kept[j], o);
        });
        kept = kept.concat(rest);
      }
      out.push.apply(out, kept);
    });

    return { records: out, duplicated: duplicated, crossMerged: crossMerged, bank: allowCross };
  }

  function blankPending() {
    return { records: [], refunds: [], stats: {}, files: [] };
  }

  /* 导入口径（本次导入最终怎么算）：
   * 含银行流水 → 以银行为准：退款不冲减，退到卡的钱由流水那条「收入」体现；
   * 只有微信 / 只有支付宝（或两者一起但没流水）→ 按账单它自己的来：退款冲减原支出。
   * 每次都从 records 复制一份重新算，反复合并也不会重复冲减。
   */
  function finalizePending(pending) {
    const raw = (pending && pending.records) || [];
    const refunds = (pending && pending.refunds) || [];
    const bank = hasBankSource(raw);
    const work = raw.map((r, i) => Object.assign({}, r, { _ri: i }));

    const rf = { matched: 0, amount: 0, unmatched: 0, total: refunds.length };
    if (!bank && refunds.length && WC.applyRefunds) Object.assign(rf, WC.applyRefunds(work, refunds));

    const records = [];
    work.forEach(r => {
      delete r._order;
      delete r._trade;
      // 冲减到 0 的支出：这笔钱确实回来了，不再计入
      if (r.type === 'expense' && r.amount <= 0.001) return;
      records.push(r);
    });
    return { records: records, refund: rf, bank: bank };
  }

  // 把一份解析结果并进待导入列表；勾了「合并」就累加，否则替换
  function ingest(res, name) {
    if (res.error) { toast(res.error); return false; }
    if (!res.records.length) { toast('没有可导入的记录（可能全部是不计收支或退款）'); return false; }
    res.records.forEach(r => { r.accountId = settings.defaultAccount(); r._src = name || ''; });

    const merging = $('optMerge').checked && state.pending && state.pending.records.length;
    const base = merging ? state.pending : blankPending();
    const m = mergeRecords(base.records || [], res.records);
    base.records = m.records;
    base.refunds = (base.refunds || []).concat(res.refunds || []);
    base.files = base.files || [];
    base.files.push({ name: name || '粘贴的文本', count: res.records.length, dup: m.duplicated });
    base.stats = base.stats || {};
    ['total', 'usable', 'merged', 'inherited', 'skippedFlow', 'skippedBad', 'skippedRefund', 'refundCount', 'refundAmount', 'refundMatched', 'skippedClosed'].forEach(k => {
      base.stats[k] = (base.stats[k] || 0) + (res.stats[k] || 0);
    });
    base.stats.crossMerged = (base.stats.crossMerged || 0) + (m.crossMerged || 0);
    base.final = finalizePending(base);
    state.pending = base;
    showImportResult(base);
    return true;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      toast('正在解析 ' + f.name + '…');
      try {
        ingest(await WC.parseFile(f), f.name);
      } catch (err) {
        console.error(err);
        toast(f.name + ' 解析失败：' + err.message);
      }
    }
  }

  function showImportResult(pending) {
    const s = pending.stats || {};
    const files = pending.files || [];
    const fin = pending.final || finalizePending(pending);
    const rf = fin.refund || {};
    $('importResult').classList.remove('hidden');
    $('importStats').innerHTML =
      '<span class="chip">共解析 <b>' + (s.total || 0) + '</b> 行</span>' +
      '<span class="chip">可导入 <b>' + fin.records.length + '</b> 笔</span>' +
      (s.crossMerged ? '<span class="chip">与银行流水合并 ' + s.crossMerged + ' 笔（金额以银行为准）</span>' : '') +
      (files.length > 1 && !fin.bank ? '<span class="chip">未含银行流水，各账单按原值保留</span>' : '') +
      (rf.total ? '<span class="chip">退款 ' + rf.total + ' 笔' +
        (fin.bank
          ? '（退到卡的由流水体现）'
          : (rf.amount
            ? '（已冲减 ¥' + fmt(rf.amount) + (rf.unmatched ? '，另 ' + rf.unmatched + ' 笔原单未成交或不在本期' : '') + '）'
            : '（原单未成交，本就没记账）')) + '</span>' : '') +
      (s.skippedClosed ? '<span class="chip">未成交 ' + s.skippedClosed + '</span>' : '') +
      (s.merged ? '<span class="chip">续行已合并 ' + s.merged + '</span>' : '') +
      (s.skippedFlow ? '<span class="chip">不计收支 ' + s.skippedFlow + '</span>' : '') +
      (s.skippedRefund ? '<span class="chip">已退款 ' + s.skippedRefund + '</span>' : '') +
      (s.skippedBad ? '<span class="chip">异常 ' + s.skippedBad + '</span>' : '');

    if (files.length > 1) {
      $('mergeFiles').innerHTML = '<span class="mf-title">已合并 ' + files.length + ' 份：</span>' +
        files.map(f => '<span class="mf-chip">' + esc(f.name) + ' · ' + f.count + ' 笔' + (f.dup ? '（去重 ' + f.dup + '）' : '') + '</span>').join('');
    } else if (files.length === 1) {
      $('mergeFiles').innerHTML = '<span class="mf-title">当前账单：</span><span class="mf-chip">' + esc(files[0].name) + ' · ' + files[0].count + ' 笔</span>';
    } else {
      $('mergeFiles').innerHTML = '';
    }

    renderPreview();
    $('importResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPreview() {
    const fin = state.pending.final || finalizePending(state.pending);
    const recs = fin.records;
    const shown = recs.slice(0, 200);
    $('previewBody').innerHTML = shown.map((r, i) => {
      const opts = WC.list(r.type).map(c => '<option value="' + c.id + '"' + (c.id === r.categoryId ? ' selected' : '') + '>' + c.icon + ' ' + esc(c.name) + '</option>').join('');
      return '<tr><td class="c-date">' + r.date + '</td><td class="c-type ' + r.type + '">' + (r.type === 'expense' ? '支出' : '收入') + '</td>' +
        '<td class="c-cat"><select data-idx="' + i + '">' + opts + '</select></td>' +
        '<td class="c-note" title="' + esc(r.note) + '">' + esc(merchantOf(r)) +
        (channelOf(r) ? ' <span class="p-chan">' + esc(channelOf(r)) + '</span>' : '') + '</td>' +
        '<td class="amt c-amt">' + fmt(r.amount) + '</td></tr>';
    }).join('');
    const n = recs.length;
    const f = (state.pending.files || []).length;
    const base = f > 1 ? '当前是 ' + f + ' 份账单合并后的结果，共 ' + n + ' 笔。' : '';
    const basis = fin.bank
      ? '本批含银行流水：同一笔金额以银行流水为准，商户名取微信/支付宝账单。'
      : (fin.refund && fin.refund.amount ? '本批没有银行流水：按账单自己的口径，退款已从原支出里冲减 ¥' + fmt(fin.refund.amount) + '。' : '');
    $('previewTip').textContent = base + basis +
      (n > 200 ? '预览前 200 笔（分类可改），确认后会导入全部 ' + n + ' 笔。' : '分类可在导入前修改。') +
      '导入的记录默认记在「' + WC.accountById(settings.defaultAccount()).name + '」账户，与已有账单重复的会自动跳过。';
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    $('budgetHint').textContent = '正在设置 ' + WC.monthLabel(state.month) + ' 的支出预算，账单页会显示使用进度；填 0 表示不限。如需改其他月份，先在账单页切换月份。';
    $('budgetInput').value = settings.budget(state.month) || '';
    $('storageInfo').textContent = '当前共 ' + store.count() + ' 条记录 · 存储于浏览器 localStorage';
    renderAccounts();
    renderCatEditor();
  }

  function renderAccounts() {
    const bal = WC.balances();
    const def = settings.defaultAccount();
    $('accountList').innerHTML = WC.accounts().map(a => {
      const v = bal[a.id] || 0;
      return '<div class="account-row" data-acc="' + a.id + '">' +
        '<input class="input cat-icon-input" style="width:42px;text-align:center;padding:6px 2px" value="' + esc(a.icon) + '" maxlength="2" data-acc-icon="' + a.id + '">' +
        '<input class="input acc-name" style="flex:1;padding:6px 10px;min-width:60px" value="' + esc(a.name) + '" maxlength="8" data-acc-name="' + a.id + '">' +
        '<span class="acc-balance ' + (v < 0 ? 'neg' : '') + '">' + (v < 0 ? '-' : '') + '¥' + fmt(Math.abs(v)) + '</span>' +
        (a.id === def ? '<span class="transfer-tag">默认</span>' : '') +
        '<button class="mini-btn" data-acc-del="' + a.id + '" title="删除账户">✕</button></div>';
    }).join('');
    $('defaultAccountSel').innerHTML = WC.accounts().map(a =>
      '<option value="' + a.id + '"' + (a.id === def ? ' selected' : '') + '>' + a.icon + ' ' + esc(a.name) + '</option>').join('');
  }

  function renderCatEditor() {
    const arr = WC.list(state.catType);
    $('catEditList').innerHTML = arr.map((c, i) =>
      '<div class="cat-edit-row" data-cid="' + c.id + '">' +
      '<i class="cat-swatch" style="background:' + c.color + '"></i>' +
      '<input class="cat-icon-input" value="' + esc(c.icon) + '" maxlength="2" data-cat-icon="' + c.id + '">' +
      '<input class="cat-name-input" value="' + esc(c.name) + '" maxlength="6" data-cat-name="' + c.id + '">' +
      '<button class="mini-btn" data-cat-up="' + c.id + '" title="上移" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
      '<button class="mini-btn" data-cat-down="' + c.id + '" title="下移" ' + (i === arr.length - 1 ? 'disabled' : '') + '>↓</button>' +
      '<button class="mini-btn del" data-cat-del="' + c.id + '" title="删除">✕</button></div>').join('');
  }

  function saveCatArr(arr) {
    settings.saveCats(state.catType, arr);
    renderCatEditor();
    refreshCatFilter();
    toast('分类已更新');
  }

  function refreshCatFilter() {
    const cur = state.fcat;
    const cats = WC.list('expense').concat(WC.list('income').filter(c => c.id !== 'other_in'));
    const opts = '<option value="all">全部分类</option>' +
      cats.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + '</option>').join('');
    $('filterCat').innerHTML = opts;
    $('filterCat').value = cats.some(c => c.id === cur) ? cur : 'all';
    state.fcat = $('filterCat').value;
    $('dCat').innerHTML = opts.replace('全部分类', '全部');
    if (!cats.some(c => c.id === state.detail.cat)) state.detail.cat = 'all';
    $('dCat').value = state.detail.cat;
  }

  function exportCsv() {
    const recs = store.all();
    if (!recs.length) { toast('暂无记录可导出'); return; }
    const head = ['日期', '收支', '分类', '金额', '账户', '转入账户', '备注', '交易对方', '交易单号', '来源'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = recs.map(r => [
      r.date,
      r.type === 'expense' ? '支出' : r.type === 'income' ? '收入' : '转账',
      r.type === 'transfer' ? '转账' : WC.byId(r.type, r.categoryId).name,
      r.amount.toFixed(2),
      WC.accountById(r.accountId).name,
      r.toAccountId ? WC.accountById(r.toAccountId).name : '',
      r.note, r.party || '', r.extId || '', r.source || '手动'
    ].map(q).join(','));
    download('记账本_' + WC.today() + '.csv', '﻿' + head.map(q).join(',') + '\n' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast('已导出 ' + recs.length + ' 条记录');
  }

  /* ---------- 统计页：可点日历热力 + 当日明细 ---------- */
  function renderHeatGrid(perDay, yy, mm) {
    const dim = perDay.length;
    const offset = new Date(yy, mm - 1, 1).getDay();
    const max = Math.max(1, ...perDay);
    const today = WC.today();
    let html = ['日', '一', '二', '三', '四', '五', '六'].map(w => '<div class="hg-wd">' + w + '</div>').join('');
    for (let i = 0; i < offset; i++) html += '<div class="hg-cell empty"></div>';
    for (let d = 1; d <= dim; d++) {
      const v = perDay[d - 1] || 0;
      const ratio = v / max;
      const date = state.month + '-' + WC.p2(d);
      const cls = 'hg-cell' + (state.statDay === d ? ' selected' : '') + (date === today ? ' today' : '');
      const bg = v > 0 ? 'background:rgba(7,193,96,' + (0.12 + ratio * 0.88).toFixed(2) + ');' : '';
      const fg = v > 0 && ratio > 0.45 ? 'color:#fff;' : '';
      html += '<button type="button" class="' + cls + '" style="' + bg + fg + '" data-day="' + d + '">' +
        '<i>' + d + '</i>' + (v > 0 ? '<b>' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)) + '</b>' : '') + '</button>';
    }
    $('heatGrid').innerHTML = html;
  }

  function renderDayDetail() {
    const el = $('dayDetail');
    if (!state.statDay) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const date = state.month + '-' + WC.p2(state.statDay);
    const list = store.all().filter(r => r.date === date)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const exp = list.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const inc = list.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const head = '<div class="dd-head">' + WC.dayLabel(date) + ' · ' + list.length + ' 笔' +
      (exp ? ' · 支出 ' + fmt(exp) : '') + (inc ? ' · 收入 ' + fmt(inc) : '') + '</div>';
    const rows = list.length ? list.map(r => {
      const isTr = r.type === 'transfer';
      const c = WC.byId(r.type, r.categoryId);
      const acc = WC.accountById(r.accountId);
      const accTo = isTr ? WC.accountById(r.toAccountId) : null;
      const icon = isTr ? '🔁' : c.icon;
      const merchant = isTr ? '' : merchantOf(r);
      const title = isTr ? (acc.name + ' → ' + accTo.name) : (merchant || r.note || c.name);
      const sub = isTr
        ? [r.note, '账户转账'].filter(Boolean).join(' · ')
        : [c.name, channelOf(r), acc.name, srcTag(r)].filter(Boolean).join(' · ');
      const amount = isTr ? fmt(r.amount) : (r.type === 'expense' ? '-' : '+') + fmt(r.amount);
      return '<div class="dd-row ' + r.type + '" data-edit="' + r.id + '">' +
        '<div class="rec-icon">' + icon + '</div>' +
        '<div class="rec-main"><div class="rec-note">' + esc(title) + '</div>' +
        '<div class="rec-sub">' + esc(sub) + '</div></div>' +
        '<div class="rec-amount ' + r.type + '">' + amount + '</div></div>';
    }).join('') : '<div class="empty small">当天没有记录</div>';
    el.innerHTML = head + rows;
    el.classList.remove('hidden');
  }

  /* ---------- 趋势标签 ---------- */
  function renderTrendTab(recs) {
    // 余额走势（按发生顺序累加，转账内部抵消）
    const asc = recs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const netByDay = {};
    asc.forEach(r => {
      const net = r.type === 'income' ? r.amount : r.type === 'expense' ? -r.amount : 0;
      netByDay[r.date] = (netByDay[r.date] || 0) + net;
    });
    const days = Object.keys(netByDay).sort();
    let acc = 0;
    const balance = days.map(d => (acc += netByDay[d]));
    if (days.length) {
      WC.charts.balanceLine($('balanceChart'), days.map(d => d.slice(5)), balance, '#07c160');
    } else {
      WC.charts.balanceLine($('balanceChart'), ['—'], [0], '#07c160');
    }

    // 星期分布
    const week = [0, 0, 0, 0, 0, 0, 0];
    const weekCnt = [0, 0, 0, 0, 0, 0, 0];
    recs.filter(r => r.type === 'expense').forEach(r => {
      const [y, m, d] = r.date.split('-').map(Number);
      const w = new Date(y, m - 1, d).getDay();
      week[w] += r.amount;
      weekCnt[w]++;
    });
    WC.charts.bars($('weekChart'), ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      [{ name: '支出金额', color: '#e0584a', values: week }]);

    // 每日净现金流 + 7 期均线
    let labels = [], net = [];
    if (state.period === 'month') {
      const dim = WC.daysInMonth(state.month);
      const arr = Array(dim).fill(0);
      recs.forEach(r => {
        const d = Number(r.date.slice(8));
        if (d >= 1 && d <= dim) arr[d - 1] += (r.type === 'income' ? r.amount : r.type === 'expense' ? -r.amount : 0);
      });
      labels = Array.from({ length: dim }, (_, i) => (i + 1) + '日');
      net = arr;
    } else {
      for (let m = 1; m <= 12; m++) {
        const mm = state.year + '-' + WC.p2(m);
        const rs = store.all().filter(r => WC.monthOf(r.date) === mm);
        labels.push(m + '月');
        net.push(rs.reduce((s, r) => s + (r.type === 'income' ? r.amount : r.type === 'expense' ? -r.amount : 0), 0));
      }
    }
    const ma = net.map((_, i) => {
      const from = Math.max(0, i - 6);
      const win = net.slice(from, i + 1);
      return win.reduce((s, v) => s + v, 0) / win.length;
    });
    WC.charts.multiLine($('cashChart'), labels, [
      { name: '净现金流', color: '#4a90e2', values: net },
      { name: '7 期均线', color: '#f2b134', values: ma }
    ]);

    // 月度明细表
    const rows = [];
    const months = state.period === 'month'
      ? [WC.shiftMonth(state.month, 0)]
      : Array.from({ length: 12 }, (_, i) => state.year + '-' + WC.p2(i + 1));
    months.forEach(m => {
      const rs = store.all().filter(r => WC.monthOf(r.date) === m);
      const e = sumBy(rs, 'expense'), i2 = sumBy(rs, 'income');
      rows.push('<tr><td>' + WC.monthLabel(m) + '</td><td class="amt">' + fmt(e) + '</td><td class="amt">' + fmt(i2) + '</td>' +
        '<td class="amt ' + (i2 - e < 0 ? 'expense' : 'income') + '">' + fmt(i2 - e) + '</td><td class="amt">' + rs.length + '</td></tr>');
    });
    const totE = sumBy(recs, 'expense'), totI = sumBy(recs, 'income');
    rows.push('<tr class="total"><td>合计</td><td class="amt">' + fmt(totE) + '</td><td class="amt">' + fmt(totI) + '</td>' +
      '<td class="amt">' + fmt(totI - totE) + '</td><td class="amt">' + recs.length + '</td></tr>');
    $('monthTableWrap').innerHTML = '<table class="pivot-table"><thead><tr><th>月份</th><th>支出</th><th>收入</th><th>结余</th><th>笔数</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
  }

  /* ---------- 交易对手标签 ---------- */
  function partyKeyOf(r) {
    // 用「商家」而不是原始交易对方：后者常是「支付宝（中国）网络技术有限公司」这类渠道名
    return String(merchantOf(r) || '未命名').trim().slice(0, 24);
  }
  function partyAgg(recs) {
    const map = {};
    recs.filter(r => r.type !== 'transfer').forEach(r => {
      const k = partyKeyOf(r);
      const o = map[k] || (map[k] = { key: k, expense: 0, income: 0, count: 0 });
      o[r.type] = (o[r.type] || 0) + r.amount;
      o.count++;
    });
    return Object.values(map);
  }
  // 某个商家主要走哪个渠道（微信 / 支付宝 / 银联），用于在统计里并列显示
  function channelFor(recs, key) {
    const cnt = {};
    recs.forEach(r => {
      if (r.type === 'transfer' || partyKeyOf(r) !== key) return;
      const ch = channelOf(r);
      if (ch) cnt[ch] = (cnt[ch] || 0) + 1;
    });
    const keys = Object.keys(cnt);
    if (!keys.length) return '';
    keys.sort((a, b) => cnt[b] - cnt[a]);
    return keys[0];
  }

  function renderPartyTab(recs) {
    const list = partyAgg(recs).filter(p => (p[state.partyType] || 0) > 0)
      .sort((a, b) => (b[state.partyType] || 0) - (a[state.partyType] || 0)).slice(0, 15);
    if (!list.length) {
      $('partyList').innerHTML = '<div class="empty small">暂无数据</div>';
      $('partyRecords').innerHTML = '';
      $('partyDetailTitle').textContent = '对手往来';
      return;
    }
    if (!state.partyKey || !list.some(p => p.key === state.partyKey)) state.partyKey = list[0].key;
    const max = list[0][state.partyType] || 1;
    $('partyList').innerHTML = list.map((p, i) =>
      '<div class="party-row' + (p.key === state.partyKey ? ' active' : '') + '" data-party="' + esc(p.key) + '">' +
      '<span class="p-rank">' + (i + 1) + '</span>' +
      '<span class="p-name">' + esc(p.key) + '</span>' +
      (channelFor(recs, p.key) ? '<span class="p-chan">' + esc(channelFor(recs, p.key)) + '</span>' : '') +
      '<div class="p-bar"><i style="width:' + Math.round(p[state.partyType] / max * 100) + '%;background:' + (state.partyType === 'expense' ? '#e0584a' : '#07c160') + '"></i></div>' +
      '<span class="p-amt">' + fmt(p[state.partyType]) + ' · ' + (p.count || 0) + '笔</span></div>').join('');

    // 选中对手的月度往来
    const key = state.partyKey;
    const mine = recs.filter(r => r.type !== 'transfer' && partyKeyOf(r) === key);
    $('partyDetailTitle').textContent = '「' + key + '」往来';
    const labels = [], vals = [];
    for (let i = 5; i >= 0; i--) {
      const m = WC.shiftMonth(state.month, -i);
      labels.push(Number(m.slice(5)) + '月');
      vals.push(store.all().filter(r => WC.monthOf(r.date) === m && r.type !== 'transfer' && partyKeyOf(r) === key)
        .reduce((s, r) => s + (r.type === 'expense' ? -r.amount : r.amount), 0));
    }
    WC.charts.balanceLine($('partyChart'), labels, vals, '#4a90e2');
    const recent = mine.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 20);
    $('partyRecords').innerHTML = recent.map(r =>
      '<div class="pr"><span>' + r.date + ' · ' + esc(WC.byId(r.type, r.categoryId).name) + '</span>' +
      '<span class="' + r.type + '">' + (r.type === 'expense' ? '-' : '+') + '¥' + fmt(r.amount) + '</span></div>').join('');
  }

  /* ---------- 金额分析标签 ---------- */
  const BUCKETS = [
    { label: '0-10', min: 0, max: 10 },
    { label: '10-50', min: 10, max: 50 },
    { label: '50-100', min: 50, max: 100 },
    { label: '100-500', min: 100, max: 500 },
    { label: '500-1000', min: 500, max: 1000 },
    { label: '1000-5000', min: 1000, max: 5000 },
    { label: '5000+', min: 5000, max: Infinity }
  ];
  function renderAmountTab(recs) {
    const exp = recs.filter(r => r.type === 'expense');
    const sums = BUCKETS.map(b => exp.filter(r => r.amount >= b.min && r.amount < b.max).reduce((s, r) => s + r.amount, 0));
    const counts = BUCKETS.map(b => exp.filter(r => r.amount >= b.min && r.amount < b.max).length);
    WC.charts.bars($('amountChart'), BUCKETS.map(b => b.label), [{ name: '支出金额', color: '#9b6de0', values: sums }]);
    const totalAmt = sums.reduce((s, v) => s + v, 0) || 1;
    $('amountLegend').innerHTML = BUCKETS.map((b, i) => sums[i] > 0
      ? '<div class="legend-item"><i class="dot" style="background:#9b6de0"></i><span class="lg-name">¥' + b.label + '</span>' +
      '<span class="lg-pct">' + (sums[i] / totalAmt * 100).toFixed(1) + '%</span>' +
      '<span class="lg-amt">' + fmt(sums[i]) + ' · ' + counts[i] + '笔</span></div>' : '').join('');

    // 大额支出专项
    const th = Number(state.bigThreshold) || 100;
    const big = exp.filter(r => r.amount >= th).sort((a, b) => b.amount - a.amount);
    const bigSum = big.reduce((s, r) => s + r.amount, 0);
    const totalExp = exp.reduce((s, r) => s + r.amount, 0) || 1;
    $('bigStats').innerHTML =
      '<span class="chip">阈值 <b>¥' + th + '</b></span>' +
      '<span class="chip">笔数 <b>' + big.length + '</b></span>' +
      '<span class="chip">金额 <b>' + fmt(bigSum) + '</b></span>' +
      '<span class="chip">占支出 <b>' + (bigSum / totalExp * 100).toFixed(1) + '%</b></span>' +
      '<span class="chip">单笔均值 <b>' + fmt(big.length ? bigSum / big.length : 0) + '</b></span>';
    // 月度趋势
    const labels = [], vals = [];
    if (state.period === 'month') {
      for (let i = 5; i >= 0; i--) {
        const m = WC.shiftMonth(state.month, -i);
        labels.push(Number(m.slice(5)) + '月');
        vals.push(store.all().filter(r => WC.monthOf(r.date) === m && r.type === 'expense' && r.amount >= th)
          .reduce((s, r) => s + r.amount, 0));
      }
    } else {
      for (let m = 1; m <= 12; m++) {
        const mm = state.year + '-' + WC.p2(m);
        labels.push(m + '月');
        vals.push(store.all().filter(r => WC.monthOf(r.date) === mm && r.type === 'expense' && r.amount >= th)
          .reduce((s, r) => s + r.amount, 0));
      }
    }
    WC.charts.bars($('bigTrend'), labels, [{ name: '大额支出', color: '#e0584a', values: vals }]);
    $('bigList').innerHTML = big.length
      ? big.slice(0, 15).map(r =>
        '<div class="rank-row"><span class="rk-icon">' + WC.byId(r.type, r.categoryId).icon + '</span>' +
        '<span class="rk-name" style="width:auto;flex:1">' + esc(r.note) + ' <span class="tip">' + r.date + ' · ' + esc(WC.accountById(r.accountId).name) + '</span></span>' +
        '<span class="rk-amt">' + fmt(r.amount) + '</span></div>').join('')
      : '<div class="empty small">没有超过 ¥' + th + ' 的支出</div>';
  }

  /* ---------- 月度分类透视 ---------- */
  function renderPivot(recs) {
    const exp = recs.filter(r => r.type === 'expense');
    const sums = {};
    exp.forEach(r => { sums[r.categoryId] = (sums[r.categoryId] || 0) + r.amount; });
    const topCats = Object.keys(sums).sort((a, b) => sums[b] - sums[a]).slice(0, 6);
    if (!topCats.length) { $('pivotWrap').innerHTML = '<div class="empty small">暂无数据</div>'; return; }

    const months = [];
    if (state.period === 'month') {
      for (let i = 5; i >= 0; i--) months.push(WC.shiftMonth(state.month, -i));
    } else {
      for (let m = 1; m <= 12; m++) months.push(state.year + '-' + WC.p2(m));
    }
    const head = '<tr><th>月份</th>' + topCats.map(id => {
      const c = WC.byId('expense', id);
      return '<th>' + c.icon + ' ' + esc(c.name) + '</th>';
    }).join('') + '<th>合计</th></tr>';

    const maxCell = Math.max(1, ...months.map(m => exp.filter(r => WC.monthOf(r.date) === m).reduce((s, r) => s + r.amount, 0)));
    const body = months.map(m => {
      const monthExp = store.all().filter(r => WC.monthOf(r.date) === m && r.type === 'expense');
      const cells = topCats.map(id => {
        const v = monthExp.filter(r => r.categoryId === id).reduce((s, r) => s + r.amount, 0);
        return '<td class="' + (v > maxCell * 0.4 ? 'hot' : '') + '">' + (v ? fmt(v) : '') + '</td>';
      }).join('');
      const tot = monthExp.reduce((s, r) => s + r.amount, 0);
      return '<tr><td>' + Number(m.slice(5)) + '月</td>' + cells + '<td>' + fmt(tot) + '</td></tr>';
    }).join('');
    const totals = topCats.map(id => '<td>' + fmt(exp.filter(r => r.categoryId === id).reduce((s, r) => s + r.amount, 0)) + '</td>').join('');
    $('pivotWrap').innerHTML = '<table class="pivot-table"><thead>' + head + '</thead><tbody>' + body +
      '<tr class="total"><td>合计</td>' + totals + '<td>' + fmt(exp.reduce((s, r) => s + r.amount, 0)) + '</td></tr></tbody></table>';
  }

  /* ---------- 明细页 ---------- */
  function detailRecords() {
    const d = state.detail;
    const q = d.q.trim().toLowerCase();
    let list = store.all().filter(r => {
      if (d.from && r.date < d.from) return false;
      if (d.to && r.date > d.to) return false;
      if (d.type !== 'all' && r.type !== d.type) return false;
      if (d.cat !== 'all' && r.categoryId !== d.cat) return false;
      if (d.acct !== 'all' && r.accountId !== d.acct && r.toAccountId !== d.acct) return false;
      if (d.min !== '' && r.amount < Number(d.min)) return false;
      if (d.max !== '' && r.amount > Number(d.max)) return false;
      if (q) {
        const hay = (r.note + ' ' + (r.party || '') + ' ' + WC.byId(r.type, r.categoryId).name + ' ' + WC.accountById(r.accountId).name + ' ' + r.amount).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    const dir = d.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let av, bv;
      if (d.sortKey === 'amount') { av = a.amount; bv = b.amount; }
      else if (d.sortKey === 'type') { av = a.type; bv = b.type; }
      else if (d.sortKey === 'category') { av = WC.byId(a.type, a.categoryId).name; bv = WC.byId(b.type, b.categoryId).name; }
      else if (d.sortKey === 'account') { av = WC.accountById(a.accountId).name; bv = WC.accountById(b.accountId).name; }
      else { av = a.date + '|' + (a.createdAt || 0); bv = b.date + '|' + (b.createdAt || 0); }
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
    return list;
  }
  function renderDetail() {
    const list = detailRecords();
    const d = state.detail;
    const exp = sumBy(list, 'expense'), inc = sumBy(list, 'income');
    const tr = list.filter(r => r.type === 'transfer').reduce((s, r) => s + r.amount, 0);
    $('detailSummary').innerHTML =
      '<span class="chip">共 <b>' + list.length + '</b> 条</span>' +
      '<span class="chip">支出 <b class="expense">' + fmt(exp) + '</b></span>' +
      '<span class="chip">收入 <b class="income">' + fmt(inc) + '</b></span>' +
      (tr ? '<span class="chip">转账 ' + fmt(tr) + '</span>' : '') +
      '<span class="chip">结余 <b>' + fmt(inc - exp) + '</b></span>';

    const pages = Math.max(1, Math.ceil(list.length / d.pageSize));
    if (d.page > pages) d.page = pages;
    const slice = list.slice((d.page - 1) * d.pageSize, d.page * d.pageSize);
    $('detailBody').innerHTML = slice.length ? slice.map(r => {
      const isTr = r.type === 'transfer';
      const typeText = isTr ? '转账' : r.type === 'expense' ? '支出' : '收入';
      return '<tr><td>' + r.date + '</td>' +
        '<td class="' + (isTr ? '' : r.type) + '">' + typeText + '</td>' +
        '<td>' + (isTr ? '—' : WC.byId(r.type, r.categoryId).icon + ' ' + esc(WC.byId(r.type, r.categoryId).name)) + '</td>' +
        '<td>' + esc(WC.accountById(r.accountId).name) + (isTr ? ' → ' + esc(WC.accountById(r.toAccountId).name) : '') + '</td>' +
        '<td>' + esc(r.note || '') + (r.source === 'wechat' ? ' <span class="tag">微信</span>' : '') + '</td>' +
        '<td>' + esc(r.party || '') + '</td>' +
        '<td class="amt ' + (isTr ? '' : r.type) + '">' + (isTr ? '' : r.type === 'expense' ? '-' : '+') + fmt(r.amount) + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty small">没有符合条件的记录</div></td></tr>';

    // 分页
    const btns = [];
    btns.push('<button data-page="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>上一页</button>');
    const start = Math.max(1, d.page - 2), end = Math.min(pages, start + 4);
    for (let p = start; p <= end; p++) btns.push('<button data-page="' + p + '" class="' + (p === d.page ? 'active' : '') + '">' + p + '</button>');
    btns.push('<button data-page="' + (d.page + 1) + '"' + (d.page >= pages ? ' disabled' : '') + '>下一页</button>');
    $('detailPager').innerHTML = '<span>第 ' + d.page + ' / ' + pages + ' 页 · 每页 ' + d.pageSize + ' 条</span>' + btns.join('');

    // 表头排序标记
    document.querySelectorAll('#detailTable th[data-sort]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === d.sortKey);
      th.textContent = th.textContent.replace(/[ ▲▼]+$/, '') + (th.dataset.sort === d.sortKey ? (d.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
    });
  }

  /* ---------- Excel 报告 ---------- */
  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function exportXlsx() {
    const recs = store.all();
    if (!recs.length) { toast('暂无记录可导出'); return; }
    const months = Array.from(new Set(recs.map(r => WC.monthOf(r.date)))).sort();
    const monthRows = [['月份', '支出', '收入', '结余', '笔数']];
    months.forEach(m => {
      const rs = recs.filter(r => WC.monthOf(r.date) === m);
      const e = sumBy(rs, 'expense'), i = sumBy(rs, 'income');
      monthRows.push([WC.monthLabel(m), +e.toFixed(2), +i.toFixed(2), +(i - e).toFixed(2), rs.length]);
    });

    const catRows = [['类型', '分类', '金额', '占比', '笔数']];
    ['expense', 'income'].forEach(type => {
      const arr = recs.filter(r => r.type === type);
      const total = arr.reduce((s, r) => s + r.amount, 0) || 1;
      const map = {};
      arr.forEach(r => { map[r.categoryId] = (map[r.categoryId] || 0) + r.amount; });
      Object.keys(map).sort((a, b) => map[b] - map[a]).forEach(id => {
        catRows.push([type === 'expense' ? '支出' : '收入', WC.byId(type, id).name, +map[id].toFixed(2),
          +(map[id] / total * 100).toFixed(2) + '%', arr.filter(r => r.categoryId === id).length]);
      });
    });

    const partyRows = [['类型', '交易对方/备注', '金额', '笔数']];
    const agg = partyAgg(recs);
    ['expense', 'income'].forEach(type => {
      agg.filter(p => (p[type] || 0) > 0).sort((a, b) => (b[type] || 0) - (a[type] || 0)).slice(0, 20)
        .forEach(p => partyRows.push([type === 'expense' ? '支出' : '收入', p.key, +p[type].toFixed(2), p.count]));
    });

    const th = Number(state.bigThreshold) || 100;
    const bigRows = [['日期', '分类', '账户', '备注', '金额']];
    recs.filter(r => r.type === 'expense' && r.amount >= th).sort((a, b) => b.amount - a.amount)
      .forEach(r => bigRows.push([r.date, WC.byId(r.type, r.categoryId).name, WC.accountById(r.accountId).name, r.note || '', +r.amount.toFixed(2)]));

    const allRows = [['日期', '收支', '分类', '账户', '转入账户', '交易对方', '备注', '金额', '交易单号', '来源']];
    recs.slice().sort((a, b) => a.date < b.date ? 1 : -1).forEach(r => {
      allRows.push([r.date,
        r.type === 'expense' ? '支出' : r.type === 'income' ? '收入' : '转账',
        r.type === 'transfer' ? '转账' : WC.byId(r.type, r.categoryId).name,
        WC.accountById(r.accountId).name,
        r.toAccountId ? WC.accountById(r.toAccountId).name : '',
        r.party || '', r.note || '', +r.amount.toFixed(2), r.extId || '', r.source || '手动']);
    });

    const expTotal = sumBy(recs, 'expense'), incTotal = sumBy(recs, 'income');
    const info = [
      ['记账本 · 分析报告'],
      ['导出时间', new Date().toLocaleString('zh-CN')],
      ['记录总数', recs.length],
      ['时间范围', (months[0] || '') + ' ~ ' + (months[months.length - 1] || '')],
      ['总收入', +incTotal.toFixed(2)],
      ['总支出', +expTotal.toFixed(2)],
      ['结余', +(incTotal - expTotal).toFixed(2)],
      ['账户数', WC.accounts().length],
      ['数据来源', '本机浏览器 localStorage，未上传任何服务器']
    ];

    const blob = WC.xlsx.build([
      { name: '报告说明', rows: info, widths: [16, 34] },
      { name: '月度统计', rows: monthRows, widths: [14, 14, 14, 14, 8] },
      { name: '类别分析', rows: catRows, widths: [8, 16, 14, 12, 8] },
      { name: '交易对手TOP', rows: partyRows, widths: [8, 30, 14, 8] },
      { name: '大额交易', rows: bigRows, widths: [12, 12, 12, 34, 12] },
      { name: '全部流水', rows: allRows, widths: [12, 8, 10, 12, 12, 20, 30, 12, 26, 8] }
    ]);
    downloadBlob('记账本分析报告_' + WC.today() + '.xlsx', blob);
    toast('已导出 6 个工作表的 Excel 报告');
  }

  function exportDetailCsv() {
    const list = detailRecords();
    if (!list.length) { toast('当前筛选没有记录'); return; }
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['日期', '收支', '分类', '账户', '转入账户', '备注', '交易对方', '金额', '交易单号'];
    const lines = list.map(r => [r.date,
      r.type === 'expense' ? '支出' : r.type === 'income' ? '收入' : '转账',
      r.type === 'transfer' ? '转账' : WC.byId(r.type, r.categoryId).name,
      WC.accountById(r.accountId).name,
      r.toAccountId ? WC.accountById(r.toAccountId).name : '',
      r.note || '', r.party || '', r.amount.toFixed(2), r.extId || ''
    ].map(q).join(','));
    download('筛选明细_' + WC.today() + '.csv', '﻿' + head.map(q).join(',') + '\n' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast('已导出 ' + list.length + ' 条');
  }

  function bind() {
    document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.nav)));
    $('btnPrevMonth').onclick = () => {
      if (state.view === 'stats' && state.period === 'year') { state.year = String(Number(state.year) - 1); renderStats(); }
      else { state.month = WC.shiftMonth(state.month, -1); state.statDay = null; state.view === 'stats' ? renderStats() : renderHome(); }
    };
    $('btnNextMonth').onclick = () => {
      if (state.view === 'stats' && state.period === 'year') { state.year = String(Number(state.year) + 1); renderStats(); }
      else { state.month = WC.shiftMonth(state.month, 1); state.statDay = null; state.view === 'stats' ? renderStats() : renderHome(); }
    };
    $('btnThisMonth').onclick = () => {
      state.month = WC.thisMonth(); state.year = WC.thisMonth().slice(0, 4);
      state.view === 'stats' ? renderStats() : renderHome();
    };
    // 统计页内的月份切换条
    $('stPrev').onclick = () => {
      if (state.period === 'year') state.year = String(Number(state.year) - 1);
      else state.month = WC.shiftMonth(state.month, -1);
      state.statDay = null;
      renderStats();
    };
    $('stNext').onclick = () => {
      if (state.period === 'year') state.year = String(Number(state.year) + 1);
      else state.month = WC.shiftMonth(state.month, 1);
      state.statDay = null;
      renderStats();
    };
    // 点日历格子 → 展开/收起当日明细
    $('heatGrid').addEventListener('click', e => {
      const cell = e.target.closest('[data-day]');
      if (!cell) return;
      const d = Number(cell.dataset.day);
      state.statDay = state.statDay === d ? null : d;
      renderHeatGrid(state._heatPerDay || [], Number(state.month.slice(0, 4)), Number(state.month.slice(5)));
      renderDayDetail();
    });
    // 点当日明细的某一行 → 打开编辑器
    $('dayDetail').addEventListener('click', e => {
      const row = e.target.closest('[data-edit]');
      if (!row) return;
      const rec = store.get(row.dataset.edit);
      if (rec) openEditor(rec);
    });
    $('btnTheme').onclick = toggleTheme;
    $('btnTheme2').onclick = toggleTheme;

    $('btnAddTop').onclick = () => openEditor(null);
    $('fabAdd').onclick = () => openEditor(null);
    $('btnEmptyAdd').onclick = () => {
      if ($('btnEmptyAdd').textContent === '清除筛选') {
        state.q = ''; state.ftype = 'all'; state.fcat = 'all'; state.facct = 'all';
        $('searchInput').value = ''; $('filterType').value = 'all'; $('filterCat').value = 'all'; $('filterAcct').value = 'all';
        renderHome();
      } else openEditor(null);
    };
    $('btnSeedDemo').onclick = () => {
      WC.seed();
      state.month = WC.thisMonth();
      renderHome();
      toast('已载入示例数据，可在「数据与设置」里清空');
    };
    $('searchInput').oninput = e => { state.q = e.target.value; renderHome(); };
    $('filterType').onchange = e => { state.ftype = e.target.value; renderHome(); };
    $('filterCat').onchange = e => { state.fcat = e.target.value; renderHome(); };
    $('filterAcct').onchange = e => { state.facct = e.target.value; renderHome(); };
    $('btnEditBudget').onclick = () => { switchView('settings'); $('budgetInput').focus(); };

    $('recordList').addEventListener('click', async e => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const rec = store.get(del.dataset.del);
        const label = rec.type === 'transfer' ? '账户转账 ¥' + fmt(rec.amount) : '「' + (rec.note || '') + ' ¥' + fmt(rec.amount) + '」';
        if (await confirmBox('删除记录', '确定删除' + label + '吗？')) {
          store.remove(del.dataset.del);
          renderHome();
          toast('已删除');
        }
        return;
      }
      const row = e.target.closest('.rec');
      if (row) openEditor(store.get(row.dataset.id));
    });

    $('btnCloseEditor').onclick = () => $('editorDialog').close();
    $('editorForm').addEventListener('submit', saveEditor);
    document.querySelectorAll('#editorTypeSeg button').forEach(b => b.onclick = () => setEditorType(b.dataset.etype));
    $('editCats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (b) { state.ecat = b.dataset.cat; renderEditorCats(); }
    });
    $('keypad').addEventListener('click', e => {
      const b = e.target.closest('[data-key]');
      if (b) keypad(b.dataset.key);
    });
    document.addEventListener('keydown', e => {
      if (!$('editorDialog').open) {
        if (e.key === 'n' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
          e.preventDefault(); openEditor(null);
        }
        return;
      }
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keypad(e.key); }
      else if (e.key === '.') { e.preventDefault(); keypad('.'); }
      else if (e.key === 'Backspace') { e.preventDefault(); keypad('del'); }
      else if (e.key === 'Enter') { e.preventDefault(); $('btnSaveRec').click(); }
      else if (e.key === 'Escape') { /* 交给 dialog */ }
    });
    document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { $('editDate').value = shiftDate(Number(b.dataset.day)); });
    $('btnDeleteRec').onclick = async () => {
      if (await confirmBox('删除记录', '确定删除这条记录吗？')) {
        store.remove(state.editingId);
        $('editorDialog').close();
        renderHome();
        toast('已删除');
      }
    };

    // 统计
    document.querySelectorAll('#statsTypeSeg button').forEach(b => b.onclick = () => {
      state.statsType = b.dataset.stype;
      document.querySelectorAll('#statsTypeSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderStats();
    });
    document.querySelectorAll('#periodSeg button').forEach(b => b.onclick = () => {
      state.period = b.dataset.period;
      if (state.period === 'year') state.year = state.month.slice(0, 4);
      document.querySelectorAll('#periodSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderStats();
    });

    // 统计标签页
    document.querySelectorAll('#statsTabs button').forEach(b => b.onclick = () => {
      state.statsTab = b.dataset.tab;
      document.querySelectorAll('#statsTabs button').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.st-tab').forEach(t => t.classList.add('hidden'));
      $('st-' + state.statsTab).classList.remove('hidden');
      renderStats();
    });
    document.querySelectorAll('#partyTypeSeg button').forEach(b => b.onclick = () => {
      state.partyType = b.dataset.ptype;
      state.partyKey = null;
      document.querySelectorAll('#partyTypeSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderStats();
    });
    $('partyList').addEventListener('click', e => {
      const row = e.target.closest('[data-party]');
      if (row) { state.partyKey = row.dataset.party; renderPartyTab(periodRecords()); }
    });
    $('btnBigApply').onclick = () => {
      const v = Number($('bigThreshold').value);
      if (!v || v <= 0) { toast('请输入有效阈值'); return; }
      state.bigThreshold = v;
      renderAmountTab(periodRecords());
      toast('大额阈值已设为 ¥' + v);
    };
    $('bigThreshold').onkeydown = e => { if (e.key === 'Enter') $('btnBigApply').click(); };

    // 明细页
    const dfilter = [
      ['dFrom', 'from'], ['dTo', 'to'], ['dType', 'type'], ['dCat', 'cat'], ['dAcct', 'acct'], ['dMin', 'min'], ['dMax', 'max'], ['dQ', 'q']
    ];
    dfilter.forEach(([id, key]) => {
      const el = $(id);
      el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {
        state.detail[key] = el.value;
        state.detail.page = 1;
        renderDetail();
      });
    });
    $('btnDetailReset').onclick = () => {
      state.detail = { from: '', to: '', type: 'all', cat: 'all', acct: 'all', min: '', max: '', q: '', sortKey: 'date', sortDir: 'desc', page: 1, pageSize: 50 };
      ['dFrom', 'dTo', 'dMin', 'dMax', 'dQ'].forEach(id => { $(id).value = ''; });
      ['dType', 'dCat', 'dAcct'].forEach(id => { $(id).value = 'all'; });
      renderDetail();
    };
    $('detailTable').querySelectorAll('th[data-sort]').forEach(th => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (state.detail.sortKey === k) state.detail.sortDir = state.detail.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.detail.sortKey = k; state.detail.sortDir = k === 'date' ? 'desc' : 'desc'; }
        renderDetail();
      };
    });
    $('detailPager').addEventListener('click', e => {
      const b = e.target.closest('button[data-page]');
      if (!b || b.disabled) return;
      state.detail.page = Number(b.dataset.page);
      renderDetail();
    });
    $('btnExportFiltered').onclick = exportDetailCsv;
    $('btnExportXlsx').onclick = exportXlsx;

    // 导入
    const dz = $('dropzone');
    $('btnPickFile').onclick = () => $('fileInput').click();
    dz.onclick = e => { if (e.target.id !== 'btnPickFile') $('fileInput').click(); };
    $('fileInput').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    $('btnParsePaste').onclick = () => {
      const text = $('pasteArea').value;
      if (!text.trim()) { toast('请先粘贴 CSV 文本'); return; }
      const r = WC.parseCsvText(text);
      if (ingest(r, '粘贴的文本')) $('pasteArea').value = '';
    };
    $('previewBody').addEventListener('change', e => {
      const sel = e.target.closest('select[data-idx]');
      if (!sel || !state.pending) return;
      const fin = state.pending.final;
      const rec = fin && fin.records[Number(sel.dataset.idx)];
      if (!rec) return;
      rec.categoryId = sel.value;
      // 改分类要同时写回原始记录，否则再并一份账单重算就丢了
      const raw = state.pending.records[rec._ri];
      if (raw) raw.categoryId = sel.value;
    });
    const cancelImport = () => {
      state.pending = null;
      $('importResult').classList.add('hidden');
      $('mergeFiles').innerHTML = '';
    };
    $('btnCancelImport').onclick = cancelImport;
    $('btnCancelImportTop').onclick = cancelImport;
    const doImport = () => {
      if (!state.pending) return;
      const fin = state.pending.final || finalizePending(state.pending);
      const nFiles = (state.pending.files || []).length;
      const clean = fin.records.map(r => {
        const c = Object.assign({}, r);
        delete c._src; delete c._chan; delete c._ri; delete c._order;
        return c;
      });
      const res = store.addMany(clean);
      toast('导入完成：新增 ' + res.added + ' 笔，跳过重复 ' + res.duplicated + ' 笔' +
        (nFiles > 1 ? '（合并 ' + nFiles + ' 份账单）' : ''));
      state.pending = null;
      $('importResult').classList.add('hidden');
      $('mergeFiles').innerHTML = '';
      $('pasteArea').value = '';
      renderHome();
    };
    $('btnDoImport').onclick = doImport;
    $('btnDoImportTop').onclick = doImport;

    // 设置：预算 / 账户 / 分类
    $('btnSaveBudget').onclick = () => {
      const v = Number($('budgetInput').value) || 0;
      settings.setBudget(state.month, v);
      toast(v > 0 ? WC.monthLabel(state.month) + '预算已设为 ¥' + fmt(v) : '已取消当月预算');
      renderSettings();
    };
    $('btnAddAccount').onclick = () => {
      const arr = WC.accounts().slice();
      arr.push({ id: 'acc_' + Date.now().toString(36), name: '新账户', icon: '🏦' });
      settings.saveAccounts(arr);
      renderAccounts();
      refreshAccountSelects();
      toast('已新增账户，可改名');
    };
    $('accountList').addEventListener('change', e => {
      const t = e.target;
      const arr = WC.accounts().slice();
      if (t.dataset.accName) {
        const it = arr.find(a => a.id === t.dataset.accName);
        if (it) { it.name = t.value.trim() || it.name; settings.saveAccounts(arr); renderAccounts(); refreshAccountSelects(); }
      } else if (t.dataset.accIcon) {
        const it = arr.find(a => a.id === t.dataset.accIcon);
        if (it) { it.icon = t.value.trim() || it.icon; settings.saveAccounts(arr); renderAccounts(); refreshAccountSelects(); }
      }
    });
    $('accountList').addEventListener('click', async e => {
      const del = e.target.closest('[data-acc-del]');
      if (!del) return;
      const id = del.dataset.accDel;
      const used = store.all().filter(r => r.accountId === id || r.toAccountId === id).length;
      if (WC.accounts().length <= 1) { toast('至少保留一个账户'); return; }
      if (used) { toast('该账户还有 ' + used + ' 条记录，不能删除'); return; }
      if (await confirmBox('删除账户', '确定删除该账户吗？')) {
        settings.saveAccounts(WC.accounts().filter(a => a.id !== id));
        if (settings.defaultAccount() === id) settings.setDefaultAccount(WC.accounts()[0].id);
        renderAccounts();
        refreshAccountSelects();
        toast('已删除');
      }
    });
    $('defaultAccountSel').onchange = e => { settings.setDefaultAccount(e.target.value); renderAccounts(); toast('默认账户已更新'); };

    document.querySelectorAll('#catTypeSeg button').forEach(b => b.onclick = () => {
      state.catType = b.dataset.ctype;
      document.querySelectorAll('#catTypeSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderCatEditor();
    });
    $('catEditList').addEventListener('change', e => {
      const t = e.target;
      const arr = WC.list(state.catType).map(c => Object.assign({}, c));
      if (t.dataset.catName) {
        const it = arr.find(c => c.id === t.dataset.catName);
        if (it) { it.name = t.value.trim().slice(0, 6) || it.name; saveCatArr(arr); }
      } else if (t.dataset.catIcon) {
        const it = arr.find(c => c.id === t.dataset.catIcon);
        if (it) { it.icon = t.value.trim().slice(0, 2) || it.icon; saveCatArr(arr); }
      }
    });
    $('catEditList').addEventListener('click', async e => {
      const t = e.target;
      const arr = WC.list(state.catType).map(c => Object.assign({}, c));
      if (t.dataset.catUp) {
        const i = arr.findIndex(c => c.id === t.dataset.catUp);
        if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; saveCatArr(arr); }
      } else if (t.dataset.catDown) {
        const i = arr.findIndex(c => c.id === t.dataset.catDown);
        if (i >= 0 && i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; saveCatArr(arr); }
      } else if (t.dataset.catDel) {
        if (arr.length <= 1) { toast('至少保留一个分类'); return; }
        if (await confirmBox('删除分类', '删除后该分类下的已有记录会显示为「其他」，确定删除吗？')) {
          saveCatArr(arr.filter(c => c.id !== t.dataset.catDel));
        }
      }
    });
    $('btnAddCat').onclick = () => {
      const arr = WC.list(state.catType).map(c => Object.assign({}, c));
      const used = arr.map(c => c.color);
      const color = WC.PALETTE.find(c => used.indexOf(c) < 0) || WC.PALETTE[arr.length % WC.PALETTE.length];
      arr.push({ id: 'c_' + Date.now().toString(36), name: '新分类', icon: '🏷️', color });
      saveCatArr(arr);
    };
    $('btnResetCats').onclick = async () => {
      if (await confirmBox('恢复默认分类', '将把支出和收入分类恢复成初始的 10+6 个，自定义分类会被删除（已有记录会自动归到「其他」）。')) {
        settings.resetCats();
        renderCatEditor();
        refreshCatFilter();
        toast('已恢复默认分类');
      }
    };

    // 备份
    $('btnExportCsv').onclick = exportCsv;
    $('btnExportJson').onclick = () => {
      const recs = store.all();
      if (!recs.length) { toast('暂无记录可备份'); return; }
      download('记账本备份_' + WC.today() + '.json', JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), records: recs }, null, 2), 'application/json');
      toast('备份已下载');
    };
    $('btnImportJson').onclick = () => $('jsonInput').click();
    $('jsonInput').onchange = async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const recs = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(recs)) throw new Error('格式不正确');
        const valid = recs.filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number(r.amount) > 0 &&
          (r.type === 'expense' || r.type === 'income' || r.type === 'transfer'))
          .map(r => ({
            id: r.id || WC.uid(), type: r.type, amount: Number(r.amount),
            categoryId: r.categoryId || (r.type === 'income' ? 'other_in' : 'other'),
            note: r.note || '', date: r.date, extId: r.extId, source: r.source, party: r.party,
            accountId: r.accountId || settings.defaultAccount(), toAccountId: r.toAccountId,
            createdAt: r.createdAt || Date.now()
          }));
        const res = store.addMany(valid);
        toast('恢复完成：新增 ' + res.added + ' 笔，跳过重复 ' + res.duplicated + ' 笔');
        renderSettings(); renderHome();
      } catch (err) { toast('恢复失败：' + err.message); }
    };
    $('btnSeed').onclick = async () => {
      if (await confirmBox('载入示例数据', '将生成近 3 个月的演示账单（约 100 笔），不影响已有记录。')) {
        WC.seed();
        toast('示例数据已载入');
        renderSettings(); renderHome();
      }
    };
    $('btnClearAll').onclick = async () => {
      if (await confirmBox('清空全部记录', '将删除本机保存的全部 ' + store.count() + ' 条记录，且无法恢复。建议先导出备份。确定继续吗？')) {
        store.clear();
        toast('已清空');
        renderSettings(); renderHome();
      }
    };

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.view === 'stats') renderStats(); }, 200);
    });
  }

  /* ---------- 启动 ---------- */
  function refreshAccountSelects() {
    const opts = WC.accounts().map(a => '<option value="' + a.id + '">' + a.icon + ' ' + esc(a.name) + '</option>').join('');
    $('filterAcct').innerHTML = '<option value="all">全部账户</option>' + opts;
    $('dAcct').innerHTML = '<option value="all">全部</option>' + opts;
  }
  function init() {
    const cats = WC.list('expense').concat(WC.list('income').filter(c => c.id !== 'other_in'));
    const catOpts = cats.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + '</option>').join('');
    $('filterCat').innerHTML = '<option value="all">全部分类</option>' + catOpts;
    $('dCat').innerHTML = '<option value="all">全部</option>' + catOpts;
    refreshAccountSelects();
    applyTheme();
    bind();
    switchView('home');
  }
  init();
})();
