// 极简 xlsx 读取：xlsx 本质是 zip，小程序用 FileSystemManager.unzip 解压后，
// 这里把 sharedStrings.xml / sheetN.xml 解析成二维字符串数组。
// 不依赖任何第三方库，纯正则解析（对微信账单这种规整表格足够）。

// 只做纯函数部分 -> 便于在 node 里单测

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
      return String.fromCharCode(parseInt(h, 16));
    })
    .replace(/&#(\d+);/g, function (m, d) {
      return String.fromCharCode(parseInt(d, 10));
    })
    .replace(/&amp;/g, '&');
}

// <si> 里可能有多个 <t>（富文本分段），全部拼起来
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const body = m[1];
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(body)) !== null) {
      text += t[1];
    }
    out.push(decodeEntities(text));
  }
  return out;
}

// 'A' -> 0, 'AB' -> 27
function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

// 解析 sheet xml -> [[cell,...],...]
function parseSheet(xml, shared) {
  const rows = [];
  if (!xml) return rows;
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const body = rm[2];
    const cells = [];
    const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(body)) !== null) {
      const attrs = cm[1] || '';
      const inner = cm[3] || '';
      const refM = attrs.match(/\br="([A-Z]+)\d+"/);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const typeM = attrs.match(/\bt="([^"]+)"/);
      const type = typeM ? typeM[1] : '';

      let value = '';
      if (type === 's') {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) {
          const i = parseInt(vm[1], 10);
          value = shared && shared[i] !== undefined ? shared[i] : '';
        }
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
    // 跳过完全空行
    let has = false;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== '' && cells[i] !== undefined) { has = true; break; }
    }
    if (has) rows.push(cells);
  }
  return rows;
}

module.exports = {
  parseSharedStrings: parseSharedStrings,
  parseSheet: parseSheet,
  decodeEntities: decodeEntities
};
