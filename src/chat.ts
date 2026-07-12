import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { icon } from "./icons";

// Chat con IA anclado en el pie de la zona central, colapsable y tipo ChatGPT.
// Además de conversar, es "agéntico": puede ACTUAR en el cuaderno (crear páginas,
// insertar o reemplazar contenido) emitiendo un bloque ```accion al final de su
// respuesta, que aquí se interpreta y ejecuta. Reutiliza el backend `ai_stream`.

export interface ChatHandlers {
  hasNotebook: () => boolean;
  hasPage: () => boolean;
  currentTitle: () => string;
  getMarkdown: () => string;
  getSelection: () => string;
  listPageTitles: () => Promise<string[]>;
  createPage: (title: string, markdown: string) => Promise<void>;
  insert: (markdown: string) => void;
  replace: (markdown: string) => void;
  replaceSelection: (markdown: string) => void;
  renamePage: (newName: string) => Promise<void>;
}

interface Turn { role: "user" | "assistant"; content: string; }

const SYSTEM_BASE =
  "Eres un asistente conversacional integrado en Cuadernillo, un editor de notas en Markdown " +
  "con estructura de cuaderno tipo Zim. Respondes en español, de forma clara y concisa.\n\n" +
  "Puedes ACTUAR en el cuaderno del usuario. Cuando te pida algo que implique escribir en él, " +
  "primero explica en UNA frase breve qué vas a hacer y, a continuación, añade AL FINAL de tu " +
  "respuesta UN ÚNICO bloque de acción con este formato EXACTO (una línea JSON entre las vallas):\n" +
  "```accion\n" +
  '{"tool":"crear_pagina","titulo":"Título","markdown":"# Título\\n\\nContenido…"}\n' +
  "```\n\n" +
  "Herramientas disponibles:\n" +
  '- {"tool":"crear_pagina","titulo":"…","markdown":"…"} → crea una página nueva con ese contenido y la abre.\n' +
  '- {"tool":"insertar","markdown":"…"} → inserta ese Markdown en la posición del cursor de la página actual.\n' +
  '- {"tool":"reemplazar","markdown":"…"} → reemplaza TODO el contenido de la página actual.\n' +
  '- {"tool":"reemplazar_seleccion","markdown":"…"} → reemplaza SOLO el texto seleccionado (útil para reescribir/corregir un fragmento). Solo si hay selección.\n' +
  '- {"tool":"renombrar_pagina","titulo":"NuevoNombre"} → renombra la página actual.\n\n' +
  "Reglas: usa el bloque SOLO cuando el usuario quiera modificar el cuaderno; si solo pregunta o " +
  "charla, responde con texto sin bloque. Nunca inventes más de una acción por respuesta. El Markdown " +
  "va en una sola línea JSON: usa \\n para los saltos de línea.";

const ACTION_RE = /```(?:acci[oó]n|action)\s*([\s\S]*?)```/i;

let els: {
  dock: HTMLElement; toggle: HTMLButtonElement; toggleIcon: HTMLElement;
  clear: HTMLButtonElement; messages: HTMLElement; form: HTMLFormElement;
  input: HTMLTextAreaElement; send: HTMLButtonElement;
} | null = null;

let handlers: ChatHandlers;
const history: Turn[] = [];
let busy = false;

const STORE_KEY = "cuadernillo.chatHistory";

function saveHistory(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-40))); } catch { /* cuota */ }
}
function loadHistory(): void {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    if (!Array.isArray(arr)) return;
    for (const t of arr)
      if (t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
        history.push(t);
  } catch { /* corrupto: se ignora */ }
}
function renderHistory(): void {
  if (!els || !history.length) return;
  els.messages.querySelector(".chat-empty")?.remove();
  for (const t of history) {
    if (t.role === "assistant" && /^\(acción ejecutada:/.test(t.content)) continue;
    addBubble(t.role, t.content);
  }
}

export function setupChat(h: ChatHandlers): void {
  handlers = h;
  const $ = (id: string) => document.getElementById(id);
  els = {
    dock: $("chat-dock") as HTMLElement,
    toggle: $("chat-toggle") as HTMLButtonElement,
    toggleIcon: $("chat-toggle-icon") as HTMLElement,
    clear: $("chat-clear") as HTMLButtonElement,
    messages: $("chat-messages") as HTMLElement,
    form: $("chat-form") as HTMLFormElement,
    input: $("chat-input") as HTMLTextAreaElement,
    send: $("chat-send") as HTMLButtonElement,
  };
  els.send.innerHTML = icon("chevron-up");

  // Conversación recordada de sesiones anteriores.
  loadHistory();
  renderHistory();

  // Estado colapsado recordado.
  const collapsed = localStorage.getItem("cuadernillo.chatCollapsed") !== "0";
  setCollapsed(collapsed);
  syncToggleIcon();

  els.toggle.addEventListener("click", () => toggleCollapsed());
  els.clear.addEventListener("click", () => clearChat());
  els.clear.innerHTML = icon("close");

  els.form.addEventListener("submit", (e) => { e.preventDefault(); void send(); });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  });
  els.input.addEventListener("input", autoGrow);
}

export function openChat(): void {
  if (!els) return;
  setCollapsed(false);
  syncToggleIcon();
  els.input.focus();
}

function toggleCollapsed(): void {
  if (!els) return;
  setCollapsed(!els.dock.classList.contains("collapsed"));
  syncToggleIcon();
}

function setCollapsed(v: boolean): void {
  if (!els) return;
  els.dock.classList.toggle("collapsed", v);
  els.toggle.setAttribute("aria-expanded", String(!v));
  localStorage.setItem("cuadernillo.chatCollapsed", v ? "1" : "0");
  if (!v) requestAnimationFrame(() => { scrollDown(); els?.input.focus(); });
}

function syncToggleIcon(): void {
  if (!els) return;
  const collapsed = els.dock.classList.contains("collapsed");
  els.toggleIcon.innerHTML = icon(collapsed ? "chevron-up" : "chevron-down");
}

function autoGrow(): void {
  if (!els) return;
  const t = els.input;
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 160) + "px";
}

function clearChat(): void {
  if (!els) return;
  history.length = 0;
  localStorage.removeItem(STORE_KEY);
  els.messages.innerHTML = '<p class="chat-empty">Escribe abajo para empezar a chatear con la IA.</p>';
}

// --- Envío de un turno -------------------------------------------------------

async function send(): Promise<void> {
  if (!els || busy) return;
  const text = els.input.value.trim();
  if (!text) return;

  els.messages.querySelector(".chat-empty")?.remove();
  els.input.value = "";
  autoGrow();
  addBubble("user", text);
  history.push({ role: "user", content: text });

  busy = true;
  els.send.disabled = true;
  const bubble = addBubble("assistant", "");
  bubble.classList.add("streaming");

  try {
    const system = await buildSystem();
    const prompt = buildPrompt();
    const full = await streamOnce(system, prompt, (acc) => {
      bubble.textContent = stripAction(acc);
      scrollDown();
    });
    bubble.classList.remove("streaming");

    const visible = stripAction(full).trim();
    bubble.textContent = visible || "(sin texto)";
    history.push({ role: "assistant", content: visible });

    await runAction(full, bubble);
  } catch (e) {
    bubble.classList.remove("streaming");
    bubble.classList.add("chat-error");
    const msg = String(e);
    bubble.textContent = /api key|nvapi|401|config/i.test(msg)
      ? "No hay IA configurada. Abre el botón «Asistente de IA» (ℹ️ en la barra) y pega tu API key."
      : "Error: " + msg;
  } finally {
    busy = false;
    els.send.disabled = false;
    saveHistory();
    scrollDown();
  }
}

// Detecta y ejecuta un bloque de acción; añade un chip con el resultado.
async function runAction(full: string, bubble: HTMLElement): Promise<void> {
  const m = full.match(ACTION_RE);
  if (!m) return;
  let act: { tool?: string; titulo?: string; markdown?: string };
  try {
    act = JSON.parse(m[1].trim());
  } catch {
    return; // JSON malformado: se ignora, ya se mostró el texto.
  }

  const md = typeof act.markdown === "string" ? act.markdown : "";
  try {
    if (act.tool === "crear_pagina") {
      if (!handlers.hasNotebook()) throw new Error("Abre un cuaderno primero.");
      const title = (act.titulo || "Nota IA").trim();
      await handlers.createPage(title, md || `# ${title}\n`);
      chip(bubble, "✓ Página creada: " + title);
    } else if (act.tool === "insertar") {
      if (!handlers.hasPage()) throw new Error("Abre una página primero.");
      handlers.insert(md);
      chip(bubble, "✓ Insertado en la página");
    } else if (act.tool === "reemplazar") {
      if (!handlers.hasPage()) throw new Error("Abre una página primero.");
      handlers.replace(md);
      chip(bubble, "✓ Página reemplazada");
    } else if (act.tool === "reemplazar_seleccion") {
      if (!handlers.hasPage()) throw new Error("Abre una página primero.");
      if (!handlers.getSelection().trim()) throw new Error("No hay texto seleccionado.");
      handlers.replaceSelection(md);
      chip(bubble, "✓ Selección reescrita");
    } else if (act.tool === "renombrar_pagina") {
      if (!handlers.hasPage()) throw new Error("Abre una página primero.");
      const name = (act.titulo || "").trim();
      if (!name) throw new Error("Falta el nuevo nombre.");
      await handlers.renamePage(name);
      chip(bubble, "✓ Página renombrada: " + name);
    } else {
      return;
    }
    history.push({ role: "assistant", content: "(acción ejecutada: " + act.tool + ")" });
  } catch (e) {
    chip(bubble, "✗ No se pudo: " + String(e), true);
  }
}

// --- Contexto y prompt -------------------------------------------------------

async function buildSystem(): Promise<string> {
  let ctx = "\n\n--- Contexto actual ---\n";
  if (handlers.hasNotebook()) {
    try {
      const titles = await handlers.listPageTitles();
      if (titles.length) ctx += "Páginas del cuaderno: " + titles.slice(0, 60).join(", ") + ".\n";
    } catch { /* ignora */ }
  } else {
    ctx += "No hay ningún cuaderno abierto.\n";
  }
  if (handlers.hasPage()) {
    const md = handlers.getMarkdown();
    ctx += `Página abierta: "${handlers.currentTitle()}".\n`;
    if (md.trim()) {
      const snip = md.length > 4000 ? md.slice(0, 4000) + "\n…(recortado)" : md;
      ctx += "Contenido de la página actual:\n" + snip + "\n";
    } else {
      ctx += "La página actual está vacía.\n";
    }
    const sel = handlers.getSelection().trim();
    if (sel) ctx += `\nTexto SELECCIONADO ahora mismo (puedes reescribirlo con reemplazar_seleccion):\n"""${sel.slice(0, 2000)}"""\n`;
  } else {
    ctx += "No hay ninguna página abierta.\n";
  }
  return SYSTEM_BASE + ctx;
}

function buildPrompt(): string {
  return history
    .map((t) => (t.role === "user" ? "Usuario: " : "Asistente: ") + t.content)
    .join("\n\n") + "\n\nAsistente:";
}

function stripAction(text: string): string {
  return text.replace(ACTION_RE, "").replace(/```acci[oó]n[\s\S]*$/i, "").trimEnd();
}

// --- Streaming (mismo canal de eventos que ai.ts; un turno a la vez) ----------

function streamOnce(system: string, prompt: string, onText: (full: string) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let acc = "";
    const uns: UnlistenFn[] = [];
    const cleanup = () => uns.forEach((u) => u());
    Promise.all([
      listen<string>("ai-chunk", (e) => { acc += e.payload; onText(acc); }),
      listen("ai-done", () => { cleanup(); resolve(acc); }),
      listen<string>("ai-error", (e) => { cleanup(); reject(new Error(String(e.payload))); }),
    ])
      .then((fns) => { uns.push(...fns); return invoke("ai_stream", { system, prompt }); })
      .catch((e) => { cleanup(); reject(e as Error); });
  });
}

// --- DOM helpers -------------------------------------------------------------

function addBubble(role: "user" | "assistant", text: string): HTMLElement {
  const b = document.createElement("div");
  b.className = "chat-msg chat-" + role;
  b.textContent = text;
  els!.messages.appendChild(b);
  scrollDown();
  return b;
}

function chip(bubble: HTMLElement, text: string, error = false): void {
  const c = document.createElement("div");
  c.className = "chat-action-chip" + (error ? " error" : "");
  c.textContent = text;
  bubble.after(c);
  scrollDown();
}

function scrollDown(): void {
  if (els) els.messages.scrollTop = els.messages.scrollHeight;
}
