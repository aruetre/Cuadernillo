import { icon } from "./icons";
import { getContent, setContent, insertMarkdown, focusEditor } from "./editor";

// Plantillas de métodos de apuntes (paquete markzim), cargadas como texto crudo.
import cornell from "../templates/cornell.md?raw";
import outline from "../templates/outline.md?raw";
import charting from "../templates/charting.md?raw";
import zettelkasten from "../templates/zettelkasten.md?raw";
import sentence from "../templates/sentence.md?raw";
import qec from "../templates/qec.md?raw";
import mapping from "../templates/mapping.md?raw";
import flow from "../templates/flow.md?raw";
import dailyBujo from "../templates/daily-bujo.md?raw";

// Capacidades del editor que una plantilla necesita para renderizar del todo.
// Si falta, la plantilla sigue disponible pero se avisa (degrada de forma legible).
type Requirement = "gfm-tables" | "frontmatter" | "mermaid" | "wikilinks";

// Lo que Cuadernillo ofrece hoy: tablas GFM y vínculos [[wiki]]. Sin frontmatter
// YAML ni Mermaid todavía.
const CAPABILITIES: Requirement[] = ["gfm-tables", "wikilinks"];

const REQ_LABEL: Record<Requirement, string> = {
  "gfm-tables": "tablas",
  frontmatter: "frontmatter",
  mermaid: "Mermaid",
  wikilinks: "vínculos [[…]]",
};

interface Template {
  id: string;
  name: string;
  description: string;
  group: string;
  content: string;
  requires: Requirement[];
}

const TEMPLATES: Template[] = [
  // --- Métodos de apuntes -----------------------------------------------------
  { id: "cornell", name: "Cornell", group: "Métodos de apuntes",
    description: "Notas, ideas clave y resumen.", content: cornell, requires: [] },
  { id: "outline", name: "Outline", group: "Métodos de apuntes",
    description: "Esquema jerárquico con sangrías.", content: outline, requires: [] },
  { id: "qec", name: "Q/E/C", group: "Métodos de apuntes",
    description: "Pregunta, evidencia y conclusión.", content: qec, requires: [] },
  { id: "sentence", name: "Frases", group: "Métodos de apuntes",
    description: "Ideas numeradas para sesiones rápidas.", content: sentence, requires: [] },
  { id: "flow", name: "Flow notes", group: "Métodos de apuntes",
    description: "Conexiones libres, contradicciones y dudas.", content: flow, requires: [] },
  { id: "charting", name: "Charting", group: "Métodos de apuntes",
    description: "Tabla comparativa de conceptos.", content: charting, requires: ["gfm-tables"] },
  { id: "zettelkasten", name: "Zettelkasten", group: "Métodos de apuntes",
    description: "Nota atómica con frontmatter y enlaces.", content: zettelkasten, requires: ["frontmatter", "wikilinks"] },
  { id: "mapping", name: "Mapa mental", group: "Métodos de apuntes",
    description: "Mindmap Mermaid con notas de apoyo.", content: mapping, requires: ["mermaid"] },
  { id: "daily-bujo", name: "Daily log", group: "Métodos de apuntes",
    description: "Rapid logging estilo bullet journal.", content: dailyBujo, requires: [] },

  // --- Trabajo y organización ------------------------------------------------
  { id: "meeting", name: "Acta de reunión", group: "Trabajo y organización",
    description: "Asistentes, orden del día, acuerdos y tareas.", requires: [], content:
`# Reunión — {{date}}

**Asistentes:**
**Lugar/Canal:**

## Orden del día
1.
2.

## Notas


## Acuerdos
-

## Tareas
- [ ] Tarea — responsable — fecha
` },
  { id: "project", name: "Página de proyecto", group: "Trabajo y organización",
    description: "Objetivo, estado, hitos, tareas y enlaces.", requires: ["wikilinks"], content:
`# {{title}}

> [!NOTE]
> Estado: **En curso** · Actualizado: {{date}}

## Objetivo


## Hitos
- [ ]

## Tareas
- [ ]

## Enlaces y notas
- [[ ]]
` },
  { id: "decision", name: "Registro de decisión", group: "Trabajo y organización",
    description: "Contexto, opciones, decisión y consecuencias (ADR).", requires: [], content:
`# Decisión: {{title}}

**Fecha:** {{date}} · **Estado:** Propuesta

## Contexto


## Opciones consideradas
1.
2.

## Decisión


## Consecuencias
-
` },
  { id: "todo", name: "Lista de tareas", group: "Trabajo y organización",
    description: "Pendiente, en curso y hecho.", requires: [], content:
`# Tareas

## Pendiente
- [ ]

## En curso
- [ ]

## Hecho
- [x]
` },
];

function fillVars(content: string, title: string): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const datetimeId = `${date.replace(/-/g, "")}-${p(now.getHours())}${p(now.getMinutes())}`;
  return content
    .replaceAll("{{date}}", date)
    .replaceAll("{{datetime_id}}", datetimeId)
    .replaceAll("{{title}}", title || "Sin título");
}

function missingReqs(t: Template): Requirement[] {
  return t.requires.filter((r) => !CAPABILITIES.includes(r));
}

// Un documento está "vacío" si no hay más que un encabezado (la página recién
// creada trae "# Título"). Entonces la plantilla reemplaza; si no, se inserta.
function isEssentiallyEmpty(md: string): boolean {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length === 0 || (lines.length === 1 && lines[0].startsWith("#"));
}

function applyTemplate(t: Template, title: string): void {
  const md = fillVars(t.content, title);
  if (isEssentiallyEmpty(getContent())) setContent(md);
  else insertMarkdown(md);
  focusEditor();
}

let overlay: HTMLElement | null = null;

export function openTemplates(pageTitle = ""): void {
  closeTemplatesNow();

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeTemplates(); });

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Plantillas");

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Plantillas</h2>`;
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = "Cerrar";
  close.setAttribute("aria-label", "Cerrar");
  close.innerHTML = icon("close");
  close.addEventListener("click", closeTemplates);
  header.appendChild(close);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";

  const groups = [...new Set(TEMPLATES.map((t) => t.group))];
  for (const g of groups) {
    const h = document.createElement("h3");
    h.className = "template-group";
    h.textContent = g;
    body.appendChild(h);

    const list = document.createElement("div");
    list.className = "template-list";
    for (const t of TEMPLATES.filter((x) => x.group === g)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "template-item";
      const missing = missingReqs(t);
      const note = missing.length
        ? `<em class="template-warn">necesita ${missing.map((r) => REQ_LABEL[r]).join(", ")} · se verá simplificada</em>`
        : "";
      item.innerHTML =
        `<span class="template-icon">${icon("template")}</span>` +
        `<span class="template-text"><strong>${t.name}</strong>` +
        `<small>${t.description}</small>${note}</span>`;
      item.addEventListener("click", () => {
        applyTemplate(t, pageTitle);
        closeTemplates();
      });
      list.appendChild(item);
    }
    body.appendChild(list);
  }

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay?.classList.add("visible"));
}

export function closeTemplates(): void {
  overlay?.classList.remove("visible");
  const o = overlay;
  overlay = null;
  setTimeout(() => o?.remove(), 200);
}

function closeTemplatesNow(): void {
  overlay?.remove();
  overlay = null;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) closeTemplates();
});
