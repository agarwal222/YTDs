// electron/main.ts
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Notification, // <--- Import Notification
} from "electron"
import path = require("node:path")
import ElectronStore from "electron-store" // Using v8.2.0 via package.json
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
  group:
    | "Best"
    | "Video+Audio (Direct)"
    | "Video+Audio (Combined)"
    | "Audio Only"
  hasVideo: boolean
  hasAudio: boolean
  resolution?: string
  fps?: number
  vcodec?: string
  acodec?: string
  container?: string
  tbr?: number
  abr?: number
  vbr?: number
  filesize?: number
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

  const allOk = dependenciesStatus.ytDlpOk && dependenciesStatus.ffmpegOk
  if (!allOk && win) {
    // Show warning dialog if dependencies are missing (optional, could be handled in renderer)
    let missing = []
    if (!dependenciesStatus.ytDlpOk) missing.push("yt-dlp")
    if (!dependenciesStatus.ffmpegOk)
      missing.push("ffmpeg (for merging/conversion)")
    // Dialog is disruptive, consider removing or making it less frequent
    /*
    dialog
      .showMessageBox(win, {
        type: "warning",
        title: "Dependencies Missing",
        message: `Cannot find/execute: ${missing.join(
          " & "
        )}. Some features might not work. Check PATH or configure paths in Settings.`,
        buttons: ["OK", "Instructions"],
      })
      .then((r) => {
        if (r.response === 1) { // Instructions button
          try {
            shell.openExternal("https://github.com/yt-dlp/yt-dlp#installation")
            shell.openExternal("https://ffmpeg.org/download.html")
          } catch (e) { console.error("Failed to open external links", e); }
        }
      });
      */
  } else if (allOk) {
    console.log("All required dependencies verified.")
  }

  return allOk // Return overall status
}

function parseAndCombineFormats(formats: any[]): DetailedFormat[] {
  // ... (Keep existing implementation - it seems fine) ...
  const results: DetailedFormat[] = []
  if (!Array.isArray(formats)) {
    return results
  }
  const bestAudio = formats
    .filter(
      (f) => f?.format_id && f.vcodec === "none" && f.acodec !== "none" && f.abr
    )
    .sort(
      (a, b) =>
        (b.preference ?? -99) - (a.preference ?? -99) ||
        (b.abr ?? 0) - (a.abr ?? 0)
    )[0]
  const bestVideoOnly = formats
    .filter(
      (f) =>
        f?.format_id && f.vcodec !== "none" && f.acodec === "none" && f.height
    )
    .sort(
      (a, b) =>
        (b.preference ?? -99) - (a.preference ?? -99) ||
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.vbr ?? b.tbr ?? 0) - (a.vbr ?? a.tbr ?? 0)
    )[0]
  const bestAudioId = bestAudio?.format_id
  const bestAudioCodec = bestAudio?.acodec?.split(".")[0] ?? "audio"
  const bestAudioExt = bestAudio?.ext ?? "unk"
  results.push({
    id: "bestvideo+bestaudio/best",
    label: "Best Quality (Auto - Recommended)",
    group: "Best",
    hasVideo: true,
    hasAudio: true,
  })
  const addedDirectResolutions = new Set<string>()
  formats
    .filter(
      (f) =>
        f?.format_id &&
        f.vcodec !== "none" &&
        f.acodec !== "none" &&
        f.resolution &&
        f.ext
    )
    .sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.tbr ?? 0) - (a.tbr ?? 0)
    )
    .forEach((f) => {
      const qKey = `${f.height}p${f.fps > 30 ? f.fps : ""}`
      if (addedDirectResolutions.has(qKey)) return
      const lParts: string[] = [qKey]
      if (f.vcodec) lParts.push(f.vcodec.split(".")[0])
      lParts.push(`(${f.ext.toUpperCase()})`)
      if (f.filesize_approx)
        lParts.push(`~${(f.filesize_approx / (1024 * 1024)).toFixed(1)}MB`)
      else if (f.tbr) lParts.push(`~${Math.round(f.tbr)}k`)
      results.push({
        id: f.format_id,
        label: lParts.join(" "),
        group: "Video+Audio (Direct)",
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
        filesize: f.filesize_approx,
      })
      addedDirectResolutions.add(qKey)
    })
  if (bestAudioId && bestVideoOnly) {
    formats
      .filter(
        (f) =>
          f?.format_id &&
          f.vcodec !== "none" &&
          f.acodec === "none" &&
          f.height &&
          f.ext
      )
      .sort(
        (a, b) =>
          (b.height ?? 0) - (a.height ?? 0) ||
          (b.fps ?? 0) - (a.fps ?? 0) ||
          (b.vbr ?? b.tbr ?? 0) - (a.vbr ?? a.tbr ?? 0)
      )
      .forEach((f) => {
        const qKey = `${f.height}p${f.fps > 30 ? f.fps : ""}`
        if (addedDirectResolutions.has(qKey)) return
        const cId = `${f.format_id}+${bestAudioId}`
        const lParts: string[] = [qKey]
        if (f.vcodec) lParts.push(f.vcodec.split(".")[0])
        lParts.push(`+ Audio`)
        lParts.push(`(${f.ext.toUpperCase()}+${bestAudioExt.toUpperCase()})`)
        let combinedSize: number | undefined = undefined
        if (f.filesize_approx != null && bestAudio?.filesize_approx != null) {
          combinedSize = f.filesize_approx + bestAudio.filesize_approx
          combinedSize !== undefined &&
            lParts.push(`~${(combinedSize / (1024 * 1024)).toFixed(1)}MB`)
        } else if (f.vbr != null && bestAudio?.abr != null) {
          lParts.push(`~${Math.round(f.vbr + bestAudio.abr)}k`)
        } else if (f.tbr != null && bestAudio?.abr != null) {
          lParts.push(`~${Math.round(f.tbr + bestAudio.abr)}k`)
        }
        results.push({
          id: cId,
          label: lParts.join(" "),
          group: "Video+Audio (Combined)",
          hasVideo: true,
          hasAudio: true,
          resolution: f.resolution,
          fps: f.fps,
          vcodec: f.vcodec,
          acodec: bestAudioCodec,
          container: `${f.ext}+${bestAudioExt}`,
          tbr: undefined,
          abr: bestAudio?.abr,
          vbr: f.vbr ?? f.tbr,
          filesize: combinedSize,
        })
        addedDirectResolutions.add(qKey)
      })
  }
  if (bestAudio) {
    const lParts = ["Audio Only"]
    if (bestAudio.acodec) lParts.push(bestAudio.acodec.split(".")[0])
    lParts.push(`(${bestAudio.ext.toUpperCase()})`)
    if (bestAudio.abr) lParts.push(`~${Math.round(bestAudio.abr)}k`)
    if (bestAudio.filesize_approx)
      lParts.push(
        `~${(bestAudio.filesize_approx / (1024 * 1024)).toFixed(1)}MB`
      )
    results.push({
      id: bestAudio.format_id,
      label: lParts.join(" "),
      group: "Audio Only",
      hasVideo: false,
      hasAudio: true,
      acodec: bestAudio.acodec,
      container: bestAudio.ext,
      abr: bestAudio.abr,
      filesize: bestAudio.filesize_approx,
    })
  }
  results.sort((a, b) => {
    const groupOrder = {
      Best: 0,
      "Video+Audio (Direct)": 1,
      "Video+Audio (Combined)": 2,
      "Audio Only": 3,
    }
    if (groupOrder[a.group] !== groupOrder[b.group])
      return groupOrder[a.group] - groupOrder[b.group]
    const qualityA =
      (a.hasVideo
        ? (a.resolution ? parseInt(a.resolution.split("x")[1], 10) : 0) *
          (a.fps ?? 30)
        : 0) + (a.abr ?? a.tbr ?? 0)
    const qualityB =
      (b.hasVideo
        ? (b.resolution ? parseInt(b.resolution.split("x")[1], 10) : 0) *
          (b.fps ?? 30)
        : 0) + (b.abr ?? b.tbr ?? 0)
    return qualityB - qualityA
  })
  return results
}

// ==================================
// --- Create Window & App Lifecycle ---
// ==================================

function createWindow() {
  const publicPath = process.env.VITE_PUBLIC ?? ""
  // Use a proper icon file if available in 'build' or 'public'
  const iconPath = path.join(__dirname, "../../build/icon.png") // Adjust if needed

  win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    icon: fs.existsSync(iconPath) ? iconPath : undefined, // Use icon only if it exists
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Be cautious with sandbox: false if loading external content
    },
    show: false, // Don't show until ready
  })

  win.once("ready-to-show", () => {
    win?.show()
  })

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send(
      "main-process-message",
      `Backend loaded: ${new Date().toLocaleString()}`
    )
    // Send initial dependency status when renderer is ready
    if (win)
      win.webContents.send("dependencies-status-update", dependenciesStatus)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: "detach" }) // Open dev tools detached
  } else {
    // Make sure the path is correct for production build
    win.loadFile(path.join(process.env.DIST!, "index.html"))
  }

  win.on("closed", () => {
    win = null
  })

  // Optional: Modify menu for a more native feel (remove default Electron menu)
  // Menu.setApplicationMenu(null); // Uncomment to remove menu bar completely
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => {
  createWindow()
  // Check dependencies slightly delayed after window creation
  setTimeout(checkAndStoreDependencies, 1500)
})

// ==================================
// --- IPC Handlers ---------------
// ==================================

// --- NEW: Notification Handler (Optional, direct call used in download) ---
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

// --- Settings ---
ipcMain.handle("settings:get-paths", () => ({
  downloadPath: store.get("downloadPath", app.getPath("downloads")),
  ytDlpPath: store.get("ytDlpExecutablePath", ""), // Return empty string if not set
  ffmpegPath: store.get("ffmpegExecutablePath", ""), // Return empty string if not set
}))

ipcMain.handle("settings:select-download-path", async () => {
  if (!win) return store.get("downloadPath", app.getPath("downloads"))
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"], // Allow creating directory
    title: "Select Download Location",
  })
  if (!result.canceled && result.filePaths.length > 0) {
    const newPath = result.filePaths[0]
    store.set("downloadPath", newPath)
    return newPath
  }
  return store.get("downloadPath", app.getPath("downloads")) // Return current if cancelled
})

ipcMain.handle(
  "settings:select-executable-path",
  async (_event, name: "yt-dlp" | "ffmpeg") => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      title: `Select ${name} Executable`,
      // Optional: Add filters based on OS
      // filters: process.platform === 'win32' ? [{ name: 'Executables', extensions: ['exe'] }] : undefined
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]
      // Store the selected path
      if (name === "yt-dlp") store.set("ytDlpExecutablePath", selectedPath)
      else store.set("ffmpegExecutablePath", selectedPath)

      // Immediately re-check dependencies and update status
      await checkAndStoreDependencies()
      return selectedPath
    }
    return null // Indicate cancellation
  }
)

// --- Dependencies ---
ipcMain.handle("app:check-dependencies", async () => {
  // This just triggers the check; status is sent via 'dependencies-status-update'
  return await checkAndStoreDependencies()
})

ipcMain.handle("app:get-dependencies-status", () => {
  // Return the current status object
  return dependenciesStatus
})

// --- Downloads: Get List & Actions ---
ipcMain.handle("downloads:get-list", () => {
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    // Map to check file existence for completed items
    const historyWithCheck = history.map((item: DownloadItem): DownloadItem => {
      let exists = false
      // Only check if status is completed and path exists
      if (item.status === "completed" && item.path) {
        try {
          exists = fs.existsSync(item.path)
        } catch (err) {
          console.error(`[GetList] Error checking file ${item.path}:`, err)
          exists = false // Treat error as file not existing
        }
      }
      // Return item with updated fileExists status
      // Ensure fileExists is boolean, default to false if not applicable
      return { ...item, fileExists: !!exists }
    })

    // Return the list, potentially filtering out missing completed files if desired
    // For now, return all items and let renderer decide how to display 'missing' ones
    return historyWithCheck
    /* // Alternative: Filter out completed items where file doesn't exist anymore
     return historyWithCheck.filter((item: DownloadItem) => {
         if (item.status === 'completed' && !item.fileExists) {
             return false; // Filter out
         }
         return true; // Keep others
     });
     */
  } catch (e) {
    console.error("Error in get-list:", e)
    return [] // Return empty list on error
  }
})

ipcMain.handle("downloads:open-folder", async (_event, filePath: string) => {
  if (!filePath) return false
  try {
    // Check if the path exists before attempting to show
    if (!fs.existsSync(filePath)) {
      // Check if the directory containing the file exists
      const dirPath = path.dirname(filePath)
      if (fs.existsSync(dirPath)) {
        shell.openPath(dirPath) // Open containing directory instead
        dialog.showErrorBox(
          "File Not Found",
          `Original file not found:\n${filePath}\n\nOpened containing folder instead.`
        )
        return true // Still potentially useful
      } else {
        dialog.showErrorBox("Error", `Path not found:\n${filePath}`)
        return false
      }
    }
    shell.showItemInFolder(path.normalize(filePath)) // Reveals the file in the folder
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
      if (win) win.webContents.send("downloads:updated") // Notify renderer
      return true
    }
    return false // Item ID not found
  } catch (e: any) {
    console.error(`Failed remove item ${itemId}:`, e)
    return false
  }
})

// Note: Renderer now handles copy path/URL via navigator.clipboard
// This main process version can be removed if not needed elsewhere.
ipcMain.handle("downloads:copy-path", async (_event, filePath: string) => {
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

    // Find the original format/options if possible (might need to store more info in DownloadItem)
    // For now, just re-trigger the download with the URL. User might need to re-select quality.
    // A more robust retry would re-use the original options.
    // We call the 'yt:download' handler directly.
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
    // Ensure dependencies are checked before fetching
    if (!dependenciesStatus.checked) await checkAndStoreDependencies()
    if (!dependenciesStatus.ytDlpOk)
      throw new Error("yt-dlp is required but missing or invalid.")

    return new Promise<DetailedFormat[]>((resolve, reject) => {
      const args = ["-J", "--flat-playlist", url] // Use -J for JSON output, handle playlists safely
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
            // Handle single video vs playlist
            const formats = info.formats || info.entries?.[0]?.formats
            if (!formats) {
              // If it's a playlist without formats directly, maybe reject or return empty?
              if (info.entries) {
                throw new Error(
                  "Playlist detected, but format fetching for individual items not implemented here."
                )
              } else {
                throw new Error(
                  "No video/format information found in yt-dlp output."
                )
              }
            }
            resolve(parseAndCombineFormats(formats))
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
    // Determine if ffmpeg is needed
    const needsFfmpeg =
      options.startTime ||
      options.endTime ||
      options.formatCode?.includes("+") || // Merging formats
      options.formatCode === "bestvideo+bestaudio/best" || // Default often requires merge
      !options.formatCode || // If no format specified, assume best = merge
      options.outputFormat // Recoding/Extracting requires ffmpeg
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
    // Generate a more robust unique ID, fallback to timestamp
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
        title: `Pending: ${options.url.substring(0, 60)}...`, // Initial title
        path: "",
        status: "pending",
        url: options.url,
        progress: 0,
        timestamp: Date.now(),
        fileExists: false,
        errorInfo: undefined,
      }
      let updatedHistory: DownloadItem[]
      if (existingItemIndex > -1) {
        // Update existing item if retrying or somehow re-adding
        updatedHistory = history.map((item, index) =>
          index === existingItemIndex ? pendingItem : item
        )
      } else {
        // Add new item
        updatedHistory = [...history, pendingItem]
      }
      store.set("downloadHistory", updatedHistory)
      eventSender.send("downloads:updated") // Notify UI
    } catch (e: any) {
      console.error(`Error setting pending state for ${videoId}:`, e)
      // Continue download attempt even if store update fails initially
    }

    // 3. Build yt-dlp Arguments
    const args: string[] = [
      "--progress", // Enable progress reporting
      "--progress-template",
      "progress:%(progress._percent_str)s", // Specific template for parsing
      "--encoding",
      "utf-8", // Ensure UTF-8 output
      "-o",
      path.join(targetDir, "%(title)s [%(id)s].%(ext)s"), // Output template
      "--no-continue", // Don't resume partial files (can cause issues)
      "--no-overwrites", // Don't overwrite existing files (safer default)
      // "--sponsorblock-mark", "all", // Optional: Mark sponsor segments
      // "--write-thumbnail", // Optional: Download thumbnail
    ]

    // Add ffmpeg path if needed
    if (needsFfmpeg) {
      args.push("--ffmpeg-location", dependenciesStatus.ffmpegPath)
    }

    // Add format selection argument
    if (
      options.formatCode &&
      options.formatCode !== "bestvideo+bestaudio/best"
    ) {
      args.push("-f", options.formatCode)
    } else {
      args.push("-f", "bestvideo+bestaudio/best") // Default to best
    }

    // Add recoding/extraction arguments
    if (options.outputFormat) {
      if (options.hasVideo) {
        // If it's a video format, recode video container
        args.push("--recode-video", options.outputFormat)
      } else if (options.hasAudio) {
        // If it's audio-only, extract audio
        args.push("-x", "--audio-format", options.outputFormat)
        // args.push("--audio-quality", "0"); // Optional: Specify audio quality (0=best)
      }
    }

    // Add time clipping arguments
    if (options.startTime || options.endTime) {
      args.push(
        "--download-sections",
        `*${options.startTime || ""}-${options.endTime || ""}` // Format: *start-end
      )
      args.push("--force-keyframes-at-cuts") // Important for accurate cuts
    }

    // Finally, add the URL
    args.push(options.url)

    console.log(
      `[Download ${videoId}] Spawning: "${dependenciesStatus.ytDlpPath}"`,
      args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")
    )

    // 4. Spawn yt-dlp Process and Handle Events
    try {
      const proc = spawn(dependenciesStatus.ytDlpPath, args, {
        windowsHide: true, // Don't show console window on Windows
      })

      let stdoutBuffer = "",
        stderrBuffer = "",
        detectedTitle = `DL ${videoId}`,
        finalPath = ""

      // --- stdout processing ---
      proc.stdout.on("data", (data) => {
        stdoutBuffer += data.toString()
        // Process line by line
        let newlineIndex
        while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.substring(0, newlineIndex).trim()
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1)

          if (!line) continue

          // Check for progress percentage
          const progressMatch = line.match(/^progress:(\d+\.?\d*)%$/)
          if (progressMatch?.[1]) {
            const progress = parseFloat(progressMatch[1])
            eventSender.send("yt:download-progress", { videoId, progress })
            // Optionally update store (might be too frequent, UI update is main goal)
            // updateStoreItemProgress(videoId, progress);
            continue // Don't log progress lines
          }

          // Check for final destination path or merging path
          const destinationMatch =
            line.match(/Destination: "?(.*)"?$/) ||
            line.match(/Merging formats into "?(.*)"?/)
          if (destinationMatch?.[1]) {
            finalPath = path.normalize(
              destinationMatch[1].trim().replace(/^"|"$/g, "")
            )
            // Extract title from filename (basic attempt)
            try {
              detectedTitle = path
                .basename(finalPath, path.extname(finalPath))
                .replace(/ \[[^\]]+\]$/, "")
                .trim()
            } catch {}
            console.log(
              `[DL ${videoId}] Detected Path: ${finalPath}, Title: ${detectedTitle}`
            )
            // Update title in store immediately if detected
            updateStoreItemTitle(videoId, detectedTitle)
          }

          // Log other stdout lines for debugging if needed
          // console.log(`[stdout ${videoId}]: ${line}`);
        }
      })

      // --- stderr processing ---
      proc.stderr.on("data", (data) => {
        const line = data.toString().trim()
        if (line) {
          console.error(`[stderr ${videoId}]: ${line}`)
          stderrBuffer += line + "\n" // Collect stderr output
        }
      })

      // --- 'close' event (Process finished) ---
      proc.on("close", (code) => {
        console.log(
          `[close ${videoId}] Code: ${code}, Final Path: ${
            finalPath || "(not detected)"
          }`
        )
        let fileExists = false
        if (finalPath) {
          try {
            fileExists = fs.existsSync(finalPath)
          } catch (e) {
            console.error(`Error checking file existence for ${finalPath}:`, e)
          }
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

        // Update history with final status
        updateStoreItemFinal(videoId, {
          title: finalTitle,
          path: status === "completed" ? finalPath : "",
          status,
          progress: status === "completed" ? 100 : undefined,
          timestamp: Date.now(),
          errorInfo: errorInfo,
          fileExists: fileExists,
        })

        // Send Native Notification
        if (Notification.isSupported()) {
          if (status === "completed") {
            new Notification({
              title: "Download Complete",
              body: finalTitle,
            }).show()
          } else if (status === "error") {
            new Notification({
              title: "Download Failed",
              body: errorInfo
                ? `${finalTitle}: ${errorInfo.substring(0, 100)}`
                : finalTitle,
            }).show()
          }
        }
      })

      // --- 'error' event (Failed to spawn) ---
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

        // Send Native Notification
        if (Notification.isSupported()) {
          new Notification({ title: "Download Error", body: errorInfo }).show()
        }
      })

      return {
        success: true,
        message: "Download process initiated.",
        videoId: videoId,
      }
    } catch (e: any) {
      // Catch synchronous errors during spawn
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

      // Send Native Notification
      if (Notification.isSupported()) {
        new Notification({ title: "Launch Error", body: errorInfo }).show()
      }
      return { success: false, message: errorInfo }
    }
  }
)

// --- Helper functions for store updates (to keep download handler cleaner) ---
function updateStoreItemFinal(
  videoId: string,
  finalData: Partial<DownloadItem>
) {
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    const updatedHistory = history.map((item) =>
      item.id === videoId ? { ...item, ...finalData } : item
    )
    // Ensure item exists if somehow pending state failed
    if (!updatedHistory.some((item) => item.id === videoId)) {
      console.warn(
        `Item ${videoId} not found in history during final update, adding.`
      )
      // Need URL at least, get it from original options if possible, otherwise add minimal item
      // This case should be rare if pending state works.
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
    // No UI update needed just for title usually, wait for progress/completion
    // if (win) win.webContents.send("downloads:updated");
  } catch (e: any) {
    // console.error(`Error saving title for ${videoId}:`, e); // Can be noisy
  }
}
// Optional: Update progress in store (can be too frequent)
/*
function updateStoreItemProgress(videoId: string, progress: number) {
    try {
        const history = store.get("downloadHistory", [] as DownloadItem[]);
        const updatedHistory = history.map(item =>
            item.id === videoId ? { ...item, progress: progress, status: 'downloading' } : item
        );
        store.set("downloadHistory", updatedHistory);
    } catch (e: any) { }
}
*/
