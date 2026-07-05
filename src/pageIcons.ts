import { invoke } from "@tauri-apps/api/core";

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

/** Abre un selector de emoji anclado en (x, y). onPick(null) quita el icono. */
export function openIconPicker(x: number, y: number, current: string | undefined, onPick: (emoji: string | null) => void): void {
  closeIconPicker();

  picker = document.createElement("div");
  picker.className = "icon-picker";

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

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEsc);
  }, 0);
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
