import "./fonts";
import { invoke } from "@tauri-apps/api/core";
import { createEditor, setContent, getContent, focusEditor, insertMarkdown, type NavLink } from "./editor";
import { renderTree, expandPathTo, type PageNode } from "./tree";
import { buildToolbar } from "./toolbar";
import { icon } from "./icons";
import { openHelp } from "./help";
import { openTemplates } from "./templates";
import { openSettings, loadSettings, resetSettings } from "./settings";
import { openNotePicker } from "./picker";
import { loadPageIcons, resetPageIcons, getPageIcon, setPageIcon, openIconPicker } from "./pageIcons";

type SaveState = "idle" | "saving" | "saved" | "error";

const el = {
  app: document.getElementById("app") as HTMLElement,
  tree: document.getElementById("tree") as HTMLElement,
  editor: document.getElementById("editor") as HTMLElement,
  editorWrap: document.getElementById("editor-wrap") as HTMLElement,
  sourceView: document.getElementById("source-view") as HTMLTextAreaElement,
  toolbar: document.getElementById("toolbar") as HTMLElement,
  pagePath: document.getElementById("page-path") as HTMLElement,
  saveStatus: document.getElementById("save-status") as HTMLElement,
  btnOpen: document.getElementById("btn-open-notebook") as HTMLButtonElement,
  btnNew: document.getElementById("btn-new-page") as HTMLButtonElement,
  btnRename: document.getElementById("btn-rename") as HTMLButtonElement,
  btnDelete: document.getElementById("btn-delete") as HTMLButtonElement,
  btnToggleSidebar: document.getElementById("btn-toggle-sidebar") as HTMLButtonElement,
  btnToggleToolbar: document.getElementById("btn-toggle-toolbar") as HTMLButtonElement,
  btnView: document.getElementById("btn-view") as HTMLButtonElement,
  btnTemplates: document.getElementById("btn-templates") as HTMLButtonElement,
  btnSettings: document.getElementById("btn-settings") as HTMLButtonElement,
  btnHelp: document.getElementById("btn-help") as HTMLButtonElement,
};

let notebookRoot: string | null = null;
let currentPage: string | null = null;
let saveTimer: number | undefined;
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

async function openNotebook(): Promise<void> {
  const selected = await invoke<string | null>("open_notebook");
  if (!selected) return;
  notebookRoot = selected;
  currentPage = null;
  el.btnNew.disabled = false;
  el.pagePath.textContent = selected;
  showWelcome();
  updatePageButtons();
  await loadSettings();
  await loadPageIcons();
  await refreshTree();
}

async function openPage(relPath: string): Promise<void> {
  if (!notebookRoot) return;
  await flushSave();
  const content = await invoke<string>("read_page", { relPath });
  currentPage = relPath;
  el.pagePath.textContent = relPath;
  el.editorWrap.classList.add("has-page");
  setContent(content);
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
}

function scheduleSave(markdown: string): void {
  pendingMarkdown = markdown;
  setSaveState("saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), 800);
}

async function flushSave(): Promise<void> {
  if (!notebookRoot || !currentPage || pendingMarkdown === null) return;
  const md = pendingMarkdown;
  pendingMarkdown = null;
  window.clearTimeout(saveTimer);
  try {
    await invoke("write_page", { relPath: currentPage, content: md });
    setSaveState("saved");
  } catch (err) {
    console.error("Error guardando:", err);
    setSaveState("error");
  }
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
    insertMarkdown(`![${alt}](${rel})`);
  } catch (err) {
    window.alert(String(err));
  }
}

function insertWikiLink(): void {
  // Buscador de notas por nombre; permite también crear una nueva al vuelo.
  openNotePicker(pages, (target) => insertMarkdown(`[[${target}]]`));
}

function insertAdmonition(type: string): void {
  insertMarkdown(`> [!${type}]\n> \n`);
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

function setupHeaderIcons(): void {
  el.btnOpen.insertAdjacentHTML("afterbegin", icon("open"));
  el.btnNew.innerHTML = icon("plus");
  el.btnToggleSidebar.innerHTML = icon("sidebar");
  el.btnToggleToolbar.innerHTML = icon("toolbar");
  el.btnView.innerHTML = icon("markup");
  el.btnTemplates.innerHTML = icon("template");
  el.btnSettings.innerHTML = icon("settings");
  el.btnHelp.innerHTML = icon("help");
  el.btnRename.innerHTML = icon("pencil");
  el.btnDelete.innerHTML = icon("trash");
}

async function init(): Promise<void> {
  await createEditor("#editor", scheduleSave, (link) => void navigate(link));
  setupHeaderIcons();
  buildToolbar(el.toolbar, {
    insertImage: () => void insertImage(),
    insertWikiLink,
    insertAdmonition,
  });

  el.btnOpen.addEventListener("click", () => void openNotebook());
  el.btnNew.addEventListener("click", () => void newPage());
  el.btnRename.addEventListener("click", () => void renamePage());
  el.btnDelete.addEventListener("click", () => void deletePage());
  el.btnHelp.addEventListener("click", () => openHelp());
  el.btnTemplates.addEventListener("click", () => openTemplates(pageTitle()));
  el.btnSettings.addEventListener("click", () => openSettings());
  el.btnView.addEventListener("click", () => toggleView());
  el.btnToggleToolbar.addEventListener("click", () =>
    applyToolbarHidden(!el.toolbar.classList.contains("hidden")));
  el.btnToggleSidebar.addEventListener("click", () =>
    applySidebarCollapsed(!el.app.classList.contains("sidebar-collapsed")));

  el.sourceView.addEventListener("input", () => {
    if (sourceMode) scheduleSave(el.sourceView.value);
  });

  applyToolbarHidden(localStorage.getItem("cuadernillo.toolbarHidden") === "1");
  applySidebarCollapsed(localStorage.getItem("cuadernillo.sidebarCollapsed") === "1");
  resetSettings();
  resetPageIcons();

  window.addEventListener("blur", () => void flushSave());
  window.addEventListener("beforeunload", () => void flushSave());

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void flushSave();
    }
  });
}

void init();
