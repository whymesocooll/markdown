// Turndown 懒加载共享模块（富文本 HTML → Markdown，含 GFM 表格/删除线/任务列表）
let promise = null;

export function loadTurndown() {
  if (!promise) {
    promise = Promise.all([import('turndown'), import('turndown-plugin-gfm')]).then(([td, gfm]) => {
      const TurndownService = td.default || td;
      const svc = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      const gfmPlugin = gfm.default || gfm;
      if (gfmPlugin) svc.use(gfmPlugin);
      return svc;
    }).catch((e) => { promise = null; throw e; }); // 加载失败可重试
  }
  return promise;
}
