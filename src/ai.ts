import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

  // Streaming: escucha ai-chunk/ai-done/ai-error, invoca ai_stream y va llamando
  // a `onText` con el texto acumulado. Resuelve con el texto completo. Solo una
  // operación a la vez (los eventos son globales).
  let streaming = false;
  function streamAi(system: string, prompt: string, onText: (full: string) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (streaming) { reject(new Error("Ya hay una operación de IA en curso.")); return; }
      streaming = true;
      let acc = "";
      const uns: UnlistenFn[] = [];
      const cleanup = () => { streaming = false; uns.forEach((u) => u()); uns.length = 0; };
      Promise.all([
        listen<string>("ai-chunk", (e) => { acc += e.payload; onText(acc); }),
        listen("ai-done", () => { cleanup(); resolve(acc); }),
        listen<string>("ai-error", (e) => { cleanup(); reject(new Error(String(e.payload))); }),
      ])
        .then((fns) => { uns.push(...fns); return invoke("ai_stream", { system, prompt }); })
        .catch((e) => { cleanup(); reject(e as Error); });
    });
  }

  // --- Configuración ---------------------------------------------------------
  const cfgSection = section(body, "Configuración");
  const apiKey = input("password", "Pega aquí tu API key (nvapi-…)");
  const model = input("text", "qwen/qwen3-next-80b-a3b-instruct");
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

  // --- Salida compartida (se rellena en vivo con el streaming) ---------------
  const result = document.createElement("textarea");
  result.className = "settings-css ai-result";
  result.readOnly = true;
  result.placeholder = "La respuesta de la IA aparecerá aquí en vivo.";
  const resultActions = document.createElement("div");
  resultActions.className = "ai-result-actions";
  const insertBtn = button("Insertar en el documento", "");
  const newDocBtn = button("Crear como documento nuevo", "");
  resultActions.append(insertBtn, newDocBtn);
  const streamInto = (): ((full: string) => void) => {
    result.value = "";
    return (full) => { result.value = full; result.scrollTop = result.scrollHeight; };
  };

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
    setBusy("Generando…");
    try {
      const out = await streamAi(SYS_GEN, prompt, streamInto());
      clearStatus();
      await handlers.onCreateDoc(title, out);
      closeAi();
    } catch (e) {
      setError(String(e));
    } finally {
      genBtn.disabled = false;
    }
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
  anaBtn.addEventListener("click", async () => {
    if (!handlers.hasPage()) { setError("Abre una página para analizarla."); return; }
    const md = handlers.getMarkdown();
    if (!md.trim()) { setError("El documento está vacío."); return; }
    const a = ANALYSES.find((x) => x.id === anaSel.value) ?? ANALYSES[0];
    anaBtn.disabled = true;
    setBusy("Analizando…");
    try {
      await streamAi(a.system, md, streamInto());
      clearStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      anaBtn.disabled = false;
    }
  });
  anaSection.appendChild(anaBtn);

  // --- Resultado (salida en streaming) ---------------------------------------
  const outSection = section(body, "Resultado");
  insertBtn.addEventListener("click", () => { if (result.value.trim()) { handlers.onInsert(result.value); closeAi(); } });
  newDocBtn.addEventListener("click", async () => {
    if (result.value.trim()) { await handlers.onCreateDoc("Nota IA", result.value); closeAi(); }
  });
  outSection.append(result, resultActions);

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
