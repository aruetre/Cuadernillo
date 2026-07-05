#Requires -Version 5.1
<#
.SYNOPSIS
    Utilidad de Cuadernillo para Windows: prepara el entorno, arranca/compila
    la app y publica un release.

.DESCRIPTION
    Tareas (primer argumento):
      dev       (por defecto) Prepara todo y arranca en modo desarrollo.
      build     Compila el binario de producción (.exe + .msi).
      setup     Solo prepara: npm install (si falta) y genera iconos (si faltan).
      release   Sube la versión, hace commit, crea el tag vX.Y.Z y lo empuja,
                lo que dispara el workflow de GitHub Actions que genera los
                binarios y crea el Release en borrador.

.EXAMPLE
    .\run.ps1
    .\run.ps1 build
    .\run.ps1 release 0.1.2

.NOTES
    Si PowerShell bloquea el script, ejecútalo así:
      powershell -ExecutionPolicy Bypass -File .\run.ps1 dev
#>
[CmdletBinding()]
param(
    [ValidateSet('dev', 'build', 'setup', 'release')]
    [string]$Task = 'dev',
    [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "OK  $msg"  -ForegroundColor Green }
function Fail($msg)        { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Assert-Tool($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Fail "No se encuentra '$name'. $hint"
    }
}

# Escribe texto en UTF-8 sin BOM (Set-Content en PS 5.1 mete BOM y rompe JSON).
function Write-TextNoBom($path, $content) {
    $full = (Resolve-Path $path).Path
    [System.IO.File]::WriteAllText($full, $content)
}

function Invoke-Setup {
    Assert-Tool node  "Instala Node 20+ desde https://nodejs.org"
    Assert-Tool npm   "Viene con Node.js."
    Assert-Tool cargo "Instala Rust (toolchain MSVC) desde https://rustup.rs"

    if (-not (Test-Path 'node_modules')) {
        Write-Step 'Instalando dependencias de npm...'
        npm install
        if ($LASTEXITCODE -ne 0) { Fail 'npm install falló.' }
    } else {
        Write-Ok 'node_modules ya presente.'
    }

    if (-not (Test-Path 'src-tauri/icons/icon.ico')) {
        Write-Step 'Generando iconos desde src-tauri/app-icon.png...'
        npx tauri icon src-tauri/app-icon.png
        if ($LASTEXITCODE -ne 0) { Fail 'La generación de iconos falló.' }
    } else {
        Write-Ok 'Iconos ya generados.'
    }
}

function Set-ProjectVersion($v) {
    Write-Step "Fijando versión $v en package.json, tauri.conf.json y Cargo.toml..."

    $pkg = Get-Content 'package.json' -Raw
    $pkg = [regex]::Replace($pkg, '("version"\s*:\s*")[^"]+(")', "`${1}$v`${2}", 1)
    Write-TextNoBom 'package.json' $pkg

    $conf = Get-Content 'src-tauri/tauri.conf.json' -Raw
    $conf = [regex]::Replace($conf, '("version"\s*:\s*")[^"]+(")', "`${1}$v`${2}", 1)
    Write-TextNoBom 'src-tauri/tauri.conf.json' $conf

    # En Cargo.toml solo la línea de versión del paquete (no las de dependencias).
    $cargo = Get-Content 'src-tauri/Cargo.toml' -Raw
    $cargo = [regex]::Replace($cargo, '(?m)^version = "[^"]*"', "version = `"$v`"", 1)
    Write-TextNoBom 'src-tauri/Cargo.toml' $cargo
}

switch ($Task) {

    'setup' {
        Invoke-Setup
        Write-Ok 'Entorno listo.'
    }

    'dev' {
        Invoke-Setup
        Write-Step 'Arrancando en modo desarrollo (recarga en caliente)...'
        npm run tauri dev
    }

    'build' {
        Invoke-Setup
        Write-Step 'Compilando binario de producción...'
        npm run tauri build
        if ($LASTEXITCODE -ne 0) { Fail 'La compilación falló.' }
        Write-Ok 'Binarios en src-tauri\target\release\bundle\'
    }

    'release' {
        if (-not $Version) { Fail 'Indica la versión, p. ej.: .\run.ps1 release 0.1.2' }
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "Versión inválida '$Version' (usa X.Y.Z)." }
        Assert-Tool git 'Instala Git para Windows: https://git-scm.com'
        if (-not (Test-Path '.git')) {
            Fail "Esta carpeta no es un repositorio git (se extrajo de un zip). Clona el repo con 'git clone https://github.com/aruetre/Cuadernillo.git' y lanza el release desde ahí."
        }

        $tag = "v$Version"
        $exists = (git tag --list $tag)
        if ($exists) { Fail "El tag $tag ya existe." }

        Set-ProjectVersion $Version

        Write-Step "Commit, tag $tag y push..."
        git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
        git commit -m "release: $tag"
        if ($LASTEXITCODE -ne 0) { Fail 'El commit falló (¿nada que commitear o identidad de git sin configurar?).' }
        git tag $tag
        git push origin HEAD
        git push origin $tag
        if ($LASTEXITCODE -ne 0) { Fail 'El push falló.' }

        Write-Ok "Release $tag lanzado."
        Write-Host "   Sigue la compilación en: https://github.com/aruetre/Cuadernillo/actions" -ForegroundColor Green
        Write-Host "   El borrador aparecerá en: https://github.com/aruetre/Cuadernillo/releases" -ForegroundColor Green
    }
}
