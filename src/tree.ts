export interface PageNode {
  name: string;       // nombre visible sin extensión
  key: string;        // ruta relativa única (dir o fichero), clave de expansión
  rel_path: string;   // ruta relativa del .md asociado; "" si el directorio no tiene página
  is_dir: boolean;
  children: PageNode[];
}

import { iconEl } from "./icons";

export type OnSelect = (relPath: string) => void;

export interface TreeOptions {
  getIcon?: (rel: string) => string | undefined;
  onChangeIcon?: (rel: string, ev: MouseEvent) => void;
}

const expanded = new Set<string>();
let opts: TreeOptions = {};

export function renderTree(
  container: HTMLElement,
  nodes: PageNode[],
  activePath: string | null,
  onSelect: OnSelect,
  options: TreeOptions = {}
): void {
  opts = options;
  container.innerHTML = "";
  if (nodes.length === 0) {
    const p = document.createElement("p");
    p.className = "tree-empty";
    p.textContent = "Cuaderno vacío. Crea la primera página con +.";
    container.appendChild(p);
    return;
  }
  container.appendChild(buildLevel(nodes, activePath, onSelect));
}

function buildLevel(nodes: PageNode[], activePath: string | null, onSelect: OnSelect): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    frag.appendChild(buildNode(node, activePath, onSelect));
  }
  return frag;
}

function buildNode(node: PageNode, activePath: string | null, onSelect: OnSelect): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.tabIndex = 0;
  if (node.is_dir) row.classList.add("is-dir");
  if (node.rel_path) row.classList.add("has-page");
  if (activePath && node.rel_path && node.rel_path === activePath) row.classList.add("active");

  const twisty = document.createElement("span");
  twisty.className = "twisty";
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  twisty.textContent = hasChildren ? (isOpen ? "▾" : "▸") : "";
  row.appendChild(twisty);

  // Icono: emoji personalizado si lo tiene; si no, carpeta o página.
  const custom = node.rel_path ? opts.getIcon?.(node.rel_path) : undefined;
  let ic: Element;
  if (custom) {
    ic = document.createElement("span");
    ic.className = "tree-icon tree-emoji";
    // Valor guardado: SVG de librería (Iconify) o un emoji.
    if (custom.trim().startsWith("<svg")) ic.innerHTML = custom;
    else ic.textContent = custom;
  } else {
    const kind = node.is_dir && !node.rel_path ? "folder" : "page";
    ic = iconEl(kind);
    ic.classList.add("tree-icon");
  }
  row.appendChild(ic);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.name;
  row.appendChild(label);
  wrap.appendChild(row);

  let childrenEl: HTMLElement | null = null;
  if (hasChildren) {
    childrenEl = document.createElement("div");
    childrenEl.className = "tree-children" + (isOpen ? "" : " collapsed");
    childrenEl.appendChild(buildLevel(node.children, activePath, onSelect));
    wrap.appendChild(childrenEl);
  }

  const toggle = () => {
    if (!childrenEl) return;
    if (expanded.has(node.key)) {
      expanded.delete(node.key);
      childrenEl.classList.add("collapsed");
      twisty.textContent = "▸";
    } else {
      expanded.add(node.key);
      childrenEl.classList.remove("collapsed");
      twisty.textContent = "▾";
    }
  };

  twisty.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

  row.addEventListener("click", () => {
    if (node.rel_path) {
      onSelect(node.rel_path);
      if (childrenEl && !expanded.has(node.key)) toggle();
    } else {
      toggle();
    }
  });

  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      row.click();
    }
  });

  // Clic derecho sobre una página: cambiar su icono.
  if (node.rel_path) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      opts.onChangeIcon?.(node.rel_path, e);
    });
  }

  return wrap;
}

export function expandPathTo(relPath: string): void {
  // Expande los directorios ancestros de la página indicada.
  const parts = relPath.split("/");
  parts.pop();
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    expanded.add(acc);
  }
}
