import { invoke } from "@tauri-apps/api/core";
import { icon } from "./icons";
import { setCodeTheme, type CodeTheme } from "./editor";

// Ajustes de aspecto por cuaderno. Se guardan en .cuadernillo/config.json y
// .cuadernillo/custom.css dentro del propio cuaderno (viajan con él).

interface Config {
  font: string;        // id del catálogo FONTS
  customFont: string;  // fuente escrita a mano (tiene prioridad si no está vacía)
  fontSize: number;    // px
  width: number;       // px, ancho del "papel"
  margin: number;      // px, margen interior del documento
  codeTheme: CodeTheme;
}

const DEFAULTS: Config = {
  font: "charter",
  customFont: "",
  fontSize: 16.5,
  width: 820,
  margin: 64,
  codeTheme: "dark",
};

interface FontDef { id: string; label: string; group: string; stack: string; }

// Catálogo. Las marcadas "(libre)" van empaquetadas (ver src/fonts.ts); el resto
// son del sistema (Windows/otros). El campo personalizado permite cualquier otra.
const FONTS: FontDef[] = [
  { id: "charter", label: "Charter", group: "Serif", stack: 'Charter, "Bitstream Charter", Georgia, serif' },
  { id: "georgia", label: "Georgia", group: "Serif", stack: "Georgia, serif" },
  { id: "cambria", label: "Cambria", group: "Serif", stack: "Cambria, Georgia, serif" },
  { id: "lora", label: "Lora (libre)", group: "Serif", stack: '"Lora", Georgia, serif' },
  { id: "merriweather", label: "Merriweather (libre)", group: "Serif", stack: '"Merriweather", Georgia, serif' },
  { id: "system", label: "Sistema", group: "Sans-serif", stack: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  { id: "segoe", label: "Segoe UI", group: "Sans-serif", stack: '"Segoe UI", system-ui, sans-serif' },
  { id: "inter", label: "Inter (libre)", group: "Sans-serif", stack: '"Inter", system-ui, sans-serif' },
  { id: "ibm-plex-sans", label: "IBM Plex Sans (libre)", group: "Sans-serif", stack: '"IBM Plex Sans", system-ui, sans-serif' },
  { id: "open-sans", label: "Open Sans (libre)", group: "Sans-serif", stack: '"Open Sans", system-ui, sans-serif' },
  { id: "roboto", label: "Roboto (libre)", group: "Sans-serif", stack: '"Roboto", system-ui, sans-serif' },
  { id: "consolas", label: "Consolas", group: "Monoespaciada", stack: 'Consolas, "Cascadia Code", monospace' },
  { id: "jetbrains-mono", label: "JetBrains Mono (libre)", group: "Monoespaciada", stack: '"JetBrains Mono", Consolas, monospace' },
  { id: "ibm-plex-mono", label: "IBM Plex Mono (libre)", group: "Monoespaciada", stack: '"IBM Plex Mono", Consolas, monospace' },
];

// Compatibilidad con configs antiguas (font era "serif"/"sans"/"mono").
const LEGACY: Record<string, string> = { serif: "charter", sans: "system", mono: "consolas" };

let config: Config = { ...DEFAULTS };
let customCss = "";
let overlay: HTMLElement | null = null;
let saveCfgTimer: number | undefined;
let saveCssTimer: number | undefined;

function fontStack(): string {
  if (config.customFont.trim()) return config.customFont.trim();
  return FONTS.find((f) => f.id === config.font)?.stack ?? FONTS[0].stack;
}

function applyConfig(): void {
  const r = document.documentElement.style;
  r.setProperty("--doc-font", fontStack());
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

function applyCodeTheme(): void {
  void setCodeTheme(config.codeTheme);
}

/** Carga config + CSS del cuaderno abierto y los aplica. Llamar al abrir cuaderno. */
export async function loadSettings(): Promise<void> {
  config = { ...DEFAULTS };
  customCss = "";
  try {
    const raw = await invoke<string>("read_config");
    if (raw) config = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* config ausente o corrupta: valores por defecto */ }
  if (LEGACY[config.font]) config.font = LEGACY[config.font];
  try {
    customCss = await invoke<string>("read_custom_css");
  } catch { /* sin CSS */ }
  applyConfig();
  applyCss();
  applyCodeTheme();
}

/** Restaura los valores por defecto (al cerrar cuaderno). */
export function resetSettings(): void {
  config = { ...DEFAULTS };
  customCss = "";
  applyConfig();
  applyCss();
  applyCodeTheme();
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

  // Fuente (catálogo agrupado)
  const fontSel = document.createElement("select");
  fontSel.className = "settings-input";
  const groups = [...new Set(FONTS.map((f) => f.group))];
  for (const g of groups) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const f of FONTS.filter((x) => x.group === g)) {
      const o = document.createElement("option");
      o.value = f.id; o.textContent = f.label;
      if (f.id === config.font) o.selected = true;
      og.appendChild(o);
    }
    fontSel.appendChild(og);
  }
  fontSel.disabled = config.customFont.trim().length > 0;
  fontSel.addEventListener("change", () => {
    config.font = fontSel.value; applyConfig(); saveConfig();
  });
  body.appendChild(field("Tipografía del texto", fontSel));

  // Fuente personalizada
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.className = "settings-input";
  customInput.placeholder = 'p. ej. "Comic Sans MS", "Times New Roman"…';
  customInput.value = config.customFont;
  customInput.addEventListener("input", () => {
    config.customFont = customInput.value;
    fontSel.disabled = config.customFont.trim().length > 0;
    applyConfig(); saveConfig();
  });
  body.appendChild(field(
    "Fuente personalizada (opcional)",
    customInput,
    "Cualquier fuente instalada en el sistema. Si la rellenas, tiene prioridad sobre la de arriba."
  ));

  // Sliders
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

  // Tema de los bloques de código
  const themeSel = document.createElement("select");
  themeSel.className = "settings-input";
  [["dark", "Oscuro (One Dark)"], ["light", "Claro"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (v === config.codeTheme) o.selected = true;
    themeSel.appendChild(o);
  });
  themeSel.addEventListener("change", () => {
    config.codeTheme = themeSel.value as CodeTheme;
    applyCodeTheme(); saveConfig();
  });
  body.appendChild(field("Tema de los bloques de código", themeSel));

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
