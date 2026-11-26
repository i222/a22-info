//! Development-only HTTP stand-in for the Tauri IPC command surface used by E2E.
//!
//! Serves `POST /invoke {"cmd": "...", "args": {...}}` on 127.0.0.1, backed by
//! the exact same `a22_core::state` ops the Tauri commands wrap
//! (`a22-app/src/commands.rs`). The Playwright suite (`e2e/`) points the
//! frontend `__TAURI_INTERNALS__.invoke` shim here so the full stack — Rust
//! logic + SQLite + Zustand store + MUI — runs headlessly in Chromium.
//!
//! Run: `A22_DB_PATH=/tmp/x.db A22_BRIDGE_PORT=9787 cargo run -p a22-core --example http_invoke_bridge`

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};

use a22_core::state::{AppState, CreateItemInput, CreateItemTimerLinkInput, CreateTimerInput, UpdateItemInput, UpdateItemTimerLinkInput, UpdateTimerInput};

const MAX_BODY: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
struct InvokeRequest {
    cmd: String,
    #[serde(default)]
    args: Value,
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn op<R>(result: Result<R, a22_core::state::StateError>) -> Result<R, String> {
    result.map_err(|error| error.to_string())
}

fn from_args<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    let value = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| format!("`{key}` is required"))
}

/// Dispatch one command; mirrors `a22-app/src/commands.rs` 1:1 (same ops, same
/// camelCase wire shapes, domain errors mapped to strings).
fn dispatch(cmd: &str, args: &Value, state: &Mutex<AppState>) -> Result<Value, String> {
    let mut app = state.lock().map_err(|poisoned| poisoned.to_string())?;
    match cmd {
        "db_load_all" => {
            let hints = app.hints();
            Ok(json!({
                "items": &app.data.items,
                "timers": &app.data.timers,
                "itemLinks": &app.data.item_links,
                "itemTimerLinks": &app.data.item_timer_links,
                "tags": hints.tags,
                "infoLabelHints": hints.info_labels,
                "relationshipTypeHints": hints.relationship_types,
            }))
        }
        "items_create" => {
            let input: CreateItemInput = from_args(args, "input")?;
            op(app.create_item(&input)).map(|item| json!(item))
        }
        "items_update" => {
            let id = str_arg(args, "id")?;
            let input: UpdateItemInput = from_args(args, "input")?;
            op(app.update_item(id, &input)).map(|item| json!(item))
        }
        "items_delete" => {
            let id = str_arg(args, "id")?;
            op(app.delete_item(id))?;
            Ok(Value::Null)
        }
        "timers_create" => {
            let input: CreateTimerInput = from_args(args, "input")?;
            op(app.create_timer(&input)).map(|timer| json!(timer))
        }
        "timers_update" => {
            let id = str_arg(args, "id")?;
            let input: UpdateTimerInput = from_args(args, "input")?;
            op(app.update_timer(id, &input)).map(|timer| json!(timer))
        }
        "timers_delete" => {
            let id = str_arg(args, "id")?;
            op(app.delete_timer(id))?;
            Ok(Value::Null)
        }
        "item_timer_links_create" => {
            let input: CreateItemTimerLinkInput = from_args(args, "input")?;
            op(app.create_item_timer_link(&input)).map(|link| json!(link))
        }
        "item_timer_links_update" => {
            let id = str_arg(args, "id")?;
            let input: UpdateItemTimerLinkInput = from_args(args, "input")?;
            op(app.update_item_timer_link(id, &input)).map(|link| json!(link))
        }
        "item_timer_links_delete" => {
            let id = str_arg(args, "id")?;
            op(app.delete_item_timer_link(id))?;
            Ok(Value::Null)
        }
        "item_timer_link_cycle" => {
            let link_id = str_arg(args, "linkId")?;
            let now_iso = args.get("nowIso").and_then(Value::as_str).map(str::to_string);
            op(app.cycle_link(link_id, now_iso.as_deref())).map(|link| json!(link))
        }
        "items_filter" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or_default().to_string();
            let tags: Vec<String> = args.get("tags").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            Ok(json!(app.filter(&query, &tags)))
        }
        "timers_statuses" => {
            let now_iso = args.get("nowIso").and_then(Value::as_str).map(str::to_string);
            let map: HashMap<String, Value> = app.statuses(now_iso.as_deref()).into_iter().map(|link_status| (link_status.link_id, json!(link_status.status))).collect();
            Ok(Value::Object(map.into_iter().collect()))
        }
        "export_snapshot" => Ok(json!(app.export_snapshot())),
        "import_snapshot" => {
            let raw_json = str_arg(args, "rawJson")?;
            op(app.import_snapshot(raw_json)).map(|summary| json!(summary))
        }
        other => Err(format!("unknown command `{other}`")),
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|window| window == b"\r\n\r\n")
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = if status == 200 {
        "OK"
    } else if status == 400 {
        "Bad Request"
    } else if status == 404 {
        "Not Found"
    } else {
        "Internal Server Error"
    };
    let _ = write!(
		stream,
		"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
		body.len()
	);
    let _ = stream.flush();
}

fn handle_connection(mut stream: TcpStream, state: Arc<Mutex<AppState>>) {
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        if let Some(end) = find_header_end(&buf) {
            break end;
        }
        match stream.read(&mut tmp) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        if buf.len() > MAX_BODY + 65536 {
            return;
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    let content_length = head
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buf.len() < body_start.saturating_add(content_length) {
        match stream.read(&mut tmp) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        if buf.len() > MAX_BODY + 65536 {
            return;
        }
    }

    if method == "OPTIONS" {
        respond(&mut stream, 200, "{}");
        return;
    }
    if path == "/health" && method == "GET" {
        respond(&mut stream, 200, "{\"ok\":true}");
        return;
    }
    if path != "/invoke" || method != "POST" {
        respond(&mut stream, 404, r#"{"error":"not found"}"#);
        return;
    }

    let body = String::from_utf8_lossy(&buf[body_start..body_start + content_length]).to_string();
    let request: InvokeRequest = match serde_json::from_str(&body) {
        Ok(request) => request,
        Err(error) => {
            respond(&mut stream, 400, &format!(r#"{{"error":"bad request body: {error}"}}"#));
            return;
        }
    };

    match dispatch(&request.cmd, &request.args, &state) {
        Ok(result) => respond(&mut stream, 200, &serde_json::to_string(&json!({ "result": result })).expect("envelope serializes")),
        Err(error) => respond(&mut stream, 500, &format!(r#"{{"error":{}}}"#, serde_json::to_string(&error).expect("string serializes"))),
    }
}

fn main() {
    let port: u16 = env_or("A22_BRIDGE_PORT", "9787").parse().expect("A22_BRIDGE_PORT is not a number");
    let db_path = env_or("A22_DB_PATH", "./e2e-a22.db");
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).expect("create db parent dir");
        }
    }
    let state = Arc::new(Mutex::new(AppState::open(&db_path).expect("open app state")));
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind bridge port");
    println!("a22 bridge ready: port={port} db={db_path}");
    use std::io::Write as _;
    let _ = std::io::stdout().flush();
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let state = Arc::clone(&state);
                std::thread::spawn(move || handle_connection(stream, state));
            }
            Err(_) => continue,
        }
    }
}
