use futures_util::StreamExt;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Vigilante de cambios en el sistema de ficheros del cuaderno. Guardado en el
/// estado para mantenerlo vivo; se reemplaza al abrir otro cuaderno.
#[derive(Default)]
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

/// Empieza a vigilar `root` recursivamente. Al detectar cambios, emite el evento
/// `notebook-changed` al frontend (que recarga el árbol, con antirrebote).
fn start_watching(app: &AppHandle, root: &Path, ws: &WatcherState) {
    let app2 = app.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = app2.emit("notebook-changed", ());
        }
    });
    if let Ok(mut w) = watcher {
        if w.watch(root, RecursiveMode::Recursive).is_ok() {
            *ws.0.lock().unwrap() = Some(w);
        }
    }
}

/// Raíz del cuaderno aprobada por el usuario, canonicalizada y custodiada por
/// el backend. El frontend NUNCA la aporta: solo puede fijarse abriendo el
/// diálogo nativo desde Rust (`open_notebook`), que es el lado de confianza.
#[derive(Default)]
struct NotebookState(Mutex<Option<PathBuf>>);

impl NotebookState {
    fn root(&self) -> Result<PathBuf, String> {
        self.0
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "No hay ningún cuaderno abierto".to_string())
    }
}

#[derive(Serialize)]
pub struct PageNode {
    name: String,
    key: String,
    rel_path: String,
    is_dir: bool,
    children: Vec<PageNode>,
}

/// Comprueba que `candidate` no escapa del cuaderno, resolviendo symlinks.
/// Sube hasta el primer ancestro existente, lo canonicaliza (siguiendo enlaces)
/// y exige que siga bajo `root`. Cubre tanto ficheros existentes (lectura y
/// borrado, donde el propio fichero podría ser un symlink hacia fuera) como
/// rutas por crear (escritura, donde se valida el directorio padre real).
fn ensure_within(root: &Path, candidate: &Path) -> Result<(), String> {
    let mut cur = candidate;
    loop {
        match fs::canonicalize(cur) {
            Ok(real) => {
                return if real.starts_with(root) {
                    Ok(())
                } else {
                    Err("Ruta fuera del cuaderno no permitida".into())
                };
            }
            // Aún no existe: sube al padre y vuelve a intentar.
            Err(_) => match cur.parent() {
                Some(parent) => cur = parent,
                None => return Err("Ruta fuera del cuaderno no permitida".into()),
            },
        }
    }
}

/// Normaliza una ruta relativa rechazando ascensos y rutas absolutas, y
/// verifica contención frente a symlinks. Devuelve la ruta absoluta segura
/// bajo `root` (que ya debe estar canonicalizado).
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("Ruta absoluta no permitida".into());
    }
    let mut clean = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return Err("Ruta fuera del cuaderno no permitida".into()),
        }
    }
    let candidate = root.join(clean);
    ensure_within(root, &candidate)?;
    Ok(candidate)
}

/// Sanea un nombre de página con posibles niveles (a/b/c) y añade .md.
fn sanitize_page_name(name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err("Nombre vacío".into());
    }
    let mut path = PathBuf::new();
    for part in trimmed.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." || part.starts_with('.') {
            return Err(format!("Componente de nombre no válido: '{part}'"));
        }
        if part.contains(['\\', ':', '*', '?', '"', '<', '>', '|']) {
            return Err(format!("Caracteres no permitidos en '{part}'"));
        }
        path.push(part);
    }
    path.set_extension("md");
    Ok(path)
}

fn build_tree(dir: &Path, root: &Path) -> Result<Vec<PageNode>, String> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());

    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            dirs.push((name, path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            files.push((name, path));
        }
    }

    let rel_of = |p: &Path| -> String {
        p.strip_prefix(root)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/")
    };

    let mut nodes: Vec<PageNode> = Vec::new();
    let mut consumed_dirs: Vec<usize> = Vec::new();

    // Páginas .md; si existe carpeta homónima (modelo Zim), sus hijos cuelgan de la página.
    for (fname, fpath) in &files {
        let stem = fname.trim_end_matches(".md").to_string();
        let mut children = Vec::new();
        let mut key = rel_of(fpath);
        if let Some(idx) = dirs.iter().position(|(dname, _)| *dname == stem) {
            let (_, dpath) = &dirs[idx];
            children = build_tree(dpath, root)?;
            key = rel_of(dpath);
            consumed_dirs.push(idx);
        }
        nodes.push(PageNode {
            name: stem,
            key,
            rel_path: rel_of(fpath),
            is_dir: !children.is_empty(),
            children,
        });
    }

    // Directorios sin página asociada.
    for (idx, (dname, dpath)) in dirs.iter().enumerate() {
        if consumed_dirs.contains(&idx) {
            continue;
        }
        let children = build_tree(dpath, root)?;
        if children.is_empty() {
            continue;
        }
        nodes.push(PageNode {
            name: dname.clone(),
            key: rel_of(dpath),
            rel_path: String::new(),
            is_dir: true,
            children,
        });
    }

    nodes.sort_by_key(|n| n.name.to_lowercase());
    Ok(nodes)
}

#[derive(Serialize)]
pub struct SearchHit {
    rel_path: String,
    name: String,
    line: usize,
    snippet: String,
}

/// Busca `query_lc` (ya en minúsculas) en el contenido de los .md bajo `dir`.
fn search_dir(dir: &Path, root: &Path, query_lc: &str, hits: &mut Vec<SearchHit>, limit: usize) {
    if hits.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut list: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    list.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    for entry in list {
        if hits.len() >= limit {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            search_dir(&path, root, query_lc, hits, limit);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let Ok(content) = fs::read_to_string(&path) else { continue };
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(query_lc) {
                    hits.push(SearchHit {
                        rel_path: rel.clone(),
                        name: stem.clone(),
                        line: i + 1,
                        snippet: line.trim().chars().take(160).collect(),
                    });
                    if hits.len() >= limit {
                        return;
                    }
                }
            }
        }
    }
}

/// Busca texto en todo el cuaderno. Devuelve coincidencias por línea.
#[tauri::command]
fn search_notebook(state: State<'_, NotebookState>, query: String) -> Result<Vec<SearchHit>, String> {
    let root = state.root()?;
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();
    search_dir(&root, &root, &q, &mut hits, 300);
    Ok(hits)
}

/// Abre el diálogo nativo de selección de carpeta desde el backend (lado de
/// confianza), canonicaliza la ruta elegida y la fija como raíz del cuaderno.
/// Devuelve la ruta mostrable, o `None` si el usuario cancela. El webview no
/// puede fijar la raíz por sí mismo: solo puede disparar este diálogo.
#[tauri::command]
async fn open_notebook(
    app: AppHandle,
    state: State<'_, NotebookState>,
    ws: State<'_, WatcherState>,
) -> Result<Option<String>, String> {
    // Comando async → se ejecuta fuera del hilo principal, por lo que el
    // diálogo bloqueante no puede provocar deadlock del webview.
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let canonical =
        fs::canonicalize(&path).map_err(|e| format!("Cuaderno no accesible: {e}"))?;
    let display = canonical.to_string_lossy().to_string();
    start_watching(&app, &canonical, &ws);
    *state.0.lock().unwrap() = Some(canonical);
    push_recent(&app, &display);
    Ok(Some(display))
}

// --- Cuadernos recientes (config de la app, no del cuaderno) ------------------
// La lista permite el intercambiador rápido y recordar el último. Guardada en la
// carpeta de config de la app. Por seguridad, `open_recent` solo acepta rutas
// que ya estén en esta lista (es decir, abiertas antes por el diálogo nativo).

fn recents_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recent_notebooks.json"))
}

fn read_recents(app: &AppHandle) -> Vec<String> {
    recents_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write_recents(app: &AppHandle, list: &[String]) {
    if let Ok(p) = recents_file(app) {
        if let Ok(s) = serde_json::to_string_pretty(list) {
            let _ = fs::write(p, s);
        }
    }
}

fn push_recent(app: &AppHandle, path: &str) {
    let mut list = read_recents(app);
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(12);
    write_recents(app, &list);
}

#[tauri::command]
fn list_recent_notebooks(app: AppHandle) -> Vec<String> {
    read_recents(&app)
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .collect()
}

#[tauri::command]
fn open_recent(
    app: AppHandle,
    state: State<'_, NotebookState>,
    ws: State<'_, WatcherState>,
    path: String,
) -> Result<Option<String>, String> {
    // Solo se aceptan rutas ya conocidas (abiertas antes por el diálogo).
    if !read_recents(&app).iter().any(|p| p == &path) {
        return Err("Cuaderno no reconocido".into());
    }
    let canonical =
        fs::canonicalize(&path).map_err(|e| format!("Cuaderno no accesible: {e}"))?;
    let display = canonical.to_string_lossy().to_string();
    start_watching(&app, &canonical, &ws);
    *state.0.lock().unwrap() = Some(canonical);
    push_recent(&app, &display);
    Ok(Some(display))
}

#[tauri::command]
fn list_pages(state: State<'_, NotebookState>) -> Result<Vec<PageNode>, String> {
    let root = state.root()?;
    build_tree(&root, &root)
}

#[tauri::command]
fn read_page(state: State<'_, NotebookState>, rel_path: String) -> Result<String, String> {
    let root = state.root()?;
    let path = safe_join(&root, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la página: {e}"))
}

#[tauri::command]
fn write_page(
    state: State<'_, NotebookState>,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let root = state.root()?;
    let path = safe_join(&root, &rel_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Escritura atómica: temporal + rename para no corromper la página.
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, &content).map_err(|e| format!("No se pudo escribir: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar: {e}"))
}

#[tauri::command]
fn create_page(state: State<'_, NotebookState>, name: String) -> Result<String, String> {
    let root = state.root()?;
    let rel = sanitize_page_name(&name)?;
    let path = safe_join(&root, &rel.to_string_lossy())?;
    if path.exists() {
        return Err("Ya existe una página con ese nombre".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let title = rel
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    fs::write(&path, format!("# {title}\n\n")).map_err(|e| e.to_string())?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn rename_page(
    state: State<'_, NotebookState>,
    rel_path: String,
    new_name: String,
) -> Result<String, String> {
    let root = state.root()?;
    let old_path = safe_join(&root, &rel_path)?;
    if !old_path.exists() {
        return Err("La página original no existe".into());
    }
    let new_rel = sanitize_page_name(&new_name)?;
    let new_path = safe_join(&root, &new_rel.to_string_lossy())?;
    if new_path.exists() {
        return Err("Ya existe una página con el nuevo nombre".into());
    }
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("No se pudo renombrar: {e}"))?;

    // Modelo Zim: mover también la carpeta de subpáginas si existe.
    let old_dir = old_path.with_extension("");
    if old_dir.is_dir() {
        let new_dir = new_path.with_extension("");
        fs::rename(&old_dir, &new_dir)
            .map_err(|e| format!("Página renombrada, pero fallo al mover subpáginas: {e}"))?;
    }
    Ok(new_rel.to_string_lossy().replace('\\', "/"))
}

// --- Papelera: eliminar mueve a .cuadernillo/trash/ (recuperable) ------------

#[derive(Serialize, Deserialize, Clone)]
struct TrashItem {
    id: String,
    original: String,
    name: String,
    deleted_at: u128,
}

fn trash_dir(root: &Path) -> PathBuf {
    dot_dir(root).join("trash")
}
fn read_trash_index(root: &Path) -> Vec<TrashItem> {
    fs::read_to_string(trash_dir(root).join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn write_trash_index(root: &Path, items: &[TrashItem]) -> Result<(), String> {
    let dir = trash_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let s = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    fs::write(dir.join("index.json"), s).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_page(state: State<'_, NotebookState>, rel_path: String) -> Result<(), String> {
    let root = state.root()?;
    let path = safe_join(&root, &rel_path)?;
    if !path.exists() {
        return Err("La página no existe".into());
    }
    let dir = trash_dir(&root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("{now}");
    fs::rename(&path, dir.join(format!("{id}.md")))
        .map_err(|e| format!("No se pudo mover a la papelera: {e}"))?;
    let name = Path::new(&rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut items = read_trash_index(&root);
    items.push(TrashItem { id, original: rel_path, name, deleted_at: now });
    write_trash_index(&root, &items)?;
    Ok(())
    // Las subpáginas (carpeta homónima) se conservan a propósito.
}

#[tauri::command]
fn list_trash(state: State<'_, NotebookState>) -> Result<Vec<TrashItem>, String> {
    let root = state.root()?;
    let dir = trash_dir(&root);
    Ok(read_trash_index(&root)
        .into_iter()
        .filter(|it| dir.join(format!("{}.md", it.id)).is_file())
        .collect())
}

#[tauri::command]
fn restore_trash(state: State<'_, NotebookState>, id: String) -> Result<String, String> {
    let root = state.root()?;
    let mut items = read_trash_index(&root);
    let pos = items
        .iter()
        .position(|it| it.id == id)
        .ok_or_else(|| "Elemento no encontrado".to_string())?;
    let item = items[pos].clone();
    let src = trash_dir(&root).join(format!("{}.md", id));
    let mut dest_rel = item.original.clone();
    let mut dest = safe_join(&root, &dest_rel)?;
    if dest.exists() {
        dest_rel = format!("{}-restaurado.md", dest_rel.trim_end_matches(".md"));
        dest = safe_join(&root, &dest_rel)?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&src, &dest).map_err(|e| format!("No se pudo restaurar: {e}"))?;
    items.remove(pos);
    write_trash_index(&root, &items)?;
    Ok(dest_rel)
}

// --- Retroenlaces: qué páginas enlazan a una nota con [[...]] ----------------

fn backlink_dir(dir: &Path, root: &Path, target: &str, hits: &mut Vec<SearchHit>, limit: usize) {
    if hits.len() >= limit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        if hits.len() >= limit {
            return;
        }
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            backlink_dir(&path, root, target, hits, limit);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let Ok(content) = fs::read_to_string(&path) else { continue };
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            for (i, line) in content.lines().enumerate() {
                if wiki_links_match(line, target) {
                    hits.push(SearchHit {
                        rel_path: rel.clone(),
                        name: stem.clone(),
                        line: i + 1,
                        snippet: line.trim().chars().take(160).collect(),
                    });
                    break; // una vez por fichero basta
                }
            }
        }
    }
}

/// ¿Alguna cita [[...]] de la línea apunta a `target` (nombre en minúsculas)?
fn wiki_links_match(line: &str, target: &str) -> bool {
    let mut rest = line;
    while let Some(open) = rest.find("[[") {
        let after = &rest[open + 2..];
        let Some(close) = after.find("]]") else { break };
        let inner = &after[..close];
        let name = inner
            .split('|')
            .next()
            .unwrap_or("")
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if name == target {
            return true;
        }
        rest = &after[close + 2..];
    }
    false
}

#[tauri::command]
fn find_backlinks(state: State<'_, NotebookState>, name: String) -> Result<Vec<SearchHit>, String> {
    let root = state.root()?;
    let target = name.trim().to_lowercase();
    if target.is_empty() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();
    backlink_dir(&root, &root, &target, &mut hits, 300);
    Ok(hits)
}

// --- Ajustes por cuaderno (.cuadernillo/) ------------------------------------
// Aspecto (fuente, márgenes, ancho) y CSS personalizado viven en una carpeta
// oculta dentro del propio cuaderno, para que viajen con él (git/Syncthing).

fn dot_dir(root: &Path) -> PathBuf {
    root.join(".cuadernillo")
}

/// Lee un fichero interno de `.cuadernillo/`. Devuelve "" si no existe todavía.
fn read_dot_file(root: &Path, name: &str) -> Result<String, String> {
    let path = dot_dir(root).join(name);
    ensure_within(root, &path)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

/// Escribe un fichero interno de `.cuadernillo/` (escritura atómica).
fn write_dot_file(root: &Path, name: &str, content: &str) -> Result<(), String> {
    let dir = dot_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_within(root, &dir)?;
    let path = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, content).map_err(|e| format!("No se pudo escribir: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar: {e}"))
}

#[tauri::command]
fn read_config(state: State<'_, NotebookState>) -> Result<String, String> {
    read_dot_file(&state.root()?, "config.json")
}

#[tauri::command]
fn write_config(state: State<'_, NotebookState>, content: String) -> Result<(), String> {
    write_dot_file(&state.root()?, "config.json", &content)
}

#[tauri::command]
fn read_custom_css(state: State<'_, NotebookState>) -> Result<String, String> {
    read_dot_file(&state.root()?, "custom.css")
}

#[tauri::command]
fn write_custom_css(state: State<'_, NotebookState>, content: String) -> Result<(), String> {
    write_dot_file(&state.root()?, "custom.css", &content)
}

#[tauri::command]
fn read_page_icons(state: State<'_, NotebookState>) -> Result<String, String> {
    read_dot_file(&state.root()?, "page-icons.json")
}

#[tauri::command]
fn write_page_icons(state: State<'_, NotebookState>, content: String) -> Result<(), String> {
    write_dot_file(&state.root()?, "page-icons.json", &content)
}

#[tauri::command]
fn read_page_layouts(state: State<'_, NotebookState>) -> Result<String, String> {
    read_dot_file(&state.root()?, "layouts.json")
}

#[tauri::command]
fn write_page_layouts(state: State<'_, NotebookState>, content: String) -> Result<(), String> {
    write_dot_file(&state.root()?, "layouts.json", &content)
}

// --- Adjuntos (imágenes) -----------------------------------------------------
// Carpeta única `attachments/` en la raíz, con una subcarpeta por página de
// referencia: la imagen de `Proyectos/PaperBridge.md` va a
// `attachments/Proyectos/PaperBridge/`. Se referencia con ruta relativa a la
// raíz del cuaderno.

fn guess_mime(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// Sanea el nombre de un adjunto: los espacios y caracteres problemáticos en
/// URLs de markdown pasan a '-' (se colapsan y recortan). Conserva letras
/// unicode (acentos), dígitos, '-' y '_'. Mantiene la extensión.
fn sanitize_filename(name: &str) -> String {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string());

    let mut out = String::new();
    let mut prev_dash = false;
    for c in stem.chars() {
        if c.is_alphanumeric() || c == '_' {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let base = out.trim_matches('-').to_string();
    let base = if base.is_empty() { "imagen".to_string() } else { base };
    match ext {
        Some(e) => format!("{base}.{e}"),
        None => base,
    }
}

/// Devuelve una ruta libre en `dir` para `filename`, añadiendo -1, -2… si choca.
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|s| s.to_string_lossy().to_string());
    for n in 1.. {
        let name = match &ext {
            Some(e) => format!("{stem}-{n}.{e}"),
            None => format!("{stem}-{n}"),
        };
        let c = dir.join(&name);
        if !c.exists() {
            return c;
        }
    }
    unreachable!()
}

/// Abre el diálogo de imagen, copia el fichero a `attachments/<página>/` y
/// devuelve su ruta relativa (posix). `None` si el usuario cancela.
#[tauri::command]
async fn import_attachment(
    app: AppHandle,
    state: State<'_, NotebookState>,
    page: String,
) -> Result<Option<String>, String> {
    let root = state.root()?;
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("Imágenes", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let src = file.into_path().map_err(|e| e.to_string())?;

    // Carpeta destino: attachments/<ruta de la página sin .md>/
    let page_stem = page.trim_end_matches(".md");
    let mut dest_dir = root.join("attachments");
    for part in page_stem.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." {
            return Err("Página no válida para adjuntar".into());
        }
        dest_dir.push(part);
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    ensure_within(&root, &dest_dir)?;

    let filename = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "Nombre de archivo no válido".to_string())?;
    let filename = sanitize_filename(&filename);
    let dest = unique_path(&dest_dir, &filename);
    fs::copy(&src, &dest).map_err(|e| format!("No se pudo copiar la imagen: {e}"))?;

    let rel = dest
        .strip_prefix(&root)
        .map_err(|_| "Ruta fuera del cuaderno".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(Some(rel))
}

/// Lee un adjunto (ruta relativa a la raíz) y lo devuelve como data-URL, para
/// que el webview lo muestre sin exponer el sistema de archivos.
#[tauri::command]
fn read_attachment(state: State<'_, NotebookState>, rel: String) -> Result<String, String> {
    let root = state.root()?;
    let path = safe_join(&root, &rel)?;
    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer el adjunto: {e}"))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime = guess_mime(ext);
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Copia una imagen arrastrada (ruta absoluta del sistema) a
/// `attachments/<página>/` y devuelve su ruta relativa (posix).
#[tauri::command]
fn import_dropped_image(
    state: State<'_, NotebookState>,
    page: String,
    src: String,
) -> Result<Option<String>, String> {
    let root = state.root()?;
    let src_path = Path::new(&src);
    if !src_path.is_file() {
        return Err("No es un archivo válido".into());
    }
    let page_stem = page.trim_end_matches(".md");
    let mut dest_dir = root.join("attachments");
    for part in page_stem.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." {
            return Err("Página no válida para adjuntar".into());
        }
        dest_dir.push(part);
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    ensure_within(&root, &dest_dir)?;
    let filename = src_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "Nombre de archivo no válido".to_string())?;
    let filename = sanitize_filename(&filename);
    let dest = unique_path(&dest_dir, &filename);
    fs::copy(src_path, &dest).map_err(|e| format!("No se pudo copiar la imagen: {e}"))?;
    let rel = dest
        .strip_prefix(&root)
        .map_err(|_| "Ruta fuera del cuaderno".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(Some(rel))
}

// --- IA (API compatible OpenAI; por defecto NVIDIA gratuita) -----------------
// Config global de la app (no del cuaderno): API key, modelo y endpoint.

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    base_url: String,
}

fn ai_config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai_config.json"))
}

fn load_ai_config(app: &AppHandle) -> AiConfig {
    ai_config_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<AiConfig>(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn read_ai_config(app: AppHandle) -> Result<String, String> {
    match ai_config_file(&app).and_then(|p| fs::read_to_string(p).map_err(|e| e.to_string())) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
fn write_ai_config(app: AppHandle, content: String) -> Result<(), String> {
    let path = ai_config_file(&app)?;
    fs::write(path, content).map_err(|e| format!("No se pudo guardar la config de IA: {e}"))
}

/// Llama a la API (chat/completions compatible OpenAI) y devuelve el texto.
#[tauri::command]
async fn ai_complete(app: AppHandle, system: String, prompt: String) -> Result<String, String> {
    let cfg = load_ai_config(&app);
    if cfg.api_key.trim().is_empty() {
        return Err("Falta la API key de IA. Configúrala en el panel de IA.".into());
    }
    let base = if cfg.base_url.trim().is_empty() {
        "https://integrate.api.nvidia.com/v1".to_string()
    } else {
        cfg.base_url.trim().trim_end_matches('/').to_string()
    };
    let model = if cfg.model.trim().is_empty() {
        "qwen/qwen3-next-80b-a3b-instruct".to_string()
    } else {
        cfg.model.trim().to_string()
    };
    let url = format!("{base}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.6,
        "max_tokens": 2048,
        "stream": false
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", cfg.api_key.trim()))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Error de red al llamar a la IA: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("La IA respondió {status}: {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Respuesta no válida: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if content.trim().is_empty() {
        return Err("La IA devolvió una respuesta vacía.".into());
    }
    Ok(content)
}

/// Como `ai_complete` pero en streaming: emite eventos `ai-chunk` con cada
/// fragmento de texto según llega, `ai-done` al terminar y `ai-error` si falla.
#[tauri::command]
async fn ai_stream(app: AppHandle, system: String, prompt: String) -> Result<(), String> {
    let cfg = load_ai_config(&app);
    let api_key = cfg.api_key.trim().to_string();
    if api_key.is_empty() {
        let _ = app.emit("ai-error", "Falta la API key de IA.".to_string());
        return Ok(());
    }
    let base = if cfg.base_url.trim().is_empty() {
        "https://integrate.api.nvidia.com/v1".to_string()
    } else {
        cfg.base_url.trim().trim_end_matches('/').to_string()
    };
    let model = if cfg.model.trim().is_empty() {
        "qwen/qwen3-next-80b-a3b-instruct".to_string()
    } else {
        cfg.model.trim().to_string()
    };
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.6,
        "max_tokens": 2048,
        "stream": true
    });

    let client = reqwest::Client::new();
    let resp = match client
        .post(format!("{base}/chat/completions"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit("ai-error", format!("Error de red: {e}"));
            return Ok(());
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let _ = app.emit("ai-error", format!("La IA respondió {status}: {text}"));
        return Ok(());
    }

    // Procesa el flujo SSE: líneas "data: {json}" con delta.content.
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let _ = app.emit("ai-error", format!("Error de flujo: {e}"));
                return Ok(());
            }
        };
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                let _ = app.emit("ai-done", ());
                return Ok(());
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                    if !delta.is_empty() {
                        let _ = app.emit("ai-chunk", delta.to_string());
                    }
                }
            }
        }
    }
    let _ = app.emit("ai-done", ());
    Ok(())
}

/// Guarda `content` en la ruta que el usuario elija en el diálogo nativo (para
/// exportar HTML). Devuelve la ruta o `None` si cancela.
#[tauri::command]
async fn export_file(
    app: AppHandle,
    content: String,
    default_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("No se pudo exportar: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(NotebookState::default())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            open_notebook,
            list_pages,
            read_page,
            write_page,
            create_page,
            rename_page,
            delete_page,
            read_config,
            write_config,
            read_custom_css,
            write_custom_css,
            read_page_icons,
            write_page_icons,
            read_page_layouts,
            write_page_layouts,
            import_attachment,
            read_attachment,
            import_dropped_image,
            list_recent_notebooks,
            open_recent,
            read_ai_config,
            write_ai_config,
            ai_complete,
            ai_stream,
            search_notebook,
            export_file,
            list_trash,
            restore_trash,
            find_backlinks
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Cuadernillo");
}
