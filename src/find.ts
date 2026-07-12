import { findSetQuery, findNext, findPrev, findReplace, findReplaceAll, findClear } from "./editor";
import { icon } from "./icons";

// Barra flotante de buscar y reemplazar dentro del documento (Ctrl+F).
let bar: HTMLElement | null = null;

export function openFind(): void {
  if (bar) { (bar.querySelector(".find-input") as HTMLInputElement)?.focus(); return; }

  bar = document.createElement("div");
  bar.className = "find-bar";
  bar.innerHTML =
    `<input class="find-input" type="text" placeholder="Buscar" aria-label="Buscar">` +
    `<span class="find-count">0/0</span>` +
    `<button class="find-btn" data-act="prev" title="Anterior (Mayús+Enter)">${icon("chevron-up")}</button>` +
    `<button class="find-btn" data-act="next" title="Siguiente (Enter)">${icon("chevron-down")}</button>` +
    `<input class="find-replace" type="text" placeholder="Reemplazar" aria-label="Reemplazar">` +
    `<button class="find-btn find-text" data-act="rep">Reemplazar</button>` +
    `<button class="find-btn find-text" data-act="repall">Todo</button>` +
    `<button class="find-btn" data-act="close" title="Cerrar (Esc)">${icon("close")}</button>`;
  document.body.appendChild(bar);

  const input = bar.querySelector(".find-input") as HTMLInputElement;
  const replace = bar.querySelector(".find-replace") as HTMLInputElement;
  const count = bar.querySelector(".find-count") as HTMLElement;
  const show = (info: { count: number; active: number }) => {
    count.textContent = info.count ? `${info.active + 1}/${info.count}` : "0/0";
  };

  const sel = window.getSelection()?.toString() ?? "";
  if (sel && sel.length < 80 && !sel.includes("\n")) input.value = sel;

  const doSearch = () => show(findSetQuery(input.value));
  input.addEventListener("input", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); show(e.shiftKey ? findPrev() : findNext()); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  replace.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); show(findReplace(replace.value)); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".find-btn");
    if (!b) return;
    switch (b.dataset.act) {
      case "prev": show(findPrev()); break;
      case "next": show(findNext()); break;
      case "rep": show(findReplace(replace.value)); break;
      case "repall": findReplaceAll(replace.value); show(findSetQuery(input.value)); break;
      case "close": closeFind(); break;
    }
  });

  if (input.value) doSearch();
  input.focus();
  input.select();
}

export function closeFind(): void {
  findClear();
  bar?.remove();
  bar = null;
}
