import "./fonts";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { createEditor, setContent, getContent, focusEditor, insertMarkdown, setImageAlign, type NavLink } from "./editor";
import { renderTree, expandPathTo, type PageNode } from "./tree";
import { buildToolbar } from "./toolbar";
import { icon } from "./icons";
import { openHelp } from "./help";
import { openTemplates } from "./templates";
import { openSettings, loadSettings, resetSettings } from "./settings";
import { openNotePicker } from "./picker";
import { openAi } from "./ai";
import { openSearch } from "./search";
import { openPalette, type PaletteCommand } from "./palette";
import { exportHtml, exportPdf } from "./export";
import { checkForUpdates } from "./updater";
import { loadPageIcons, resetPageIcons, getPageIcon, setPageIcon, openIconPicker } from "./pageIcons";
import { renderOutline } from "./outline";

type SaveState = "idle" | "saving" | "saved" | "error";

const el = {
  app: document.getElementById("app") as HTMLElement,
  tree: document.getElementById("tree") as HTMLElement,
  outline: document.getElementById("outline") as HTMLElement,
  btnToggleOutline: document.getElementById("btn-toggle-outline") as HTMLButtonElement,
  btnOutlineClose: document.getElementById("btn-outline-close") as HTMLButtonElement,
  editor: document.getElementById("editor") as HTMLElement,
  editorWrap: document.getElementById("editor-wrap") as HTMLElement,
  sourceView: document.getElementById("source-view") as HTMLTextAreaElement,
  toolbar: document.getElementById("toolbar") as HTMLElement,
  pagePath: document.getElementById("page-path") as HTMLElement,
  saveStatus: document.getElementById("save-status") as HTMLElement,
  btnOpen: document.getElementById("btn-open-notebook") as HTMLButtonElement,
  btnRecents: document.getElementById("btn-recents") as HTMLButtonElement,
  btnNew: document.getElementById("btn-new-page") as HTMLButtonElement,
  btnRename: document.getElementById("btn-rename") as HTMLButtonElement,
  btnDelete: document.getElementById("btn-delete") as HTMLButtonElement,
  btnToggleSidebar: document.getElementById("btn-toggle-sidebar") as HTMLButtonElement,
  btnSearch: document.getElementById("btn-search") as HTMLButtonElement,
  btnToggleToolbar: document.getElementById("btn-toggle-toolbar") as HTMLButtonElement,
  btnView: document.getElementById("btn-view") as HTMLButtonElement,
  btnCopyDoc: document.getElementById("btn-copy-doc") as HTMLButtonElement,
  btnExport: document.getElementById("btn-export") as HTMLButtonElement,
  btnTemplates: document.getElementById("btn-templates") as HTMLButtonElement,
  btnSettings: document.getElementById("btn-settings") as HTMLButtonElement,
  btnHelp: document.getElementById("btn-help") as HTMLButtonElement,
  btnTheme: document.getElementById("btn-theme") as HTMLButtonElement,
  btnAi: document.getElementById("btn-ai") as HTMLButtonElement,
  tbMin: document.getElementById("tb-min") as HTMLButtonElement,
  tbMax: document.getElementById("tb-max") as HTMLButtonElement,
  tbClose: document.getElementById("tb-close") as HTMLButtonElement,
};

let notebookRoot: string | null = null;
let currentPage: string | null = null;
let saveTimer: number | undefined;
let outlineTimer: number | undefined;
let watchTimer: number | undefined;
let lastWriteAt = 0;
let pendingMarkdown: string | null = null;
let sourceMode = false;
// Lista plana de páginas (rel_path + nombre) para resolver vínculos.
let pages: { rel: string; name: string }[] = [];

function setSaveState(state: SaveState): void {
  el.saveStatus.dataset.state = state;
}

function pageTitle(): string {
  if (!currentPage) return "";
  const base = currentPage.split("/").pop() ?? currentPage;
  return base.replace(/\.md$/, "");
}

function flattenPages(nodes: PageNode[], acc: { rel: string; name: string }[]): void {
  for (const n of nodes) {
    if (n.rel_path) acc.push({ rel: n.rel_path, name: n.name });
    if (n.children.length) flattenPages(n.children, acc);
  }
}

async function refreshTree(): Promise<void> {
  if (!notebookRoot) return;
  const nodes = await invoke<PageNode[]>("list_pages");
  pages = [];
  flattenPages(nodes, pages);
  renderTree(el.tree, nodes, currentPage, openPage, {
    getIcon: getPageIcon,
    onChangeIcon: (rel, ev) => {
      openIconPicker(ev.clientX, ev.clientY, getPageIcon(rel), (emoji) => {
        setPageIcon(rel, emoji);
        void refreshTree();
      });
    },
  });
}

async function activateNotebook(display: string): Promise<void> {
  notebookRoot = display;
  currentPage = null;
  el.btnNew.disabled = false;
  el.pagePath.textContent = display;
  showWelcome();
  updatePageButtons();
  await loadSettings();
  await loadPageIcons();
  await refreshTree();
}

async function openNotebook(): Promise<void> {
  await flushSave();
  const selected = await invoke<string | null>("open_notebook");
  if (selected) await activateNotebook(selected);
}

async function openRecentNotebook(path: string): Promise<void> {
  await flushSave();
  try {
    const display = await invoke<string | null>("open_recent", { path });
    if (display) await activateNotebook(display);
  } catch (err) {
    window.alert(String(err));
  }
}

async function autoOpenLast(): Promise<void> {
  try {
    const recents = await invoke<string[]>("list_recent_notebooks");
    if (recents.length > 0) await openRecentNotebook(recents[0]);
  } catch { /* sin recientes */ }
}

// Menú del intercambiador rápido de cuadernos.
async function openRecentsMenu(): Promise<void> {
  const prev = document.querySelector(".copy-menu");
  if (prev) { prev.remove(); return; }
  let recents: string[] = [];
  try { recents = await invoke<string[]>("list_recent_notebooks"); } catch { /* vacío */ }

  const menu = document.createElement("div");
  menu.className = "copy-menu recents-menu";
  for (const path of recents) {
    const name = path.split(/[\\/]/).pop() || path;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy-menu-item";
    b.title = path;
    b.textContent = name + (path === notebookRoot ? "  ●" : "");
    b.addEventListener("click", () => { menu.remove(); void openRecentNotebook(path); });
    menu.appendChild(b);
  }
  const other = document.createElement("button");
  other.type = "button";
  other.className = "copy-menu-item recents-other";
  other.textContent = "Abrir otro cuaderno…";
  other.addEventListener("click", () => { menu.remove(); void openNotebook(); });
  menu.appendChild(other);

  document.body.appendChild(menu);
  const r = el.btnRecents.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 4}px`;
  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== el.btnRecents) {
        menu.remove();
        document.removeEventListener("mousedown", close, true);
      }
    };
    document.addEventListener("mousedown", close, true);
  }, 0);
}

async function openPage(relPath: string): Promise<void> {
  if (!notebookRoot) return;
  await flushSave();
  const content = await invoke<string>("read_page", { relPath });
  currentPage = relPath;
  el.pagePath.textContent = relPath;
  el.editorWrap.classList.add("has-page");
  setContent(content);
  renderOutline(el.outline, content, gotoHeading);
  if (sourceMode) el.sourceView.value = content;
  setSaveState("idle");
  updatePageButtons();
  expandPathTo(relPath);
  await refreshTree();
  if (sourceMode) el.sourceView.focus(); else focusEditor();
}

function showWelcome(): void {
  el.editorWrap.classList.remove("has-page");
  setViewMode(false);
  clearOutline();
}

function scheduleSave(markdown: string): void {
  pendingMarkdown = markdown;
  setSaveState("saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), 800);
  scheduleOutline(markdown);
}

// --- Índice / navegación por títulos -----------------------------------------

function gotoHeading(index: number): void {
  const hs = document.querySelectorAll<HTMLElement>(
    "#editor .ProseMirror h1, #editor .ProseMirror h2, #editor .ProseMirror h3, #editor .ProseMirror h4, #editor .ProseMirror h5, #editor .ProseMirror h6"
  );
  hs[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scheduleOutline(markdown: string): void {
  window.clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(() => renderOutline(el.outline, markdown, gotoHeading), 400);
}

function clearOutline(): void {
  el.outline.innerHTML = "";
}

async function flushSave(): Promise<void> {
  if (!notebookRoot || !currentPage || pendingMarkdown === null) return;
  const md = pendingMarkdown;
  pendingMarkdown = null;
  window.clearTimeout(saveTimer);
  lastWriteAt = Date.now();
  try {
    await invoke("write_page", { relPath: currentPage, content: md });
    lastWriteAt = Date.now();
    setSaveState("saved");
  } catch (err) {
    console.error("Error guardando:", err);
    setSaveState("error");
  }
}

// Cambios externos en el cuaderno (git, Syncthing, otro editor) → recarga el
// árbol. Antirrebote + se ignora justo tras un guardado propio (no eran nuestros).
function onExternalChange(): void {
  if (!notebookRoot) return;
  if (Date.now() - lastWriteAt < 2500) return;
  window.clearTimeout(watchTimer);
  watchTimer = window.setTimeout(() => void refreshTree(), 700);
}

// --- Navegación por vínculos ([[wiki]] y enlaces markdown internos) ----------

function resolveWiki(target: string): string | null {
  const t = target.replace(/\.md$/, "").toLowerCase();
  let hit = pages.find((p) => p.rel.replace(/\.md$/, "").toLowerCase() === t);
  if (hit) return hit.rel;
  hit = pages.find((p) => p.name.toLowerCase() === t);
  return hit ? hit.rel : null;
}

function resolveRelative(href: string): string {
  // Resuelve un enlace relativo respecto al directorio de la página actual.
  const dir = currentPage ? currentPage.split("/").slice(0, -1) : [];
  const stack = [...dir];
  for (const part of href.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  let rel = stack.join("/");
  if (!/\.md$/.test(rel)) rel += ".md";
  return rel;
}

async function navigate(link: NavLink): Promise<void> {
  if (!notebookRoot) return;
  let rel = link.type === "wiki" ? resolveWiki(link.target) : null;

  if (link.type === "md") {
    const candidate = resolveRelative(link.target);
    rel = pages.some((p) => p.rel === candidate) ? candidate : null;
    if (!rel) {
      // ¿Ofrecer crear la página que falta?
      if (window.confirm(`La página "${link.target}" no existe. ¿Crearla?`)) {
        rel = await createNamed(candidate.replace(/\.md$/, ""));
      }
    }
  } else if (!rel) {
    if (window.confirm(`La nota "${link.target}" no existe. ¿Crearla?`)) {
      rel = await createNamed(link.target);
    }
  }

  if (rel) await openPage(rel);
}

async function createNamed(name: string): Promise<string | null> {
  try {
    const relPath = await invoke<string>("create_page", { name });
    await refreshTree();
    return relPath;
  } catch (err) {
    window.alert(String(err));
    return null;
  }
}

// --- Vista código ↔ formato --------------------------------------------------

function setViewMode(source: boolean): void {
  sourceMode = source;
  if (source) {
    el.sourceView.value = getContent();
    el.editorWrap.classList.add("source-mode");
    el.btnView.innerHTML = icon("eye");
    el.btnView.title = "Ver con formato";
    el.sourceView.focus();
  } else {
    if (el.editorWrap.classList.contains("source-mode")) {
      setContent(el.sourceView.value);
    }
    el.editorWrap.classList.remove("source-mode");
    el.btnView.innerHTML = icon("markup");
    el.btnView.title = "Ver código markdown";
  }
}

function toggleView(): void {
  if (!currentPage) return;
  setViewMode(!sourceMode);
  if (!sourceMode) focusEditor();
}

// --- Herramientas de contenido (barra) ---------------------------------------

async function insertImage(): Promise<void> {
  if (!currentPage) return;
  try {
    const rel = await invoke<string | null>("import_attachment", { page: currentPage });
    if (!rel) return;
    const alt = rel.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "imagen";
    insertMarkdown(`![${alt}](${rel})`, true);
  } catch (err) {
    window.alert(String(err));
  }
}

function insertWikiLink(): void {
  // Buscador de notas por nombre; permite también crear una nueva al vuelo.
  openNotePicker(pages, (target) => insertMarkdown(`[[${target}]]`));
}

function insertAdmonition(type: string): void {
  // Deja el cursor dentro del aviso para escribir el contenido (se sale con ↓).
  insertMarkdown(`> [!${type}]\n> \n`);
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function insertDate(): void {
  const d = new Date();
  insertMarkdown(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

function insertTime(): void {
  const d = new Date();
  insertMarkdown(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

// --- Copiar todo el documento (fuente o con formato) -------------------------

async function copyMarkdown(): Promise<void> {
  try { await navigator.clipboard.writeText(getContent()); } catch (e) { console.error(e); }
}

async function copyFormatted(): Promise<void> {
  const pm = document.querySelector("#editor .ProseMirror");
  const html = pm?.innerHTML ?? "";
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([getContent()], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await copyMarkdown();
  }
}

function openCopyMenu(): void {
  const prev = document.querySelector(".copy-menu");
  if (prev) { prev.remove(); return; }
  const menu = document.createElement("div");
  menu.className = "copy-menu";
  const items: [string, () => void][] = [
    ["Copiar como Markdown", () => void copyMarkdown()],
    ["Copiar con formato", () => void copyFormatted()],
  ];
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy-menu-item";
    b.textContent = label;
    b.addEventListener("click", () => { menu.remove(); fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = el.btnCopyDoc.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== el.btnCopyDoc) {
        menu.remove();
        document.removeEventListener("mousedown", close, true);
      }
    };
    document.addEventListener("mousedown", close, true);
  }, 0);
}

// --- IA ----------------------------------------------------------------------

async function aiCreateDoc(title: string, markdown: string): Promise<void> {
  if (!notebookRoot) { window.alert("Abre un cuaderno primero para crear el documento."); return; }
  try {
    const rel = await invoke<string>("create_page", { name: title });
    await invoke("write_page", { relPath: rel, content: markdown });
    await refreshTree();
    await openPage(rel);
  } catch (err) {
    window.alert(String(err));
  }
}

function openExportMenu(): void {
  const prev = document.querySelector(".copy-menu");
  if (prev) { prev.remove(); return; }
  const menu = document.createElement("div");
  menu.className = "copy-menu";
  const items: [string, () => void][] = [
    ["Exportar a HTML…", () => void exportHtml(pageTitle() || "documento")],
    ["Imprimir / Guardar como PDF", () => exportPdf()],
  ];
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy-menu-item";
    b.textContent = label;
    b.addEventListener("click", () => { menu.remove(); fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = el.btnExport.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== el.btnExport) {
        menu.remove();
        document.removeEventListener("mousedown", close, true);
      }
    };
    document.addEventListener("mousedown", close, true);
  }, 0);
}

function openAiPanel(): void {
  openAi({
    getMarkdown: () => getContent(),
    hasPage: () => currentPage !== null,
    onCreateDoc: aiCreateDoc,
    onInsert: (md) => insertMarkdown(md),
  });
}

// --- Búsqueda y paleta de comandos -------------------------------------------

function doSearch(): void {
  if (!notebookRoot) { window.alert("Abre un cuaderno para buscar."); return; }
  openSearch((rel) => void openPage(rel));
}

function doPalette(): void {
  const commands: PaletteCommand[] = [
    { label: "Buscar texto en el cuaderno", hint: "Ctrl+Mayús+F", run: doSearch },
    { label: "Nueva página", run: () => void newPage() },
    { label: "Abrir cuaderno", run: () => void openNotebook() },
    { label: "Cambiar de cuaderno (recientes)", run: () => void openRecentsMenu() },
    { label: "Ajustes del cuaderno", run: () => openSettings() },
    { label: "Asistente de IA", run: openAiPanel },
    { label: "Plantillas", run: () => openTemplates(pageTitle()) },
    { label: "Insertar imagen", run: () => void insertImage() },
    { label: "Copiar documento", run: () => openCopyMenu() },
    { label: "Exportar a HTML", run: () => void exportHtml(pageTitle() || "documento") },
    { label: "Imprimir / Guardar como PDF", run: exportPdf },
    { label: "Insertar fecha", run: insertDate },
    { label: "Insertar hora", run: insertTime },
    { label: "Cambiar tema claro/oscuro", run: toggleTheme },
    { label: "Cursor retro (activar/desactivar)", run: () => applyRetroCursor(document.body.classList.contains("retro-off")) },
    { label: "Mostrar/ocultar índice", run: () => applyOutlineCollapsed(!el.app.classList.contains("outline-collapsed")) },
    { label: "Buscar actualizaciones", run: () => void checkForUpdates(false) },
    { label: "Ayuda de markdown", run: () => openHelp() },
    { label: "Renombrar página", run: () => void renamePage() },
    { label: "Eliminar página", run: () => void deletePage() },
  ];
  openPalette(pages, commands, (rel) => void openPage(rel));
}

// --- Gestión de páginas ------------------------------------------------------

async function newPage(): Promise<void> {
  if (!notebookRoot) return;
  const suggestion = currentPage ? currentPage.replace(/\.md$/, "") + "/" : "";
  const name = window.prompt(
    "Nombre de la nueva página.\nUsa / para anidar (ej: Proyectos/PaperBridge):",
    suggestion
  );
  if (!name) return;
  const relPath = await createNamed(name);
  if (relPath) {
    expandPathTo(relPath);
    await openPage(relPath);
  }
}

async function renamePage(): Promise<void> {
  if (!notebookRoot || !currentPage) return;
  const base = currentPage.replace(/\.md$/, "");
  const name = window.prompt("Nuevo nombre (ruta relativa sin .md):", base);
  if (!name || name === base) return;
  await flushSave();
  try {
    const relPath = await invoke<string>("rename_page", {
      relPath: currentPage,
      newName: name,
    });
    currentPage = relPath;
    expandPathTo(relPath);
    await refreshTree();
    el.pagePath.textContent = relPath;
  } catch (err) {
    window.alert(String(err));
  }
}

async function deletePage(): Promise<void> {
  if (!notebookRoot || !currentPage) return;
  const ok = window.confirm(`¿Eliminar la página "${currentPage}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await invoke("delete_page", { relPath: currentPage });
    currentPage = null;
    pendingMarkdown = null;
    showWelcome();
    el.pagePath.textContent = notebookRoot;
    setSaveState("idle");
    updatePageButtons();
    await refreshTree();
  } catch (err) {
    window.alert(String(err));
  }
}

function updatePageButtons(): void {
  const hasPage = currentPage !== null;
  el.btnRename.disabled = !hasPage;
  el.btnDelete.disabled = !hasPage;
  el.btnView.disabled = !hasPage;
  el.btnCopyDoc.disabled = !hasPage;
  el.btnExport.disabled = !hasPage;
  el.btnTemplates.disabled = !hasPage;
  el.btnSettings.disabled = notebookRoot === null;
}

// --- Preferencias de interfaz (locales de la máquina) ------------------------

function applyToolbarHidden(hidden: boolean): void {
  el.toolbar.classList.toggle("hidden", hidden);
  localStorage.setItem("cuadernillo.toolbarHidden", hidden ? "1" : "0");
}

function applySidebarCollapsed(collapsed: boolean): void {
  el.app.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("cuadernillo.sidebarCollapsed", collapsed ? "1" : "0");
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  // El botón muestra el icono del tema al que cambiaría.
  el.btnTheme.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  localStorage.setItem("cuadernillo.theme", theme);
}

function toggleTheme(): void {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

function applyRetroCursor(on: boolean): void {
  document.body.classList.toggle("retro-off", !on);
  localStorage.setItem("cuadernillo.retroCursor", on ? "1" : "0");
}

function applyOutlineCollapsed(collapsed: boolean): void {
  el.app.classList.toggle("outline-collapsed", collapsed);
  el.btnToggleOutline.setAttribute("aria-pressed", collapsed ? "false" : "true");
  localStorage.setItem("cuadernillo.outlineCollapsed", collapsed ? "1" : "0");
}

function setupHeaderIcons(): void {
  el.btnOpen.insertAdjacentHTML("afterbegin", icon("open"));
  el.btnRecents.innerHTML = icon("history");
  el.btnNew.innerHTML = icon("plus");
  el.btnSearch.innerHTML = icon("search");
  el.btnToggleSidebar.innerHTML = icon("sidebar");
  el.btnToggleToolbar.innerHTML = icon("toolbar");
  el.btnToggleOutline.innerHTML = icon("sidebar-right");
  el.btnOutlineClose.innerHTML = icon("sidebar-right");
  el.btnView.innerHTML = icon("markup");
  el.btnCopyDoc.innerHTML = icon("copy");
  el.btnExport.innerHTML = icon("export");
  el.btnTemplates.innerHTML = icon("template");
  el.btnSettings.innerHTML = icon("settings");
  el.btnAi.innerHTML = icon("ai");
  el.btnHelp.innerHTML = icon("help");
  el.btnRename.innerHTML = icon("pencil");
  el.btnDelete.innerHTML = icon("trash");
}

function setupTitlebar(): void {
  el.tbMin.innerHTML = icon("minimize");
  el.tbMax.innerHTML = icon("maximize");
  el.tbClose.innerHTML = icon("close");
  const win = getCurrentWindow();
  el.tbMin.addEventListener("click", () => void win.minimize());
  el.tbMax.addEventListener("click", () => void win.toggleMaximize());
  el.tbClose.addEventListener("click", () => void win.close());
}

async function init(): Promise<void> {
  setupTitlebar();
  await createEditor("#editor", scheduleSave, (link) => void navigate(link));
  setupHeaderIcons();
  buildToolbar(el.toolbar, {
    insertImage: () => void insertImage(),
    insertWikiLink,
    insertAdmonition,
    alignImage: (a) => setImageAlign(a as "left" | "center" | "right" | "none"),
    insertDate,
    insertTime,
  });

  el.btnOpen.addEventListener("click", () => void openNotebook());
  el.btnRecents.addEventListener("click", () => void openRecentsMenu());
  el.btnNew.addEventListener("click", () => void newPage());
  el.btnRename.addEventListener("click", () => void renamePage());
  el.btnDelete.addEventListener("click", () => void deletePage());
  el.btnHelp.addEventListener("click", () => openHelp());
  el.btnTheme.addEventListener("click", () => toggleTheme());
  el.btnAi.addEventListener("click", () => openAiPanel());
  el.btnSearch.addEventListener("click", () => doSearch());
  el.btnTemplates.addEventListener("click", () => openTemplates(pageTitle()));
  el.btnSettings.addEventListener("click", () => openSettings());
  el.btnView.addEventListener("click", () => toggleView());
  el.btnCopyDoc.addEventListener("click", () => openCopyMenu());
  el.btnExport.addEventListener("click", () => openExportMenu());
  el.btnToggleToolbar.addEventListener("click", () =>
    applyToolbarHidden(!el.toolbar.classList.contains("hidden")));
  el.btnToggleSidebar.addEventListener("click", () =>
    applySidebarCollapsed(!el.app.classList.contains("sidebar-collapsed")));
  el.btnToggleOutline.addEventListener("click", () =>
    applyOutlineCollapsed(!el.app.classList.contains("outline-collapsed")));
  el.btnOutlineClose.addEventListener("click", () => applyOutlineCollapsed(true));

  el.sourceView.addEventListener("input", () => {
    if (sourceMode) scheduleSave(el.sourceView.value);
  });

  applyTheme(localStorage.getItem("cuadernillo.theme") === "dark" ? "dark" : "light");
  applyRetroCursor(localStorage.getItem("cuadernillo.retroCursor") !== "0");
  applyToolbarHidden(localStorage.getItem("cuadernillo.toolbarHidden") === "1");
  applySidebarCollapsed(localStorage.getItem("cuadernillo.sidebarCollapsed") === "1");
  applyOutlineCollapsed(localStorage.getItem("cuadernillo.outlineCollapsed") === "1");
  resetSettings();
  resetPageIcons();

  // Vigilancia de cambios externos en el cuaderno.
  void listen("notebook-changed", () => onExternalChange());

  window.addEventListener("blur", () => void flushSave());
  window.addEventListener("beforeunload", () => void flushSave());

  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void flushSave();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      doPalette();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      doSearch();
    }
  });

  // Recordar el último cuaderno: reabre el más reciente al arrancar.
  void autoOpenLast();

  // Comprobación silenciosa de actualizaciones al arrancar (a los 3 s).
  window.setTimeout(() => void checkForUpdates(true), 3000);
}

void init();
