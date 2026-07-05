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
            delete_page
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Cuadernillo");
}
