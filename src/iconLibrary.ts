import { getIconData, iconToSVG, iconToHTML, replaceIDs } from "@iconify/utils";

// Estructura mínima de una colección Iconify (evita depender de @iconify/types).
type IconSet = { icons?: Record<string, unknown>; aliases?: Record<string, unknown> };

// Acceso offline a varias colecciones de iconos (Iconify). Las colecciones se
// cargan de forma perezosa (import dinámico → chunk aparte) la primera vez que
// se abre el selector, para no engordar el arranque. Se rinden a SVG inline con
// @iconify/utils, sin CDN (compatible con el CSP).

interface Collection {
  prefix: string;
  name: string;
  load: () => Promise<{ default: IconSet }>;
}

const COLLECTIONS: Collection[] = [
  { prefix: "lucide", name: "Lucide", load: () => import("@iconify-json/lucide/icons.json") },
  { prefix: "tabler", name: "Tabler", load: () => import("@iconify-json/tabler/icons.json") },
  { prefix: "ph", name: "Phosphor", load: () => import("@iconify-json/ph/icons.json") },
  { prefix: "bi", name: "Bootstrap", load: () => import("@iconify-json/bi/icons.json") },
  { prefix: "ri", name: "Remix", load: () => import("@iconify-json/ri/icons.json") },
  { prefix: "heroicons", name: "Heroicons", load: () => import("@iconify-json/heroicons/icons.json") },
];

const loaded = new Map<string, IconSet>();
let index: string[] = []; // "prefix:name" de todas las colecciones cargadas
let loadingPromise: Promise<void> | null = null;

/** Carga todas las colecciones (una sola vez) y construye el índice de búsqueda. */
export function ensureLibraryLoaded(): Promise<void> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    await Promise.all(
      COLLECTIONS.map(async (c) => {
        try {
          const mod = await c.load();
          const data = (mod.default ?? mod) as IconSet;
          loaded.set(c.prefix, data);
        } catch {
          /* colección no disponible: se omite */
        }
      })
    );
    const names: string[] = [];
    for (const [prefix, data] of loaded) {
      for (const name of Object.keys(data.icons ?? {})) names.push(`${prefix}:${name}`);
      for (const name of Object.keys(data.aliases ?? {})) names.push(`${prefix}:${name}`);
    }
    index = names;
  })();
  return loadingPromise;
}

/** Busca iconos por subcadena. Devuelve ids "prefix:name" (máx. `limit`). */
export function searchIcons(query: string, limit = 120): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, limit);
  const out: string[] = [];
  for (const id of index) {
    if (id.toLowerCase().includes(q)) {
      out.push(id);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Renderiza un icono "prefix:name" a una cadena SVG inline (currentColor, 1em). */
export function renderIconSvg(id: string): string | null {
  const [prefix, ...rest] = id.split(":");
  const name = rest.join(":");
  const set = loaded.get(prefix);
  if (!set) return null;
  const data = getIconData(set as never, name);
  if (!data) return null;
  const built = iconToSVG(data, { height: "1em" });
  const attrs = {
    ...built.attributes,
    width: "1em",
    height: "1em",
    style: "color:currentColor;vertical-align:middle",
  };
  return iconToHTML(replaceIDs(built.body), attrs);
}

export function collectionNames(): { prefix: string; name: string }[] {
  return COLLECTIONS.map((c) => ({ prefix: c.prefix, name: c.name }));
}
