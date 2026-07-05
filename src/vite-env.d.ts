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
