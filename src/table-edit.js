// 表格源码操作：解析与增删行列 / 对齐 / 单元格替换（纯函数）
// 策略：解析 -> 操作 -> 整表重建，避免维护单元格级偏移

const ALIGN_MARK = { left: ':---', center: ':---:', right: '---:' };

/** 拆分一行单元格（处理 \| 转义与行内代码中的 |） */
export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > -1) { cur += s.slice(i, end + 1); i = end; continue; }
    }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** 解析表格，返回 { rows, aligns, colCount }；rows[0]=表头, rows[1]=对齐行, 其余为数据行 */
export function parseTable(src) {
  const rows = String(src).split('\n').filter((l) => l.trim())
    .map((l) => splitRow(l));
  if (rows.length < 2) return null;
  const colCount = Math.max(...rows.map((r) => r.length));
  const aligns = rows[1].map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  });
  return { rows, aligns, colCount };
}

function rebuild(p) {
  return p.rows.map((cells) => {
    const padded = Array.from({ length: p.colCount }, (_, i) => cells[i] ?? '');
    return '| ' + padded.join(' | ') + ' |';
  }).join('\n');
}

export function insertRow(src, dataRowIdx, dir) {
  const p = parseTable(src);
  if (!p) return src;
  const idx = Math.max(2, Math.min(p.rows.length, 2 + dataRowIdx + (dir === 'below' ? 1 : 0)));
  p.rows.splice(idx, 0, Array(p.colCount).fill(''));
  return rebuild(p);
}

export function deleteRow(src, dataRowIdx) {
  const p = parseTable(src);
  if (!p) return src;
  const idx = 2 + dataRowIdx;
  if (idx >= p.rows.length) return src;
  p.rows.splice(idx, 1);
  if (p.rows.length < 3) return ''; // 删掉最后一行数据 -> 只剩表头，整个表格删除
  return rebuild(p);
}

export function insertCol(src, colIdx, dir) {
  const p = parseTable(src);
  if (!p) return src;
  const idx = Math.max(0, Math.min(p.colCount, colIdx + (dir === 'right' ? 1 : 0)));
  for (const row of p.rows) row.splice(idx, 0, row === p.rows[1] ? '---' : '');
  p.colCount++;
  return rebuild(p);
}

export function deleteCol(src, colIdx) {
  const p = parseTable(src);
  if (!p) return src;
  if (colIdx >= p.colCount) return src;
  for (const row of p.rows) row.splice(colIdx, 1);
  p.colCount--;
  if (!p.colCount) return '';
  if (p.colCount === 1 && p.rows.length < 3) return ''; // 只剩一个单元格 -> 无意义，删除
  return rebuild(p);
}

export function setColAlign(src, colIdx, align) {
  const p = parseTable(src);
  if (!p) return src;
  const row = p.rows[1];
  if (colIdx >= row.length) return src;
  row[colIdx] = ALIGN_MARK[align] || '---';
  return rebuild(p);
}

/** 替换数据行单元格（rowIdx 为数据行 0-based） */
export function setCell(src, rowIdx, colIdx, text) {
  const p = parseTable(src);
  if (!p) return src;
  const row = p.rows[2 + rowIdx];
  if (!row) return src;
  while (row.length <= colIdx) row.push('');
  row[colIdx] = String(text ?? '').replace(/\|/g, '\\|');
  if (colIdx >= p.colCount) p.colCount = row.length;
  return rebuild(p);
}
