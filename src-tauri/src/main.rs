use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, Size, WebviewWindow, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

const SEARCH_WIDTH: f64 = 840.0;
const SEARCH_HEIGHT: f64 = 560.0;
const SETTINGS_WIDTH: f64 = 1040.0;
const SETTINGS_HEIGHT: f64 = 720.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hotkey {
    key: String,
    modifiers: Vec<String>,
}

impl Default for Hotkey {
    fn default() -> Self {
        Self {
            key: "Space".to_string(),
            modifiers: vec!["option".to_string()],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    key: String,
    value: String,
    #[serde(default = "default_entry_kind")]
    kind: String,
    #[serde(default)]
    source_id: String,
    #[serde(default)]
    source_path: String,
    #[serde(default)]
    name: String,
}

fn default_entry_kind() -> String {
    "regular".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectorySource {
    #[serde(default)]
    id: String,
    path: String,
    #[serde(default)]
    last_prefix: String,
    #[serde(default = "default_expanded")]
    expanded: bool,
}

fn default_expanded() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceGroup {
    id: String,
    path: String,
    last_prefix: String,
    expanded: bool,
    missing: bool,
    snippets: Vec<Entry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    hotkey: Hotkey,
    theme: String,
    entries: Vec<Entry>,
    recent_sources: Vec<DirectorySource>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: Hotkey::default(),
            theme: "light".to_string(),
            entries: Vec::new(),
            recent_sources: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    config: Config,
    effective_entries: Vec<Entry>,
    source_groups: Vec<SourceGroup>,
    config_path: String,
    hotkey_accelerator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShownPayload {
    route: String,
}

#[derive(Debug, Clone)]
struct FrontmostApp {
    name: String,
    bundle_id: String,
}

#[derive(Debug)]
struct AppData {
    config: Config,
    config_path: PathBuf,
    undo_entries: Option<Vec<Entry>>,
    is_visible: bool,
    suppress_blur_hide: bool,
    last_frontmost_app: Option<FrontmostApp>,
    last_window_position: Option<PhysicalPosition<i32>>,
}

impl AppData {
    fn new() -> Self {
        Self {
            config: Config::default(),
            config_path: default_config_path(),
            undo_entries: None,
            is_visible: false,
            suppress_blur_hide: false,
            last_frontmost_app: None,
            last_window_position: None,
        }
    }
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn default_config_path() -> PathBuf {
    if let Ok(path) = env::var("SS_CONFIG_PATH") {
        return PathBuf::from(path);
    }
    default_config_path_for_home(home_dir())
}

fn default_config_path_for_home(home: PathBuf) -> PathBuf {
    home
        .join("Library")
        .join("Application Support")
        .join("skill-spotlight")
        .join("config.json")
}

fn legacy_config_path_for_home(home: PathBuf) -> PathBuf {
    home
        .join("Library")
        .join("Application Support")
        .join("skillspotlight-tauri")
        .join("config.json")
}

fn migrate_legacy_config_if_needed(config_path: &Path, legacy_path: &Path) {
    if config_path.exists() || !legacy_path.exists() {
        return;
    }
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::rename(legacy_path, config_path).is_err() {
        let _ = fs::copy(legacy_path, config_path);
    }
}

fn sanitize_config(config: Config) -> Config {
    let mut clean = Config::default();
    clean.hotkey = Hotkey {
        key: if config.hotkey.key.is_empty() {
            "Space".to_string()
        } else {
            config.hotkey.key
        },
        modifiers: config
            .hotkey
            .modifiers
            .into_iter()
            .map(|item| item.to_string())
            .collect(),
    };
    clean.theme = if config.theme == "dark" {
        "dark".to_string()
    } else {
        "light".to_string()
    };
    clean.entries = config
        .entries
        .into_iter()
        .filter_map(|entry| {
            let key = entry.key;
            if key.is_empty() {
                return None;
            }
            Some(Entry {
                key,
                value: entry.value,
                kind: if entry.kind == "directory" {
                    "directory".to_string()
                } else {
                    "regular".to_string()
                },
                source_id: entry.source_id,
                source_path: entry.source_path,
                name: entry.name,
            })
        })
        .collect();
    clean.recent_sources = config
        .recent_sources
        .into_iter()
        .enumerate()
        .filter_map(|(index, source)| {
            if source.path.is_empty() {
                return None;
            }
            let id = if source.id.is_empty() {
                format!(
                    "source-{}-{}",
                    index,
                    source
                        .path
                        .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
                )
            } else {
                source.id
            };
            Some(DirectorySource {
                id,
                path: source.path,
                last_prefix: normalize_prefix(&source.last_prefix),
                expanded: source.expanded,
            })
        })
        .collect();
    clean
}

fn load_config_into(data: &mut AppData) {
    data.config_path = default_config_path();
    if env::var("SS_CONFIG_PATH").is_err() && !data.config_path.exists() {
        let legacy_path = legacy_config_path_for_home(home_dir());
        migrate_legacy_config_if_needed(&data.config_path, &legacy_path);
    }
    match fs::read_to_string(&data.config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Config>(&raw).ok())
    {
        Some(config) => {
            data.config = sanitize_config(config);
        }
        None => {
            if data.config_path.exists() {
                let backup = data
                    .config_path
                    .with_extension(format!("json.bak-{}", unix_millis()));
                let _ = fs::copy(&data.config_path, backup);
            }
            data.config = Config::default();
            let _ = write_config(&data.config_path, &data.config);
        }
    }
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn write_config(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn payload_from(data: &AppData) -> StatePayload {
    StatePayload {
        config: data.config.clone(),
        effective_entries: get_effective_entries(&data.config),
        source_groups: get_source_groups(&data.config),
        config_path: data.config_path.to_string_lossy().to_string(),
        hotkey_accelerator: hotkey_to_accelerator(&data.config.hotkey),
    }
}

fn emit_state(app: &AppHandle) {
    let payload = {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        payload_from(&data)
    };
    let _ = app.emit_to("main", "state", payload);
}

fn save_and_emit(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        write_config(&data.config_path, &data.config)?;
    }
    emit_state(app);
    Ok(())
}

fn expand_home(input: &str) -> PathBuf {
    if input == "~" {
        return home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(input)
}

fn normalize_prefix(prefix: &str) -> String {
    prefix.trim().to_string()
}

fn scan_directory_entries(source: &DirectorySource) -> Vec<Entry> {
    let absolute_dir = expand_home(&source.path);
    let children = match fs::read_dir(&absolute_dir) {
        Ok(children) => children,
        Err(_) => return Vec::new(),
    };

    let mut paths: Vec<_> = children.filter_map(Result::ok).collect();
    paths.sort_by_key(|entry| entry.file_name());

    paths
        .into_iter()
        .filter_map(|child| {
            let file_name = child.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') {
                return None;
            }
            let path = child.path();
            let name = path
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or(file_name);
            let value = fs::canonicalize(&path)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            Some(Entry {
                key: format!("{}{}", normalize_prefix(&source.last_prefix), name),
                value,
                kind: "directory".to_string(),
                source_id: source.id.clone(),
                source_path: source.path.clone(),
                name,
            })
        })
        .collect()
}

fn get_source_groups(config: &Config) -> Vec<SourceGroup> {
    config
        .recent_sources
        .iter()
        .map(|source| {
            let snippets = config
                .entries
                .iter()
                .filter(|entry| entry.kind == "directory" && entry.source_id == source.id)
                .cloned()
                .collect();
            SourceGroup {
                id: source.id.clone(),
                path: source.path.clone(),
                last_prefix: source.last_prefix.clone(),
                expanded: source.expanded,
                missing: false,
                snippets,
            }
        })
        .collect()
}

fn get_effective_entries(config: &Config) -> Vec<Entry> {
    config.entries.clone()
}

fn upsert_directory_source(config: &Config, source: DirectorySource) -> Config {
    let source_id = if source.id.is_empty() {
        format!("source-{}", unix_millis())
    } else {
        source.id
    };
    let next_source = DirectorySource {
        id: source_id.clone(),
        path: source.path,
        last_prefix: normalize_prefix(&source.last_prefix),
        expanded: source.expanded,
    };
    let scanned = scan_directory_entries(&next_source);
    let mut recent_sources = vec![next_source.clone()];
    recent_sources.extend(
        config
            .recent_sources
            .iter()
            .filter(|item| item.id != next_source.id && item.path != next_source.path)
            .cloned(),
    );
    recent_sources.truncate(12);

    let entries = config
        .entries
        .iter()
        .filter(|entry| entry.kind != "directory" || entry.source_id != source_id)
        .cloned()
        .chain(scanned)
        .collect();

    Config {
        hotkey: config.hotkey.clone(),
        theme: config.theme.clone(),
        entries,
        recent_sources,
    }
}

fn update_directory_source(config: &Config, source: DirectorySource) -> Config {
    let previous = config
        .recent_sources
        .iter()
        .find(|item| item.id == source.id);
    let next_source = DirectorySource {
        id: source.id,
        path: if source.path.is_empty() {
            previous.map(|item| item.path.clone()).unwrap_or_default()
        } else {
            source.path
        },
        last_prefix: normalize_prefix(&source.last_prefix),
        expanded: source.expanded,
    };

    let mut recent_sources = vec![next_source.clone()];
    recent_sources.extend(
        config
            .recent_sources
            .iter()
            .filter(|item| item.id != next_source.id)
            .cloned(),
    );

    let entries = config
        .entries
        .iter()
        .map(|entry| {
            if entry.kind != "directory" || entry.source_id != next_source.id {
                return entry.clone();
            }
            let name = if entry.name.is_empty() {
                Path::new(&entry.value)
                    .file_stem()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default()
            } else {
                entry.name.clone()
            };
            Entry {
                key: format!("{}{}", next_source.last_prefix, name),
                source_path: next_source.path.clone(),
                name,
                ..entry.clone()
            }
        })
        .collect();

    Config {
        hotkey: config.hotkey.clone(),
        theme: config.theme.clone(),
        entries,
        recent_sources,
    }
}

fn remove_directory_source(config: &Config, source_id: &str) -> Config {
    Config {
        hotkey: config.hotkey.clone(),
        theme: config.theme.clone(),
        entries: config
            .entries
            .iter()
            .filter(|entry| entry.kind != "directory" || entry.source_id != source_id)
            .cloned()
            .collect(),
        recent_sources: config
            .recent_sources
            .iter()
            .filter(|source| source.id != source_id)
            .cloned()
            .collect(),
    }
}

fn hotkey_to_accelerator(hotkey: &Hotkey) -> String {
    let mut parts = Vec::new();
    for modifier in &hotkey.modifiers {
        match modifier.as_str() {
            "command" => parts.push("Command".to_string()),
            "option" => parts.push("Alt".to_string()),
            "control" => parts.push("Control".to_string()),
            "shift" => parts.push("Shift".to_string()),
            _ => {}
        }
    }
    parts.push(if hotkey.key.is_empty() {
        "Space".to_string()
    } else {
        hotkey.key.clone()
    });
    parts.join("+")
}

fn accelerator_to_hotkey(accelerator: &str) -> Hotkey {
    let mut parts: Vec<String> = accelerator
        .split('+')
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect();
    let key = parts.pop().unwrap_or_else(|| "Space".to_string());
    let modifiers = parts
        .into_iter()
        .map(|part| match part.to_lowercase().as_str() {
            "cmd" | "command" | "commandorcontrol" => "command".to_string(),
            "alt" | "option" => "option".to_string(),
            "ctrl" | "control" => "control".to_string(),
            "shift" => "shift".to_string(),
            other => other.to_string(),
        })
        .collect();
    Hotkey { key, modifiers }
}

fn run_osascript(lines: &[String]) -> String {
    let mut command = Command::new("osascript");
    for line in lines {
        command.arg("-e").arg(line);
    }
    match command.output() {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => String::new(),
    }
}

fn capture_frontmost_app() -> Option<FrontmostApp> {
    if cfg!(not(target_os = "macos")) {
        return None;
    }
    let script = vec![
        "tell application \"System Events\"".to_string(),
        "set frontApp to first application process whose frontmost is true".to_string(),
        "set appName to name of frontApp".to_string(),
        "try".to_string(),
        "set bundleId to bundle identifier of frontApp".to_string(),
        "on error".to_string(),
        "set bundleId to \"\"".to_string(),
        "end try".to_string(),
        "return appName & linefeed & bundleId".to_string(),
        "end tell".to_string(),
    ];
    let out = run_osascript(&script);
    let mut lines = out.lines();
    let name = lines.next().unwrap_or_default().to_string();
    let bundle_id = lines.next().unwrap_or_default().to_string();
    if name.is_empty() || name == "SkillSpotlight" {
        return None;
    }
    Some(FrontmostApp { name, bundle_id })
}

fn read_clipboard() -> String {
    Command::new("pbpaste")
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
}

fn write_clipboard(value: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(value.as_bytes())
            .map_err(|err| err.to_string())?;
    }
    child.wait().map_err(|err| err.to_string())?;
    Ok(())
}

fn current_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

fn resize_for_route(app: &AppHandle, window: &WebviewWindow, route: &str) -> Result<(), String> {
    let (width, height) = if route == "settings" || route == "prefs" {
        (SETTINGS_WIDTH, SETTINGS_HEIGHT)
    } else {
        (SEARCH_WIDTH, SEARCH_HEIGHT)
    };
    window
        .set_size(Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|err| err.to_string())?;
    let last_position = {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        data.last_window_position
    };
    if let Some(position) = last_position {
        window.set_position(position).map_err(|err| err.to_string())
    } else {
        window.center().map_err(|err| err.to_string())
    }
}

fn hide_window(app: &AppHandle) -> Result<(), String> {
    let window = current_window(app)?;
    let position = window.outer_position().ok();
    window.hide().map_err(|err| err.to_string())?;
    let state = app.state::<Mutex<AppData>>();
    let mut data = state.lock().expect("app state poisoned");
    data.is_visible = false;
    if position.is_some() {
        data.last_window_position = position;
    }
    Ok(())
}

fn show_window(app: &AppHandle, route: &str) -> Result<(), String> {
    let last_frontmost_app = capture_frontmost_app();
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.last_frontmost_app = last_frontmost_app;
    }

    let window = current_window(app)?;
    resize_for_route(app, &window, route)?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.is_visible = true;
    }
    app.emit_to(
        "main",
        "shown",
        ShownPayload {
            route: route.to_string(),
        },
    )
    .map_err(|err| err.to_string())?;
    emit_state(app);
    Ok(())
}

#[tauri::command]
fn get_home_dir() -> String {
    home_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_state(state: tauri::State<'_, Mutex<AppData>>) -> StatePayload {
    let data = state.lock().expect("app state poisoned");
    payload_from(&data)
}

#[tauri::command]
fn hide(app: AppHandle) -> Result<(), String> {
    hide_window(&app)
}

#[tauri::command]
fn toggle_window(app: AppHandle) -> Result<(), String> {
    let visible = {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        data.is_visible
    };
    if visible {
        hide_window(&app)
    } else {
        show_window(&app, "search")
    }
}

#[tauri::command]
fn set_route(app: AppHandle, route: String) -> Result<serde_json::Value, String> {
    let window = current_window(&app)?;
    resize_for_route(&app, &window, &route)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn paste_entry(app: AppHandle, entry: Entry) -> Result<serde_json::Value, String> {
    hide_window(&app)?;
    let value = entry.value;
    let previous_text = read_clipboard();
    write_clipboard(&value)?;

    if cfg!(target_os = "macos") {
        thread::sleep(Duration::from_millis(60));
        let last_frontmost_app = {
            let state = app.state::<Mutex<AppData>>();
            let data = state.lock().expect("app state poisoned");
            data.last_frontmost_app.clone()
        };
        if let Some(frontmost) = last_frontmost_app {
            if !frontmost.bundle_id.is_empty() {
                let script = vec![format!(
                    "tell application id \"{}\" to activate",
                    frontmost.bundle_id
                )];
                let _ = run_osascript(&script);
            } else if !frontmost.name.is_empty() {
                let script = vec![format!(
                    "tell application \"{}\" to activate",
                    frontmost.name
                )];
                let _ = run_osascript(&script);
            }
        }
        thread::sleep(Duration::from_millis(90));
        let _ = run_osascript(&[
            "tell application \"System Events\" to keystroke \"v\" using command down".to_string(),
        ]);
        thread::sleep(Duration::from_millis(700));
        if read_clipboard() == value {
            let _ = write_clipboard(&previous_text);
        }
        return Ok(serde_json::json!({ "mode": "paste" }));
    }

    Ok(serde_json::json!({ "mode": "clipboard" }))
}

#[tauri::command]
fn copy_entry(app: AppHandle, entry: Entry) -> Result<serde_json::Value, String> {
    hide_window(&app)?;
    write_clipboard(&entry.value)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn reveal_entry(app: AppHandle, entry: Entry) -> Result<(), String> {
    hide_window(&app)?;
    Command::new("open")
        .arg("-R")
        .arg(entry.value)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_entries(app: AppHandle, entries: Vec<Entry>) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.undo_entries = Some(data.config.entries.clone());
        data.config.entries = entries;
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn set_theme(app: AppHandle, theme: String) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.config.theme = if theme == "dark" { "dark" } else { "light" }.to_string();
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn undo(app: AppHandle) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        let Some(previous) = data.undo_entries.take() else {
            return Ok(serde_json::json!({ "ok": false }));
        };
        let current = data.config.entries.clone();
        data.config.entries = previous;
        data.undo_entries = Some(current);
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn choose_sync_directory(app: AppHandle) -> Result<Option<String>, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.suppress_blur_hide = true;
    }
    let picked = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string());
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.suppress_blur_hide = false;
    }
    if let Ok(window) = current_window(&app) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(picked)
}

#[tauri::command]
fn apply_sync(app: AppHandle, source: DirectorySource) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.undo_entries = Some(data.config.entries.clone());
        data.config = upsert_directory_source(&data.config, source);
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true, "ignoredReplaceKeys": [] }))
}

#[tauri::command]
fn save_source(app: AppHandle, source: DirectorySource) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.undo_entries = Some(data.config.entries.clone());
        data.config = update_directory_source(&data.config, source);
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn remove_source(app: AppHandle, source_id: String) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.undo_entries = Some(data.config.entries.clone());
        data.config = remove_directory_source(&data.config, &source_id);
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn sync_all(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.undo_entries = Some(data.config.entries.clone());
        for source in data.config.recent_sources.clone() {
            data.config = upsert_directory_source(&data.config, source);
        }
    }
    save_and_emit(&app)
}

#[tauri::command]
fn set_hotkey(app: AppHandle, accelerator: String) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        data.config.hotkey = accelerator_to_hotkey(&accelerator);
    }
    save_and_emit(&app)?;
    Ok(serde_json::json!({ "ok": true, "accelerator": accelerator }))
}

#[tauri::command]
fn reload_config(app: AppHandle) -> Result<serde_json::Value, String> {
    {
        let state = app.state::<Mutex<AppData>>();
        let mut data = state.lock().expect("app state poisoned");
        load_config_into(&mut data);
    }
    emit_state(&app);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn reveal_config(app: AppHandle) -> Result<(), String> {
    let config_path = {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        data.config_path.clone()
    };
    Command::new("open")
        .arg("-R")
        .arg(config_path)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn reveal_source(path: String) -> Result<(), String> {
    let expanded = expand_home(&path);
    Command::new("open")
        .arg(expanded)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_search = MenuItem::with_id(app, "open-search", "Open Search", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let sync_all_item = MenuItem::with_id(app, "sync-all", "Sync All", true, None::<&str>)?;
    let reload_config_item =
        MenuItem::with_id(app, "reload-config", "Reload Config", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let separator3 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_search,
            &settings,
            &sync_all_item,
            &separator,
            &reload_config_item,
            &about,
            &separator2,
            &quit,
            &separator3,
        ],
    )?;

    const TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/tray-icon.png");

    TrayIconBuilder::new()
        .tooltip("SkillSpotlight")
        .icon(TRAY_ICON)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-search" => {
                let _ = show_window(app, "search");
            }
            "settings" | "about" => {
                let _ = show_window(app, "settings");
            }
            "sync-all" => {
                let _ = sync_all(app.clone());
            }
            "reload-config" => {
                let _ = reload_config(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn maybe_open_settings_on_first_run(app: AppHandle) {
    let has_entries = {
        let state = app.state::<Mutex<AppData>>();
        let data = state.lock().expect("app state poisoned");
        !data.config.entries.is_empty()
    };
    if !has_entries {
        tauri::async_runtime::spawn(async move {
            thread::sleep(Duration::from_millis(250));
            let _ = show_window(&app, "settings");
        });
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(AppData::new()))
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            get_state,
            hide,
            toggle_window,
            set_route,
            paste_entry,
            copy_entry,
            reveal_entry,
            save_entries,
            set_theme,
            undo,
            choose_sync_directory,
            apply_sync,
            save_source,
            remove_source,
            sync_all,
            set_hotkey,
            reload_config,
            reveal_config,
            reveal_source,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            {
                let state = app.state::<Mutex<AppData>>();
                let mut data = state.lock().expect("app state poisoned");
                load_config_into(&mut data);
            }

            build_tray(app)?;

            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Focused(false)) {
                        let app_handle = app_handle.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(90));
                            let should_hide = current_window(&app_handle)
                                .ok()
                                .and_then(|window| window.is_focused().ok())
                                .map(|focused| !focused)
                                .unwrap_or(false);
                            let suppress_blur_hide = {
                                let state = app_handle.state::<Mutex<AppData>>();
                                let data = state.lock().expect("app state poisoned");
                                data.suppress_blur_hide
                            };
                            if should_hide && !suppress_blur_hide {
                                let _ = hide_window(&app_handle);
                            }
                        });
                    }
                });
            }

            maybe_open_settings_on_first_run(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SkillSpotlight");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("{}-{}", prefix, id));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn hotkey_conversion_round_trips_option_space() {
        let hotkey = accelerator_to_hotkey("Alt+Space");
        assert_eq!(hotkey.key, "Space");
        assert_eq!(hotkey.modifiers, vec!["option"]);
        assert_eq!(hotkey_to_accelerator(&hotkey), "Alt+Space");
    }

    #[test]
    fn default_config_path_uses_tauri_app_directory() {
        let path = default_config_path_for_home(PathBuf::from("/Users/example"));
        assert_eq!(
            path,
            PathBuf::from(
                "/Users/example/Library/Application Support/skill-spotlight/config.json"
            )
        );
    }

    #[test]
    fn migrates_legacy_tauri_config_directory() {
        let dir = temp_dir("skill-spotlight-config-migration");
        let config_path = dir.join("Application Support/skill-spotlight/config.json");
        let legacy_path = dir.join("Application Support/skillspotlight-tauri/config.json");
        fs::create_dir_all(legacy_path.parent().unwrap()).unwrap();
        fs::write(&legacy_path, r#"{"theme":"dark"}"#).unwrap();

        migrate_legacy_config_if_needed(&config_path, &legacy_path);

        assert_eq!(fs::read_to_string(&config_path).unwrap(), r#"{"theme":"dark"}"#);
        assert!(!legacy_path.exists());
    }

    #[test]
    fn directory_source_allows_missing_id_from_import() {
        let dir = temp_dir("skill-spotlight-missing-id");
        fs::create_dir_all(dir.join("skill-a")).unwrap();
        let source: DirectorySource = serde_json::from_value(serde_json::json!({
            "path": dir.to_string_lossy(),
            "lastPrefix": "codex:",
            "expanded": true
        }))
        .unwrap();

        assert!(source.id.is_empty());

        let config = upsert_directory_source(&Config::default(), source);
        let generated_id = &config.recent_sources[0].id;
        assert!(generated_id.starts_with("source-"));
        assert_eq!(config.entries[0].source_id, *generated_id);
        assert_eq!(config.entries[0].key, "codex:skill-a");
    }

    #[test]
    fn directory_source_generates_prefixed_entries() {
        let dir = temp_dir("skill-spotlight-source");
        fs::create_dir_all(dir.join("skill-a")).unwrap();
        fs::write(dir.join("note.md"), "hello").unwrap();

        let config = upsert_directory_source(
            &Config::default(),
            DirectorySource {
                id: "codex".to_string(),
                path: dir.to_string_lossy().to_string(),
                last_prefix: "codex:".to_string(),
                expanded: true,
            },
        );

        let keys: Vec<String> = config
            .entries
            .iter()
            .map(|entry| entry.key.clone())
            .collect();
        assert_eq!(keys, vec!["codex:note", "codex:skill-a"]);
    }

    #[test]
    fn removing_source_removes_generated_entries() {
        let dir = temp_dir("skill-spotlight-remove");
        fs::create_dir_all(dir.join("skill-a")).unwrap();
        let config = upsert_directory_source(
            &Config::default(),
            DirectorySource {
                id: "codex".to_string(),
                path: dir.to_string_lossy().to_string(),
                last_prefix: String::new(),
                expanded: true,
            },
        );
        let config = remove_directory_source(&config, "codex");
        assert!(config.entries.is_empty());
        assert!(config.recent_sources.is_empty());
    }

    #[test]
    fn source_prefix_updates_generated_keys() {
        let dir = temp_dir("skill-spotlight-prefix");
        fs::create_dir_all(dir.join("skill-a")).unwrap();
        let config = upsert_directory_source(
            &Config::default(),
            DirectorySource {
                id: "codex".to_string(),
                path: dir.to_string_lossy().to_string(),
                last_prefix: String::new(),
                expanded: true,
            },
        );
        let config = update_directory_source(
            &config,
            DirectorySource {
                id: "codex".to_string(),
                path: dir.to_string_lossy().to_string(),
                last_prefix: "codex".to_string(),
                expanded: true,
            },
        );
        assert_eq!(config.entries[0].key, "codexskill-a");
    }

    #[test]
    fn replacement_source_keeps_direct_entries() {
        let dir = temp_dir("skill-spotlight-direct");
        fs::create_dir_all(dir.join("skill-a")).unwrap();
        let config = Config {
            entries: vec![Entry {
                key: "manual".to_string(),
                value: "value".to_string(),
                kind: "regular".to_string(),
                source_id: String::new(),
                source_path: String::new(),
                name: String::new(),
            }],
            ..Config::default()
        };
        let config = upsert_directory_source(
            &config,
            DirectorySource {
                id: "codex".to_string(),
                path: dir.to_string_lossy().to_string(),
                last_prefix: "codex:".to_string(),
                expanded: true,
            },
        );
        let keys: HashSet<String> = config
            .entries
            .iter()
            .map(|entry| entry.key.clone())
            .collect();
        assert!(keys.contains("manual"));
        assert!(keys.contains("codex:skill-a"));
    }
}
