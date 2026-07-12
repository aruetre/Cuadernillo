import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { icon } from "./icons";

// Notas de versión. La primera entrada es la más reciente.
interface Release { version: string; notes: string[]; }

const CHANGELOG: Release[] = [
  { version: "0.5.0", notes: [
    "Layout de página por documento: A6–A3, Carta/Legal, orientación y márgenes.",
    "Buscar y reemplazar dentro del documento (Ctrl+F).",
    "Arrastrar y soltar imágenes al editor.",
    "Papelera: eliminar es recuperable; retroenlaces entre notas.",
    "Copia de seguridad del cuaderno a .zip.",
    "Contador de palabras, corrector ortográfico, zoom (Ctrl +/−), deshacer/rehacer.",
    "Recuerda la última página y el tamaño/posición de la ventana.",
    "Enlaces externos abren el navegador; barra reorganizada; Acerca de / Novedades.",
  ]},
  { version: "0.4.2", notes: [
    "Respuestas de IA en streaming (aparecen en vivo).",
    "Los enlaces externos abren el navegador del sistema.",
    "Cursor retro activable/desactivable.",
    "Negritas reales (pesos de fuente).",
    "Layout de página por documento: A6–A3, Carta/Legal, orientación y márgenes.",
  ]},
  { version: "0.4.1", notes: [
    "Sistema de actualización automática (firmado).",
  ]},
  { version: "0.4.0", notes: [
    "Búsqueda de texto en todo el cuaderno (Ctrl+Mayús+F).",
    "Paleta de comandos (Ctrl+P).",
    "Vigilancia de cambios externos del cuaderno.",
    "Exportar el documento a HTML y PDF.",
  ]},
  { version: "0.3.0", notes: [
    "Modo claro/oscuro global.",
    "Asistente de IA: generar documentos y analizar el actual.",
    "Barra de título propia; panel de índice a la derecha.",
    "Intercambiador de cuadernos y recordar el último.",
  ]},
  { version: "0.2.0", notes: [
    "Barra de herramientas, plantillas, admonitions, vínculos [[wiki]].",
    "Imágenes con adjuntos; resaltado de código con CodeMirror; fuentes.",
  ]},
  { version: "0.1.0", notes: [
    "Primera versión: editor markdown WYSIWYG con estructura tipo Zim.",
  ]},
];

let overlay: HTMLElement | null = null;

/** Muestra las novedades solo si es la primera vez que se abre esta versión. */
export async function maybeShowWhatsNew(): Promise<void> {
  let v = "";
  try { v = await getVersion(); } catch { return; }
  const seen = localStorage.getItem("cuadernillo.lastSeenVersion");
  localStorage.setItem("cuadernillo.lastSeenVersion", v);
  if (seen === null || seen === v) return; // primera instalación o misma versión
  void openAbout(v);
}

export async function openAbout(highlight?: string): Promise<void> {
  closeNow();
  let version = "";
  try { version = await getVersion(); } catch { /* dev */ }

  overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAbout(); });

  const dialog = document.createElement("div");
  dialog.className = "modal about-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Acerca de Cuadernillo");

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Cuadernillo${version ? ` <span class="about-ver">v${version}</span>` : ""}</h2>`;
  const close = document.createElement("button");
  close.className = "icon-btn";
  close.title = "Cerrar";
  close.innerHTML = icon("close");
  close.addEventListener("click", closeAbout);
  header.appendChild(close);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body about-body";

  const meta = document.createElement("p");
  meta.className = "about-meta";
  meta.innerHTML =
    "Editor markdown WYSIWYG con estructura de cuaderno tipo Zim.<br>" +
    "Antonio Rueda · GPL-3.0 · " +
    '<a href="https://github.com/aruetre/Cuadernillo">github.com/aruetre/Cuadernillo</a>';
  meta.querySelector("a")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openUrl("https://github.com/aruetre/Cuadernillo");
  });
  body.appendChild(meta);

  if (highlight) {
    const banner = document.createElement("div");
    banner.className = "about-banner";
    banner.textContent = `Novedades de la versión ${highlight}`;
    body.appendChild(banner);
  }

  const h = document.createElement("h3");
  h.className = "about-changelog-title";
  h.textContent = "Novedades";
  body.appendChild(h);

  for (const rel of CHANGELOG) {
    const block = document.createElement("div");
    block.className = "about-release" + (rel.version === highlight ? " highlight" : "");
    const v = document.createElement("div");
    v.className = "about-release-ver";
    v.textContent = `v${rel.version}`;
    const ul = document.createElement("ul");
    for (const n of rel.notes) {
      const li = document.createElement("li");
      li.textContent = n;
      ul.appendChild(li);
    }
    block.append(v, ul);
    body.appendChild(block);
  }

  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay?.classList.add("visible"));
}

export function closeAbout(): void {
  overlay?.classList.remove("visible");
  const o = overlay;
  overlay = null;
  setTimeout(() => o?.remove(), 200);
}

function closeNow(): void { overlay?.remove(); overlay = null; }

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay) closeAbout();
});
