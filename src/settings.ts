import { invoke } from "@tauri-apps/api/core";
import { icon } from "./icons";

// Ajustes de aspecto por cuaderno. Se guardan en .cuadernillo/config.json y
// .cuadernillo/custom.css dentro del propio cuaderno (viajan con él).

interface Config {
  font: "serif" | "sans" | "mono";
  fontSize: number;   // px
  width: number;      // px, ancho del "papel"
  margin: number;     // px, margen interior del documento
}

const DEFAULTS: Config = { font: "serif", fontSize: 16.5, width: 820, margin: 64 };

const FONT_STACK: Record<Config["font"], string> = {
  serif: "var(--serif)",
  sans: "var(--sans)",
  mono: "var(--mono)",
};

let config: Config = { ...DEFAULTS };
let customCss = "";
let overlay: HTMLElement | null = null;
let saveCfgTimer: number | undefined;
let saveCssTimer: number | undefined;

function applyConfig(): void {
  const r = document.documentElement.style;
  r.setProperty("--doc-font", FONT_STACK[config.font]);
  r.setProperty("--doc-font-size", `${config.fontSize}px`);
  r.setProperty("--doc-width", `${config.width}px`);
  r.setProperty("--doc-pad-x", `${config.margin}px`);
}

function applyCss(): void {
  let style = document.getElementById("cuadernillo-custom-css") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "cuadernillo-custom-css";
    document.head.appendChild(style);
  }
  style.textContent = customCss;
}

/** Carga config + CSS del cuaderno abierto y los aplica. Llamar al abrir cuaderno. */
export async function loadSettings(): Promise<void> {
  config = { ...DEFAULTS };
  customCss = "";
  try {
    const raw = await invoke<string>("read_config");
    if (raw) config = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* config ausente o corrupta: valores por defecto */ }
  try {
    customCss = await invoke<string>("read_custom_css");
  } catch { /* sin CSS */ }
  applyConfig();
  applyCss();
}

/** Restaura los valores por defecto (al cerrar cuaderno). */
export function resetSettings(): void {
  config = { ...DEFAULTS };
  customCss = "";
  applyConfig();
  applyCss();
}

function saveConfig(): void {
  window.clearTimeout(saveCfgTimer);
  saveCfgTimer = window.setTimeout(() => {
    void invoke("write_config", { content: JSON.stringify(config, null, 2) }).catch(() => {});
  }, 400);
}

function saveCss(): void {
  window.clearTimeout(saveCssTimer);
  saveCssTimer = window.setTimeout(() => {
    void invoke("write_custom_css", { content: customCss }).catch(() => {});
  }, 500);
}

function field(label: string, control: HTMLElement, hint = ""): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "settings-field";
  const span = document.createElement("span");
  span.className = "settings-label";
  span.textContent = label;
  wrap.append(span, control);
  if (hint) {
    const h = document.createElement("small");
    h.className = "settings-hint";
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

export function openSettings(): void {
  closeNow();
  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Ajustes del cuaderno");

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Ajustes del cuaderno</h2>`;
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = "Cerrar";
  close.innerHTML = icon("close");
  close.addEventListener("click", closeSettings);
  header.appendChild(close);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body settings-body";

  // Fuente
  const fontSel = document.createElement("select");
  fontSel.className = "settings-input";
  [["serif", "Serif (con remates)"], ["sans", "Sans-serif"], ["mono", "Monoespaciada"]]
    .forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t; if (v === config.font) o.selected = true;
      fontSel.appendChild(o);
    });
  fontSel.addEventListener("change", () => {
    config.font = fontSel.value as Config["font"];
    applyConfig(); saveConfig();
  });
  body.appendChild(field("Tipografía del texto", fontSel));

  // Helper para sliders numéricos
  const slider = (min: number, max: number, step: number, value: number,
                  onInput: (v: number) => void, unit = "px") => {
    const box = document.createElement("div");
    box.className = "settings-slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value);
    const out = document.createElement("span");
    out.className = "settings-value";
    out.textContent = `${value}${unit}`;
    input.addEventListener("input", () => {
      const v = Number(input.value);
      out.textContent = `${v}${unit}`;
      onInput(v);
    });
    box.append(input, out);
    return box;
  };

  body.appendChild(field("Tamaño del texto",
    slider(12, 24, 0.5, config.fontSize, (v) => { config.fontSize = v; applyConfig(); saveConfig(); })));
  body.appendChild(field("Ancho del documento",
    slider(560, 1200, 20, config.width, (v) => { config.width = v; applyConfig(); saveConfig(); })));
  body.appendChild(field("Márgenes interiores",
    slider(16, 120, 4, config.margin, (v) => { config.margin = v; applyConfig(); saveConfig(); })));

  // CSS personalizado
  const cssArea = document.createElement("textarea");
  cssArea.className = "settings-css";
  cssArea.spellcheck = false;
  cssArea.value = customCss;
  cssArea.placeholder =
    "/* CSS propio para el markdown. Ejemplo: */\n.milkdown .ProseMirror h1 { color: crimson; }";
  cssArea.addEventListener("input", () => { customCss = cssArea.value; applyCss(); saveCss(); });

  const fileBtn = document.createElement("input");
  fileBtn.type = "file";
  fileBtn.accept = ".css,text/css";
  fileBtn.className = "settings-file";
  fileBtn.addEventListener("change", () => {
    const f = fileBtn.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      customCss = String(reader.result ?? "");
      cssArea.value = customCss;
      applyCss(); saveCss();
    };
    reader.readAsText(f);
  });

  body.appendChild(field(
    "CSS personalizado del markdown",
    cssArea,
    "Se aplica a la vista con formato. Apunta a .milkdown .ProseMirror …"
  ));
  body.appendChild(field("Cargar CSS desde archivo", fileBtn));

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay?.classList.add("visible"));
}

export function closeSettings(): void {
  overlay?.classList.remove("visible");
  const o = overlay;
  overlay = null;
  setTimeout(() => o?.remove(), 200);
}

function closeNow(): void {
  overlay?.remove();
  overlay = null;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) closeSettings();
});
