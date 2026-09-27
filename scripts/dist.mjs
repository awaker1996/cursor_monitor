#!/usr/bin/env node
/**
 * Packaging orchestrator for `npm run dist`.
 *
 * Root cause this guards against:
 *   electron-builder empties its output directory before packaging. On Windows,
 *   the `.asar` it produces is an Electron archive, and Electron-based editors
 *   that have this project open (VS Code / Cursor / MiniMax Code / OpenChamber
 *   …) happily open and keep a handle on `win-unpacked/resources/app.asar`.
 *   The removal then fails with
 *   `The process cannot access the file because it is being used by another process`
 *   and the build aborts with ERR_ELECTRON_BUILDER_CANNOT_EXECUTE. Renaming the
 *   folder is blocked too, so no amount of retrying in-place can help.
 *
 * The fix:
 *   1. Stop instances of the packaged app / dev Electron that could lock files.
 *   2. Package into a directory *outside the workspace* (external output), so no
 *      editor/IDE indexes it and no build artifact there can ever be locked.
 *   3. Copy the finished installers / update metadata into `release`, and
 *      refresh `release/win-unpacked` when that folder is not locked.
 *
 * Override the external output location with CURSOR_MONITOR_DIST_DIR.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = 'release'
const legacyStagingDir = 'release-build'
const artifactPattern = /\.(exe|blockmap|yml)$/i
const ignoredArtifacts = /^builder-debug\.yml$/i

const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])
const RETRY_ATTEMPTS = 40 // 40 * 250ms = 10s of grace for short-lived locks
const RETRY_DELAY_MS = 250

function log(message) {
  console.log(`[dist] ${message}`)
}

function warn(message) {
  console.warn(`[dist] warning: ${message}`)
}

/** Synchronous sleep so the orchestrator stays strictly sequential. */
function sleep(ms) {
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

function isFileLockError(err) {
  if (!err) return false
  if (err.code && LOCK_CODES.has(err.code)) return true
  return /being used by another process|access is denied|EBUSY|EPERM|EACCES|ENOTEMPTY/i.test(
    err.message ?? '',
  )
}

/**
 * Terminate processes that can hold the build output open: the installed /
 * portable app (by name), the dev Electron started from `node_modules` (by
 * executable path), and Electron children we can only match by command line.
 * Never touches editors, which live outside the project tree.
 */
function stopRunningInstances() {
  if (process.platform !== 'win32') return

  const escapedRoot = root.replace(/'/g, "''")
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = '${escapedRoot}'`,
    '$self = $PID',
    'function Get-Targets {',
    '  Get-CimInstance Win32_Process | Where-Object {',
    '    $p = $_',
    '    if ($p.ProcessId -eq $self) { return $false }',
    "    if ($p.Name -like 'Cursor Token Monitor*') { return $true }",
    '    if ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }',
    "    if ($p.Name -ieq 'electron.exe' -and $p.CommandLine -and $p.CommandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }",
    '    return $false',
    '  }',
    '}',
    'for ($i = 0; $i -lt 5; $i++) {',
    '  $targets = @(Get-Targets)',
    '  if ($targets.Count -eq 0) { break }',
    '  foreach ($t in $targets) {',
    '    try {',
    '      Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop',
    '      Write-Output ("stopped {0} {1}" -f $t.ProcessId, $t.Name)',
    '    } catch {',
    '      Write-Output ("could not stop {0} {1}: {2}" -f $t.ProcessId, $t.Name, $_.Exception.Message)',
    '    }',
    '  }',
    '  Start-Sleep -Milliseconds 400',
    '}',
    '$remaining = @(Get-Targets)',
    'if ($remaining.Count -eq 0) {',
    "  Write-Output 'all clear'",
    '} else {',
    '  foreach ($r in $remaining) {',
    '    Write-Output ("still running {0} {1}" -f $r.ProcessId, $r.Name)',
    '  }',
    '}',
  ].join('\n')

  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'inherit',
  })
  if (res.error) warn(`could not query running processes (${res.error.message})`)
}

/**
 * Remove a directory, retrying while a file inside is locked by another
 * process. Returns false only when the lock outlives the retry window.
 * Deleting is the reliable test on Windows: a locked file can often still be
 * opened for read/write, but never removed.
 */
function emptyDir(dir) {
  const target = path.isAbsolute(dir) ? dir : path.join(root, dir)
  if (!fs.existsSync(target)) return true
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      return true
    } catch (err) {
      if (!isFileLockError(err)) throw err
      sleep(RETRY_DELAY_MS)
    }
  }
  return false
}

/** A fresh, empty directory outside the workspace where IDEs cannot lock it. */
function resolveExternalOutputRoot() {
  const override = process.env.CURSOR_MONITOR_DIST_DIR
  if (override) return path.resolve(override)
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir()
  return path.join(base, 'CursorTokenMonitor', 'dist')
}

function pickOutputDir() {
  const outRoot = resolveExternalOutputRoot()
  fs.mkdirSync(outRoot, { recursive: true })
  if (emptyDir(outRoot)) return outRoot

  // Even the external root is held (rare — usually an antivirus scan): nest a
  // unique, guaranteed-empty directory under it.
  const unique = path.join(outRoot, `build-${Date.now()}`)
  fs.mkdirSync(unique, { recursive: true })
  log(`external output root is locked; using '${unique}'.`)
  return unique
}

function copyDirSync(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirSync(src, dest)
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest)
    else fs.copyFileSync(src, dest)
  }
}

function copyFileWithRetry(src, dest) {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      fs.copyFileSync(src, dest)
      return true
    } catch (err) {
      if (!isFileLockError(err)) throw err
      sleep(RETRY_DELAY_MS)
    }
  }
  return false
}

/** Copy installers / update metadata into the stable `release` folder. */
function publishArtifacts(fromDir) {
  const from = path.isAbsolute(fromDir) ? fromDir : path.join(root, fromDir)
  const to = path.join(root, releaseDir)
  fs.mkdirSync(to, { recursive: true })

  const entries = fs
    .readdirSync(from, { withFileTypes: true })
    .filter((entry) => entry.isFile() && artifactPattern.test(entry.name) && !ignoredArtifacts.test(entry.name))

  if (entries.length === 0) {
    warn(`no installer artifacts found in ${fromDir}`)
  } else {
    for (const entry of entries) {
      const dest = path.join(to, entry.name)
      if (copyFileWithRetry(path.join(from, entry.name), dest)) {
        log(`published ${path.join(releaseDir, entry.name)}`)
      } else {
        warn(`could not overwrite ${path.join(releaseDir, entry.name)} (locked by another process); the new copy stays in ${fromDir}.`)
      }
    }
  }

  // Refresh the unpacked directory too, so `release/win-unpacked` is never a
  // stale, half-deleted shell. Skipped (with guidance) when it is locked.
  const fromUnpacked = path.join(from, 'win-unpacked')
  if (!fs.existsSync(fromUnpacked)) return

  const toUnpacked = path.join(to, 'win-unpacked')
  if (!emptyDir(toUnpacked)) {
    warn(`'${path.join(releaseDir, 'win-unpacked')}' is held open by another process — usually an editor/IDE indexing this folder.`)
    warn('close that editor (or reload it so it picks up the new exclude config) and re-run `npm run dist` to refresh it.')
    warn(`a fresh, runnable unpacked build is already available at: ${fromUnpacked}`)
    return
  }

  try {
    copyDirSync(fromUnpacked, toUnpacked)
    log(`refreshed ${path.join(releaseDir, 'win-unpacked')}`)
  } catch (err) {
    warn(`could not refresh ${path.join(releaseDir, 'win-unpacked')} (${err.message})`)
  }
}

/** Remove the old in-workspace staging dir left by previous versions. */
function cleanLegacyStaging() {
  if (!fs.existsSync(path.join(root, legacyStagingDir))) return
  if (emptyDir(legacyStagingDir)) {
    log(`removed legacy '${legacyStagingDir}'.`)
  } else {
    warn(`could not remove legacy '${legacyStagingDir}' (locked by an editor/IDE); delete it once that process closes.`)
  }
}

function runElectronBuilder(outputDir) {
  const bin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
  )
  const res = spawnSync(bin, [`--config.directories.output=${outputDir}`], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  })
  if (res.error) throw res.error
  if (res.status !== 0) process.exit(res.status ?? 1)
}

log('stopping running app instances...')
stopRunningInstances()

const outputDir = pickOutputDir()
log(`running electron-builder (output: ${outputDir})...`)
runElectronBuilder(outputDir)

log(`publishing artifacts into '${releaseDir}'...`)
publishArtifacts(outputDir)

cleanLegacyStaging()

log('done.')
