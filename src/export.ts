import { invoke } from "@tauri-apps/api/core";
import { getDocumentHtml } from "./editor";

// Estilo autocontenido para el HTML exportado (independiente del tema de la app).
const EXPORT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f4f4f2;
    font-family: Charter, "Bitstream Charter", Georgia, serif;
    color: #1e2126;
    line-height: 1.65;
  }
  .doc {
    max-width: 820px;
    margin: 40px auto;
    background: #fff;
    padding: 56px 64px;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
  }
  h1, h2, h3, h4 { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #1f4e8c; line-height: 1.25; margin: 1.4em 0 .5em; }
  h1 { font-size: 1.9em; border-bottom: 2px solid #e8eef7; padding-bottom: .2em; }
  h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
  a { color: #1f4e8c; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: .87em; background: #eef0f2; border-radius: 3px; padding: .1em .35em; }
  pre { background: #23272e; color: #d8dee6; border-radius: 6px; padding: 14px 18px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: inherit; }
  blockquote { border-left: 3px solid #1f4e8c; background: #e8eef7; margin: 1em 0; padding: 8px 16px; border-radius: 0 4px 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #dcdcd8; padding: 6px 10px; }
  th { background: #f2f2f0; font-family: system-ui, sans-serif; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  hr { border: none; border-top: 1px solid #dcdcd8; margin: 2em 0; }
  ul, ol { padding-left: 1.4em; }
  @media print {
    body { background: #fff; }
    .doc { margin: 0; box-shadow: none; border-radius: 0; padding: 0; max-width: 100%; }
  }
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildStandalone(title: string, contentHtml: string): string {
  return (
    "<!doctype html>\n" +
    '<html lang="es">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${escapeHtml(title)}</title>\n<style>${EXPORT_CSS}</style>\n</head>\n` +
    `<body>\n<article class="doc">\n${contentHtml}\n</article>\n</body>\n</html>\n`
  );
}

function fileBase(title: string): string {
  const clean = title.replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().replace(/\s+/g, "-");
  return clean || "documento";
}

/** Exporta el documento actual a un fichero HTML autocontenido. */
export async function exportHtml(title: string): Promise<void> {
  const content = await getDocumentHtml();
  if (!content.trim()) { window.alert("No hay documento que exportar."); return; }
  const html = buildStandalone(title, content);
  try {
    await invoke("export_file", { content: html, defaultName: `${fileBase(title)}.html`, extension: "html" });
  } catch (err) {
    window.alert(String(err));
  }
}

/** Abre el diálogo de impresión del sistema (permite «Guardar como PDF»). */
export function exportPdf(): void {
  window.print();
}
