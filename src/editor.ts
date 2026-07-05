import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
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
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { indent } from "@milkdown/kit/plugin/indent";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll, callCommand, getMarkdown, insert, $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { codeBlockComponent, codeBlockConfig } from "@milkdown/kit/component/code-block";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { invoke } from "@tauri-apps/api/core";

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
                const from = pos + m.index;
                decos.push(
                  Decoration.inline(from, from + m[0].length, { class: "wikilink" })
                );
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
            const mm = /\[\[([^\]]+)\]\]/.exec(wiki.textContent ?? "");
            if (mm) {
              navigateCb({ type: "wiki", target: mm[1].split("|")[0].trim() });
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
          }
          return false;
        },
      },
    })
);

// --- Resolución de imágenes: src relativo → data-URL (solo en el DOM) ---------
// El modelo de ProseMirror conserva la ruta relativa (para el markdown); aquí
// solo cambiamos el src del <img> mostrado, sin afectar a lo que se guarda.
const imgCache = new Map<string, string>();
const imgFailed = new Set<string>();

function resolveImages(): void {
  const imgs = document.querySelectorAll<HTMLImageElement>("#editor img");
  imgs.forEach((img) => {
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
    .create();

  // Observa cambios del DOM del editor para resolver imágenes recién pintadas.
  const target = document.querySelector(mountSel);
  if (target) {
    observer = new MutationObserver(() => scheduleResolveImages());
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
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

export function focusEditor(): void {
  const pm = document.querySelector<HTMLElement>("#editor .ProseMirror");
  pm?.focus();
}

/** Inserta texto markdown en la posición del cursor (imágenes, plantillas…). */
export function insertMarkdown(md: string): void {
  if (!editor) return;
  editor.action(insert(md));
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
  bold: () => run(toggleStrongCommand.key),
  italic: () => run(toggleEmphasisCommand.key),
  strike: () => run(toggleStrikethroughCommand.key),
  inlineCode: () => run(toggleInlineCodeCommand.key),
  heading: (level: number) => run(wrapInHeadingCommand.key, level),
  paragraph: () => run(turnIntoTextCommand.key),
  bulletList: () => run(wrapInBulletListCommand.key),
  orderedList: () => run(wrapInOrderedListCommand.key),
  blockquote: () => run(wrapInBlockquoteCommand.key),
  codeBlock: () => run(createCodeBlockCommand.key),
  hr: () => run(insertHrCommand.key),
  table: () => run(insertTableCommand.key),
};
