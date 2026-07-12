import { invoke } from "@tauri-apps/api/core";

// Layout de página por documento: tamaño (A6–A3 + internacionales), orientación
// y nivel de márgenes. Se guarda por cuaderno en .cuadernillo/layouts.json
// (rel_path → layout) y se aplica vía variables CSS en milímetros.

export interface Layout {
  size: string;
  orientation: "portrait" | "landscape";
  margin: string;
}

export const DEFAULT_LAYOUT: Layout = { size: "a4", orientation: "portrait", margin: "normal" };

// Tamaños en mm (lado corto × lado largo, es decir en vertical).
export const SIZES: { id: string; label: string; short: number; long: number }[] = [
  { id: "a6", label: "A6", short: 105, long: 148 },
  { id: "a5", label: "A5", short: 148, long: 210 },
  { id: "a4", label: "A4", short: 210, long: 297 },
  { id: "a3", label: "A3", short: 297, long: 420 },
  { id: "letter", label: "Carta (US Letter)", short: 216, long: 279 },
  { id: "legal", label: "Legal (US)", short: 216, long: 356 },
  { id: "tabloid", label: "Tabloide", short: 279, long: 432 },
];

export const MARGINS: { id: string; label: string; mm: number }[] = [
  { id: "none", label: "Ninguno", mm: 4 },
  { id: "narrow", label: "Estrecho", mm: 12 },
  { id: "normal", label: "Normal", mm: 20 },
  { id: "wide", label: "Ancho", mm: 30 },
];

let layouts: Record<string, Layout> = {};
let saveTimer: number | undefined;

export async function loadLayouts(): Promise<void> {
  layouts = {};
  try {
    const raw = await invoke<string>("read_page_layouts");
    if (raw) layouts = JSON.parse(raw);
  } catch { /* sin layouts o JSON corrupto */ }
}

export function resetLayouts(): void { layouts = {}; }

export function getLayout(rel: string | null): Layout {
  return (rel && layouts[rel]) || DEFAULT_LAYOUT;
}

export function setLayout(rel: string, layout: Layout): void {
  layouts[rel] = layout;
  applyLayout(layout);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("write_page_layouts", { content: JSON.stringify(layouts, null, 2) }).catch(() => {});
  }, 300);
}

export function applyLayout(layout: Layout): void {
  const s = SIZES.find((x) => x.id === layout.size) ?? SIZES[2];
  const m = MARGINS.find((x) => x.id === layout.margin) ?? MARGINS[2];
  const width = layout.orientation === "landscape" ? s.long : s.short;
  const r = document.documentElement.style;
  r.setProperty("--doc-width", `${width}mm`);
  r.setProperty("--doc-pad-x", `${m.mm}mm`);
  r.setProperty("--doc-pad-y", `${Math.max(m.mm, 12)}mm`);
}

// --- Selector emergente -----------------------------------------------------

let picker: HTMLElement | null = null;

export function openLayoutMenu(x: number, y: number, current: Layout, onChange: (l: Layout) => void): void {
  closeLayoutMenu();
  const cur: Layout = { ...current };

  picker = document.createElement("div");
  picker.className = "layout-menu";

  const rebuild = () => {
    picker!.innerHTML = "";
    picker!.append(
      group("Tamaño", SIZES.map((s) => chip(s.label, s.id === cur.size, () => { cur.size = s.id; emit(); }))),
      group("Orientación", [
        chip("Vertical", cur.orientation === "portrait", () => { cur.orientation = "portrait"; emit(); }),
        chip("Horizontal", cur.orientation === "landscape", () => { cur.orientation = "landscape"; emit(); }),
      ]),
      group("Márgenes", MARGINS.map((m) => chip(m.label, m.id === cur.margin, () => { cur.margin = m.id; emit(); }))),
    );
  };
  const emit = () => { onChange({ ...cur }); rebuild(); };

  rebuild();
  document.body.appendChild(picker);
  const rect = picker.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  picker.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEsc);
  }, 0);
}

function group(title: string, items: HTMLElement[]): HTMLElement {
  const g = document.createElement("div");
  g.className = "layout-group";
  const h = document.createElement("div");
  h.className = "layout-group-title";
  h.textContent = title;
  const row = document.createElement("div");
  row.className = "layout-chips";
  row.append(...items);
  g.append(h, row);
  return g;
}

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "layout-chip" + (active ? " active" : "");
  b.textContent = label;
  b.addEventListener("mousedown", (e) => { e.preventDefault(); onClick(); });
  return b;
}

function onOutside(e: MouseEvent): void {
  if (picker && !picker.contains(e.target as Node)) closeLayoutMenu();
}
function onEsc(e: KeyboardEvent): void {
  if (e.key === "Escape") closeLayoutMenu();
}

export function closeLayoutMenu(): void {
  if (!picker) return;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onEsc);
  picker.remove();
  picker = null;
}
