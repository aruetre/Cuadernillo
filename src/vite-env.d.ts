/// <reference types="vite/client" />

// Importación de ficheros como texto crudo (Vite: sufijo ?raw).
declare module "*.md?raw" {
  const content: string;
  export default content;
}
declare module "*?raw" {
  const content: string;
  export default content;
}

// Colecciones de iconos de Iconify (JSON) importadas dinámicamente.
declare module "@iconify-json/*/icons.json" {
  const data: { icons?: Record<string, unknown>; aliases?: Record<string, unknown> };
  export default data;
}
