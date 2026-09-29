// src/dialogs.js —— 应用内对话框：提示条（toast）、通用确认（showConfirm）、通用输入（showPrompt）
// Electron 无 window.prompt，文件树新建文件等需要输入的场景统一走 showPrompt
import { $ } from './icons.js';

/* ---------------- 提示条 ---------------- */
let toastTimer = null;
// toast(msg, { type:'info'|'success'|'error'|'warn', duration }) —— 错误默认更久并带手动关闭
export function toast(msg, { type = 'info', duration = 1800 } = {}) {
  const el = $('#toast');
  el.classList.toggle('error', type === 'error');
  el.classList.toggle('warn', type === 'warn');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (type === 'error' || type === 'warn') {
    // 错误提示不自动消失，用户主动关闭
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '✕';
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭提示');
    close.onclick = () => { clearTimeout(toastTimer); el.classList.remove('show'); close.remove(); };
    el.appendChild(close);
  } else {
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }
}

/* ---------------- 通用确认对话框 ---------------- */
// showConfirm({ title, message, actions:[{label, value, kind}] }) -> Promise<value>
// Escape 视为取消（解析为第一个 value 为 'cancel' 的动作，否则最后一个动作）
let confirmResolve = null;
export function showConfirm({ title, message, actions = [{ label: '取消', value: 'cancel', kind: 'ghost' }] }) {
  if (confirmResolve) confirmResolve('cancel'); // 已有对话框：直接取消旧的
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $('#confirmTitle').textContent = title || '';
    $('#confirmMsg').textContent = message || '';
    $('#confirmMsg').classList.toggle('hidden', !message);
    const box = $('#confirmActions');
    box.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.kind || 'ghost');
      btn.textContent = a.label;
      btn.onclick = () => dismissConfirm(a.value);
      box.appendChild(btn);
    }
    $('#confirmOverlay').classList.remove('hidden');
    $('#confirmDlg').classList.remove('hidden');
    const first = box.querySelector('.primary') || box.querySelector('.btn');
    if (first) first.focus();
  });
}
function dismissConfirm(value) {
  $('#confirmOverlay').classList.add('hidden');
  $('#confirmDlg').classList.add('hidden');
  const r = confirmResolve; confirmResolve = null;
  if (r) r(value);
}

/* ---------------- 通用输入对话框 ---------------- */
// showPrompt({ title, message, value, placeholder, ok }) -> Promise<string|null>（取消返回 null）
let promptResolve = null;
export function showPrompt({ title, message = '', value = '', placeholder = '', ok = '确定' } = {}) {
  if (promptResolve) promptResolve(null); // 已有对话框：直接取消旧的
  return new Promise((resolve) => {
    promptResolve = resolve;
    $('#promptTitle').textContent = title || '';
    $('#promptMsg').textContent = message;
    $('#promptMsg').classList.toggle('hidden', !message);
    const input = $('#promptInput');
    input.value = value;
    input.placeholder = placeholder;
    $('#promptOk').textContent = ok;
    $('#promptOverlay').classList.remove('hidden');
    $('#promptDlg').classList.remove('hidden');
    input.focus();
    input.select();
  });
}
export function dismissPrompt(value) {
  $('#promptOverlay').classList.add('hidden');
  $('#promptDlg').classList.add('hidden');
  const r = promptResolve; promptResolve = null;
  if (r) r(value);
}

// 对话框的 Escape 关闭（模块加载时注册一次，与原先在 main.js 顶层注册的时机一致）
document.addEventListener('keydown', (e) => {
  if (promptResolve && e.key === 'Escape') { e.preventDefault(); dismissPrompt(null); return; }
  if (!confirmResolve) return;
  if (e.key === 'Escape') { e.preventDefault(); dismissConfirm('cancel'); }
});
