import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Comprobación de actualizaciones contra los GitHub Releases (updater de Tauri).
// `silent`: no avisa si no hay nada (para la comprobación automática al arrancar).
export async function checkForUpdates(silent = false): Promise<void> {
  let update;
  try {
    update = await check();
  } catch (e) {
    if (!silent) window.alert("No se pudo comprobar actualizaciones:\n" + String(e));
    return;
  }
  if (!update) {
    if (!silent) window.alert("Ya tienes la última versión de Cuadernillo.");
    return;
  }

  const notes = update.body ? `\n\n${update.body}` : "";
  const ok = window.confirm(
    `Hay una versión nueva: ${update.version}${notes}\n\n¿Descargar e instalar ahora? La app se reiniciará al terminar.`
  );
  if (!ok) return;

  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    window.alert("Error al instalar la actualización:\n" + String(e));
  }
}
