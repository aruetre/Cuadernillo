import { invoke } from "@tauri-apps/api/core";
import { icon } from "./icons";

interface SearchHit { rel_path: string; name: string; line: number; snippet: string; }

// Búsqueda de texto en todo el cuaderno (backend: search_notebook). Muestra
// coincidencias por línea con el término resaltado; al elegir una, abre la página.
export function openSearch(onOpen: (rel: string) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay picker-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const box = document.createElement("div");
  box.className = "picker";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Buscar en el cuaderno");

  const search = document.createElement("div");
  search.className = "picker-search";
  search.innerHTML = icon("search");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Buscar texto en todo el cuaderno…";
  search.appendChild(input);
  box.appendChild(search);

  const list = document.createElement("div");
  list.className = "picker-list";
  box.appendChild(list);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));

  let hits: SearchHit[] = [];
  let active = 0;
  let timer: number | undefined;
  let lastQuery = "";

  function render(query: string): void {
    list.innerHTML = "";
    if (!query.trim()) {
      addHint("Escribe para buscar en el contenido de las páginas.");
      return;
    }
    if (hits.length === 0) {
      addHint("Sin resultados.");
      return;
    }
    hits.forEach((h, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "picker-item search-item" + (i === active ? " active" : "");
      el.innerHTML =
        `<span class="picker-primary">${escapeHtml(h.name)} <span class="search-line">:${h.line}</span></span>` +
        `<span class="picker-secondary search-snippet">${highlight(h.snippet, query)}</span>`;
      el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      list.appendChild(el);
    });
    (list.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  function addHint(text: string): void {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = text;
    list.appendChild(empty);
  }

  async function runSearch(): Promise<void> {
    const q = input.value;
    lastQuery = q;
    if (!q.trim()) { hits = []; render(q); return; }
    try {
      const res = await invoke<SearchHit[]>("search_notebook", { query: q });
      if (q !== lastQuery) return; // llegó tarde
      hits = res;
      active = 0;
      render(q);
    } catch {
      hits = [];
      render(q);
    }
  }

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void runSearch(), 200);
  }

  function choose(i: number): void {
    const h = hits[i];
    if (!h) return;
    close();
    onOpen(h.rel_path);
  }

  function close(): void {
    overlay.classList.remove("visible");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => overlay.remove(), 180);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, hits.length - 1); render(input.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(input.value); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  }

  input.addEventListener("input", schedule);
  document.addEventListener("keydown", onKey, true);
  render("");
  input.focus();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function highlight(text: string, query: string): string {
  const safe = escapeHtml(text);
  const q = query.trim();
  if (!q) return safe;
  const idx = safe.toLowerCase().indexOf(escapeHtml(q).toLowerCase());
  if (idx < 0) return safe;
  const len = escapeHtml(q).length;
  return safe.slice(0, idx) + "<mark>" + safe.slice(idx, idx + len) + "</mark>" + safe.slice(idx + len);
}
