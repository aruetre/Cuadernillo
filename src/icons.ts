// Iconos SVG inline. El CSP de la app bloquea recursos externos, así que no se
// puede usar una icon-font de CDN. Cada icono es un trazo de 24x24 con
// currentColor, para que herede el color del botón. Uso: icon("bold").

const P = 'stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';

const PATHS: Record<string, string> = {
  // Formato de texto
  bold: `<path d="M6 4h8a4 4 0 0 1 0 8H6z" ${P}/><path d="M6 12h9a4 4 0 0 1 0 8H6z" ${P}/>`,
  italic: `<line x1="19" y1="4" x2="10" y2="4" ${P}/><line x1="14" y1="20" x2="5" y2="20" ${P}/><line x1="15" y1="4" x2="9" y2="20" ${P}/>`,
  strike: `<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6" ${P}/><line x1="4" y1="12" x2="20" y2="12" ${P}/>`,
  code: `<polyline points="16 18 22 12 16 6" ${P}/><polyline points="8 6 2 12 8 18" ${P}/>`,
  h1: `<path d="M4 6v12M12 6v12M4 12h8" ${P}/><path d="M17 10l2-1v9" ${P}/>`,
  h2: `<path d="M4 6v12M11 6v12M4 12h7" ${P}/><path d="M16 10a2 2 0 1 1 3 1.7L16 18h4" ${P}/>`,
  h3: `<path d="M4 6v12M11 6v12M4 12h7" ${P}/><path d="M16 9h3l-2 3a2 2 0 1 1-1 3.5" ${P}/>`,
  paragraph: `<path d="M13 4H8a4 4 0 0 0 0 8h5M13 4v16M17 4v16" ${P}/>`,
  // Bloques
  ul: `<line x1="9" y1="6" x2="20" y2="6" ${P}/><line x1="9" y1="12" x2="20" y2="12" ${P}/><line x1="9" y1="18" x2="20" y2="18" ${P}/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>`,
  ol: `<line x1="10" y1="6" x2="20" y2="6" ${P}/><line x1="10" y1="12" x2="20" y2="12" ${P}/><line x1="10" y1="18" x2="20" y2="18" ${P}/><path d="M4 4v4M3 8h2M3 6h1" ${P}/><path d="M3 12h2l-2 3h2" ${P}/><path d="M3 17h2v1.5H3M3 19h2" ${P}/>`,
  quote: `<path d="M6 7h6v6a4 4 0 0 1-4 4M14 7h6v6a4 4 0 0 1-4 4" ${P}/>`,
  codeblock: `<rect x="3" y="4" width="18" height="16" rx="2" ${P}/><polyline points="9 9 7 12 9 15" ${P}/><polyline points="15 9 17 12 15 15" ${P}/>`,
  hr: `<line x1="3" y1="12" x2="21" y2="12" ${P}/>`,
  table: `<rect x="3" y="4" width="18" height="16" rx="1" ${P}/><line x1="3" y1="10" x2="21" y2="10" ${P}/><line x1="3" y1="15" x2="21" y2="15" ${P}/><line x1="12" y1="4" x2="12" y2="20" ${P}/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="2" ${P}/><circle cx="8.5" cy="9.5" r="1.5" ${P}/><path d="M4 18l5-5 3 3 3-3 5 5" ${P}/>`,
  link: `<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" ${P}/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" ${P}/>`,
  wiki: `<path d="M4 5h16v14H4z" ${P}/><path d="M9 5v14M15 5v14" ${P}/>`,
  admonition: `<path d="M12 3l9 16H3z" ${P}/><line x1="12" y1="10" x2="12" y2="14" ${P}/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>`,
  // Interfaz
  eye: `<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" ${P}/><circle cx="12" cy="12" r="3" ${P}/>`,
  markup: `<polyline points="8 6 3 12 8 18" ${P}/><polyline points="16 6 21 12 16 18" ${P}/><line x1="13" y1="4" x2="11" y2="20" ${P}/>`,
  help: `<circle cx="12" cy="12" r="9" ${P}/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" ${P}/><circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none"/>`,
  template: `<rect x="4" y="3" width="16" height="18" rx="2" ${P}/><line x1="8" y1="3" x2="8" y2="21" ${P}/><line x1="11" y1="8" x2="17" y2="8" ${P}/><line x1="11" y1="12" x2="17" y2="12" ${P}/><line x1="11" y1="16" x2="15" y2="16" ${P}/>`,
  settings: `<circle cx="12" cy="12" r="3" ${P}/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1.15V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 2.6 15H2.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 11 2.5V2.4a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 17 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21.4 9v.09a2 2 0 0 1 0 4z" ${P}/>`,
  sidebar: `<rect x="3" y="4" width="18" height="16" rx="2" ${P}/><line x1="9" y1="4" x2="9" y2="20" ${P}/>`,
  toolbar: `<rect x="3" y="5" width="18" height="5" rx="1" ${P}/><line x1="6" y1="14" x2="18" y2="14" ${P}/><line x1="6" y1="18" x2="14" y2="18" ${P}/>`,
  plus: `<line x1="12" y1="5" x2="12" y2="19" ${P}/><line x1="5" y1="12" x2="19" y2="12" ${P}/>`,
  folder: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" ${P}/>`,
  page: `<path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" ${P}/><polyline points="14 2 14 6 18 6" ${P}/><line x1="8" y1="13" x2="14" y2="13" ${P}/><line x1="8" y1="17" x2="12" y2="17" ${P}/>`,
  pencil: `<path d="M12 20h9" ${P}/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" ${P}/>`,
  trash: `<polyline points="3 6 5 6 21 6" ${P}/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" ${P}/><path d="M10 11v6M14 11v6" ${P}/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" ${P}/>`,
  open: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3H3z" ${P}/><path d="M3 12h18l-2 7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" ${P}/>`,
  close: `<line x1="6" y1="6" x2="18" y2="18" ${P}/><line x1="18" y1="6" x2="6" y2="18" ${P}/>`,
};

// Iconos de la interfaz servidos desde Lucide (Iconify), importado de forma
// estática para poder renderizar de manera síncrona al arrancar. Cada nombre
// interno se mapea a un icono de Lucide; si el mapeo falla, se usa el SVG
// dibujado a mano de arriba como respaldo, así nunca falta un icono.
import lucide from "@iconify-json/lucide/icons.json";
import { getIconData, iconToSVG, iconToHTML, replaceIDs } from "@iconify/utils";

const LUCIDE: Record<string, string> = {
  bold: "bold", italic: "italic", strike: "strikethrough", code: "code",
  h1: "heading-1", h2: "heading-2", h3: "heading-3", paragraph: "pilcrow",
  ul: "list", ol: "list-ordered", quote: "quote", codeblock: "square-code",
  hr: "minus", table: "table", image: "image", link: "link", wiki: "brackets",
  admonition: "triangle-alert", eye: "eye", markup: "code-xml",
  help: "circle-help", template: "layout-template", settings: "settings",
  sidebar: "panel-left", toolbar: "panel-top", plus: "plus",
  folder: "folder", page: "file-text", pencil: "pencil", trash: "trash-2",
  open: "folder-open", close: "x",
  "align-left": "align-left", "align-center": "align-center",
  "align-right": "align-right", calendar: "calendar", clock: "clock",
  copy: "copy", outline: "list-tree", history: "history", books: "library",
  "sidebar-right": "panel-right", minimize: "minus", maximize: "square",
  restore: "copy", sun: "sun", moon: "moon",
};

function lucideSvg(name: string): string | null {
  const id = LUCIDE[name];
  if (!id) return null;
  const data = getIconData(lucide as never, id);
  if (!data) return null;
  const built = iconToSVG(data, { height: "1em" });
  return iconToHTML(replaceIDs(built.body), {
    ...built.attributes,
    width: "18",
    height: "18",
    "aria-hidden": "true",
    focusable: "false",
  });
}

function handDrawn(name: string): string {
  const body = PATHS[name] ?? "";
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function icon(name: keyof typeof PATHS | string): string {
  return lucideSvg(name) ?? handDrawn(name);
}

export function iconEl(name: string): SVGElement {
  const tmp = document.createElement("div");
  tmp.innerHTML = icon(name);
  return tmp.firstElementChild as SVGElement;
}
