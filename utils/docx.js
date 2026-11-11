// 极简 docx 读取：docx 也是 zip，解压后读 word/document.xml
// 提取其中的表格（w:tbl -> w:tr -> w:tc -> w:t），转成二维字符串数组，
// 复用 billParser.parseRows 的二维表解析逻辑。纯正则，无第三方依赖。

const decodeEntities = require('./xlsx').decodeEntities;

// 取出 XML 片段里所有 <w:t> 文本（跳过 w:delText 等修订痕迹）
function cellText(xml) {
  let text = '';
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = tRe.exec(xml)) !== null) {
    text += m[1];
  }
  // <w:tab/> 当作空格，<w:br/> 当作换行合并成空格
  text = text.replace(/<w:tab\b[^>]*\/>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

// 单张表 -> [[cell,...],...]
function parseTable(tblXml) {
  const rows = [];
  const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let tr;
  while ((tr = trRe.exec(tblXml)) !== null) {
    const body = tr[1];
    const cells = [];
    const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let tc;
    while ((tc = tcRe.exec(body)) !== null) {
      cells.push(cellText(tc[1]));
    }
    let has = false;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) { has = true; break; }
    }
    if (has) rows.push(cells);
  }
  return rows;
}

// 整份 document.xml -> { tables: [...], paragraphs: [...] }
function parseDocument(xml) {
  const tables = [];
  const paragraphs = [];
  if (!xml) return { tables: tables, paragraphs: paragraphs };

  // 先摘掉表格，剩下的才算正文段落（避免把表格里的文字重复进 paragraphs）
  const tblRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let m;
  let rest = xml;
  while ((m = tblRe.exec(xml)) !== null) {
    const rows = parseTable(m[1]);
    if (rows.length) tables.push(rows);
    rest = rest.replace(m[0], ' ');
  }

  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let p;
  while ((p = pRe.exec(rest)) !== null) {
    const t = cellText(p[1]);
    if (t) paragraphs.push(t);
  }

  return { tables: tables, paragraphs: paragraphs };
}

// 从多张表里挑最像账单的那张：优先含表头关键词，其次行数最多
function pickBillTable(tables) {
  if (!tables || !tables.length) return null;
  let best = null;
  let bestScore = -1;
  tables.forEach(function (rows) {
    const joined = rows.slice(0, 6).map(function (r) { return r.join(' '); }).join(' ');
    let score = rows.length;
    if (joined.indexOf('交易时间') >= 0) score += 1000;
    if (joined.indexOf('金额') >= 0) score += 500;
    if (joined.indexOf('收/支') >= 0 || joined.indexOf('收支') >= 0) score += 200;
    if (score > bestScore) { bestScore = score; best = rows; }
  });
  return best;
}

module.exports = {
  cellText: cellText,
  parseTable: parseTable,
  parseDocument: parseDocument,
  pickBillTable: pickBillTable
};
