// electron/main.ts
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Notification,
} from "electron"
import path = require("node:path")
import ElectronStore from "electron-store"
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process"
import fs = require("node:fs")

// --- Constants ---
const YTD_SUBFOLDER = "YTDs" // Name for the dedicated download subfolder

// --- Type Definitions (Consistent with preload.ts) ---
interface DownloadItem {
  id: string
  title: string
  path: string
  status: "pending" | "downloading" | "completed" | "error"
  url: string
  progress?: number
  timestamp?: number
  fileExists?: boolean // Added during get-list or download completion
  errorInfo?: string
}
interface DetailedFormat {
  id: string
  label: string
  group: string // Make group flexible string
  hasVideo: boolean
  hasAudio: boolean
  resolution?: string
  fps?: number
  vcodec?: string
  acodec?: string
  container?: string
  tbr?: number // Total Bitrate (often for combined streams)
  abr?: number // Audio Bitrate
  vbr?: number // Video Bitrate
  filesize?: number // Approx filesize in bytes
  qualityRank?: number // Add rank for sorting within groups
}
interface StoreType {
  downloadPath?: string
  downloadHistory?: DownloadItem[]
  ytDlpExecutablePath?: string
  ffmpegExecutablePath?: string
}

// --- Store Initialization ---
const store: ElectronStore<StoreType> = new ElectronStore<StoreType>({})

// --- Global State ---
let win: BrowserWindow | null = null
let dependenciesStatus = {
  ytDlpOk: false,
  ffmpegOk: false,
  checked: false,
  ytDlpPath: "yt-dlp", // Default command name
  ffmpegPath: "ffmpeg", // Default command name
}

// --- Path Calculations ---
process.env.DIST = path.join(__dirname, "../dist")
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, "../public")
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]

// ==================================
// --- Helper Functions -----------
// ==================================

async function checkCommand(
  commandOrPath: string,
  name: "yt-dlp" | "ffmpeg"
): Promise<{ ok: boolean; pathUsed: string; errorMsg?: string }> {
  let effectivePath = commandOrPath
  let checkViaPath = false
  const versionArg = name === "ffmpeg" ? "-version" : "--version"

  // If a specific path is provided, validate and use it
  if (
    commandOrPath &&
    (path.isAbsolute(commandOrPath) || commandOrPath.includes(path.sep))
  ) {
    try {
      if (!fs.existsSync(commandOrPath)) {
        return {
          ok: false,
          pathUsed: commandOrPath,
          errorMsg: `Path not found: ${commandOrPath}`,
        }
      }
      if (!fs.statSync(commandOrPath).isFile()) {
        return {
          ok: false,
          pathUsed: commandOrPath,
          errorMsg: `Path not file: ${commandOrPath}`,
        }
      }
      // Use the validated absolute/relative path
      effectivePath = commandOrPath
    } catch (err: any) {
      return {
        ok: false,
        pathUsed: commandOrPath,
        errorMsg: `Error accessing path: ${err.message}`,
      }
    }
  } else {
    // No specific path, try the default command name (check system PATH)
    effectivePath = name
    checkViaPath = true
  }

  // Attempt to run the command
  return new Promise((resolve) => {
    try {
      const proc = spawn(effectivePath, [versionArg], {
        shell: process.platform === "win32", // Use shell on Windows for PATH resolution
        windowsHide: true,
      })
      let out = ""
      let errOut = ""
      proc.stdout.on("data", (d) => (out += d.toString()))
      proc.stderr.on("data", (d) => (errOut += d.toString()))

      proc.on("close", (code) => {
        const info = (out || errOut).trim()
        const ok = code === 0 && !!info // Command executed successfully and produced output
        resolve({
          ok,
          pathUsed: effectivePath, // Return the path that was actually tested
          errorMsg: ok
            ? undefined
            : `Exit Code ${code}. Stderr: ${errOut.trim() || "(none)"}`,
        })
      })

      proc.on("error", (err) => {
        // This 'error' event usually means the command itself couldn't be found/spawned
        resolve({
          ok: false,
          pathUsed: effectivePath,
          errorMsg: `Spawn Error: ${err.message}`,
        })
      })
    } catch (e: any) {
      // Catch synchronous errors during spawn setup
      resolve({
        ok: false,
        pathUsed: effectivePath,
        errorMsg: `Sync Spawn Error: ${e.message}`,
      })
    }
  })
}

async function checkAndStoreDependencies(): Promise<boolean> {
  console.log("Starting dependency check...")
  dependenciesStatus.checked = false // Mark as checking
  const ytDlpUserPath = store.get("ytDlpExecutablePath")
  const ffmpegUserPath = store.get("ffmpegExecutablePath")

  // Check both dependencies concurrently
  const [ytDlpCheck, ffmpegCheck] = await Promise.all([
    checkCommand(ytDlpUserPath || "", "yt-dlp"),
    checkCommand(ffmpegUserPath || "", "ffmpeg"),
  ])

  // Update global status object
  dependenciesStatus = {
    ytDlpOk: ytDlpCheck.ok,
    ffmpegOk: ffmpegCheck.ok,
    checked: true, // Mark check as complete
    // Store the path that was successfully used, or the user's preference if check failed
    ytDlpPath: ytDlpCheck.ok ? ytDlpCheck.pathUsed : ytDlpUserPath || "yt-dlp",
    ffmpegPath: ffmpegCheck.ok
      ? ffmpegCheck.pathUsed
      : ffmpegUserPath || "ffmpeg",
  }

  console.log("Dependency check complete. Status:", dependenciesStatus)

  // Send updated status to renderer
  if (win) {
    win.webContents.send("dependencies-status-update", dependenciesStatus)
  }

  const allOk = dependenciesStatus.ytDlpOk // && dependenciesStatus.ffmpegOk; // Only require yt-dlp for core functionality
  if (!dependenciesStatus.ytDlpOk && win) {
    // Show warning only if yt-dlp is missing
    console.warn("yt-dlp dependency missing or invalid")
  } else if (allOk) {
    console.log("Core dependency (yt-dlp) verified.")
  }

  return allOk // Return overall status based on yt-dlp primarily
}

// --- Helper: Format Size ---
function formatBytes(bytes: number | undefined | null, decimals = 1): string {
  if (bytes === undefined || bytes === null || bytes === 0) return ""
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  // Handle potential log(0) or negative bytes
  if (bytes <= 0) return "0 Bytes"
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  // Ensure index is within bounds
  const safeIndex = Math.min(i, sizes.length - 1)
  return `~${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))}${
    sizes[safeIndex]
  }`
}

// --- Helper: Create Label ---
function createFormatLabel(
  f: any,
  type: "direct" | "video" | "audio" | "combined",
  bestAudioInfo?: any
): string {
  const parts: string[] = []

  // Video Info
  if (type === "video" || type === "direct" || type === "combined") {
    if (f.height) parts.push(f.height + "p") // 1080p
    if (f.fps && f.fps > 30) parts.push(`${Math.round(f.fps)}fps`)
    if (f.vcodec && f.vcodec !== "none") parts.push(f.vcodec.split(".")[0])
    // Add Video Bitrate if available and type is video-only
    if (type === "video" && f.vbr) parts.push(`~${Math.round(f.vbr)}k`)
    else if (type === "video" && f.tbr) parts.push(`~${Math.round(f.tbr)}k`) // Fallback to tbr for video
  }

  // Audio Info
  if (type === "audio" || type === "direct") {
    if (f.acodec && f.acodec !== "none") parts.push(f.acodec.split(".")[0])
    if (f.abr) parts.push(`~${Math.round(f.abr)}k`)
  }

  // Combined Audio Info (from bestAudioInfo)
  if (type === "combined" && bestAudioInfo?.acodec) {
    parts.push(`+${bestAudioInfo.acodec.split(".")[0]}`)
    if (bestAudioInfo.abr) parts.push(`~${Math.round(bestAudioInfo.abr)}k`)
  }

  // Container Info
  if (type === "direct" || type === "video" || type === "audio") {
    if (f.ext) parts.push(`(${f.ext.toUpperCase()})`)
  } else if (type === "combined" && bestAudioInfo) {
    parts.push(`(${f.ext}+${bestAudioInfo.ext})`) // Show both extensions
  }

  // Filesize Info
  if (type === "direct" || type === "video" || type === "audio") {
    if (f.filesize || f.filesize_approx)
      parts.push(formatBytes(f.filesize ?? f.filesize_approx))
  } else if (type === "combined" && bestAudioInfo) {
    let combinedSize: number | undefined = undefined
    if (f.filesize_approx != null && bestAudioInfo.filesize_approx != null) {
      combinedSize = f.filesize_approx + bestAudioInfo.filesize_approx
    }
    if (combinedSize) parts.push(formatBytes(combinedSize))
  }

  return parts.join(" ").trim()
}

// --- REFACTORED: parseAndCombineFormats (WITH LOGGING) ---
function parseAndCombineFormats(rawFormats: any[]): DetailedFormat[] {
  const results: DetailedFormat[] = []
  if (!Array.isArray(rawFormats)) return results

  // Filter out non-http protocols and formats without essential info
  const validFormats = rawFormats.filter(
    (f) =>
      f?.format_id &&
      f.protocol &&
      ["http", "https"].includes(f.protocol) &&
      (f.vcodec !== "none" || f.acodec !== "none") // Must have video OR audio
  )

  // --- Filter and Sort Raw Formats ---
  const videoOnlyFormats = validFormats
    .filter((f) => f.vcodec !== "none" && f.acodec === "none" && f.height)
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.vbr ?? b.tbr ?? 0) - (a.vbr ?? a.tbr ?? 0) ||
        (b.preference ?? -99) - (a.preference ?? -99)
    )

  const audioOnlyFormats = validFormats
    .filter((f) => f.vcodec === "none" && f.acodec !== "none" && f.abr)
    .sort(
      (a, b) =>
        (b.abr ?? 0) - (a.abr ?? 0) ||
        (b.preference ?? -99) - (a.preference ?? -99)
    )

  const directCombinedFormats = validFormats
    .filter((f) => f.vcodec !== "none" && f.acodec !== "none" && f.resolution)
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.tbr ?? 0) - (a.tbr ?? 0) ||
        (b.preference ?? -99) - (a.preference ?? -99)
    )

  // --- START DEBUG LOGGING ---
  console.log(`\n--- Parsing Formats ---`)
  console.log(`[Formats Debug] Raw Count: ${rawFormats.length}`)
  console.log(
    `[Formats Debug] Valid Count (HTTP(S), Has A/V): ${validFormats.length}`
  )
  console.log(`[Formats Debug] VideoOnly Count: ${videoOnlyFormats.length}`)
  console.log(`[Formats Debug] AudioOnly Count: ${audioOnlyFormats.length}`)
  console.log(
    `[Formats Debug] DirectCombined Count: ${directCombinedFormats.length}`
  )
  // --- END DEBUG LOGGING ---

  // Find the best audio stream
  const bestAudio =
    audioOnlyFormats.find((f) => f.acodec?.startsWith("opus")) ||
    audioOnlyFormats[0]
  const bestAudioId = bestAudio?.format_id
  const bestAudioInfo = bestAudio
    ? {
        acodec: bestAudio.acodec,
        ext: bestAudio.ext,
        abr: bestAudio.abr,
        filesize_approx: bestAudio.filesize_approx,
      }
    : undefined
  console.log(
    `[Formats Debug] Best Audio Selected: ${
      bestAudio ? bestAudio.format_id + " (" + bestAudio.acodec + ")" : "None"
    }`
  ) // Log best audio

  // --- Add "Best" Option ---
  results.push({
    id: "bestvideo+bestaudio/best",
    label: "Best Available (Recommended)",
    group: "Best Quality",
    hasVideo: true,
    hasAudio: true,
    qualityRank: 10000,
  })

  const addedDirectKeys = new Set<string>()

  // --- Add Direct Combined Formats ---
  directCombinedFormats.forEach((f) => {
    const qualityKey = `${f.height}p${f.fps > 30 ? Math.round(f.fps) : ""}`
    if (addedDirectKeys.has(qualityKey)) return
    results.push({
      id: f.format_id,
      label: createFormatLabel(f, "direct"),
      group: "Video + Audio (Single File)",
      hasVideo: true,
      hasAudio: true,
      resolution: f.resolution,
      fps: f.fps,
      vcodec: f.vcodec,
      acodec: f.acodec,
      container: f.ext,
      tbr: f.tbr,
      abr: f.abr,
      vbr: f.vbr,
      filesize: f.filesize_approx ?? f.filesize,
      qualityRank: (f.height ?? 0) * 10 + (f.fps ?? 0) + (f.tbr ?? 0) / 1000,
    })
    addedDirectKeys.add(qualityKey)
  })
  console.log(
    `[Formats Debug] Added Direct Combined: ${
      results.filter((r) => r.group === "Video + Audio (Single File)").length
    } (Unique Res/FPS)`
  ) // Log count

  // --- Add Generated Combined Formats (Video + Best Audio) ---
  let addedGeneratedCount = 0 // Counter for logging
  if (bestAudioId && bestAudioInfo) {
    videoOnlyFormats.forEach((f) => {
      const qualityKey = `${f.height}p${f.fps > 30 ? Math.round(f.fps) : ""}`
      if (addedDirectKeys.has(qualityKey)) return // Skip if direct exists
      const combinedId = `${f.format_id}+${bestAudioId}`
      results.push({
        id: combinedId,
        label: createFormatLabel(f, "combined", bestAudioInfo),
        group: "Video + Best Audio (Requires Merge)",
        hasVideo: true,
        hasAudio: true,
        resolution: f.resolution,
        fps: f.fps,
        vcodec: f.vcodec,
        acodec: bestAudioInfo.acodec,
        container: `${f.ext}+${bestAudioInfo.ext}`,
        tbr: undefined,
        abr: bestAudioInfo.abr,
        vbr: f.vbr ?? f.tbr,
        filesize:
          f.filesize_approx != null && bestAudioInfo.filesize_approx != null
            ? f.filesize_approx + bestAudioInfo.filesize_approx
            : undefined,
        qualityRank:
          (f.height ?? 0) * 10 + (f.fps ?? 0) + (f.vbr ?? f.tbr ?? 0) / 1000,
      })
      addedDirectKeys.add(qualityKey) // Also mark this key as added
      addedGeneratedCount++ // Increment counter
    })
  }
  console.log(
    `[Formats Debug] Added Generated Combined: ${addedGeneratedCount}`
  ) // Log count

  // --- Add Video Only Formats ---
  let addedVideoOnlyCount = 0
  videoOnlyFormats.forEach((f) => {
    results.push({
      id: f.format_id,
      label: createFormatLabel(f, "video"),
      group: "Video Only",
      hasVideo: true,
      hasAudio: false,
      resolution: f.resolution,
      fps: f.fps,
      vcodec: f.vcodec,
      acodec: "none",
      container: f.ext,
      tbr: undefined,
      abr: undefined,
      vbr: f.vbr ?? f.tbr,
      filesize: f.filesize_approx ?? f.filesize,
      qualityRank:
        (f.height ?? 0) * 10 + (f.fps ?? 0) + (f.vbr ?? f.tbr ?? 0) / 1000,
    })
    addedVideoOnlyCount++
  })
  console.log(`[Formats Debug] Added Video Only: ${addedVideoOnlyCount}`) // Log count

  // --- Add Audio Only Formats ---
  let addedAudioOnlyCount = 0
  audioOnlyFormats.forEach((f) => {
    results.push({
      id: f.format_id,
      label: createFormatLabel(f, "audio"),
      group: "Audio Only",
      hasVideo: false,
      hasAudio: true,
      resolution: undefined,
      fps: undefined,
      vcodec: "none",
      acodec: f.acodec,
      container: f.ext,
      tbr: undefined,
      abr: f.abr,
      vbr: undefined,
      filesize: f.filesize_approx ?? f.filesize,
      qualityRank: f.abr ?? 0,
    })
    addedAudioOnlyCount++
  })
  console.log(`[Formats Debug] Added Audio Only: ${addedAudioOnlyCount}`) // Log count

  // --- Final Sorting ---
  const groupOrder: { [key: string]: number } = {
    "Best Quality": 0,
    "Video + Audio (Single File)": 1,
    "Video + Best Audio (Requires Merge)": 2,
    "Video Only": 3,
    "Audio Only": 4,
  }
  results.sort((a, b) => {
    const groupA = groupOrder[a.group] ?? 99
    const groupB = groupOrder[b.group] ?? 99
    if (groupA !== groupB) return groupA - groupB
    return (b.qualityRank ?? 0) - (a.qualityRank ?? 0)
  })

  // --- More Debug Logging ---
  console.log(
    `[Formats Debug] Final Result Count After Processing/Sorting: ${results.length}`
  )
  // Log the groups of the first few items to verify sort order
  // console.log(`[Formats Debug] Final Results Sample (Groups):`, results.slice(0, 10).map(r => r.group));
  console.log(`--- Finished Parsing Formats ---\n`)
  // --- End Debug Logging ---

  return results
}

// ==================================
// --- Create Window & App Lifecycle ---
// ==================================

function createWindow() {
  const publicPath = process.env.VITE_PUBLIC ?? ""
  // Assuming icon is in build dir for packaged app
  const iconPath = path.join(__dirname, "../../build/icon.png")

  win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    // Use icon only if it exists - provide fallbacks for dev if needed
    icon: fs.existsSync(iconPath)
      ? iconPath
      : path.join(publicPath, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false, // Don't show until ready
    // Optional: Add title bar style for macOS
    // titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  })

  win.once("ready-to-show", () => {
    win?.show()
  })

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send(
      "main-process-message",
      `Backend loaded: ${new Date().toLocaleString()}`
    )
    if (win)
      win.webContents.send("dependencies-status-update", dependenciesStatus)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    win.loadFile(path.join(process.env.DIST!, "index.html"))
  }

  win.on("closed", () => {
    win = null
  })

  // Optional: Remove default menu
  // Menu.setApplicationMenu(null);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  createWindow()
  setTimeout(checkAndStoreDependencies, 1500) // Delay initial check slightly
})

// ==================================
// --- IPC Handlers ---------------
// ==================================

// --- Notification Handler (Optional: can be called from Renderer too) ---
ipcMain.handle(
  "app:show-notification",
  (_event, options: { title: string; body: string }) => {
    if (!Notification.isSupported()) {
      console.warn("Native notifications not supported on this system.")
      return
    }
    new Notification({ title: options.title, body: options.body }).show()
  }
)

// --- Settings Handlers ---
ipcMain.handle("settings:get-paths", () => ({
  downloadPath: store.get("downloadPath", app.getPath("downloads")),
  ytDlpPath: store.get("ytDlpExecutablePath", ""),
  ffmpegPath: store.get("ffmpegExecutablePath", ""),
}))

ipcMain.handle("settings:select-download-path", async () => {
  if (!win) return store.get("downloadPath", app.getPath("downloads"))
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select Download Location",
  })
  if (!result.canceled && result.filePaths.length > 0) {
    const newPath = result.filePaths[0]
    store.set("downloadPath", newPath)
    return newPath
  }
  return store.get("downloadPath", app.getPath("downloads"))
})

ipcMain.handle(
  "settings:select-executable-path",
  async (_event, name: "yt-dlp" | "ffmpeg") => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      title: `Select ${name} Executable`,
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      if (name === "yt-dlp") store.set("ytDlpExecutablePath", selectedPath)
      else store.set("ffmpegExecutablePath", selectedPath)
      await checkAndStoreDependencies() // Re-check after setting path
      return selectedPath
    }
    return null
  }
)

// --- Dependencies Handlers ---
ipcMain.handle("app:check-dependencies", async () => {
  return await checkAndStoreDependencies()
})

ipcMain.handle("app:get-dependencies-status", () => {
  return dependenciesStatus
})

// --- Downloads: List & Actions ---
ipcMain.handle("downloads:get-list", () => {
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    const historyWithCheck = history.map((item: DownloadItem): DownloadItem => {
      let exists = false
      if (item.status === "completed" && item.path) {
        try {
          exists = fs.existsSync(item.path)
        } catch (err) {
          exists = false
        }
      }
      return { ...item, fileExists: !!exists }
    })
    return historyWithCheck
  } catch (e) {
    console.error("Error in get-list:", e)
    return []
  }
})

ipcMain.handle("downloads:open-folder", async (_event, filePath: string) => {
  if (!filePath) return false
  try {
    if (!fs.existsSync(filePath)) {
      const dirPath = path.dirname(filePath)
      if (fs.existsSync(dirPath)) {
        shell.openPath(dirPath)
        dialog.showErrorBox(
          "File Not Found",
          `Original file not found:\n${filePath}\n\nOpened containing folder instead.`
        )
        return true
      } else {
        dialog.showErrorBox("Error", `Path not found:\n${filePath}`)
        return false
      }
    }
    shell.showItemInFolder(path.normalize(filePath))
    return true
  } catch (e: any) {
    console.error(`Failed open folder for ${filePath}:`, e)
    dialog.showErrorBox("Error", `Cannot open folder: ${e.message}`)
    return false
  }
})

ipcMain.handle("downloads:remove-item", async (_event, itemId: string) => {
  if (!itemId) return false
  try {
    const history = store.get("downloadHistory", [])
    const updatedHistory = history.filter((item) => item.id !== itemId)
    if (updatedHistory.length < history.length) {
      store.set("downloadHistory", updatedHistory)
      if (win) win.webContents.send("downloads:updated")
      return true
    }
    return false
  } catch (e: any) {
    console.error(`Failed remove item ${itemId}:`, e)
    return false
  }
})

ipcMain.handle("downloads:copy-path", async (_event, filePath: string) => {
  // Kept for completeness, but recommend renderer clipboard API
  if (!filePath) return false
  try {
    clipboard.writeText(path.normalize(filePath))
    return true
  } catch (e: any) {
    console.error(`Failed copy path ${filePath}:`, e)
    return false
  }
})

ipcMain.handle("downloads:retry", async (event, itemId: string) => {
  if (!itemId) return { success: false, message: "Invalid ID." }
  try {
    const history = store.get("downloadHistory", [])
    const itemToRetry = history.find((item) => item.id === itemId)
    if (!itemToRetry)
      return { success: false, message: "Item not found in history." }
    console.log(`Retrying download for ${itemToRetry.url} (ID: ${itemId})`)
    // Re-trigger download with original URL. Quality might need re-selection by user
    // in the UI if original format isn't stored/retrieved.
    return await ipcMain.handle("yt:download", event, { url: itemToRetry.url })
  } catch (e: any) {
    console.error(`Failed to retry item ${itemId}:`, e)
    return { success: false, message: `Retry error: ${e.message}` }
  }
})

// --- YouTube Actions ---
ipcMain.handle(
  "yt:fetch-formats",
  async (_event, url: string): Promise<DetailedFormat[]> => {
    if (!dependenciesStatus.checked) await checkAndStoreDependencies()
    if (!dependenciesStatus.ytDlpOk)
      throw new Error("yt-dlp is required but missing or invalid.")

    return new Promise<DetailedFormat[]>((resolve, reject) => {
      const args = ["-J", "--flat-playlist", url]
      console.log(
        `Fetching formats: ${dependenciesStatus.ytDlpPath} ${args.join(" ")}`
      )
      const proc = spawn(dependenciesStatus.ytDlpPath, args, {
        windowsHide: true,
      })
      let jsonData = ""
      let errData = ""
      proc.stdout.on("data", (d) => (jsonData += d.toString()))
      proc.stderr.on("data", (d) => (errData += d.toString()))
      proc.on("close", (code) => {
        if (code === 0 && jsonData) {
          try {
            const info = JSON.parse(jsonData)
            const formats = info.formats || info.entries?.[0]?.formats
            if (!formats) {
              if (info.entries)
                throw new Error(
                  "Playlist detected, format fetching for playlists not fully supported."
                )
              else throw new Error("No video/format information found.")
            }
            resolve(parseAndCombineFormats(formats)) // Use the updated parser
          } catch (e: any) {
            console.error(
              "Format JSON Parse Error:",
              e,
              "\nRaw JSON:",
              jsonData.substring(0, 1000)
            )
            reject(
              new Error(
                `Failed to parse video info: ${
                  e.message
                }. stderr: ${errData.trim()}`
              )
            )
          }
        } else {
          console.error(
            `yt-dlp format fetch failed (code ${code}): ${errData.trim()}`
          )
          reject(
            new Error(
              `yt-dlp failed (code ${code}): ${
                errData.trim() || "Unknown error"
              }`
            )
          )
        }
      })
      proc.on("error", (e) => {
        console.error(`yt-dlp spawn error for format fetch: ${e.message}`)
        reject(e)
      })
    })
  }
)

ipcMain.handle(
  "yt:download",
  async (
    _event,
    options: {
      url: string
      formatCode?: string
      outputFormat?: string
      hasVideo?: boolean
      hasAudio?: boolean
      startTime?: string
      endTime?: string
    }
  ) => {
    // 1. Dependency Checks
    if (!dependenciesStatus.checked) await checkAndStoreDependencies()
    let missingDeps = []
    if (!dependenciesStatus.ytDlpOk) missingDeps.push("yt-dlp")
    const needsFfmpeg =
      options.startTime ||
      options.endTime ||
      options.formatCode?.includes("+") ||
      options.formatCode === "bestvideo+bestaudio/best" ||
      !options.formatCode ||
      options.outputFormat
    if (needsFfmpeg && !dependenciesStatus.ffmpegOk) missingDeps.push("ffmpeg")

    if (missingDeps.length > 0) {
      const msg = `Cannot download: Required ${missingDeps.join(
        ", "
      )} missing or invalid.`
      dialog.showErrorBox("Dependencies Error", msg)
      return { success: false, message: msg }
    }

    // 2. Prepare Paths and Initial State
    const baseDir: string = store.get("downloadPath", app.getPath("downloads"))
    const targetDir = path.join(baseDir, YTD_SUBFOLDER)
    const videoId = options.url.includes("v=")
      ? options.url.split("v=")[1].split("&")[0]
      : `dl_${Date.now()}`
    const eventSender = _event.sender

    try {
      fs.mkdirSync(targetDir, { recursive: true })
    } catch (e: any) {
      const msg = `Cannot create download directory: ${targetDir}\nError: ${e.message}`
      dialog.showErrorBox("Directory Error", msg)
      return { success: false, message: msg }
    }

    // Add/Update item in history as 'pending'
    try {
      const history = store.get("downloadHistory", [] as DownloadItem[])
      const existingItemIndex = history.findIndex((i) => i.id === videoId)
      const pendingItem: DownloadItem = {
        id: videoId,
        title: `Pending: ${options.url.substring(0, 60)}...`,
        path: "",
        status: "pending",
        url: options.url,
        progress: 0,
        timestamp: Date.now(),
        fileExists: false,
        errorInfo: undefined,
      }
      let updatedHistory: DownloadItem[] =
        existingItemIndex > -1
          ? history.map((item, index) =>
              index === existingItemIndex ? pendingItem : item
            )
          : [...history, pendingItem]
      store.set("downloadHistory", updatedHistory)
      eventSender.send("downloads:updated")
    } catch (e: any) {
      console.error(`Error setting pending state for ${videoId}:`, e)
    }

    // 3. Build yt-dlp Arguments
    const args: string[] = [
      "--progress",
      "--progress-template",
      "progress:%(progress._percent_str)s",
      "--encoding",
      "utf-8",
      "-o",
      path.join(targetDir, "%(title)s [%(id)s].%(ext)s"),
      "--no-continue",
      "--no-overwrites",
      // Optional args:
      // "--sponsorblock-mark", "all",
      // "--write-thumbnail",
      // "--embed-metadata", // Embed basic metadata
    ]
    if (needsFfmpeg)
      args.push("--ffmpeg-location", dependenciesStatus.ffmpegPath)
    if (options.formatCode && options.formatCode !== "bestvideo+bestaudio/best")
      args.push("-f", options.formatCode)
    else args.push("-f", "bestvideo+bestaudio/best")
    if (options.outputFormat) {
      if (options.hasVideo) args.push("--recode-video", options.outputFormat)
      else if (options.hasAudio)
        args.push("-x", "--audio-format", options.outputFormat)
    }
    if (options.startTime || options.endTime) {
      args.push(
        "--download-sections",
        `*${options.startTime || ""}-${options.endTime || ""}`
      )
      args.push("--force-keyframes-at-cuts")
    }
    args.push(options.url)

    console.log(
      `[Download ${videoId}] Spawning: "${dependenciesStatus.ytDlpPath}"`,
      args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")
    )

    // 4. Spawn yt-dlp Process and Handle Events
    try {
      const proc = spawn(dependenciesStatus.ytDlpPath, args, {
        windowsHide: true,
      })
      let stdoutBuffer = "",
        stderrBuffer = "",
        detectedTitle = `DL ${videoId}`,
        finalPath = ""

      // --- stdout processing ---
      proc.stdout.on("data", (data) => {
        stdoutBuffer += data.toString()
        let newlineIndex
        while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.substring(0, newlineIndex).trim()
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1)
          if (!line) continue
          const progressMatch = line.match(/^progress:(\d+\.?\d*)%$/)
          if (progressMatch?.[1]) {
            eventSender.send("yt:download-progress", {
              videoId,
              progress: parseFloat(progressMatch[1]),
            })
            continue
          }
          const destinationMatch =
            line.match(/Destination: "?(.*)"?$/) ||
            line.match(/Merging formats into "?(.*)"?/)
          if (destinationMatch?.[1]) {
            finalPath = path.normalize(
              destinationMatch[1].trim().replace(/^"|"$/g, "")
            )
            try {
              detectedTitle = path
                .basename(finalPath, path.extname(finalPath))
                .replace(/ \[[^\]]+\]$/, "")
                .trim()
            } catch {}
            console.log(
              `[DL ${videoId}] Detected Path: ${finalPath}, Title: ${detectedTitle}`
            )
            updateStoreItemTitle(videoId, detectedTitle)
          }
          // console.log(`[stdout ${videoId}]: ${line}`); // Uncomment for detailed logs
        }
      })

      // --- stderr processing ---
      proc.stderr.on("data", (data) => {
        const line = data.toString().trim()
        if (line) {
          console.error(`[stderr ${videoId}]: ${line}`)
          stderrBuffer += line + "\n"
        }
      })

      // --- 'close' event ---
      proc.on("close", (code) => {
        console.log(
          `[close ${videoId}] Code: ${code}, Path: ${finalPath || "(none)"}`
        )
        let fileExists = false
        if (finalPath) {
          try {
            fileExists = fs.existsSync(finalPath)
          } catch (e) {}
        }
        const status: DownloadItem["status"] =
          code === 0 && fileExists ? "completed" : "error"
        const finalTitle =
          status === "completed" ? detectedTitle : `Failed: ${detectedTitle}`
        const errorInfo =
          code !== 0
            ? stderrBuffer.trim() || `yt-dlp exited with code ${code}`
            : !fileExists
            ? `Output file missing or undetected: ${
                finalPath || "(path unknown)"
              }`
            : undefined

        updateStoreItemFinal(videoId, {
          title: finalTitle,
          path: status === "completed" ? finalPath : "",
          status,
          progress: status === "completed" ? 100 : undefined,
          timestamp: Date.now(),
          errorInfo: errorInfo,
          fileExists: fileExists,
        })
        if (Notification.isSupported()) {
          if (status === "completed")
            new Notification({
              title: "Download Complete",
              body: finalTitle,
            }).show()
          else if (status === "error")
            new Notification({
              title: "Download Failed",
              body: errorInfo
                ? `${finalTitle}: ${errorInfo.substring(0, 100)}`
                : finalTitle,
            }).show()
        }
      })

      // --- 'error' event ---
      proc.on("error", (err) => {
        console.error(`[spawn error ${videoId}]:`, err)
        const errorInfo = `Failed to start yt-dlp: ${err.message}`
        updateStoreItemFinal(videoId, {
          title: "Spawn Error",
          path: "",
          status: "error",
          errorInfo,
          timestamp: Date.now(),
          fileExists: false,
        })
        if (Notification.isSupported())
          new Notification({ title: "Download Error", body: errorInfo }).show()
      })

      return {
        success: true,
        message: "Download process initiated.",
        videoId: videoId,
      }
    } catch (e: any) {
      // Catch synchronous spawn errors
      console.error(`[Sync spawn error ${videoId}]:`, e)
      const errorInfo = `Failed to launch download process: ${e.message}`
      updateStoreItemFinal(videoId, {
        title: "Launch Error",
        path: "",
        status: "error",
        errorInfo,
        timestamp: Date.now(),
        fileExists: false,
      })
      if (Notification.isSupported())
        new Notification({ title: "Launch Error", body: errorInfo }).show()
      return { success: false, message: errorInfo }
    }
  }
)

// --- Helper functions for store updates ---
function updateStoreItemFinal(
  videoId: string,
  finalData: Partial<DownloadItem>
) {
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    let itemFound = false
    const updatedHistory = history.map((item) => {
      if (item.id === videoId) {
        itemFound = true
        return { ...item, ...finalData } // Merge new data
      }
      return item
    })
    // If somehow the item wasn't in the list (e.g., pending state failed), add it now.
    if (!itemFound) {
      console.warn(
        `Item ${videoId} not found in history during final update, adding.`
      )
      const minimalItem: DownloadItem = {
        id: videoId,
        url: finalData.url || "Unknown URL",
        title: "Update Error",
        path: "",
        status: "error",
        ...finalData,
      }
      updatedHistory.push(minimalItem)
    }
    store.set("downloadHistory", updatedHistory)
    if (win) win.webContents.send("downloads:updated") // Notify UI
    console.log(
      `[Store ${videoId}] Final status (${finalData.status}) updated.`
    )
  } catch (e: any) {
    console.error(`Error saving final status for ${videoId}:`, e)
  }
}
function updateStoreItemTitle(videoId: string, title: string) {
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    const updatedHistory = history.map((item) =>
      item.id === videoId ? { ...item, title: title } : item
    )
    store.set("downloadHistory", updatedHistory)
    // No UI update needed just for title detection usually
  } catch (e: any) {}
}
