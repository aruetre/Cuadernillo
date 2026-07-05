use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

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

/// Abre el diálogo nativo de selección de carpeta desde el backend (lado de
/// confianza), canonicaliza la ruta elegida y la fija como raíz del cuaderno.
/// Devuelve la ruta mostrable, o `None` si el usuario cancela. El webview no
/// puede fijar la raíz por sí mismo: solo puede disparar este diálogo.
#[tauri::command]
async fn open_notebook(
    app: AppHandle,
    state: State<'_, NotebookState>,
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
    *state.0.lock().unwrap() = Some(canonical);
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

#[tauri::command]
fn delete_page(state: State<'_, NotebookState>, rel_path: String) -> Result<(), String> {
    let root = state.root()?;
    let path = safe_join(&root, &rel_path)?;
    fs::remove_file(&path).map_err(|e| format!("No se pudo eliminar: {e}"))
    // Las subpáginas (carpeta homónima) se conservan a propósito.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(NotebookState::default())
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
            import_attachment,
            read_attachment
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Cuadernillo");
}
