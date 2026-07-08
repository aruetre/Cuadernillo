# Cuadernillo

Editor markdown WYSIWYG de escritorio con estructura de cuaderno jerárquico tipo Zim Wiki. Construido con Tauri 2 (Rust) y Milkdown (ProseMirror). Todo software libre: MIT y Apache-2.0.

Lo que ves es lo que hay: escribes sobre el documento renderizado, no sobre texto plano ni panel dividido. Los atajos markdown funcionan en vivo: `# ` crea un título, `**texto**` pone negrita, `- ` abre una lista, ``` abre un bloque de código.

## Descargas

Los binarios ya compilados están en la **[página de Releases](https://github.com/aruetre/Cuadernillo/releases/latest)**. Descarga el que corresponda a tu sistema:

| Sistema | Fichero | Notas |
|---|---|---|
| **Windows 11** | `Cuadernillo_x.y.z_x64-setup.exe` o `Cuadernillo_x.y.z_x64_en-US.msi` | Instalador. WebView2 ya viene en Windows 11. |
| **Ubuntu / Debian** | `cuadernillo_x.y.z_amd64.deb` | `sudo apt install ./cuadernillo_*.deb` |
| **Fedora** | `cuadernillo-x.y.z-1.x86_64.rpm` | `sudo dnf install ./cuadernillo-*.rpm` |
| **Cualquier Linux** | `cuadernillo_x.y.z_amd64.AppImage` | `chmod +x` y ejecutar. Portable, sin instalar. |

> Los ejecutables no están firmados. En Windows, SmartScreen puede avisar: *Más información → Ejecutar de todas formas*. En Linux, dale permiso de ejecución al AppImage.

Si prefieres compilarlo tú mismo, sigue [Requisitos](#requisitos-comunes) y [Puesta en marcha](#puesta-en-marcha).

## Modelo de datos (idéntico a Zim)

- Un cuaderno es una carpeta cualquiera del disco.
- Cada página es un fichero `.md` en texto plano. Sin base de datos, sin formato propietario.
- Una página tiene subpáginas si existe una carpeta con su mismo nombre: `Proyectos.md` + `Proyectos/PaperBridge.md`.
- El cuaderno se puede versionar con git, sincronizar con Syncthing o abrir con cualquier otro editor.

## Requisitos comunes

- **Node.js 20+** ([nodejs.org](https://nodejs.org)).
- **Rust estable** vía [rustup](https://rustup.rs).

Tauri compila una app **nativa del sistema donde la construyes**: si compilas en Linux obtienes un binario Linux (GTK + WebKit), y si compilas en Windows obtienes un `.exe`/`.msi` (WebView2). Elige el apartado de tu sistema.

> ⚠️ **No compiles desde WSL apuntando a rutas de Windows** (ni al revés). El `node`/`npm` del PATH puede ser el binario del otro sistema y `npm install` falla dejando `node_modules/` vacío. Trabaja siempre con el proyecto y las herramientas del **mismo** sistema. Para una app de Windows: proyecto en `C:\...` y comandos en PowerShell. Para una app de Linux: proyecto en `~/...` y comandos en la terminal de Linux (con un Node nativo de Linux, p. ej. vía `nvm`, no el de `/mnt/c/`).

### Linux

Dependencias de sistema en Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++
```

En Debian/Ubuntu (22.04+, que trae `webkit2gtk-4.1`):

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

> En Ubuntu 20.04 el paquete es `libwebkit2gtk-4.0-dev` (no existe el `4.1`).

### Windows 11

Instala una sola vez, además de Node y Rust:

- Al instalar Rust con rustup, usa el toolchain **`stable-x86_64-pc-windows-msvc`** (el que ofrece por defecto).
- **Visual Studio C++ Build Tools** ([descarga](https://visualstudio.microsoft.com/visual-cpp-build-tools/)) marcando *"Desktop development with C++"*. Aporta el `link.exe` que Rust necesita para enlazar.
- **WebView2**: ya viene preinstalado en Windows 11, no hay que hacer nada.

Ejecuta todos los comandos desde **PowerShell** (o CMD), con el proyecto en una ruta nativa de Windows (`C:\Users\<tu-usuario>\Cuadernillo`, no en `\\wsl.localhost\...`).

## Puesta en marcha

### Windows: script `run.ps1`

En Windows lo más cómodo es el script de PowerShell incluido, que prepara el
entorno (instala dependencias y **genera los iconos si faltan**) y arranca:

```powershell
.\run.ps1            # setup + arrancar en desarrollo
.\run.ps1 build      # compilar el .exe + .msi
.\run.ps1 setup      # solo preparar el entorno
.\run.ps1 release 0.2.0   # subir versión, tag y push (dispara el release en CI)
```

> **Si PowerShell bloquea el script** con *«no está firmado digitalmente»
> (`UnauthorizedAccess`)*, es la directiva de ejecución de Windows, no un fallo
> del script. Autoriza los scripts **solo en esa ventana** (no necesita admin y
> se revierte al cerrarla) ejecutando esto **antes** del script:
>
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
> .\run.ps1
> ```
>
> Para no repetirlo, hazlo permanente para tu usuario una sola vez y desbloquea
> el archivo (que Windows marca como «descargado de Internet»):
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
> Unblock-File .\run.ps1
> ```

### Comandos manuales (Linux y Windows)

Equivalen a lo que hace el script, y son la vía en Linux:

```bash
npm install
npx tauri icon src-tauri/app-icon.png   # genera src-tauri/icons/ (solo la primera vez)
npm run tauri dev                        # desarrollo con recarga
npm run tauri build                      # binario de producción
```

`npm run tauri build` genera, según el sistema: `.deb`/`.rpm`/AppImage en Linux, y `.exe` + instalador `.msi` en Windows (en `src-tauri/target/release/bundle/`).

> La primera compilación de Rust tarda varios minutos; las siguientes son incrementales y rápidas.

## Publicar una versión (mantenedores)

Los binarios de la sección [Descargas](#descargas) los genera GitHub Actions
(`.github/workflows/release.yml`) automáticamente. Para publicar:

```bash
# 1. Sube la versión en package.json y src-tauri/tauri.conf.json (p. ej. 0.2.0)
# 2. Crea y empuja el tag
git tag v0.2.0
git push origin v0.2.0
```

El workflow compila en Windows y Ubuntu en paralelo (Windows produce
`.exe`/`.msi`; Ubuntu produce `.deb`, `.rpm` y AppImage), genera los iconos
desde `app-icon.png` y crea un **Release en borrador** con todo adjunto. Revísalo
en la pestaña *Releases* y pulsa *Publish* cuando esté listo. También puedes
lanzarlo a mano desde *Actions → Release → Run workflow*.

## Funcionalidad actual

- Abrir cualquier carpeta como cuaderno (diálogo nativo).
- Árbol lateral con expansión/colapso, navegación con teclado.
- Edición WYSIWYG: CommonMark + GFM (tablas, tareas, tachado), historial de deshacer, portapapeles con conversión markdown.
- Autoguardado con debounce de 800 ms, guardado al perder foco y con Ctrl+S. Escritura atómica (temporal + rename).
- Crear, renombrar y eliminar páginas. Renombrar mueve también la carpeta de subpáginas. Eliminar conserva las subpáginas.
- Validación de rutas en el backend Rust: sin `..`, sin rutas absolutas, sin caracteres conflictivos. Nada sale de la carpeta del cuaderno.
- Asistente de IA opcional (ver abajo).

## Asistente de IA

Cuadernillo puede conectarse a una IA para **generar** documentos y **analizar**
el que tengas abierto. Usa cualquier API **compatible con OpenAI**; por defecto
está preparado para la **API gratuita de NVIDIA**.

### Conseguir una API key gratis (NVIDIA)

1. Entra en **[build.nvidia.com](https://build.nvidia.com)** e inicia sesión (gratis).
2. Elige un modelo (p. ej. *Llama 3.3 70B Instruct*) y pulsa **«Get API Key»**.
3. Copia la clave, que empieza por `nvapi-…`.

### Configurar

Abre el panel de IA con el botón de **chispas (✨)** de la cabecera → sección
**Configuración**:

- **API key**: pega tu `nvapi-…`.
- **Modelo**: por defecto `meta/llama-3.3-70b-instruct` (puedes poner cualquiera del catálogo).
- **Endpoint**: `https://integrate.api.nvidia.com/v1` (déjalo salvo que uses otro proveedor).

La configuración se guarda **en tu equipo** (carpeta de config de la app), no en
el cuaderno, así que no viaja al compartir/sincronizar.

### Uso

- **Generar documento**: escribe un título y una instrucción → la IA redacta el
  contenido y **crea una página `.md` nueva** con él.
- **Analizar documento**: envía el documento abierto y elige el análisis
  (resumen, revisión y correcciones, ideas para ampliar, extraer tareas). El
  resultado puedes **insertarlo** o **guardarlo como nota nueva**.

### Otros proveedores

Al ser compatible con OpenAI, funciona cambiando **Endpoint** + **Modelo** (y la
key): OpenAI (`https://api.openai.com/v1`), o un modelo **local** con Ollama
(`http://localhost:11434/v1`, sin coste ni envío de datos fuera del equipo).

> **Privacidad**: con una API en la nube, el texto que envíes (instrucción o
> documento) se manda a ese proveedor. Con Ollama local, no sale de tu equipo.

## Arquitectura

```
src/                  Frontend TypeScript + Vite
  main.ts             Estado, navegación, autoguardado
  editor.ts           Milkdown: presets, listener, replaceAll
  tree.ts             Árbol de páginas
  styles.css          Tema completo
src-tauri/
  src/lib.rs          Comandos: list_pages, read_page, write_page,
                      create_page, rename_page, delete_page
  capabilities/       Permisos mínimos: core + dialog:allow-open
```

El frontend nunca toca el disco directamente. Todo pasa por comandos Rust con rutas saneadas, lo que reduce superficie de ataque frente a usar el plugin fs con alcance amplio.

## Hoja de ruta razonable

1. Enlaces wiki `[[Página]]` con autocompletado y creación al hacer clic (plugin ProseMirror propio).
2. Búsqueda de texto completo (crate `grep` o índice tantivy).
3. Vigilancia de cambios externos con `notify` para recargar el árbol.
4. Exportar rama a HTML/PDF vía pandoc.
5. Paleta de comandos (Ctrl+P) para saltar entre páginas.

## Licencia

Cuadernillo - editor markdown WYSIWYG con estructura de cuaderno
Copyright (C) 2026 Antonio Rueda (antoniorueda.es)

Publicado bajo GPL-3.0. Ver LICENSE.
