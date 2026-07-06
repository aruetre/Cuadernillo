// Panel de índice: extrae los títulos del markdown de la página actual y permite
// saltar a cada uno. La numeración de títulos coincide con la del DOM (mismo
// orden de documento), así que basta el índice para localizar el destino.

export type OnGoto = (index: number) => void;

interface Heading { level: number; text: string; }

function clean(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")   // [[wiki|alias]] -> wiki
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")             // [texto](url) -> texto
    .replace(/[*_`~]/g, "")
    .trim();
}

function parseHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: clean(m[2]) });
  }
  return out;
}

export function renderOutline(container: HTMLElement, markdown: string, onGoto: OnGoto): void {
  const headings = parseHeadings(markdown);
  container.innerHTML = "";
  if (headings.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "Sin títulos";
    container.appendChild(p);
    return;
  }
  const minLevel = Math.min(...headings.map((h) => h.level));
  headings.forEach((h, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "outline-item";
    b.dataset.level = String(h.level);
    b.style.paddingLeft = `${10 + (h.level - minLevel) * 12}px`;
    b.textContent = h.text || "(sin título)";
    b.title = h.text;
    b.addEventListener("click", () => onGoto(i));
    container.appendChild(b);
  });
}
