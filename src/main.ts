import { invoke } from "@tauri-apps/api/core";
import { createEditor, setContent, focusEditor } from "./editor";
import { renderTree, expandPathTo, type PageNode } from "./tree";

type SaveState = "idle" | "saving" | "saved" | "error";

const el = {
  tree: document.getElementById("tree") as HTMLElement,
  editor: document.getElementById("editor") as HTMLElement,
  pagePath: document.getElementById("page-path") as HTMLElement,
  saveStatus: document.getElementById("save-status") as HTMLElement,
  btnOpen: document.getElementById("btn-open-notebook") as HTMLButtonElement,
  btnNew: document.getElementById("btn-new-page") as HTMLButtonElement,
  btnRename: document.getElementById("btn-rename") as HTMLButtonElement,
  btnDelete: document.getElementById("btn-delete") as HTMLButtonElement,
};

let notebookRoot: string | null = null;
let currentPage: string | null = null;
let saveTimer: number | undefined;
let pendingMarkdown: string | null = null;

function setSaveState(state: SaveState): void {
  el.saveStatus.dataset.state = state;
}

async function refreshTree(): Promise<void> {
  if (!notebookRoot) return;
  const nodes = await invoke<PageNode[]>("list_pages");
  renderTree(el.tree, nodes, currentPage, openPage);
}

async function openNotebook(): Promise<void> {
  // El backend abre el diálogo nativo y fija la raíz del cuaderno; el frontend
  // solo recibe la ruta ya aprobada para mostrarla. La raíz nunca se envía.
  const selected = await invoke<string | null>("open_notebook");
  if (!selected) return;
  notebookRoot = selected;
  currentPage = null;
  el.btnNew.disabled = false;
  el.pagePath.textContent = selected;
  el.editor.classList.remove("visible");
  updatePageButtons();
  await refreshTree();
}

async function openPage(relPath: string): Promise<void> {
  if (!notebookRoot) return;
  await flushSave();
  const content = await invoke<string>("read_page", { relPath });
  currentPage = relPath;
  el.pagePath.textContent = relPath;
  el.editor.classList.add("visible");
  setContent(content);
  setSaveState("idle");
  updatePageButtons();
  expandPathTo(relPath);
  await refreshTree();
  focusEditor();
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

async function newPage(): Promise<void> {
  if (!notebookRoot) return;
  const suggestion = currentPage ? currentPage.replace(/\.md$/, "") + "/" : "";
  const name = window.prompt(
    "Nombre de la nueva página.\nUsa / para anidar (ej: Proyectos/PaperBridge):",
    suggestion
  );
  if (!name) return;
  try {
    const relPath = await invoke<string>("create_page", { name });
    expandPathTo(relPath);
    await refreshTree();
    await openPage(relPath);
  } catch (err) {
    window.alert(String(err));
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
    el.editor.classList.remove("visible");
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
}

async function init(): Promise<void> {
  await createEditor("#editor", scheduleSave);
  el.btnOpen.addEventListener("click", () => void openNotebook());
  el.btnNew.addEventListener("click", () => void newPage());
  el.btnRename.addEventListener("click", () => void renamePage());
  el.btnDelete.addEventListener("click", () => void deletePage());

  // Guardado al perder foco de la ventana y antes de cerrar.
  window.addEventListener("blur", () => void flushSave());
  window.addEventListener("beforeunload", () => void flushSave());

  // Atajo: Ctrl+S fuerza guardado inmediato.
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void flushSave();
    }
  });
}

void init();
