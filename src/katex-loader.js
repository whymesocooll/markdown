// KaTeX 懒加载共享模块（Widget / 行内渲染 / 导出共用同一实例，避免进入启动包）
let promise = null;
let instance = null;

export function loadKatex() {
  if (!promise) {
    promise = import('katex').then((m) => {
      instance = m.default || m;
      return instance;
    }).catch((e) => { promise = null; throw e; }); // 加载失败可重试
  }
  return promise;
}

/** 已加载完成则同步返回实例，否则返回 null 并在后台触发加载（调用方按需降级显示源码） */
export function katexNow() {
  if (!instance && !promise) loadKatex();
  return instance;
}
