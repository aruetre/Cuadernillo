import { invoke } from "@tauri-apps/api/core";
import { icon } from "./icons";

// Panel de IA: configuración (API key/modelo/endpoint, global de la app),
// generación de documentos y análisis del documento actual. Las llamadas van
// por el backend Rust (comando ai_complete), compatible con la API de NVIDIA.

export interface AiHandlers {
  getMarkdown: () => string;
  hasPage: () => boolean;
  onCreateDoc: (title: string, markdown: string) => void | Promise<void>;
  onInsert: (markdown: string) => void;
}

const SYS_GEN =
  "Eres un asistente que redacta documentos en Markdown claro y bien estructurado, en español. " +
  "Devuelve SOLO el contenido en Markdown, sin explicaciones ni vallas de código alrededor.";

const ANALYSES: { id: string; label: string; system: string }[] = [
  { id: "resumen", label: "Resumen", system: "Resume el siguiente documento Markdown en español, en puntos claros. Devuelve solo Markdown." },
  { id: "revision", label: "Revisión y correcciones", system: "Revisa el siguiente documento Markdown: corrige ortografía y gramática y sugiere mejoras de redacción. Responde en español y en Markdown." },
  { id: "ideas", label: "Ideas para ampliar", system: "Propón ideas y secciones para ampliar el siguiente documento Markdown. Responde en español y en Markdown." },
  { id: "tareas", label: "Extraer tareas", system: "Extrae una lista de tareas accionables (formato «- [ ]») del siguiente documento Markdown. Responde solo con la lista en Markdown." },
];

let overlay: HTMLElement | null = null;

export function openAi(handlers: AiHandlers): void {
  closeNow();
  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAi(); });

  const dialog = document.createElement("div");
  dialog.className = "modal ai-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Asistente de IA");

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Asistente de IA</h2>`;
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = "Cerrar";
  close.innerHTML = icon("close");
  close.addEventListener("click", closeAi);
  header.appendChild(close);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body ai-body";
  dialog.appendChild(body);

  // Ayuda: qué hace y cómo empezar.
  const intro = document.createElement("div");
  intro.className = "ai-intro";
  intro.innerHTML =
    "<p><strong>Genera</strong> documentos nuevos y <strong>analiza</strong> el que tengas abierto usando IA.</p>" +
    "<ol>" +
    "<li>Consigue una API key gratis en <strong>build.nvidia.com</strong> (empieza por <code>nvapi-</code>).</li>" +
    "<li>Pégala abajo en <strong>Configuración</strong> y pulsa Guardar.</li>" +
    "<li><strong>Generar</strong>: título + instrucción → crea una nota nueva. " +
    "<strong>Analizar</strong>: resumen, correcciones, ideas o tareas del documento actual.</li>" +
    "</ol>" +
    "<p class=\"ai-intro-note\">Privacidad: el texto que envíes va al proveedor de la API. La clave se guarda solo en tu equipo.</p>";
  body.appendChild(intro);

  // Estado / errores.
  const status = document.createElement("div");
  status.className = "ai-status";

  function setBusy(msg: string): void { status.textContent = msg; status.dataset.state = "busy"; }
  function setError(msg: string): void { status.textContent = msg; status.dataset.state = "error"; }
  function clearStatus(): void { status.textContent = ""; status.dataset.state = ""; }

  async function callAi(system: string, prompt: string): Promise<string | null> {
    setBusy("Generando… (puede tardar unos segundos)");
    try {
      const out = await invoke<string>("ai_complete", { system, prompt });
      clearStatus();
      return out;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  // --- Configuración ---------------------------------------------------------
  const cfgSection = section(body, "Configuración");
  const apiKey = input("password", "Pega aquí tu API key (nvapi-…)");
  const model = input("text", "meta/llama-3.3-70b-instruct");
  const baseUrl = input("text", "https://integrate.api.nvidia.com/v1");
  cfgSection.append(
    field("API key", apiKey, "Consíguela gratis en build.nvidia.com. Se guarda solo en tu equipo."),
    field("Modelo", model),
    field("Endpoint (API compatible OpenAI)", baseUrl)
  );
  const saveCfg = button("Guardar configuración", "primary");
  saveCfg.addEventListener("click", () => {
    void invoke("write_ai_config", {
      content: JSON.stringify({ apiKey: apiKey.value.trim(), model: model.value.trim(), baseUrl: baseUrl.value.trim() }, null, 2),
    }).then(() => setBusyDone("Configuración guardada.")).catch((e) => setError(String(e)));
  });
  cfgSection.appendChild(saveCfg);

  function setBusyDone(msg: string): void { status.textContent = msg; status.dataset.state = "ok"; }

  // Cargar config existente.
  void invoke<string>("read_ai_config").then((raw) => {
    if (!raw) return;
    try {
      const c = JSON.parse(raw);
      apiKey.value = c.apiKey ?? "";
      model.value = c.model ?? "";
      baseUrl.value = c.baseUrl ?? "";
    } catch { /* ignora */ }
  });

  // --- Generar ---------------------------------------------------------------
  const genSection = section(body, "Generar documento");
  const genTitle = input("text", "Título del nuevo documento");
  const genPrompt = textarea("Describe qué quieres que genere (tema, tono, estructura…)");
  genSection.append(field("Título", genTitle), field("Instrucción", genPrompt));
  const genBtn = button("Generar y crear documento", "primary");
  genBtn.addEventListener("click", async () => {
    const title = genTitle.value.trim();
    const prompt = genPrompt.value.trim();
    if (!title) { setError("Escribe un título para el documento."); return; }
    if (!prompt) { setError("Escribe qué quieres generar."); return; }
    genBtn.disabled = true;
    const out = await callAi(SYS_GEN, prompt);
    genBtn.disabled = false;
    if (out) { await handlers.onCreateDoc(title, out); closeAi(); }
  });
  genSection.appendChild(genBtn);

  // --- Analizar --------------------------------------------------------------
  const anaSection = section(body, "Analizar documento actual");
  const anaSel = document.createElement("select");
  anaSel.className = "settings-input";
  for (const a of ANALYSES) {
    const o = document.createElement("option");
    o.value = a.id; o.textContent = a.label;
    anaSel.appendChild(o);
  }
  anaSection.appendChild(field("Tipo de análisis", anaSel));
  const anaBtn = button("Analizar documento", "primary");
  const result = document.createElement("textarea");
  result.className = "settings-css ai-result";
  result.readOnly = true;
  result.placeholder = "El resultado del análisis aparecerá aquí.";
  const resultActions = document.createElement("div");
  resultActions.className = "ai-result-actions";
  const insertBtn = button("Insertar en el documento", "");
  const newDocBtn = button("Crear como documento nuevo", "");
  resultActions.append(insertBtn, newDocBtn);

  anaBtn.addEventListener("click", async () => {
    if (!handlers.hasPage()) { setError("Abre una página para analizarla."); return; }
    const md = handlers.getMarkdown();
    if (!md.trim()) { setError("El documento está vacío."); return; }
    const a = ANALYSES.find((x) => x.id === anaSel.value) ?? ANALYSES[0];
    anaBtn.disabled = true;
    const out = await callAi(a.system, md);
    anaBtn.disabled = false;
    if (out) result.value = out;
  });
  insertBtn.addEventListener("click", () => { if (result.value.trim()) { handlers.onInsert(result.value); closeAi(); } });
  newDocBtn.addEventListener("click", async () => {
    if (result.value.trim()) { await handlers.onCreateDoc("Análisis", result.value); closeAi(); }
  });
  anaSection.append(anaBtn, result, resultActions);

  body.appendChild(status);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay?.classList.add("visible"));
}

// --- Helpers de construcción -------------------------------------------------

function section(parent: HTMLElement, title: string): HTMLElement {
  const h = document.createElement("h3");
  h.className = "ai-section-title";
  h.textContent = title;
  const sec = document.createElement("div");
  sec.className = "ai-section";
  parent.append(h, sec);
  return sec;
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

function input(type: string, placeholder: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.className = "settings-input";
  el.placeholder = placeholder;
  return el;
}

function textarea(placeholder: string): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.className = "settings-css";
  el.placeholder = placeholder;
  el.style.minHeight = "90px";
  return el;
}

function button(label: string, variant: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ai-btn" + (variant ? ` ai-btn-${variant}` : "");
  b.textContent = label;
  return b;
}

export function closeAi(): void {
  overlay?.classList.remove("visible");
  const o = overlay;
  overlay = null;
  setTimeout(() => o?.remove(), 200);
}

function closeNow(): void { overlay?.remove(); overlay = null; }

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) closeAi();
});
