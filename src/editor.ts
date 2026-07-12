import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  gfm,
  toggleStrikethroughCommand,
  insertTableCommand,
} from "@milkdown/kit/preset/gfm";
import { history, undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { indent } from "@milkdown/kit/plugin/indent";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll, callCommand, getMarkdown, getHTML, insert, $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { codeBlockComponent, codeBlockConfig } from "@milkdown/kit/component/code-block";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type CodeTheme = "dark" | "light";

// Extensiones de CodeMirror según el tema elegido para los bloques de código.
function codeExtensions(theme: CodeTheme) {
  return theme === "light"
    ? [syntaxHighlighting(defaultHighlightStyle)]
    : [oneDark];
}

export type OnChange = (markdown: string) => void;
export interface NavLink { type: "wiki" | "md"; target: string; }
export type OnNavigate = (link: NavLink) => void;

let editor: Editor | null = null;
let suppress = false;
let navigateCb: OnNavigate = () => {};

const ADM_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
const WIKI_RE = /\[\[([^\]\n]+)\]\]/g;

// Plugin propio de ProseMirror: decora (sin tocar el documento) los vínculos
// [[wiki]] y detecta blockquotes que son admonitions estilo GitHub, y gestiona
// la navegación al hacer clic en vínculos wiki y en enlaces markdown internos.
const enhancePlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("cuadernillo-enhance"),
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            // Vínculos [[wiki]] y etiqueta [!TIPO] como decoración inline.
            if (node.isText && node.text) {
              const text = node.text;
              WIKI_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = WIKI_RE.exec(text))) {
                const start = pos + m.index;
                const end = start + m[0].length;
                const openTo = start + 2;      // tras "[["
                const closeFrom = end - 2;     // antes de "]]"
                const inner = m[1];
                const pipe = inner.indexOf("|");
                const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
                // Oculta los corchetes.
                decos.push(Decoration.inline(start, openTo, { class: "wiki-mark" }));
                decos.push(Decoration.inline(closeFrom, end, { class: "wiki-mark" }));
                if (pipe >= 0) {
                  // Con alias: oculta "destino|" y muestra solo el alias.
                  const aliasStart = openTo + pipe + 1;
                  decos.push(Decoration.inline(openTo, aliasStart, { class: "wiki-mark" }));
                  decos.push(Decoration.inline(aliasStart, closeFrom, { class: "wikilink", "data-target": target }));
                } else {
                  decos.push(Decoration.inline(openTo, closeFrom, { class: "wikilink", "data-target": target }));
                }
              }
              const adm = ADM_RE.exec(text.trim());
              if (adm) {
                const start = pos + text.indexOf(adm[0]);
                decos.push(
                  Decoration.inline(start, start + adm[0].length, {
                    class: `adm-tag adm-tag-${adm[1].toLowerCase()}`,
                  })
                );
              }
            }
            // Blockquote-admonition: decoración de nodo con clase de color.
            if (node.type.name === "blockquote") {
              const marker = ADM_RE.exec((node.firstChild?.textContent ?? "").trim());
              if (marker) {
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: `admonition adm-${marker[1].toLowerCase()}`,
                  })
                );
              }
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
        handleClick(_view, _pos, event) {
          const el = event.target as HTMLElement;
          const wiki = el.closest(".wikilink");
          if (wiki) {
            const target = wiki.getAttribute("data-target") ?? "";
            if (target) {
              navigateCb({ type: "wiki", target });
              return true;
            }
          }
          const a = el.closest("a");
          if (a) {
            const href = a.getAttribute("href") ?? "";
            if (href && !/^[a-z]+:/i.test(href) && !href.startsWith("#")) {
              navigateCb({ type: "md", target: href });
              return true;
            }
            if (/^https?:/i.test(href)) {
              void openUrl(href); // enlace externo → navegador del sistema
              return true;
            }
          }
          return false;
        },
      },
    })
);

// Garantiza que el documento SIEMPRE termina en un párrafo vacío, para que el
// cursor pueda salir con ↓ de cualquier bloque (código, tabla, cita) que quede
// al final. Junto al gap-cursor, evita que el cursor quede atrapado.
const trailingParagraph = $prose(
  () =>
    new Plugin({
      key: new PluginKey("cuadernillo-trailing"),
      appendTransaction(_trs, _oldState, state) {
        const last = state.doc.lastChild;
        if (last && last.type.name !== "paragraph") {
          const para = state.schema.nodes.paragraph;
          if (para) return state.tr.insert(state.doc.content.size, para.create());
        }
        return null;
      },
    })
);

// Cursor retro tipo terminal: un bloque sólido parpadeante superpuesto en la
// posición del cursor (con mezcla "difference" invierte el carácter debajo,
// como una consola clásica). Oculta el caret nativo por CSS.
const blockCursor = $prose(
  () =>
    new Plugin({
      key: new PluginKey("cuadernillo-block-cursor"),
      view(editorView) {
        const caret = document.createElement("div");
        caret.className = "retro-caret";
        document.body.appendChild(caret);

        const update = () => {
          const sel = editorView.state.selection;
          if (!editorView.hasFocus() || !sel.empty) {
            caret.style.display = "none";
            return;
          }
          try {
            const c = editorView.coordsAtPos(sel.head);
            const h = Math.max(12, c.bottom - c.top);
            caret.style.display = "block";
            caret.style.height = `${h}px`;
            caret.style.width = `${Math.round(h * 0.55)}px`;
            caret.style.left = `${c.left}px`;
            caret.style.top = `${c.top}px`;
          } catch {
            caret.style.display = "none";
          }
        };

        const onScroll = () => update();
        document.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        editorView.dom.addEventListener("focus", update);
        editorView.dom.addEventListener("blur", () => { caret.style.display = "none"; });
        update();

        return {
          update: () => update(),
          destroy: () => {
            caret.remove();
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onScroll);
          },
        };
      },
    })
);

// --- Buscar y reemplazar dentro del documento --------------------------------

interface FindState { query: string; matches: { from: number; to: number }[]; active: number; }
const findKey = new PluginKey<FindState>("cuadernillo-find");

function computeMatches(doc: import("@milkdown/kit/prose/model").Node, query: string): { from: number; to: number }[] {
  const q = query.toLowerCase();
  const out: { from: number; to: number }[] = [];
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(q);
    while (idx !== -1) {
      out.push({ from: pos + idx, to: pos + idx + q.length });
      idx = text.indexOf(q, idx + q.length);
    }
  });
  return out;
}

const findPlugin = $prose(
  () =>
    new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ query: "", matches: [], active: 0 }),
        apply(tr, prev) {
          const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
          let query = meta?.query !== undefined ? meta.query : prev.query;
          let active = meta?.active !== undefined ? meta.active : prev.active;
          if (meta?.query !== undefined) active = 0;
          if (!query) return { query: "", matches: [], active: 0 };
          if (tr.docChanged || meta?.query !== undefined) {
            const matches = computeMatches(tr.doc, query);
            return { query, matches, active: Math.min(active, Math.max(0, matches.length - 1)) };
          }
          return { query, matches: prev.matches, active };
        },
      },
      props: {
        decorations(state) {
          const fs = findKey.getState(state);
          if (!fs || !fs.query) return DecorationSet.empty;
          return DecorationSet.create(
            state.doc,
            fs.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, { class: i === fs.active ? "find-match find-active" : "find-match" })
            )
          );
        },
      },
    })
);

function withView<T>(fn: (view: import("@milkdown/kit/prose/view").EditorView) => T): T | undefined {
  if (!editor) return undefined;
  return editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

export function findInfo(): { count: number; active: number } {
  const fs = withView((v) => findKey.getState(v.state));
  return { count: fs?.matches.length ?? 0, active: fs?.active ?? 0 };
}

export function findSetQuery(query: string): { count: number; active: number } {
  withView((v) => v.dispatch(v.state.tr.setMeta(findKey, { query })));
  return findInfo();
}

function goToActive(delta: number): { count: number; active: number } {
  withView((v) => {
    const fs = findKey.getState(v.state);
    if (!fs || fs.matches.length === 0) return;
    const active = (fs.active + delta + fs.matches.length) % fs.matches.length;
    const m = fs.matches[active];
    v.dispatch(
      v.state.tr
        .setMeta(findKey, { active })
        .setSelection(TextSelection.create(v.state.doc, m.from, m.to))
        .scrollIntoView()
    );
  });
  return findInfo();
}
export const findNext = () => goToActive(1);
export const findPrev = () => goToActive(-1);

export function findReplace(replacement: string): { count: number; active: number } {
  withView((v) => {
    const fs = findKey.getState(v.state);
    const m = fs?.matches[fs.active];
    if (!m) return;
    v.dispatch(v.state.tr.insertText(replacement, m.from, m.to));
  });
  return findInfo();
}

export function findReplaceAll(replacement: string): number {
  let n = 0;
  withView((v) => {
    const fs = findKey.getState(v.state);
    if (!fs || fs.matches.length === 0) return;
    n = fs.matches.length;
    const tr = v.state.tr;
    for (let i = fs.matches.length - 1; i >= 0; i--) {
      tr.insertText(replacement, fs.matches[i].from, fs.matches[i].to);
    }
    v.dispatch(tr);
  });
  return n;
}

export function findClear(): void {
  withView((v) => v.dispatch(v.state.tr.setMeta(findKey, { query: "" })));
}

// --- Resolución de imágenes: src relativo → data-URL (solo en el DOM) ---------
// El modelo de ProseMirror conserva la ruta relativa (para el markdown); aquí
// solo cambiamos el src del <img> mostrado, sin afectar a lo que se guarda.
const imgCache = new Map<string, string>();
const imgFailed = new Set<string>();

function resolveImages(): void {
  const imgs = document.querySelectorAll<HTMLImageElement>("#editor img");
  imgs.forEach((img) => {
    // Alineación: se guarda en el título del markdown (![](url "center")).
    const align = (img.getAttribute("title") ?? "").toLowerCase();
    img.classList.remove("img-left", "img-center", "img-right");
    if (align === "left" || align === "center" || align === "right") {
      img.classList.add(`img-${align}`);
    }

    const raw = img.getAttribute("src") ?? "";
    if (!raw || /^(data|https?|blob|asset|file):/i.test(raw)) return;
    const cached = imgCache.get(raw);
    if (cached) {
      if (img.src !== cached) img.src = cached;
      return;
    }
    if (imgFailed.has(raw)) return; // no machacar el log en cada tecla
    // La ruta puede venir codificada (%20) si el nombre tenía espacios.
    let rel = raw;
    try { rel = decodeURIComponent(raw); } catch { /* ruta ya literal */ }
    invoke<string>("read_attachment", { rel })
      .then((url) => {
        imgCache.set(raw, url);
        img.src = url;
      })
      .catch((e) => {
        imgFailed.add(raw);
        console.error("[Cuadernillo] No se pudo cargar la imagen:", raw, e);
      });
  });
}

let imgScheduled = false;
function scheduleResolveImages(): void {
  if (imgScheduled) return;
  imgScheduled = true;
  requestAnimationFrame(() => {
    imgScheduled = false;
    resolveImages();
  });
  // Reintentos: la imagen puede pintarse un poco después de la transacción.
  window.setTimeout(resolveImages, 120);
  window.setTimeout(resolveImages, 400);
}

// Parámetros de construcción guardados para poder reconstruir (cambio de tema).
let mountSel = "#editor";
let onChangeCb: OnChange = () => {};
let codeThemeCurrent: CodeTheme = "dark";
let observer: MutationObserver | null = null;

async function build(): Promise<void> {
  document.documentElement.setAttribute("data-code-theme", codeThemeCurrent);
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, mountSel);
      ctx.set(defaultValueCtx, "");
      ctx.get(listenerCtx).markdownUpdated((_ctx, md, prev) => {
        if (suppress || md === prev) return;
        onChangeCb(md);
        scheduleResolveImages();
      });
      // Bloques de código con CodeMirror: todos los lenguajes + tema elegido.
      ctx.update(codeBlockConfig.key, (prev) => ({
        ...prev,
        languages: [...languages],
        extensions: codeExtensions(codeThemeCurrent),
      }));
    })
    .use(commonmark)
    .use(gfm)
    .use(codeBlockComponent)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(cursor)
    .use(listener)
    .use(enhancePlugin)
    .use(trailingParagraph)
    .use(blockCursor)
    .use(findPlugin)
    .create();

  // Corrector ortográfico del webview (subrayado + sugerencias con clic derecho).
  document.querySelector<HTMLElement>(`${mountSel} .ProseMirror`)?.setAttribute("spellcheck", "true");

  // Observa cambios del DOM del editor para resolver imágenes recién pintadas.
  const target = document.querySelector(mountSel);
  if (target) {
    observer = new MutationObserver(() => scheduleResolveImages());
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "title"],
    });
  }
}

export async function createEditor(
  mount: string,
  onChange: OnChange,
  onNavigate: OnNavigate,
  codeTheme: CodeTheme = "dark"
): Promise<void> {
  mountSel = mount;
  onChangeCb = onChange;
  navigateCb = onNavigate;
  codeThemeCurrent = codeTheme;
  await build();
}

/** Cambia el tema de los bloques de código reconstruyendo el editor. */
export async function setCodeTheme(theme: CodeTheme): Promise<void> {
  if (!editor || theme === codeThemeCurrent) return;
  const md = getContent();
  codeThemeCurrent = theme;
  observer?.disconnect();
  observer = null;
  try {
    await editor.destroy();
  } catch { /* ignore */ }
  await build();
  setContent(md);
}

export function setContent(markdown: string): void {
  if (!editor) return;
  suppress = true;
  editor.action(replaceAll(markdown, true));
  scheduleResolveImages();
  // El listener se dispara de forma asíncrona; liberamos en el siguiente tick largo.
  setTimeout(() => { suppress = false; }, 50);
}

/** Devuelve el markdown actual del documento (para la vista de código crudo). */
export function getContent(): string {
  if (!editor) return "";
  return editor.action(getMarkdown());
}

/** HTML limpio del documento, con las imágenes incrustadas como data-URL (para
 *  exportar a un fichero autocontenido). */
export async function getDocumentHtml(): Promise<string> {
  if (!editor) return "";
  const div = document.createElement("div");
  div.innerHTML = editor.action(getHTML());
  for (const img of Array.from(div.querySelectorAll("img"))) {
    const raw = img.getAttribute("src") ?? "";
    if (!raw || /^(data|https?):/i.test(raw)) continue;
    let rel = raw;
    try { rel = decodeURIComponent(raw); } catch { /* ya literal */ }
    try {
      const url = imgCache.get(raw) ?? (await invoke<string>("read_attachment", { rel }));
      img.setAttribute("src", url);
    } catch { /* deja la ruta relativa */ }
  }
  return div.innerHTML;
}

export function focusEditor(): void {
  const pm = document.querySelector<HTMLElement>("#editor .ProseMirror");
  pm?.focus();
}

/** Inserta texto markdown en la posición del cursor. Si `block`, deja el cursor
 *  en una línea nueva debajo (para no quedar atrapado dentro del elemento). */
export function insertMarkdown(md: string, block = false): void {
  if (!editor) return;
  editor.action(insert(md));
  if (block) moveToNewLineAfter();
  scheduleResolveImages();
  focusEditor();
}

/** Texto plano de la selección actual del editor (vacío si no hay selección). */
export function getSelectionText(): string {
  if (!editor) return "";
  return editor.action((ctx) => {
    const { state } = ctx.get(editorViewCtx);
    const { from, to } = state.selection;
    return state.doc.textBetween(from, to, "\n\n", "\n");
  });
}

/** Reemplaza la selección actual por el markdown dado (si no hay selección,
 *  inserta en el cursor). Lo usa el chat para reescribir el texto marcado. */
export function replaceSelection(md: string): void {
  if (!editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view.state.selection.empty) view.dispatch(view.state.tr.deleteSelection());
  });
  insertMarkdown(md);
}

// Crea un párrafo vacío tras el bloque superior actual y coloca ahí el cursor
// (equivale a "Enter" al terminar de insertar un elemento).
function moveToNewLineAfter(): void {
  if (!editor) return;
  editor.action((ctx) => {
    try {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const $to = state.selection.$to;
      const pos = $to.depth === 0 ? $to.pos : $to.after(1);
      const para = state.schema.nodes.paragraph?.createAndFill();
      if (!para) return;
      const tr = state.tr.insert(pos, para);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr.scrollIntoView());
    } catch { /* posición no válida: se ignora */ }
  });
}

// Tras aplicar una marca a una selección (p. ej. negrita a una palabra), coloca
// el cursor al final y limpia las marcas activas, para que lo siguiente que se
// escriba salga sin formato (no queda "atrapado" dentro de la marca).
function collapseSelectionEnd(): void {
  if (!editor) return;
  editor.action((ctx) => {
    try {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const sel = state.selection;
      if (sel.empty) return;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, sel.to));
      tr.setStoredMarks([]);
      dispatch(tr);
    } catch { /* se ignora */ }
  });
}

/**
 * Alinea la imagen seleccionada (o la más cercana al cursor) guardando la
 * alineación en el título del markdown: `![alt](url "center")`. "none" la quita.
 */
export function setImageAlign(align: "left" | "center" | "right" | "none"): void {
  if (!editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const sel = state.selection;
    let pos = -1;
    let node: import("@milkdown/kit/prose/model").Node | null = null;
    if (sel instanceof NodeSelection && sel.node.type.name === "image") {
      pos = sel.from;
      node = sel.node;
    } else {
      state.doc.nodesBetween(Math.max(0, sel.from - 1), sel.to + 1, (n, p) => {
        if (pos < 0 && n.type.name === "image") { pos = p; node = n; }
      });
    }
    if (pos < 0 || !node) return;
    const title = align === "none" ? null : align;
    view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, title }));
  });
  scheduleResolveImages();
  focusEditor();
}

// --- Comandos de formato expuestos para la barra de herramientas -------------
// Se disparan con callCommand(cmd.key, payload). Envolvemos cada uno para que
// main.ts/toolbar.ts no tengan que importar nada de Milkdown.

function run(key: unknown, payload?: unknown): void {
  if (!editor) return;
  editor.action(callCommand(key as never, payload as never));
  focusEditor();
}

export const format = {
  undo: () => run(undoCommand.key),
  redo: () => run(redoCommand.key),
  // Marcas: tras aplicarlas a una palabra, el cursor sale al final sin marca.
  bold: () => { run(toggleStrongCommand.key); collapseSelectionEnd(); },
  italic: () => { run(toggleEmphasisCommand.key); collapseSelectionEnd(); },
  strike: () => { run(toggleStrikethroughCommand.key); collapseSelectionEnd(); },
  inlineCode: () => { run(toggleInlineCodeCommand.key); collapseSelectionEnd(); },
  heading: (level: number) => run(wrapInHeadingCommand.key, level),
  paragraph: () => run(turnIntoTextCommand.key),
  bulletList: () => run(wrapInBulletListCommand.key),
  orderedList: () => run(wrapInOrderedListCommand.key),
  blockquote: () => run(wrapInBlockquoteCommand.key),
  // Con contenido interno: el cursor se queda dentro (se sale con ↓).
  codeBlock: () => run(createCodeBlockCommand.key),
  table: () => run(insertTableCommand.key),
  // Sin contenido interno: el cursor salta a una línea nueva debajo.
  hr: () => { run(insertHrCommand.key); moveToNewLineAfter(); },
};
