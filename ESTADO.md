# Estado del proyecto y deuda técnica

_Última actualización: 2026-07-12._

> **Registro 2026-07-12:** chat IA agéntico colapsable en el pie (crear página /
> insertar / reemplazar / reescribir selección / renombrar; recuerda la
> conversación). Barra de herramientas reagrupada por función. Robustez:
> caché de imágenes con límite (D3) y carrera de `setContent` con token (D9).
> Admonitions estilo GitHub con marcador oculto (D10). **Pendiente:** aspecto
> del bloque de código (D7 — clases ya localizadas: `.milkdown-code-block`,
> `.tools`, `.language-button`, `.copy-button`, `.language-picker`,
> `.language-list-item`; falta el CSS, requiere inspección en la app) e
> historial de deshacer al cambiar tema de código (D2, aplazado: necesita
> `Compartment` de CodeMirror con la app corriendo).

Documento vivo con el estado real de Cuadernillo tras la gran tanda de features:
qué está hecho, qué deuda técnica arrastra, qué riesgos hay y qué queda por
desarrollar.

---

## 1. Resumen

Cuadernillo pasó de un editor mínimo (Fase A) a un editor con barra de
herramientas, ajustes por cuaderno, imágenes, admonitions, vínculos wiki,
plantillas, resaltado de código con CodeMirror, fuentes libres y librería de
iconos. **Compila y arranca** (verificado por el usuario). El grueso se
desarrolló sin build intermedio, así que la cobertura de pruebas es **manual y
parcial**: hay que ejercitar caminos concretos para dar por buenos los detalles.

Arquitectura sana de fondo: el backend Rust es dueño del disco y la seguridad de
rutas; el frontend nunca toca ficheros directamente. La deuda es sobre todo de
**robustez y pulido**, no estructural.

---

## 2. Funcionalidad implementada

| Área | Estado | Notas |
|---|---|---|
| Barra de herramientas ocultable + comandos de formato | ✅ | `toolbar.ts` |
| Toggle código ↔ vista con formato | ✅ | textarea + `replaceAll` |
| Imágenes + carpeta `attachments/<página>/` | ✅ | bug de espacios resuelto |
| Ajustes por cuaderno (`.cuadernillo/`): fuente, tamaño, ancho, márgenes | ✅ | `settings.ts` |
| CSS personalizado del markdown | ✅ | textarea + carga de fichero |
| Admonitions estilo GitHub + desplegable con iconos | ✅ | decoraciones |
| Vínculos `[[wiki]]` + enlaces `.md` navegables + buscador de notas | ✅ | `picker.ts` |
| Plantillas (13, incl. paquete markzim) | ✅ | `templates.ts` |
| Resaltado de código con CodeMirror (todos los lenguajes) | ✅ | tema en ajustes |
| Fuentes libres empaquetadas + sistema + personalizada | ✅ | `fonts.ts` |
| Iconos de página con buscador Iconify (clic derecho) | ✅ | `iconLibrary.ts` |
| Iconos de la interfaz desde Lucide | ✅ | `icons.ts` |
| Cursor: gap-cursor + párrafo final + cursor retro de bloque | ✅ | recién añadido |
| Ayuda de markdown | ✅ | `help.ts` |
| `run.ps1` (setup/dev/build/release) | ✅ | Windows |
| CI de releases (GitHub Actions) | ✅ | tag `v*` → binarios |

---

## 3. Deuda técnica

Severidad: 🔴 alta · 🟠 media · 🟡 baja.

| # | Sev | Dónde | Deuda | Propuesta |
|---|---|---|---|---|
| D1 | 🟠 | general | `tsc --noEmit` ya está en el CI (ci.yml); faltan tests de Rust. ni typecheck en CI de PRs. Todo se valida a mano. | Añadir `tsc --noEmit` al workflow y algún test de las funciones puras de Rust (`safe_join`, `sanitize_filename`). |
| D2 | 🟠 | `editor.ts` `setCodeTheme` | Cambiar el tema de código **reconstruye el editor entero** y recarga el markdown → se pierde el **historial de deshacer** y la posición del cursor. | Usar un `Compartment` de CodeMirror para reconfigurar sin recrear, o avisar de que aplica en recarga. |
| D3 | ✅ | `editor.ts` imágenes | Caché con límite (60) + evicción LRU (`cacheImage`). Queda pendiente el límite por tamaño de imagen y valorar `asset:` para imágenes grandes. |
| D4 | ✅ | `iconLibrary.ts` | El buscador carga **todas las colecciones** en memoria y hace **scan lineal** por cada tecla (~30k iconos). Sin debounce. | Debounce en el input; índice o límite por colección; cargar colecciones bajo demanda. |
| D5 | 🟠 | `pageIcons.ts` | El icono de página se guarda como **cadena SVG cruda** en `page-icons.json` (infla el fichero, no se puede re-tematizar). | Guardar el id `prefix:name` y renderizar al vuelo (requiere precargar la colección al pintar el árbol). |
| D6 | ✅ | `editor.ts` `blockCursor` | El cursor retro **oculta el caret nativo** globalmente. Si el overlay se descoloca (scroll anidado, zoom), no hay caret visible. Sin probar en todos los escenarios. | Hacerlo opcional (ajuste on/off) y validar posición con contenedores scrolleables. |
| D7 | ✅ | code-block CodeMirror | El **selector de lenguaje y el botón copiar** del componente salen sin estilar → rompen el aspecto. (Pendiente de arreglar.) | Estilar/integrar su DOM; requiere ver las clases en la app corriendo. |
| D8 | 🟡 | `editor.ts` decoraciones | El plugin recomputa decoraciones (`[[wiki]]`, admonitions) sobre **todo el documento en cada transacción**. Fino para notas; puede notarse en docs enormes. | Limitar al rango visible o cachear por nodo. |
| D9 | ✅ | `editor.ts` `setContent` | Resuelto con un **token**: un temporizador viejo ya no libera `suppress` si hubo un `setContent` posterior. |
| D10 | ✅ | admonitions | Marcador `[!NOTE]` oculto con decoración (se muestra solo al editar su línea) + cabecera icono+título estilo GitHub. Round-trip del markdown intacto. |
| D11 | ✅ | `fonts.ts` | Solo se importa el **peso 400**; las negritas del cuerpo son sintéticas (faux-bold). | Importar 400+700 de las fuentes clave. |
| D12 | ✅ | enlaces externos | Los enlaces `http(s)` en el editor **no abren** el navegador (solo se navegan los internos). | Interceptar y abrir con el plugin `opener`/`shell` de Tauri. |
| D13 | 🟡 | bundle | Iconify + fuentes + CodeMirror **engordan el bundle** y el arranque parsea bastante JSON. | Ya hay lazy-load en iconos; medir y recortar colecciones si molesta. |

---

## 4. Riesgos y bugs conocidos

- **Cursor atrapado en bloques**: mitigado con gap-cursor + párrafo final, pero el
  salir del **bloque CodeMirror** con teclado no está verificado; puede necesitar
  un keymap de salida.
- **Cursor retro sin probar** en todos los casos (ver D6).
- **Aspecto del code-block** (D7) reconocido como feo por el usuario, sin resolver.
- Todo lo posterior a la Fase A tiene **cobertura de pruebas parcial**.

---

## 5. Pendiente por desarrollar (lo hablado)

| Pedido | Estado | Nota |
|---|---|---|
| Alineación de **imágenes** (izq/centro/der) | ✅ hecho | título del markdown + CSS |
| Justificación de **texto** | ❌ descartado | el usuario pidió no hacerlo (rompería el markdown puro) |
| **Recordar el último cuaderno** abierto | ✅ hecho | recientes en config de la app + auto-open |
| **Intercambiador rápido** de cuadernos | ✅ hecho | menú de recientes en la barra lateral |
| Panel de **navegación por títulos** (outline) | ✅ hecho | `outline.ts`, panel plegable |
| Botones **insertar fecha / hora** | ✅ hecho | en la barra de herramientas |
| **Copiar todo el documento** (fuente o vista) | ✅ hecho | menú en la cabecera |
| Arreglar UI del **bloque de código** (D7) | ⏳ pendiente | necesita inspección del DOM en la app corriendo |
| Salir del **bloque CodeMirror** con teclado | ⏳ por verificar | mitigado con párrafo final + gap-cursor |

### Roadmap original del README (sigue vigente en parte)
- Búsqueda de texto completo en el cuaderno.
- Vigilancia de cambios externos (`notify`) para recargar el árbol.
- Exportar rama a HTML/PDF (pandoc).
- Paleta de comandos (Ctrl+P).

---

## 6. Recomendaciones (orden sugerido)

1. **Consolidar**: ejercitar a mano los caminos críticos (insertar cada bloque,
   imágenes, vínculos, cambiar tema/fuente) y anotar lo que falle. _(en curso)_
2. **Añadir `tsc --noEmit` al CI** (D1): red de seguridad barata contra regresiones.
3. Implementar los **pendientes rápidos** (fecha/hora, copiar doc, recordar
   cuaderno, outline) que dan mucho valor con poco riesgo.
4. Arreglar el **aspecto del code-block** (D7) y el **salir del bloque** con teclado.
5. Atacar la deuda 🟠 por impacto: historial al cambiar tema (D2), buscador de
   iconos (D4/D5).
