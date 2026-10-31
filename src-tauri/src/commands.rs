// InkFlow 桌面命令层：渲染进程 IPC 的全部实现（移植自 Electron main.cjs）
// 语义与 main.cjs 逐条对齐：句柄 {kind,path,name}、mtime 冲突检测、原子写、grep 限额等。
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::AppState;

/* ---------------- 句柄：与浏览器 File System Access handle 同构 ---------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Handle {
    #[serde(default)]
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub name: String,
}

fn basename(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}
fn dir_handle(p: PathBuf) -> Handle {
    Handle { kind: "directory".into(), name: basename(&p), path: p.to_string_lossy().into_owned() }
}
fn file_handle(p: PathBuf) -> Handle {
    Handle { kind: "file".into(), name: basename(&p), path: p.to_string_lossy().into_owned() }
}

fn to_path_buf(f: FilePath) -> PathBuf {
    match f {
        FilePath::Path(p) => p,
        FilePath::Url(u) => u.to_file_path().unwrap_or_default(),
    }
}

/* ---------------- 返回类型（字段名与 main.cjs 返回的 JSON 完全一致） ---------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub kind: &'static str, // "dir" | "file"
    pub handle: Handle,
    pub depth: f64,
}

#[derive(Serialize)]
pub struct GrepHit {
    pub name: String,
    pub path: String, // 相对目录的 POSIX 路径
    pub line: usize,
    pub text: String,
    pub handle: Handle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub name: String,
    pub text: String,
    pub mtime: f64,
    pub handle: Handle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSuccess {
    pub name: String,
    pub mtime: f64,
    pub handle: Handle,
}

/// file_save 的返回：成功或 mtime 冲突（JS 侧按 res.conflict 判断）
#[derive(Serialize)]
#[serde(untagged, rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved(SaveSuccess),
    Conflict { conflict: bool, current_mtime: f64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatResult {
    pub exists: bool,
    pub is_file: bool,
    pub mtime: Option<f64>,
}

/// pdf_export 的返回：{ok:true,path} | {ok:false,reason}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/* ---------------- 常量与文件工具 ---------------- */

pub const MAX_DEPTH: f64 = 8.0;
pub const MD_EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];
const CREATE_EXTS: [&str; 3] = ["md", "markdown", "txt"];

pub fn has_ext(name: &str, exts: &[&str]) -> bool {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .map(|e| exts.contains(&e.as_str()))
        .unwrap_or(false)
}

fn mtime_ms(p: &Path) -> std::io::Result<f64> {
    let t = std::fs::metadata(p)?.modified()?;
    Ok(t.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO).as_secs_f64() * 1000.0)
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

static ATOMIC_SEQ: AtomicU64 = AtomicU64::new(0);

/// 原子写：临时文件 + rename（保留 Electron 的 .inkflow-tmp-* 命名约定）
fn atomic_write(target: &Path, text: &str) -> std::io::Result<()> {
    let mut tmp_name = target.as_os_str().to_os_string();
    tmp_name.push(format!(
        ".inkflow-tmp-{}-{}-{}",
        std::process::id(),
        now_ms(),
        ATOMIC_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = PathBuf::from(tmp_name);
    std::fs::write(&tmp, text)?;
    match std::fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/* ---------------- 文件夹路径持久化（userData/folder-path.json，兼容 Electron 旧位置） ---------------- */

fn folder_store(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("folder-path.json"))
}
fn legacy_folder_store() -> Option<PathBuf> {
    // Electron userData 默认 %APPDATA%/inkflow；Tauri 用 identifier 目录，读到旧文件后迁移
    dirs::data_dir().map(|d| d.join("inkflow").join("folder-path.json"))
}
fn read_folder_store(app: &AppHandle) -> Option<PathBuf> {
    let new = folder_store(app)?;
    if let Ok(s) = std::fs::read_to_string(&new) {
        if let Ok(p) = serde_json::from_str::<String>(&s) {
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    let legacy = legacy_folder_store()?;
    let s = std::fs::read_to_string(&legacy).ok()?;
    let p = serde_json::from_str::<String>(&s).ok()?;
    if p.is_empty() {
        return None;
    }
    if let Some(parent) = new.parent() {
        let _ = std::fs::create_dir_all(parent);
        let _ = std::fs::write(&new, &s);
    }
    Some(PathBuf::from(p))
}

/* ---------------- 文件夹命令 ---------------- */

#[tauri::command]
pub async fn folder_open(app: AppHandle) -> Result<Option<Handle>, String> {
    let win = app.get_webview_window("main");
    let app2 = app.clone(); // 闭包外还要写 folder-path.json
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut b = app2.dialog().file().set_title("打开文件夹");
        if let Some(w) = &win {
            b = b.set_parent(w);
        }
        b.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(f) = picked else { return Ok(None) };
    let p = to_path_buf(f);
    if p.as_os_str().is_empty() {
        return Ok(None);
    }
    if let Some(store) = folder_store(&app) {
        if let Some(parent) = store.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&store, serde_json::to_string(&p.to_string_lossy()).unwrap_or_default());
    }
    Ok(Some(dir_handle(p)))
}

#[tauri::command]
pub async fn folder_restore(app: AppHandle) -> Result<Option<Handle>, String> {
    let Some(p) = read_folder_store(&app) else { return Ok(None) };
    match std::fs::metadata(&p) {
        Ok(m) if m.is_dir() => Ok(Some(dir_handle(p))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn folder_close(app: AppHandle) -> Result<bool, String> {
    if let Some(s) = folder_store(&app) {
        let _ = std::fs::remove_file(s);
    }
    if let Some(s) = legacy_folder_store() {
        let _ = std::fs::remove_file(s);
    }
    Ok(true)
}

/* ---------------- 文件树遍历与全文搜索 ---------------- */

fn walk_dir(dir: &Path, depth: f64) -> Vec<TreeNode> {
    if depth > MAX_DEPTH {
        return vec![];
    }
    let mut out = Vec::new();
    // 无权限目录跳过（与 Electron 一致）
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            out.push(TreeNode { name, kind: "dir", handle: dir_handle(p), depth });
        } else if ft.is_file() && has_ext(&name, &MD_EXTS) {
            out.push(TreeNode { name, kind: "file", handle: file_handle(p), depth });
        }
    }
    // 目录在前；名称按「小写优先、原样兜底」两段比较，近似 Electron 的 zh-Hans-CN localeCompare
    out.sort_by(|a, b| {
        let ka = a.kind != "dir";
        let kb = b.kind != "dir";
        ka.cmp(&kb).then_with(|| {
            a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name))
        })
    });
    out
}

#[tauri::command]
pub async fn fs_walk(handle: Handle, depth: Option<f64>) -> Result<Vec<TreeNode>, String> {
    Ok(walk_dir(Path::new(&handle.path), depth.unwrap_or(0.0)))
}

struct GrepLimits {
    scanned: usize,
}

fn grep_walk(
    dir: &Path,
    prefix: &str,
    depth: f64,
    q: &str,
    hits: &mut Vec<GrepHit>,
    lim: &mut GrepLimits,
) {
    if depth > MAX_DEPTH || lim.scanned >= 500 || hits.len() >= 200 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if hits.len() >= 200 || lim.scanned >= 500 {
            return;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            grep_walk(&p, &rel, depth + 1.0, q, hits, lim);
        } else if ft.is_file() && has_ext(&name, &MD_EXTS) {
            lim.scanned += 1;
            // 单文件 2MB 上限，防止巨型文件卡死
            if e.metadata().map(|m| m.len()).unwrap_or(0) > 2 * 1024 * 1024 {
                continue;
            }
            let Ok(bytes) = std::fs::read(&p) else { continue };
            let text = String::from_utf8_lossy(&bytes);
            let mut per_file = 0;
            for (i, line) in text.lines().enumerate() {
                if hits.len() >= 200 {
                    return;
                }
                if line.to_lowercase().contains(q) {
                    hits.push(GrepHit {
                        name: name.clone(),
                        path: rel.clone(),
                        line: i + 1,
                        text: line.chars().take(200).collect(),
                        handle: file_handle(p.clone()),
                    });
                    per_file += 1;
                    if per_file >= 5 {
                        break;
                    }
                }
            }
        }
    }
}

/// 文件夹全文搜索：每文件最多 5 条、共 200 条、单文件 2MB、深度 8 层
#[tauri::command]
pub async fn fs_grep(dir_path: String, query: String) -> Result<Vec<GrepHit>, String> {
    let mut hits = Vec::new();
    if dir_path.is_empty() || query.is_empty() {
        return Ok(hits);
    }
    let q = query.to_lowercase();
    let mut lim = GrepLimits { scanned: 0 };
    grep_walk(Path::new(&dir_path), "", 0.0, &q, &mut hits, &mut lim);
    Ok(hits)
}

/* ---------------- 文件读写 ---------------- */

#[tauri::command]
pub async fn fs_read(handle: Handle) -> Result<ReadResult, String> {
    let p = PathBuf::from(&handle.path);
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let mtime = mtime_ms(&p).map_err(|e| e.to_string())?;
    // name 兜底：调用方可能只传 path（旧 desktop.js 就漏传了 name）
    let name = if handle.name.is_empty() { basename(&p) } else { handle.name.clone() };
    Ok(ReadResult { name, text, mtime, handle })
}

/// 供渲染层判断最近文件是否仍存在（不存在也返回 exists:false，永不 reject）
#[tauri::command]
pub async fn fs_stat(path: String) -> Result<StatResult, String> {
    match std::fs::metadata(&path) {
        Ok(m) => Ok(StatResult {
            exists: true,
            is_file: m.is_file(),
            mtime: mtime_ms(Path::new(&path)).ok(),
        }),
        Err(_) => Ok(StatResult { exists: false, is_file: false, mtime: None }),
    }
}

#[tauri::command]
pub async fn fs_create(handle: Handle, name: String) -> Result<Option<Handle>, String> {
    let mut n = name;
    if !has_ext(&n, &CREATE_EXTS) {
        n.push_str(".md");
    }
    let p = Path::new(&handle.path).join(&n);
    // create_new 等价于 Node 的 flag:'wx'：已存在或其他错误 → null
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
        Ok(_) => Ok(Some(file_handle(p))),
        Err(_) => Ok(None),
    }
}

/// 粘贴/拖入的图片落盘：<dir>/assets/ 内去重命名，返回相对 dirPath 的 POSIX 路径；失败 null（渲染层回退 base64）
#[tauri::command]
pub async fn fs_write_asset(
    dir_path: String,
    file_name: String,
    data_url: String,
) -> Result<Option<String>, String> {
    if dir_path.is_empty() || !data_url.starts_with("data:") {
        return Ok(None);
    }
    let Some((_, payload)) = data_url.split_once(";base64,") else { return Ok(None) };
    let clean: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&clean) else {
        return Ok(None);
    };
    let dir = Path::new(&dir_path).join("assets");
    if std::fs::create_dir_all(&dir).is_err() {
        return Ok(None);
    }
    let ext = Path::new(&file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| ".png".into());
    let base = Path::new(&file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "image".into());
    let mut name = format!("{base}{ext}");
    let mut n = 1;
    while dir.join(&name).exists() {
        name = format!("{base}-{n}{ext}");
        n += 1;
    }
    let target = dir.join(&name);
    if std::fs::write(&target, &bytes).is_err() {
        return Ok(None);
    }
    let rel = target.strip_prefix(&dir_path).map_err(|_| "路径异常".to_string())?;
    Ok(Some(rel.to_string_lossy().replace('\\', "/")))
}

/* ---------------- 文件打开/保存/另存/下载 ---------------- */

#[tauri::command]
pub async fn file_open(app: AppHandle) -> Result<Option<ReadResult>, String> {
    let win = app.get_webview_window("main");
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut b = app
            .dialog()
            .file()
            .set_title("打开 Markdown 文件")
            .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"]);
        if let Some(w) = &win {
            b = b.set_parent(w);
        }
        b.blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(f) = picked else { return Ok(None) };
    let p = to_path_buf(f);
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let mtime = mtime_ms(&p).map_err(|e| e.to_string())?;
    Ok(Some(ReadResult { name: basename(&p), text, mtime, handle: file_handle(p) }))
}

#[tauri::command]
pub async fn file_save(
    handle: Handle,
    text: String,
    expected_mtime: Option<f64>,
) -> Result<SaveOutcome, String> {
    let p = PathBuf::from(&handle.path);
    // mtime 冲突检测：与 Electron 相同的 0.5ms 容差
    if let Some(exp) = expected_mtime {
        let cur = mtime_ms(&p).map_err(|e| e.to_string())?;
        if (cur - exp).abs() > 0.5 {
            return Ok(SaveOutcome::Conflict { conflict: true, current_mtime: cur });
        }
    }
    atomic_write(&p, &text).map_err(|e| e.to_string())?;
    let mtime = mtime_ms(&p).map_err(|e| e.to_string())?;
    let name = if handle.name.is_empty() { basename(&p) } else { handle.name.clone() };
    Ok(SaveOutcome::Saved(SaveSuccess { name, mtime, handle }))
}

#[tauri::command]
pub async fn file_save_as(
    app: AppHandle,
    name: String,
    text: String,
) -> Result<Option<SaveSuccess>, String> {
    let mut suggested = name;
    if !has_ext(&suggested, &CREATE_EXTS) {
        suggested.push_str(".md");
    }
    let win = app.get_webview_window("main");
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut b = app
            .dialog()
            .file()
            .set_title("另存为")
            .set_file_name(suggested.clone())
            .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"]);
        if let Some(w) = &win {
            b = b.set_parent(w);
        }
        b.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(f) = picked else { return Ok(None) };
    let p = to_path_buf(f);
    atomic_write(&p, &text).map_err(|e| e.to_string())?;
    let mtime = mtime_ms(&p).map_err(|e| e.to_string())?;
    Ok(Some(SaveSuccess { name: basename(&p), mtime, handle: file_handle(p) }))
}

/// 导出 HTML/MD 落盘：替代桌面版 Blob URL 下载（WebView2 下载行为与 Electron 不同）
#[tauri::command]
pub async fn download_file(app: AppHandle, name: String, text: String) -> Result<Option<String>, String> {
    let win = app.get_webview_window("main");
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut b = app.dialog().file().set_file_name(name.clone());
        if let Some(w) = &win {
            b = b.set_parent(w);
        }
        b.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(f) = picked else { return Ok(None) };
    let p = to_path_buf(f);
    std::fs::write(&p, text).map_err(|e| e.to_string())?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/* ---------------- PDF 导出（headless Edge sidecar） ---------------- */

const EDGE_X86: &str = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
const EDGE_X64: &str = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe";

fn find_edge() -> Option<&'static str> {
    [EDGE_X86, EDGE_X64].iter().copied().find(|p| Path::new(p).is_file())
}

/// 临时路径自检：本程序在 temp_dir 下以「inkflow- 前缀 + 时间戳」自建，
/// 只应包含安全字符；不含用户输入。作为防御性校验再过一道。
fn is_safe_generated_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '\\' | '/' | ':' | '.' | '_' | '-'))
}

/// 组装 Edge 命令行参数。全部为固定开关 + 自建临时路径，不含任何用户输入；
/// Chromium 系 CLI 要求开关与值同 token（--print-to-pdf=<路径>），用 OsString 拼接。
fn edge_print_args(tmp_pdf: &Path, profile: &Path, url: &str) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--disable-extensions",
        "--no-pdf-header-footer",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    let mut pdf_arg = OsString::from("--print-to-pdf=");
    pdf_arg.push(tmp_pdf.as_os_str());
    args.push(pdf_arg);
    let mut profile_arg = OsString::from("--user-data-dir=");
    profile_arg.push(profile.as_os_str());
    args.push(profile_arg);
    args.push(OsString::from(url));
    args
}

/// 启动 headless Edge 渲染临时 HTML → PDF。程序路径严格限定在上面两个字面量允许列表内；
/// std::process::Command 直接把 argv 传给 CreateProcess，不经 shell 解释，无命令拼接注入面。
fn spawn_edge_print_to_pdf(edge: &'static str, args: Vec<OsString>) -> Result<std::process::Child, String> {
    let mut cmd = match edge {
        EDGE_X86 => std::process::Command::new(EDGE_X86),
        EDGE_X64 => std::process::Command::new(EDGE_X64),
        _ => return Err("Edge 可执行文件路径不在允许列表内".into()),
    };
    cmd.args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn().map_err(|e| format!("启动 Edge 失败: {e}"))
}

/// headless Edge 渲染临时 HTML → PDF 文件；返回 PDF 是否生成成功
fn generate_pdf(edge: &'static str, tmp_html: &Path, tmp_pdf: &Path, profile: &Path) -> Result<bool, String> {
    if ![tmp_html, tmp_pdf, profile].iter().all(|p| is_safe_generated_path(p)) {
        return Err("临时路径包含异常字符，已中止导出".into());
    }
    let url = tauri::Url::from_file_path(tmp_html).map_err(|_| "临时 HTML 路径无效".to_string())?;
    let mut child = spawn_edge_print_to_pdf(edge, edge_print_args(tmp_pdf, profile, url.as_str()))?;
    // 最多等待 60s
    for _ in 0..600 {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("等待 Edge 失败: {e}")),
        }
    }
    if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
        let _ = child.kill();
        return Err("PDF 导出超时".into());
    }
    Ok(std::fs::metadata(tmp_pdf).map(|m| m.len() > 0).unwrap_or(false))
}

/// 导出 PDF：{ok:true,path} | null（取消）| {ok:false,reason}
/// 测试钩子：INKFLOW_PDF_DIR=<目录> 时跳过对话框直接写入该目录
#[tauri::command]
pub async fn pdf_export(
    app: AppHandle,
    html: String,
    filename: Option<String>,
) -> Result<Option<PdfOutcome>, String> {
    let safe: String = filename
        .unwrap_or_else(|| "document.pdf".into())
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let ts = now_ms();
    let tmp_html = std::env::temp_dir().join(format!("inkflow-pdf-{ts}.html"));
    let tmp_pdf = std::env::temp_dir().join(format!("inkflow-pdf-{ts}.pdf"));
    let profile = std::env::temp_dir().join(format!("inkflow-edge-{ts}"));
    std::fs::write(&tmp_html, &html).map_err(|e| e.to_string())?;

    let gen = {
        let edge = find_edge();
        let th = tmp_html.clone();
        let tp = tmp_pdf.clone();
        let pr = profile.clone();
        tauri::async_runtime::spawn_blocking(move || match edge {
            Some(e) => generate_pdf(e, &th, &tp, &pr),
            None => Err("未找到 Microsoft Edge，无法导出 PDF".into()),
        })
        .await
        .map_err(|e| e.to_string())?
    };

    let outcome = if let Err(reason) = gen {
        Some(PdfOutcome { ok: false, path: None, reason: Some(reason) })
    } else if !gen.unwrap_or(false) {
        Some(PdfOutcome { ok: false, path: None, reason: Some("生成的 PDF 为空".into()) })
    } else {
        match std::env::var("INKFLOW_PDF_DIR") {
            Ok(d) if !d.is_empty() => {
                let target = Path::new(&d).join(&safe);
                match std::fs::copy(&tmp_pdf, &target) {
                    Ok(_) => Some(PdfOutcome {
                        ok: true,
                        path: Some(target.to_string_lossy().into_owned()),
                        reason: None,
                    }),
                    Err(e) => Some(PdfOutcome { ok: false, path: None, reason: Some(e.to_string()) }),
                }
            }
            _ => {
                let win = app.get_webview_window("main");
                let picked = tauri::async_runtime::spawn_blocking(move || {
                    let mut b = app
                        .dialog()
                        .file()
                        .set_title("导出 PDF")
                        .set_file_name(safe.clone())
                        .add_filter("PDF", &["pdf"]);
                    if let Some(w) = &win {
                        b = b.set_parent(w);
                    }
                    b.blocking_save_file()
                })
                .await
                .map_err(|e| e.to_string())?;
                match picked {
                    None => None, // 取消
                    Some(f) => {
                        let target = to_path_buf(f);
                        match std::fs::copy(&tmp_pdf, &target) {
                            Ok(_) => Some(PdfOutcome {
                                ok: true,
                                path: Some(target.to_string_lossy().into_owned()),
                                reason: None,
                            }),
                            Err(e) => {
                                Some(PdfOutcome { ok: false, path: None, reason: Some(e.to_string()) })
                            }
                        }
                    }
                }
            }
        }
    };

    let _ = std::fs::remove_file(&tmp_html);
    let _ = std::fs::remove_file(&tmp_pdf);
    let _ = std::fs::remove_dir_all(&profile);
    Ok(outcome)
}

/* ---------------- 生命周期命令 ---------------- */

/// 渲染进程就绪：下发启动参数里的待打开文件，并触发冒烟/截图流程
#[tauri::command]
pub async fn renderer_ready(app: AppHandle) -> Result<(), String> {
    let next = { app.state::<AppState>().pending.lock().unwrap().pop_front() };
    if let Some(p) = next {
        crate::emit_open(&app, p);
    }
    if is_env("INKFLOW_SMOKE", "1") {
        crate::start_smoke(app);
    } else if let Ok(shot) = std::env::var("INKFLOW_SHOT") {
        if !shot.is_empty() {
            crate::start_shot(app, shot);
        }
    }
    Ok(())
}

/// 关闭确认完毕：置标记后真正关窗（on_window_event 放行）
#[tauri::command]
pub async fn close_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    app.state::<AppState>().close_approved.store(true, Ordering::SeqCst);
    let _ = window.close();
    Ok(())
}

/// 冒烟脚本回传结果：打印 SMOKE_RESULT 后退出（供 test/desktop-smoke.mjs 校验）；detail 用于失败定位
#[tauri::command]
pub async fn smoke_report(app: AppHandle, ok: bool, detail: Option<String>) -> Result<(), String> {
    if let Some(d) = detail {
        println!("SMOKE_DETAIL {d}");
    }
    println!("SMOKE_RESULT {}", if ok { "PASS" } else { "FAIL" });
    app.exit(if ok { 0 } else { 1 });
    Ok(())
}

pub fn is_env(key: &str, val: &str) -> bool {
    std::env::var(key).as_deref() == Ok(val)
}
