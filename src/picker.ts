import { icon } from "./icons";

export interface PickItem { rel: string; name: string; }

// Buscador de notas por nombre para insertar un vínculo [[…]]. Filtra en vivo,
// se navega con teclado y, si el texto no coincide con ninguna, permite crear
// una nota nueva con ese nombre (el vínculo la creará al hacer clic).
export function openNotePicker(items: PickItem[], onPick: (target: string) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay picker-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const box = document.createElement("div");
  box.className = "picker";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Buscar nota");

  const search = document.createElement("div");
  search.className = "picker-search";
  search.innerHTML = icon("wiki");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Buscar nota por nombre…";
  input.setAttribute("aria-label", "Buscar nota por nombre");
  search.appendChild(input);
  box.appendChild(search);

  const list = document.createElement("div");
  list.className = "picker-list";
  box.appendChild(list);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));

  // Estado del filtrado.
  type Row = { target: string; primary: string; secondary: string; create: boolean };
  let rows: Row[] = [];
  let active = 0;

  const targetOf = (rel: string) => rel.replace(/\.md$/, "");

  function compute(query: string): Row[] {
    const q = query.trim().toLowerCase();
    const matches = items
      .filter((it) => !q || it.name.toLowerCase().includes(q) || it.rel.toLowerCase().includes(q))
      .slice(0, 60)
      .map((it) => ({ target: targetOf(it.rel), primary: it.name, secondary: targetOf(it.rel), create: false }));

    // Opción de crear si hay texto y no hay coincidencia exacta por nombre/ruta.
    const exact = items.some(
      (it) => it.name.toLowerCase() === q || targetOf(it.rel).toLowerCase() === q
    );
    if (query.trim() && !exact) {
      matches.unshift({
        target: query.trim(),
        primary: `Crear «${query.trim()}»`,
        secondary: "nueva nota",
        create: true,
      });
    }
    return matches;
  }

  function render(): void {
    list.innerHTML = "";
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "picker-empty";
      empty.textContent = "Sin notas. Escribe un nombre para crear una.";
      list.appendChild(empty);
      return;
    }
    rows.forEach((r, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "picker-item" + (i === active ? " active" : "") + (r.create ? " create" : "");
      el.innerHTML =
        `<span class="picker-primary">${escapeHtml(r.primary)}</span>` +
        `<span class="picker-secondary">${escapeHtml(r.secondary)}</span>`;
      el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      list.appendChild(el);
    });
    const activeEl = list.children[active] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  function refilter(): void {
    rows = compute(input.value);
    active = 0;
    render();
  }

  function choose(i: number): void {
    const r = rows[i];
    if (!r) return;
    close();
    onPick(r.target);
  }

  function close(): void {
    overlay.classList.remove("visible");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => overlay.remove(), 180);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  }

  input.addEventListener("input", refilter);
  document.addEventListener("keydown", onKey, true);
  refilter();
  input.focus();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
