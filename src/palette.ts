import { icon } from "./icons";

export interface PaletteCommand { label: string; hint?: string; run: () => void; }
export interface PalettePage { rel: string; name: string; }

interface Row { kind: "cmd" | "page"; label: string; secondary: string; action: () => void; }

// Paleta de comandos (Ctrl+P): ejecuta acciones o salta a cualquier página.
export function openPalette(
  pages: PalettePage[],
  commands: PaletteCommand[],
  onOpenPage: (rel: string) => void
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay picker-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const box = document.createElement("div");
  box.className = "picker";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Paleta de comandos");

  const search = document.createElement("div");
  search.className = "picker-search";
  search.innerHTML = icon("palette");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ir a una página o ejecutar un comando…";
  search.appendChild(input);
  box.appendChild(search);

  const list = document.createElement("div");
  list.className = "picker-list";
  box.appendChild(list);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));

  const base: Row[] = [
    ...commands.map((c): Row => ({ kind: "cmd", label: c.label, secondary: c.hint ?? "comando", action: c.run })),
    ...pages.map((p): Row => ({ kind: "page", label: p.name, secondary: p.rel.replace(/\.md$/, ""), action: () => onOpenPage(p.rel) })),
  ];

  let rows: Row[] = base;
  let active = 0;

  function compute(q: string): Row[] {
    const query = q.trim().toLowerCase();
    if (!query) return base.slice(0, 80);
    return base
      .filter((r) => r.label.toLowerCase().includes(query) || r.secondary.toLowerCase().includes(query))
      .slice(0, 80);
  }

  function render(): void {
    list.innerHTML = "";
    if (rows.length === 0) {
      const e = document.createElement("div");
      e.className = "picker-empty";
      e.textContent = "Sin coincidencias.";
      list.appendChild(e);
      return;
    }
    rows.forEach((r, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "picker-item" + (i === active ? " active" : "");
      el.innerHTML =
        `<span class="picker-primary"><span class="palette-kind">${r.kind === "cmd" ? "›" : "📄"}</span> ${escapeHtml(r.label)}</span>` +
        `<span class="picker-secondary">${escapeHtml(r.secondary)}</span>`;
      el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      list.appendChild(el);
    });
    (list.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  function refilter(): void { rows = compute(input.value); active = 0; render(); }

  function choose(i: number): void {
    const r = rows[i];
    if (!r) return;
    close();
    r.action();
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
