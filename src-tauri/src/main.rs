// InkFlow 桌面应用入口：Tauri Builder 装配 + 启动链路 + 冒烟/截图验证通道
// 对应 Electron main.cjs 的非 IPC 部分：窗口、单实例、启动参数文件、close 拦截、SMOKE/SHOT
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, WindowEvent};

use commands::MD_EXTS;

/* ---------------- 全局状态 ---------------- */

pub struct AppState {
    /// 启动参数/二次启动待打开的文件队列（渲染进程每开完一个会再报就绪）
    pub pending: Mutex<VecDeque<String>>,
    /// 渲染进程确认关闭后置位，on_window_event 放行真正的 close
    pub close_approved: AtomicBool,
    /// 截图模式：主题注入是否已完成（reload 后 renderer_ready 再次进入流程）
    pub themed: AtomicBool,
    /// 冒烟流程只跑一次
    pub smoke_started: AtomicBool,
    /// 启动参数携带的文件名（冒烟 openCheck 用）
    pub initial_files: Mutex<Vec<String>>,
}

fn is_smoke() -> bool {
    commands::is_env("INKFLOW_SMOKE", "1")
}
fn is_shot() -> bool {
    std::env::var("INKFLOW_SHOT").map(|v| !v.is_empty()).unwrap_or(false)
}

/* ---------------- 启动参数文件解析（右键「打开方式」/双击关联文件） ---------------- */

pub fn parse_file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    let mut out = Vec::new();
    for a in args {
        if a.is_empty() || a == "." || a.starts_with('-') {
            continue;
        }
        // 不用 canonicalize（Windows 会给出 \\?\ 前缀路径），仅做词法拼接
        let p = PathBuf::from(&a);
        let p = if p.is_absolute() { p } else { std::env::current_dir().map(|d| d.join(&p)).unwrap_or(p) };
        if !commands::has_ext(&p.to_string_lossy(), &MD_EXTS) {
            continue;
        }
        if std::fs::metadata(&p).map(|m| m.is_file()).unwrap_or(false) {
            out.push(p.to_string_lossy().into_owned());
        }
    }
    out
}

/* ---------------- 待打开文件下发 ---------------- */

pub fn emit_open(app: &tauri::AppHandle, p: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("app:open-request", p);
    }
}

fn flush_pending(app: &tauri::AppHandle) {
    let next = app.state::<AppState>().pending.lock().unwrap().pop_front();
    if let Some(p) = next {
        emit_open(app, p);
    }
}

/* ---------------- 冒烟通道（INKFLOW_SMOKE=1 + INKFLOW_SMOKE_DIR） ---------------- */

pub fn start_smoke(app: tauri::AppHandle) {
    let already = { app.state::<AppState>().smoke_started.swap(true, Ordering::SeqCst) };
    if already {
        return;
    }
    let open_name = app.state::<AppState>().initial_files.lock().unwrap().first().cloned();
    let smoke_dir = std::env::var("INKFLOW_SMOKE_DIR").ok().filter(|s| !s.is_empty());
    let has_files = open_name.is_some();
    std::thread::spawn(move || {
        // 等编辑器挂载 + 启动参数文件打开
        std::thread::sleep(Duration::from_millis(if has_files { 3000 } else { 1500 }));
        let open_check = open_name
            .map(|n| format!(" || window.InkFlow?.app?.name !== {}", serde_json::to_string(&n).unwrap_or_default()))
            .unwrap_or_default();
        let win = match app.get_webview_window("main") {
            Some(w) => w,
            None => {
                println!("SMOKE_RESULT FAIL");
                app.exit(1);
                return;
            }
        };
        let js = match &smoke_dir {
            Some(dir) => {
                let dj = serde_json::to_string(dir).unwrap_or_default();
                format!(
                    r#"(async () => {{
  const I = window.__TAURI__ && window.__TAURI__.core;
  if (!I) return;
  const report = (ok, d) => I.invoke('smoke_report', {{ ok, detail: d }}).catch(() => {{}});
  try {{
    if (typeof window.inkflowDesktop !== 'object') return report(false, 'no inkflowDesktop bridge');
    if (!document.querySelector('.cm-content')) return report(false, 'editor not mounted');
    if ({open_check_judge}) return report(false, 'startup file not opened, name=' + (window.InkFlow && window.InkFlow.app && window.InkFlow.app.name));
    const nodes = await I.invoke('fs_walk', {{ handle: {{ path: {dj} }}, depth: 0 }});
    if (!(Array.isArray(nodes) && nodes.length >= 2 && nodes.some((n) => n.kind === 'dir') && nodes.some((n) => n.kind === 'file'))) return report(false, 'fs_walk bad: ' + JSON.stringify(nodes));
    const fh = {{ kind: 'file', path: {dj} + '/a.md', name: 'a.md' }};
    const rd = await I.invoke('fs_read', {{ handle: fh }});
    const ok = await I.invoke('file_save', {{ handle: fh, text: rd.text + '\n原子保存验证', expectedMtime: rd.mtime }});
    if (!ok || ok.conflict) return report(false, 'save failed: ' + JSON.stringify(ok));
    const stale = await I.invoke('file_save', {{ handle: fh, text: '应被拦截', expectedMtime: rd.mtime }});
    report(!!(stale && stale.conflict === true), 'conflict check: ' + JSON.stringify(stale));
  }} catch (e) {{ report(false, 'EXC ' + (e && (e.message || e.toString()))); }}
}})()"#,
                    open_check_judge = if open_check.is_empty() { "false".to_string() } else { open_check.trim_start_matches(" || ").to_string() },
                    dj = dj
                )
            }
            None => format!(
                "(function(){{ const I = window.__TAURI__ && window.__TAURI__.core; if (!I) return; const ok = typeof window.inkflowDesktop === 'object' && !!document.querySelector('.cm-content'){open_check}; I.invoke('smoke_report', {{ ok }}).catch(function(){{}}); }})()"
            ),
        };
        let _ = win.eval(&js);
    });
}

/* ---------------- 截图通道（INKFLOW_SHOT=<png 路径>，可选 INKFLOW_THEME） ---------------- */

pub fn start_shot(app: tauri::AppHandle, shot_path: String) {
    std::thread::spawn(move || {
        let theme = std::env::var("INKFLOW_THEME").ok().filter(|s| !s.is_empty());
        let themed = app.state::<AppState>().themed.load(Ordering::SeqCst);
        let Some(win) = app.get_webview_window("main") else { return };
        // INKFLOW_THEME=<主题名>：先写入本地设置并刷新，reload 后 renderer_ready 会再次进入本流程
        if let Some(t) = theme.filter(|_| !themed) {
            app.state::<AppState>().themed.store(true, Ordering::SeqCst);
            let tj = serde_json::to_string(&t).unwrap_or_default();
            let js = format!(
                r#"(() => {{ try {{ const s = JSON.parse(localStorage.getItem('inkflow:settings') || '{{}}');
              s.theme = {tj};
              localStorage.setItem('inkflow:settings', JSON.stringify(s));
              location.reload(); }} catch (e) {{}} }})()"#
            );
            let _ = win.eval(&js);
            return;
        }
        // 欢迎页不进入截图：先关闭再等渲染稳定
        let _ = win.eval("(() => { try { window.InkFlow && window.InkFlow.dismissWelcome && window.InkFlow.dismissWelcome(); } catch (e) {} })()");
        std::thread::sleep(Duration::from_millis(2500));
        match capture_window_png(&win, Path::new(&shot_path)) {
            Ok(()) => {
                println!("SHOT_SAVED");
                app.exit(0);
            }
            Err(e) => {
                println!("SHOT_FAIL {e}");
                app.exit(1);
            }
        }
    });
}

/* ---------------- 窗口截图（Win32 PrintWindow，PW_RENDERFULLCONTENT 支持硬件合成内容） ---------------- */

fn capture_window_png(win: &tauri::WebviewWindow, out: &Path) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    // windows 0.58 把 PrintWindow 生成在 Xps 模块；PW_RENDERFULLCONTENT 在 WindowsAndMessaging
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, PW_RENDERFULLCONTENT};

    unsafe {
        let raw = win.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(raw.0);
        let mut rc = Default::default();
        GetClientRect(hwnd, &mut rc).map_err(|e| e.to_string())?;
        let w = (rc.right - rc.left).max(1);
        let h = (rc.bottom - rc.top).max(1);
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            return Err("GetDC 失败".into());
        }
        let mem = CreateCompatibleDC(hdc);
        let bmp = CreateCompatibleBitmap(hdc, w, h);
        let old = SelectObject(mem, HGDIOBJ::from(bmp));
        let mut result: Result<(), String> = Ok(());
        if !PrintWindow(hwnd, mem, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool() {
            result = Err("PrintWindow 失败".into());
        } else {
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h; // 自顶向下的行序
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            let mut buf = vec![0u8; w as usize * h as usize * 4];
            let copied = GetDIBits(
                mem,
                bmp,
                0,
                h as u32,
                Some(buf.as_mut_ptr() as _),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            if copied == 0 {
                result = Err("GetDIBits 失败".into());
            } else {
                // BGRA → RGBA，并补不透明 alpha
                for px in buf.chunks_exact_mut(4) {
                    px.swap(0, 2);
                    px[3] = 255;
                }
                match image::RgbaImage::from_raw(w as u32, h as u32, buf) {
                    Some(img) => {
                        if let Err(e) = img.save(out) {
                            result = Err(format!("保存截图失败: {e}"));
                        }
                    }
                    None => result = Err("图像缓冲无效".into()),
                }
            }
        }
        SelectObject(mem, old);
        let _ = DeleteObject(HGDIOBJ::from(bmp));
        let _ = DeleteDC(mem);
        let _ = ReleaseDC(None, hdc);
        result
    }
}

/* ---------------- 启动 ---------------- */

fn main() {
    let smoke = is_smoke();
    let shot = is_shot();

    let mut builder = tauri::Builder::default();

    // 单实例：再次用「打开方式」启动时把文件转交已有窗口（冒烟/截图模式跳过）
    if !smoke && !shot {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = parse_file_args(argv.iter().cloned());
            if !files.is_empty() {
                app.state::<AppState>().pending.lock().unwrap().extend(files);
            }
            flush_pending(app);
        }));
    }
    // 窗口状态记忆（冒烟模式跳过，与 Electron readWindowState 行为一致）
    if !smoke {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.window().show();
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 关闭先转发渲染进程（保存/丢弃/取消三选一），close_ready 后放行
                let app = window.app_handle();
                if !app.state::<AppState>().close_approved.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("app:before-close", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::folder_open,
            commands::folder_restore,
            commands::folder_close,
            commands::fs_walk,
            commands::fs_grep,
            commands::fs_read,
            commands::fs_stat,
            commands::fs_create,
            commands::fs_write_asset,
            commands::file_open,
            commands::file_save,
            commands::file_save_as,
            commands::download_file,
            commands::pdf_export,
            commands::renderer_ready,
            commands::close_ready,
            commands::smoke_report,
        ])
        .setup(|app| {
            let files = parse_file_args(std::env::args());
            let names: Vec<String> = files
                .iter()
                .map(|p| Path::new(p).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default())
                .collect();
            app.manage(AppState {
                pending: Mutex::new(files.into_iter().collect()),
                close_approved: AtomicBool::new(false),
                themed: AtomicBool::new(false),
                smoke_started: AtomicBool::new(false),
                initial_files: Mutex::new(names),
            });
            Ok(())
        });

    builder.run(tauri::generate_context!()).expect("InkFlow 启动失败");
}
