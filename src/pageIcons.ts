import { invoke } from "@tauri-apps/api/core";
import { ensureLibraryLoaded, searchIcons, renderIconSvg } from "./iconLibrary";

// Icono personalizado por página (emoji), guardado por cuaderno en
// .cuadernillo/page-icons.json como { "rel/path.md": "📌", ... }.

let icons: Record<string, string> = {};
let saveTimer: number | undefined;

export async function loadPageIcons(): Promise<void> {
  icons = {};
  try {
    const raw = await invoke<string>("read_page_icons");
    if (raw) icons = JSON.parse(raw);
  } catch { /* sin iconos o JSON corrupto */ }
}

export function resetPageIcons(): void {
  icons = {};
}

export function getPageIcon(rel: string): string | undefined {
  return icons[rel];
}

export function setPageIcon(rel: string, emoji: string | null): void {
  if (emoji) icons[rel] = emoji;
  else delete icons[rel];
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("write_page_icons", { content: JSON.stringify(icons, null, 2) }).catch(() => {});
  }, 300);
}

// Paleta de emojis para el selector.
const EMOJIS = [
  "📄", "📝", "📌", "⭐", "🔖", "📚", "📖", "🗒️",
  "📊", "📈", "🧩", "🎯", "✅", "🔥", "💡", "🧠",
  "🚀", "🐛", "⚙️", "🔧", "🎨", "🧪", "🔗", "📅",
  "💬", "❓", "⚠️", "🔒", "💰", "🏷️", "📁", "🌱",
];

let picker: HTMLElement | null = null;

/**
 * Selector de icono de página anclado en (x, y). Permite buscar entre miles de
 * iconos de las librerías (Iconify) o elegir un emoji rápido. `onPick` recibe el
 * emoji, la cadena SVG del icono elegido, o null para quitarlo.
 */
export function openIconPicker(x: number, y: number, current: string | undefined, onPick: (value: string | null) => void): void {
  closeIconPicker();

  picker = document.createElement("div");
  picker.className = "icon-picker";

  // Buscador de librerías de iconos.
  const search = document.createElement("input");
  search.type = "text";
  search.className = "icon-picker-input";
  search.placeholder = "Buscar icono (Lucide, Tabler, Phosphor…)";
  picker.appendChild(search);

  const results = document.createElement("div");
  results.className = "icon-picker-results";
  const hint = document.createElement("div");
  hint.className = "icon-picker-hint";
  hint.textContent = "Cargando librerías…";
  results.appendChild(hint);
  picker.appendChild(results);

  // Emojis de acceso rápido.
  const sub = document.createElement("div");
  sub.className = "icon-picker-sublabel";
  sub.textContent = "Emojis";
  picker.appendChild(sub);

  const grid = document.createElement("div");
  grid.className = "icon-picker-grid";
  for (const e of EMOJIS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-picker-emoji" + (e === current ? " current" : "");
    b.textContent = e;
    b.addEventListener("mousedown", (ev) => { ev.preventDefault(); closeIconPicker(); onPick(e); });
    grid.appendChild(b);
  }
  picker.appendChild(grid);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "icon-picker-clear";
  clear.textContent = "Quitar icono";
  clear.addEventListener("mousedown", (ev) => { ev.preventDefault(); closeIconPicker(); onPick(null); });
  picker.appendChild(clear);

  document.body.appendChild(picker);

  // Coloca dentro de la ventana.
  const rect = picker.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  picker.style.left = `${Math.max(8, px)}px`;
  picker.style.top = `${Math.max(8, py)}px`;

  // Carga perezosa de las librerías y búsqueda en vivo.
  let ready = false;
  const renderResults = () => {
    if (!ready) return;
    const q = search.value.trim();
    results.innerHTML = "";
    if (!q) {
      const h = document.createElement("div");
      h.className = "icon-picker-hint";
      h.textContent = "Escribe para buscar entre miles de iconos";
      results.appendChild(h);
      return;
    }
    const ids = searchIcons(q, 60);
    if (ids.length === 0) {
      const h = document.createElement("div");
      h.className = "icon-picker-hint";
      h.textContent = "Sin resultados";
      results.appendChild(h);
      return;
    }
    for (const id of ids) {
      const svg = renderIconSvg(id);
      if (!svg) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-picker-libicon";
      b.title = id;
      b.innerHTML = svg;
      b.addEventListener("mousedown", (ev) => { ev.preventDefault(); closeIconPicker(); onPick(svg); });
      results.appendChild(b);
    }
  };

  void ensureLibraryLoaded().then(() => { ready = true; renderResults(); });
  search.addEventListener("input", renderResults);

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEsc);
  }, 0);
  search.focus();
}

function onOutside(e: MouseEvent): void {
  if (picker && !picker.contains(e.target as Node)) closeIconPicker();
}
function onEsc(e: KeyboardEvent): void {
  if (e.key === "Escape") closeIconPicker();
}

export function closeIconPicker(): void {
  if (!picker) return;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onEsc);
  picker.remove();
  picker = null;
}
