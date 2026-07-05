import { icon } from "./icons";
import { format, insertMarkdown } from "./editor";

// Acciones opcionales que aportan fases posteriores (imágenes, vínculos wiki,
// admonitions). Si no se pasan, esos botones no se renderizan (nada de botones
// muertos).
export interface ToolbarHandlers {
  insertImage?: () => void;
  insertWikiLink?: () => void;
  insertAdmonition?: () => void;
}

interface Btn {
  id: string;
  icon: string;
  title: string;
  action: () => void;
}

function insertLinkPrompt(): void {
  const url = window.prompt("URL del enlace:", "https://");
  if (!url) return;
  const text = window.prompt("Texto del enlace:", url) || url;
  insertMarkdown(`[${text}](${url})`);
}

export function buildToolbar(container: HTMLElement, handlers: ToolbarHandlers = {}): void {
  container.innerHTML = "";

  const groups: Btn[][] = [
    [
      { id: "h1", icon: "h1", title: "Título 1", action: () => format.heading(1) },
      { id: "h2", icon: "h2", title: "Título 2", action: () => format.heading(2) },
      { id: "h3", icon: "h3", title: "Título 3", action: () => format.heading(3) },
      { id: "p", icon: "paragraph", title: "Párrafo normal", action: () => format.paragraph() },
    ],
    [
      { id: "bold", icon: "bold", title: "Negrita (Ctrl+B)", action: () => format.bold() },
      { id: "italic", icon: "italic", title: "Cursiva (Ctrl+I)", action: () => format.italic() },
      { id: "strike", icon: "strike", title: "Tachado", action: () => format.strike() },
      { id: "inlineCode", icon: "code", title: "Código en línea", action: () => format.inlineCode() },
    ],
    [
      { id: "ul", icon: "ul", title: "Lista con viñetas", action: () => format.bulletList() },
      { id: "ol", icon: "ol", title: "Lista numerada", action: () => format.orderedList() },
      { id: "quote", icon: "quote", title: "Cita", action: () => format.blockquote() },
      { id: "codeblock", icon: "codeblock", title: "Bloque de código", action: () => format.codeBlock() },
    ],
    [
      { id: "table", icon: "table", title: "Insertar tabla", action: () => format.table() },
      { id: "hr", icon: "hr", title: "Línea horizontal", action: () => format.hr() },
      { id: "link", icon: "link", title: "Insertar enlace", action: insertLinkPrompt },
    ],
  ];

  // Grupo de acciones de fases posteriores, solo si hay handler.
  const extra: Btn[] = [];
  if (handlers.insertImage)
    extra.push({ id: "image", icon: "image", title: "Insertar imagen", action: handlers.insertImage });
  if (handlers.insertWikiLink)
    extra.push({ id: "wiki", icon: "wiki", title: "Vínculo a nota [[…]]", action: handlers.insertWikiLink });
  if (handlers.insertAdmonition)
    extra.push({ id: "admonition", icon: "admonition", title: "Bloque de aviso (admonition)", action: handlers.insertAdmonition });
  if (extra.length) groups.push(extra);

  groups.forEach((group, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "toolbar-sep";
      container.appendChild(sep);
    }
    for (const b of group) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tbtn";
      btn.dataset.tool = b.id;
      btn.title = b.title;
      btn.setAttribute("aria-label", b.title);
      btn.innerHTML = icon(b.icon);
      // mousedown en vez de click para no perder la selección del editor.
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        b.action();
      });
      container.appendChild(btn);
    }
  });
}
