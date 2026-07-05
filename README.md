# Cuadernillo

Editor markdown WYSIWYG de escritorio con estructura de cuaderno jerárquico tipo Zim Wiki. Construido con Tauri 2 (Rust) y Milkdown (ProseMirror). Todo software libre: MIT y Apache-2.0.

Lo que ves es lo que hay: escribes sobre el documento renderizado, no sobre texto plano ni panel dividido. Los atajos markdown funcionan en vivo: `# ` crea un título, `**texto**` pone negrita, `- ` abre una lista, ``` abre un bloque de código.

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

Los comandos son los mismos en ambos sistemas (en Windows, desde PowerShell):

```bash
npm install
npx tauri icon src-tauri/app-icon.png   # genera src-tauri/icons/ (solo la primera vez)
npm run tauri dev                        # desarrollo con recarga
npm run tauri build                      # binario de producción
```

`npm run tauri build` genera, según el sistema: `.deb`/`.rpm`/AppImage en Linux, y `.exe` + instalador `.msi` en Windows (en `src-tauri/target/release/bundle/`).

> La primera compilación de Rust tarda varios minutos; las siguientes son incrementales y rápidas.

## Funcionalidad actual

- Abrir cualquier carpeta como cuaderno (diálogo nativo).
- Árbol lateral con expansión/colapso, navegación con teclado.
- Edición WYSIWYG: CommonMark + GFM (tablas, tareas, tachado), historial de deshacer, portapapeles con conversión markdown.
- Autoguardado con debounce de 800 ms, guardado al perder foco y con Ctrl+S. Escritura atómica (temporal + rename).
- Crear, renombrar y eliminar páginas. Renombrar mueve también la carpeta de subpáginas. Eliminar conserva las subpáginas.
- Validación de rutas en el backend Rust: sin `..`, sin rutas absolutas, sin caracteres conflictivos. Nada sale de la carpeta del cuaderno.

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
