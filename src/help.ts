import { icon } from "./icons";

interface Row { syntax: string; result: string; }
interface Section { title: string; rows: Row[]; }

const SECTIONS: Section[] = [
  {
    title: "Texto",
    rows: [
      { syntax: "**negrita**", result: "negrita" },
      { syntax: "*cursiva*", result: "cursiva" },
      { syntax: "~~tachado~~", result: "tachado" },
      { syntax: "`código`", result: "código en línea" },
    ],
  },
  {
    title: "Títulos",
    rows: [
      { syntax: "# Título 1", result: "encabezado nivel 1" },
      { syntax: "## Título 2", result: "encabezado nivel 2" },
      { syntax: "### Título 3", result: "encabezado nivel 3" },
    ],
  },
  {
    title: "Listas y bloques",
    rows: [
      { syntax: "- elemento", result: "lista con viñetas" },
      { syntax: "1. elemento", result: "lista numerada" },
      { syntax: "- [ ] tarea", result: "casilla de tarea" },
      { syntax: "> cita", result: "bloque de cita" },
      { syntax: "```", result: "bloque de código" },
      { syntax: "---", result: "línea horizontal" },
    ],
  },
  {
    title: "Enlaces e imágenes",
    rows: [
      { syntax: "[texto](url)", result: "enlace" },
      { syntax: "[texto](Pagina.md)", result: "enlace a otra nota" },
      { syntax: "[[Pagina]]", result: "vínculo wiki a otra nota" },
      { syntax: "![alt](imagen.png)", result: "imagen" },
    ],
  },
  {
    title: "Tablas",
    rows: [
      { syntax: "| A | B |\n|---|---|\n| 1 | 2 |", result: "tabla de 2 columnas" },
    ],
  },
  {
    title: "Avisos (admonitions, estilo GitHub)",
    rows: [
      { syntax: "> [!NOTE]", result: "nota informativa" },
      { syntax: "> [!TIP]", result: "consejo" },
      { syntax: "> [!IMPORTANT]", result: "importante" },
      { syntax: "> [!WARNING]", result: "advertencia" },
      { syntax: "> [!CAUTION]", result: "precaución" },
    ],
  },
  {
    title: "Asistente de IA (botón ✨ de la cabecera)",
    rows: [
      { syntax: "Configuración", result: "API key gratis de build.nvidia.com (nvapi-…)" },
      { syntax: "Generar", result: "título + instrucción → crea una nota nueva con IA" },
      { syntax: "Analizar", result: "resumen, correcciones, ideas o tareas del documento actual" },
    ],
  },
];

let overlay: HTMLElement | null = null;

export function openHelp(): void {
  if (overlay) { overlay.classList.add("visible"); return; }

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeHelp(); });

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Ayuda de markdown");

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Referencia de Markdown</h2>`;
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = "Cerrar";
  close.setAttribute("aria-label", "Cerrar");
  close.innerHTML = icon("close");
  close.addEventListener("click", closeHelp);
  header.appendChild(close);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body help-body";
  for (const sec of SECTIONS) {
    const h = document.createElement("h3");
    h.textContent = sec.title;
    body.appendChild(h);
    const table = document.createElement("table");
    table.className = "help-table";
    for (const row of sec.rows) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const code = document.createElement("code");
      code.textContent = row.syntax;
      td1.appendChild(code);
      const td2 = document.createElement("td");
      td2.textContent = row.result;
      tr.append(td1, td2);
      table.appendChild(tr);
    }
    body.appendChild(table);
  }
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay?.classList.add("visible"));
}

export function closeHelp(): void {
  overlay?.classList.remove("visible");
}

// Cerrar con Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay?.classList.contains("visible")) closeHelp();
});
