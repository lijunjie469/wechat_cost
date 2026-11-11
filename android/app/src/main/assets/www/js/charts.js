/* 轻量 canvas 图表：环形图 / 分组柱状图 / 折线图（无第三方依赖，支持 HiDPI 与深色模式） */
(function () {
  'use strict';

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function setup(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = '100%';
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const h = height || 220;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /* 环形图 + 中心合计 */
  function donut(canvas, data, centerTop, centerBottom) {
    const size = Math.min(canvas.parentElement.clientWidth || 260, 260);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2, R = size / 2 - 8, r = R * 0.62;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (!total) {
      ctx.beginPath(); ctx.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2);
      ctx.lineWidth = R - r; ctx.strokeStyle = css('--panel-2'); ctx.stroke();
    } else {
      let angle = -Math.PI / 2;
      data.forEach(d => {
        const sweep = (d.value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R, angle, angle + sweep);
        ctx.arc(cx, cy, r, angle + sweep, angle, true);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        angle += sweep;
      });
    }
    ctx.fillStyle = css('--text-2');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(centerTop || '', cx, cy - 8);
    ctx.fillStyle = css('--text');
    ctx.font = '700 22px sans-serif';
    ctx.fillText(centerBottom || '', cx, cy + 20);
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }
  function compact(v) {
    if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + 'w';
    if (v >= 1000) return Math.round(v / 100) / 10 + 'k';
    return String(Math.round(v));
  }

  /* 分组柱状图：近 6 个月收支 */
  function bars(canvas, labels, series) {
    const { ctx, w, h } = setup(canvas, 240);
    const padL = 44, padR = 8, padT = 26, padB = 30;
    const iw = w - padL - padR, ih = h - padT - padB;
    const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
    ctx.font = '11px sans-serif';
    // 网格与 Y 轴
    for (let i = 0; i <= 4; i++) {
      const y = padT + ih - (ih * i) / 4;
      ctx.strokeStyle = css('--line');
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'right';
      ctx.fillText(compact((max * i) / 4), padL - 8, y + 4);
    }
    const groupW = iw / labels.length;
    const barW = Math.min(20, (groupW - 14) / series.length);
    labels.forEach((lb, i) => {
      const gx = padL + groupW * i + groupW / 2;
      series.forEach((s, j) => {
        const v = s.values[i] || 0;
        const bh = (v / max) * ih;
        const x = gx - (barW * series.length) / 2 + j * barW + 2;
        ctx.fillStyle = s.color;
        const y = padT + ih - bh;
        const bw = barW - 4;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, Math.max(bh, v > 0 ? 2 : 0), [3, 3, 0, 0]);
        else ctx.rect(x, y, bw, bh);
        ctx.fill();
      });
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'center';
      ctx.fillText(lb, gx, h - 10);
    });
    // 图例
    let lx = padL;
    series.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 2, 10, 10);
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'left';
      ctx.fillText(s.name, lx + 15, 11);
      lx += 70;
    });
  }

  /* 折线图：每日支出 */
  function line(canvas, labels, values, color) {
    const { ctx, w, h } = setup(canvas, 220);
    const padL = 44, padR = 12, padT = 14, padB = 26;
    const iw = w - padL - padR, ih = h - padT - padB;
    const max = niceMax(Math.max(1, ...values));
    ctx.font = '11px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = padT + ih - (ih * i) / 4;
      ctx.strokeStyle = css('--line');
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'right';
      ctx.fillText(compact((max * i) / 4), padL - 8, y + 4);
    }
    const px = i => padL + (values.length === 1 ? iw / 2 : (iw * i) / (values.length - 1));
    const py = v => padT + ih - (v / max) * ih;
    // 面积填充
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, (color || '#07c160') + '44');
    grad.addColorStop(1, (color || '#07c160') + '00');
    ctx.beginPath();
    ctx.moveTo(px(0), padT + ih);
    values.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.lineTo(px(values.length - 1), padT + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // 线
    ctx.beginPath();
    values.forEach((v, i) => { if (i === 0) ctx.moveTo(px(i), py(v)); else ctx.lineTo(px(i), py(v)); });
    ctx.strokeStyle = color || '#07c160';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 最高点点缀
    const peak = values.indexOf(Math.max(...values));
    if (values[peak] > 0) {
      ctx.beginPath(); ctx.arc(px(peak), py(values[peak]), 4, 0, Math.PI * 2);
      ctx.fillStyle = color || '#07c160'; ctx.fill();
      ctx.fillStyle = css('--text');
      ctx.textAlign = 'center';
      ctx.fillText(WC.fmt(values[peak]), Math.min(Math.max(px(peak), padL + 24), w - 40), Math.max(py(values[peak]) - 10, padT - 4));
    }
    // X 轴稀疏标签
    ctx.fillStyle = css('--text-2');
    const step = Math.ceil(labels.length / 8);
    labels.forEach((lb, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      ctx.textAlign = 'center';
      ctx.fillText(lb, px(i), h - 8);
    });
  }

  const WC = window.WC = window.WC || {};
  WC.charts = { donut, bars, line, heatmap, multiLine, balanceLine };

  /* 支持负值的走势线（余额 / 净现金流），带零轴 */
  function balanceLine(canvas, labels, values, color) {
    const { ctx, w, h } = setup(canvas, 250);
    const padL = 52, padR = 12, padT = 18, padB = 26;
    const iw = w - padL - padR, ih = h - padT - padB;
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max - min < 1) { max += 1; min -= 1; }
    const span = max - min;
    const py = v => padT + ih - ((v - min) / span) * ih;
    const px = i => padL + (values.length <= 1 ? iw / 2 : (iw * i) / (values.length - 1));
    ctx.font = '11px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const val = min + (span * i) / 4;
      const y = py(val);
      ctx.strokeStyle = css('--line');
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'right';
      ctx.fillText(compact(val), padL - 8, y + 4);
    }
    if (min < 0 && max > 0) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = css('--text-2');
      ctx.beginPath(); ctx.moveTo(padL, py(0)); ctx.lineTo(w - padR, py(0)); ctx.stroke();
      ctx.restore();
    }
    const base = color || '#07c160';
    const zeroY = py(0);
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, base + '33');
    grad.addColorStop(1, base + '00');
    ctx.beginPath();
    ctx.moveTo(px(0), zeroY);
    values.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.lineTo(px(values.length - 1), zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    values.forEach((v, i) => { if (i === 0) ctx.moveTo(px(i), py(v)); else ctx.lineTo(px(i), py(v)); });
    ctx.strokeStyle = base; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = css('--text-2');
    const step = Math.ceil(labels.length / 8);
    labels.forEach((lb, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      ctx.textAlign = 'center';
      ctx.fillText(lb, px(i), h - 8);
    });
  }

  /* 日历热力图：7 列（周日→周六），按每日金额强度着色 */
  function heatmap(canvas, year, month, values, color) {
    const cols = 7;
    const first = new Date(year, month - 1, 1);
    const dim = new Date(year, month, 0).getDate();
    const offset = first.getDay();
    const rows = Math.ceil((offset + dim) / cols);
    const gap = 6;
    canvas.style.width = '100%';
    const canvasW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const cell = Math.max(30, Math.min(56, Math.floor((canvasW - gap * (cols - 1)) / cols)));
    const gridW = cell * cols + gap * (cols - 1);
    const offsetX = Math.max(0, Math.floor((canvasW - gridW) / 2));
    const h = rows * (cell + gap) + 22;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = h + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, h);

    const max = Math.max(1, ...values);
    const base = color || '#07c160';
    const curX = i => offsetX + (i % cols) * (cell + gap);
    const curY = i => Math.floor(i / cols) * (cell + gap) + 20;

    ctx.font = '11px sans-serif';
    ctx.fillStyle = css('--text-2');
    ctx.textAlign = 'center';
    ['日', '一', '二', '三', '四', '五', '六'].forEach((w, i) => {
      ctx.fillText(w, curX(i) + cell / 2, 12);
    });

    for (let d = 1; d <= dim; d++) {
      const idx = offset + d - 1;
      const v = values[d - 1] || 0;
      const ratio = v / max;
      const x = curX(idx), y = curY(idx);
      ctx.fillStyle = v > 0 ? hexAlpha(base, 0.12 + ratio * 0.88) : css('--panel-2');
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, cell, cell, 8); ctx.fill(); }
      else ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = ratio > 0.45 ? '#fff' : css('--text-2');
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(d), x + 5, y + 13);
      if (v > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = ratio > 0.45 ? 'rgba(255,255,255,.95)' : css('--text');
        ctx.font = '600 11px sans-serif';
        ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)), x + cell / 2, y + cell - 8);
      }
    }
  }

  function hexAlpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* 多序列折线：分类趋势 */
  function multiLine(canvas, labels, series) {
    const { ctx, w, h } = setup(canvas, 240);
    const padL = 44, padR = 12, padT = 30, padB = 26;
    const iw = w - padL - padR, ih = h - padT - padB;
    const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
    ctx.font = '11px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = padT + ih - (ih * i) / 4;
      ctx.strokeStyle = css('--line');
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'right';
      ctx.fillText(compact((max * i) / 4), padL - 8, y + 4);
    }
    const px = i => padL + (valuesCount(labels) === 1 ? iw / 2 : (iw * i) / (labels.length - 1));
    const py = v => padT + ih - (v / max) * ih;
    series.forEach(s => {
      ctx.beginPath();
      s.values.forEach((v, i) => { if (i === 0) ctx.moveTo(px(i), py(v)); else ctx.lineTo(px(i), py(v)); });
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      s.values.forEach((v, i) => {
        ctx.beginPath(); ctx.arc(px(i), py(v), 2.5, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.fill();
      });
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--text-2');
    labels.forEach((lb, i) => ctx.fillText(lb, px(i), h - 8));
    let lx = padL;
    series.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 8, 10, 3);
      ctx.fillStyle = css('--text-2');
      ctx.textAlign = 'left';
      ctx.fillText(s.name, lx + 14, 12);
      lx += ctx.measureText(s.name).width + 34;
    });
  }
  function valuesCount(labels) { return labels.length; }
})();
