import { icon } from "./icons";
import { format, insertMarkdown } from "./editor";

// Acciones opcionales de contenido. Si no se pasan, esos botones no se
// renderizan (nada de botones muertos).
export interface ToolbarHandlers {
  insertImage?: () => void;
  insertWikiLink?: () => void;
  insertAdmonition?: (type: string) => void;
  alignImage?: (align: string) => void;
  insertDate?: () => void;
  insertTime?: () => void;
}

const ADMONITIONS = [
  { value: "NOTE", iconHtml: "ℹ️", label: "Nota" },
  { value: "TIP", iconHtml: "💡", label: "Consejo" },
  { value: "IMPORTANT", iconHtml: "❗", label: "Importante" },
  { value: "WARNING", iconHtml: "⚠️", label: "Advertencia" },
  { value: "CAUTION", iconHtml: "🛑", label: "Precaución" },
];

interface MenuItem { value: string; iconHtml: string; label: string; }

// Desplegable genérico de la barra: un botón con menú de opciones.
function buildMenuDropdown(
  container: HTMLElement,
  mainIcon: string,
  title: string,
  items: MenuItem[],
  onPick: (value: string) => void
): void {
  const wrap = document.createElement("div");
  wrap.className = "tbtn-dropdown";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tbtn";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.setAttribute("aria-haspopup", "true");
  btn.innerHTML = icon(mainIcon);

  const menu = document.createElement("div");
  menu.className = "tbtn-menu";
  for (const it of items) {
    const mi = document.createElement("button");
    mi.type = "button";
    mi.className = "tbtn-menu-item";
    mi.innerHTML = `<span class="adm-menu-icon">${it.iconHtml}</span><span>${it.label}</span>`;
    mi.addEventListener("mousedown", (e) => {
      e.preventDefault();
      close();
      onPick(it.value);
    });
    menu.appendChild(mi);
  }

  const onOutside = (e: MouseEvent) => { if (!wrap.contains(e.target as Node)) close(); };
  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  function open(): void {
    menu.classList.add("open");
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEsc);
  }
  function close(): void {
    menu.classList.remove("open");
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onEsc);
  }
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    menu.classList.contains("open") ? close() : open();
  });

  wrap.append(btn, menu);
  container.appendChild(wrap);
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
      { id: "undo", icon: "undo", title: "Deshacer (Ctrl+Z)", action: () => format.undo() },
      { id: "redo", icon: "redo", title: "Rehacer (Ctrl+Y)", action: () => format.redo() },
    ],
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

  // Grupo de acciones de contenido (imagen, vínculo, fecha/hora), solo si hay handler.
  const extra: Btn[] = [];
  if (handlers.insertImage)
    extra.push({ id: "image", icon: "image", title: "Insertar imagen", action: handlers.insertImage });
  if (handlers.insertWikiLink)
    extra.push({ id: "wiki", icon: "wiki", title: "Vínculo a nota [[…]]", action: handlers.insertWikiLink });
  if (handlers.insertDate)
    extra.push({ id: "date", icon: "calendar", title: "Insertar fecha de hoy", action: handlers.insertDate });
  if (handlers.insertTime)
    extra.push({ id: "time", icon: "clock", title: "Insertar hora actual", action: handlers.insertTime });
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

  // Desplegables al final: alinear imagen y admonitions.
  if (handlers.alignImage || handlers.insertAdmonition) {
    const sep = document.createElement("span");
    sep.className = "toolbar-sep";
    container.appendChild(sep);
  }
  if (handlers.alignImage) {
    buildMenuDropdown(container, "align-center", "Alinear imagen", [
      { value: "left", iconHtml: icon("align-left"), label: "Izquierda" },
      { value: "center", iconHtml: icon("align-center"), label: "Centrar" },
      { value: "right", iconHtml: icon("align-right"), label: "Derecha" },
      { value: "none", iconHtml: icon("close"), label: "Quitar alineación" },
    ], handlers.alignImage);
  }
  if (handlers.insertAdmonition) {
    buildMenuDropdown(container, "admonition", "Bloque de aviso (admonition)",
      ADMONITIONS, handlers.insertAdmonition);
  }
}
