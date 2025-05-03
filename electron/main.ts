// electron/main.ts
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Notification,
  WebContents,
} from "electron"
import { autoUpdater, UpdateInfo, ProgressInfo } from "electron-updater"
import path = require("node:path")
import ElectronStore from "electron-store"
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process"
import fs = require("node:fs")
// Optional: Setup a proper logger like electron-log
// import log from 'electron-log/main';
// autoUpdater.logger = log;
// autoUpdater.logger.transports.file.level = 'info';
// log.info('App starting...');

// --- Constants ---
const YTD_SUBFOLDER = "YTDs"

// --- Type Definitions ---
interface DownloadItem {
  id: string
  title: string
  path: string
  status: "pending" | "downloading" | "completed" | "error"
  url: string
  progress?: number
  timestamp?: number
  fileExists?: boolean
  errorInfo?: string
  thumbnailUrl?: string
}
interface DetailedFormat {
  id: string
  label: string
  group: string
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
  qualityRank?: number
}
interface PlaylistItem {
  id: string
  url: string
  title: string
  thumbnail?: string
}
interface PlaylistDownloadOptions {
  formatCode?: string
  outputFormat?: string
  hasVideo?: boolean
  hasAudio?: boolean
}
interface StoreType {
  downloadPath?: string
  downloadHistory?: DownloadItem[]
  ytDlpExecutablePath?: string
  ffmpegExecutablePath?: string
}
interface DownloadOptions {
  url: string
  formatCode?: string
  outputFormat?: string
  hasVideo?: boolean
  hasAudio?: boolean
  startTime?: string
  endTime?: string
}
interface DownloadResult {
  success: boolean
  message: string
  videoId?: string
  error?: string
}

// --- Store Initialization ---
const store: ElectronStore<StoreType> = new ElectronStore<StoreType>({})

// --- Global State ---
let win: BrowserWindow | null = null
let dependenciesStatus = {
  ytDlpOk: false,
  ffmpegOk: false,
  checked: false,
  ytDlpPath: "yt-dlp",
  ffmpegPath: "ffmpeg",
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
      effectivePath = commandOrPath
    } catch (err: any) {
      return {
        ok: false,
        pathUsed: commandOrPath,
        errorMsg: `Error accessing path: ${err.message}`,
      }
    }
  } else {
    effectivePath = name
    checkViaPath = true
  }
  return new Promise((resolve) => {
    try {
      const proc = spawn(effectivePath, [versionArg], {
        shell: process.platform === "win32",
        windowsHide: true,
      })
      let out = ""
      let errOut = ""
      proc.stdout.on("data", (d) => (out += d.toString()))
      proc.stderr.on("data", (d) => (errOut += d.toString()))
      proc.on("close", (code) => {
        const info = (out || errOut).trim()
        const ok = code === 0 && !!info
        resolve({
          ok,
          pathUsed: effectivePath,
          errorMsg: ok
            ? undefined
            : `Exit Code ${code}. Stderr: ${errOut.trim() || "(none)"}`,
        })
      })
      proc.on("error", (err) => {
        resolve({
          ok: false,
          pathUsed: effectivePath,
          errorMsg: `Spawn Error: ${err.message}`,
        })
      })
    } catch (e: any) {
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
  dependenciesStatus.checked = false
  const ytDlpUserPath = store.get("ytDlpExecutablePath")
  const ffmpegUserPath = store.get("ffmpegExecutablePath")
  const [ytDlpCheck, ffmpegCheck] = await Promise.all([
    checkCommand(ytDlpUserPath || "", "yt-dlp"),
    checkCommand(ffmpegUserPath || "", "ffmpeg"),
  ])
  dependenciesStatus = {
    ytDlpOk: ytDlpCheck.ok,
    ffmpegOk: ffmpegCheck.ok,
    checked: true,
    ytDlpPath: ytDlpCheck.ok ? ytDlpCheck.pathUsed : ytDlpUserPath || "yt-dlp",
    ffmpegPath: ffmpegCheck.ok
      ? ffmpegCheck.pathUsed
      : ffmpegUserPath || "ffmpeg",
  }
  console.log("Dependency check complete. Status:", dependenciesStatus)
  if (win) {
    win.webContents.send("dependencies-status-update", dependenciesStatus)
  }
  const allOk = dependenciesStatus.ytDlpOk
  if (!dependenciesStatus.ytDlpOk && win) {
    console.warn("yt-dlp dependency missing or invalid")
  } else if (allOk) {
    console.log("Core dependency (yt-dlp) verified.")
  }
  return allOk
}

function formatBytes(bytes: number | undefined | null, decimals = 1): string {
  if (bytes === undefined || bytes === null || bytes === 0) return ""
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  if (bytes <= 0) return "0 Bytes"
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const safeIndex = Math.min(i, sizes.length - 1)
  return `~${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))}${
    sizes[safeIndex]
  }`
}

function createFormatLabel(
  f: any,
  type: "direct" | "video" | "audio" | "combined",
  bestAudioInfo?: any
): string {
  const parts: string[] = []
  if (type === "video" || type === "direct" || type === "combined") {
    if (f.height) parts.push(f.height + "p")
    if (f.fps && f.fps > 30) parts.push(`${Math.round(f.fps)}fps`)
    if (f.vcodec && f.vcodec !== "none") parts.push(f.vcodec.split(".")[0])
    if (type === "video" && f.vbr) parts.push(`~${Math.round(f.vbr)}k`)
    else if (type === "video" && f.tbr) parts.push(`~${Math.round(f.tbr)}k`)
  }
  if (type === "audio" || type === "direct") {
    if (f.acodec && f.acodec !== "none") parts.push(f.acodec.split(".")[0])
    if (f.abr) parts.push(`~${Math.round(f.abr)}k`)
  }
  if (type === "combined" && bestAudioInfo?.acodec) {
    parts.push(`+${bestAudioInfo.acodec.split(".")[0]}`)
    if (bestAudioInfo.abr) parts.push(`~${Math.round(bestAudioInfo.abr)}k`)
  }
  if (type === "direct" || type === "video" || type === "audio") {
    if (f.ext) parts.push(`(${f.ext.toUpperCase()})`)
  } else if (type === "combined" && bestAudioInfo) {
    parts.push(`(${f.ext}+${bestAudioInfo.ext})`)
  }
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

function parseAndCombineFormats(rawFormats: any[]): DetailedFormat[] {
  const results: DetailedFormat[] = []
  if (!Array.isArray(rawFormats)) return results
  const validFormats = rawFormats.filter(
    (f) =>
      f?.format_id &&
      f.protocol &&
      ["http", "https"].includes(f.protocol) &&
      (f.vcodec !== "none" || f.acodec !== "none")
  )
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
  results.push({
    id: "bestvideo+bestaudio/best",
    label: "Best Available (Recommended)",
    group: "Best Quality",
    hasVideo: true,
    hasAudio: true,
    qualityRank: 10000,
  })
  const addedDirectKeys = new Set<string>()
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
  if (bestAudioId && bestAudioInfo) {
    videoOnlyFormats.forEach((f) => {
      const qualityKey = `${f.height}p${f.fps > 30 ? Math.round(f.fps) : ""}`
      if (addedDirectKeys.has(qualityKey)) return
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
      addedDirectKeys.add(qualityKey)
    })
  }
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
  })
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
  })
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
  return results
}

// ==================================
// --- Core Download Logic ---
// ==================================
async function executeDownloadLogic(
  options: DownloadOptions
): Promise<DownloadResult> {
  const eventSender: WebContents | null = win?.webContents ?? null

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

  // 2. Fetch Info & Prepare State
  let videoInfo: { title?: string; thumbnail?: string } = {}
  try {
    console.log(`[Download ${options.url}] Fetching video info...`)
    const infoArgs = ["-J", "--flat-playlist", options.url]
    const infoProc = spawn(dependenciesStatus.ytDlpPath, infoArgs, {
      windowsHide: true,
    })
    let infoJsonData = ""
    infoProc.stdout.on("data", (d) => (infoJsonData += d.toString()))
    await new Promise<void>((resolve, reject) => {
      infoProc.on("close", (code) => {
        if (code === 0 && infoJsonData) {
          try {
            const parsed = JSON.parse(infoJsonData)
            const entry = parsed.entries ? parsed.entries[0] : parsed
            videoInfo.title = entry?.title
            videoInfo.thumbnail = entry?.thumbnail
            console.log(`[Download ${options.url}] Got info.`)
            resolve()
          } catch (e) {
            reject(new Error("Failed to parse video info JSON"))
          }
        } else {
          reject(new Error(`yt-dlp info fetch failed with code ${code}`))
        }
      })
      infoProc.on("error", reject)
    })
  } catch (error: any) {
    console.error(
      `[Download ${options.url}] Failed to fetch video info: ${error.message}`
    )
  }
  const baseDir: string = store.get("downloadPath", app.getPath("downloads"))
  const targetDir = path.join(baseDir, YTD_SUBFOLDER)
  const videoId = options.url.includes("v=")
    ? options.url.split("v=")[1].split("&")[0]
    : `dl_${Date.now()}`
  try {
    fs.mkdirSync(targetDir, { recursive: true })
  } catch (e: any) {
    const msg = `Cannot create download directory: ${targetDir}\nError: ${e.message}`
    dialog.showErrorBox("Directory Error", msg)
    return { success: false, message: msg }
  }
  try {
    const history = store.get("downloadHistory", [] as DownloadItem[])
    const existingItemIndex = history.findIndex((i) => i.id === videoId)
    const pendingItem: DownloadItem = {
      id: videoId,
      title: videoInfo.title || `Pending: ${options.url.substring(0, 60)}...`,
      path: "",
      status: "pending",
      url: options.url,
      progress: 0,
      timestamp: Date.now(),
      fileExists: false,
      errorInfo: undefined,
      thumbnailUrl: videoInfo.thumbnail,
    }
    let updatedHistory: DownloadItem[] =
      existingItemIndex > -1
        ? history.map((item, index) =>
            index === existingItemIndex ? pendingItem : item
          )
        : [...history, pendingItem]
    store.set("downloadHistory", updatedHistory)
    eventSender?.send("downloads:updated")
  } catch (e: any) {
    console.error(`Error setting pending state for ${videoId}:`, e)
  }

  // 3. Build yt-dlp Arguments
  const args: string[] = []
  args.push(
    "--progress",
    "--progress-template",
    "progress:%(progress._percent_str)s",
    "--encoding",
    "utf-8",
    "-o",
    path.join(targetDir, "%(title)s [%(id)s].%(ext)s"),
    "--no-continue",
    "--no-overwrites"
  )
  if (needsFfmpeg) args.push("--ffmpeg-location", dependenciesStatus.ffmpegPath)
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
      detectedTitle = videoInfo.title || `DL ${videoId}`,
      finalPath = ""
    proc.stdout.on("data", (data) => {
      stdoutBuffer += data.toString()
      let newlineIndex
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.substring(0, newlineIndex).trim()
        stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1)
        if (!line) continue
        const progressMatch = line.match(/^progress:(\d+\.?\d*)%$/)
        if (progressMatch?.[1]) {
          eventSender?.send("yt:download-progress", {
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
      }
    })
    proc.stderr.on("data", (data) => {
      const line = data.toString().trim()
      if (line) {
        console.error(`[stderr ${videoId}]: ${line}`)
        stderrBuffer += line + "\n"
      }
    })
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
        (status === "completed" ? detectedTitle : `Failed: ${detectedTitle}`) ||
        (status === "completed"
          ? videoInfo.title
          : `Failed: ${videoInfo.title || videoId}`)
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
        thumbnailUrl: videoInfo.thumbnail,
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
        thumbnailUrl: videoInfo.thumbnail,
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
    console.error(`[Sync spawn error ${videoId}]:`, e)
    const errorInfo = `Failed to launch download process: ${e.message}`
    updateStoreItemFinal(videoId, {
      title: "Launch Error",
      path: "",
      status: "error",
      errorInfo,
      timestamp: Date.now(),
      fileExists: false,
      thumbnailUrl: videoInfo.thumbnail,
    })
    if (Notification.isSupported())
      new Notification({ title: "Launch Error", body: errorInfo }).show()
    return { success: false, message: errorInfo }
  }
}

// --- Helper function to trigger single download for playlists ---
async function triggerSingleDownload(
  item: { url: string },
  options: PlaylistDownloadOptions
): Promise<DownloadResult> {
  const singleDownloadOptions: DownloadOptions = {
    url: item.url,
    formatCode: options.formatCode,
    outputFormat: options.outputFormat,
    hasVideo: options.hasVideo,
    hasAudio: options.hasAudio,
  }
  console.log(`Triggering download for playlist item: ${item.url}`)
  try {
    const result = await executeDownloadLogic(singleDownloadOptions)
    return result
  } catch (error: any) {
    console.error(`Error triggering download for ${item.url}:`, error)
    return {
      success: false,
      message: `Failed to start download for ${item.url}: ${error.message}`,
    }
  }
}

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
        return { ...item, ...finalData }
      }
      return item
    })
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
    if (win) win.webContents.send("downloads:updated")
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
  } catch (e: any) {}
}

// ==================================
// --- Single Instance Lock ---
// ==================================
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log("Another instance is already running. Quitting this instance.")
  app.quit()
} else {
  // This is the primary instance.
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    console.log("Second instance detected. Focusing existing window.")
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // --- Create Window & App Lifecycle Setup (Primary Instance) ---
  function createWindow() {
    const publicPath = process.env.VITE_PUBLIC ?? ""
    const iconPath = path.join(__dirname, "../../build/icon.png")
    win = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      icon: fs.existsSync(iconPath)
        ? iconPath
        : path.join(publicPath, "electron-vite.svg"),
      show: false,
      frame: true,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    })
    win.once("ready-to-show", () => {
      win?.show()
      if (app.isPackaged) {
        console.log("[AutoUpdate] Checking for updates...")
        setTimeout(() => {
          autoUpdater.checkForUpdatesAndNotify().catch((err) => {
            console.error("[AutoUpdate] Error:", err.message)
          })
        }, 5000)
      } else {
        console.log("[AutoUpdate] Dev mode, skipping check.")
      }
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
  }

  app.whenReady().then(() => {
    createWindow()
    setTimeout(checkAndStoreDependencies, 1500)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  // --- AutoUpdater Event Handling Setup (Primary Instance) ---
  autoUpdater.logger = console
  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdate] Checking...")
  })
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    console.log("[AutoUpdate] Update available.", info)
  })
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    console.log("[AutoUpdate] Update not available.", info)
  })
  autoUpdater.on("error", (err) => {
    console.error("[AutoUpdate] Error:", err.message)
    if (win && !err.message.includes("net::ERR_")) {
      dialog.showErrorBox(
        "Update Error",
        `Failed to check for updates: ${err.message}`
      )
    }
  })
  autoUpdater.on("download-progress", (progressObj: ProgressInfo) => {
    let msg = `DL ${Math.round(progressObj.percent)}% (${Math.round(
      progressObj.bytesPerSecond / 1024
    )} KB/s)`
    console.log(`[AutoUpdate] ${msg}`)
    if (win)
      win.webContents.send("update-download-progress", progressObj.percent)
  })
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    console.log("[AutoUpdate] Update downloaded.", info)
    dialog
      .showMessageBox(win!, {
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} downloaded. Restart to install?`,
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          console.log("[AutoUpdate] Restarting...")
          autoUpdater.quitAndInstall()
        }
      })
      .catch((err) => {
        console.error("[AutoUpdate] Restart dialog error:", err)
      })
  })

  // ==================================
  // --- IPC Handlers Setup (Primary Instance) ---
  // ==================================
  ipcMain.handle(
    "app:show-notification",
    (_event, options: { title: string; body: string }) => {
      if (!Notification.isSupported()) {
        console.warn("Notifications not supported.")
        return
      }
      new Notification({ title: options.title, body: options.body }).show()
    }
  )
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
        await checkAndStoreDependencies()
        return selectedPath
      }
      return null
    }
  )
  ipcMain.handle(
    "app:check-dependencies",
    async () => await checkAndStoreDependencies()
  )
  ipcMain.handle("app:get-dependencies-status", () => dependenciesStatus)
  ipcMain.handle("downloads:get-list", () => {
    console.log("[IPC downloads:get-list] Handler invoked.")
    try {
      const history = store.get("downloadHistory", [] as DownloadItem[])
      if (!Array.isArray(history)) {
        console.error(
          "[IPC downloads:get-list] Error: History retrieved from store is not an array:",
          history
        )
        store.set("downloadHistory", [])
        return []
      }
      const validHistory = history.filter((item) => {
        if (
          !item ||
          typeof item !== "object" ||
          !item.id ||
          !item.url ||
          !item.status
        ) {
          console.warn(
            "[IPC downloads:get-list] Filtering out invalid item from history:",
            item
          )
          return false
        }
        return true
      })
      const historyWithCheck = validHistory.map(
        (item: DownloadItem): DownloadItem => {
          let exists = false
          if (item.status === "completed" && item.path) {
            try {
              exists = fs.existsSync(item.path)
            } catch (err) {
              console.error(
                `[IPC downloads:get-list] Error checking file ${item.path} for item ${item.id}:`,
                err
              )
              exists = false
            }
          }
          return { ...item, fileExists: !!exists }
        }
      )
      console.log(
        `[IPC downloads:get-list] Returning ${historyWithCheck.length} items.`
      )
      return historyWithCheck
    } catch (e: any) {
      console.error("[IPC downloads:get-list] Unexpected error:", e)
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
    if (!filePath) return false
    try {
      clipboard.writeText(path.normalize(filePath))
      return true
    } catch (e: any) {
      console.error(`Failed copy path ${filePath}:`, e)
      return false
    }
  })
  ipcMain.handle(
    "downloads:retry",
    async (_event, itemId: string): Promise<DownloadResult> => {
      if (!itemId) return { success: false, message: "Invalid ID." }
      try {
        const history = store.get("downloadHistory", [])
        const itemToRetry = history.find((item) => item.id === itemId)
        if (!itemToRetry)
          return { success: false, message: "Item not found in history." }
        console.log(`Retrying download for ${itemToRetry.url} (ID: ${itemId})`)
        return await executeDownloadLogic({ url: itemToRetry.url })
      } catch (e: any) {
        console.error(`Failed to retry item ${itemId}:`, e)
        return { success: false, message: `Retry error: ${e.message}` }
      }
    }
  )
  ipcMain.handle(
    "yt:fetch-formats",
    async (
      _event,
      url: string
    ): Promise<{
      formats: DetailedFormat[]
      thumbnailUrl?: string
      title?: string
    }> => {
      if (!dependenciesStatus.checked) await checkAndStoreDependencies()
      if (!dependenciesStatus.ytDlpOk)
        throw new Error("yt-dlp is required but missing or invalid.")
      return new Promise(async (resolve, reject) => {
        const args = ["-J", "--flat-playlist", url]
        console.log(
          `Fetching formats & info: ${dependenciesStatus.ytDlpPath} ${args.join(
            " "
          )}`
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
              const videoInfo = info.entries ? info.entries[0] : info
              const formats = videoInfo?.formats
              const thumbnailUrl = videoInfo?.thumbnail
              const title = videoInfo?.title
              if (!formats) {
                if (info.entries)
                  throw new Error(
                    "Playlist detected, format fetching for playlists not fully supported."
                  )
                else throw new Error("No video/format information found.")
              }
              resolve({
                formats: parseAndCombineFormats(formats),
                thumbnailUrl: thumbnailUrl,
                title: title,
              })
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
    async (_event, options: DownloadOptions): Promise<DownloadResult> => {
      return await executeDownloadLogic(options)
    }
  )
  ipcMain.handle(
    "yt:fetch-playlist-videos",
    async (_event, playlistUrl: string): Promise<PlaylistItem[]> => {
      if (!dependenciesStatus.checked) await checkAndStoreDependencies()
      if (!dependenciesStatus.ytDlpOk) throw new Error("yt-dlp is required.")
      return new Promise<PlaylistItem[]>((resolve, reject) => {
        const args = ["--flat-playlist", "-J", playlistUrl]
        console.log(
          `Fetching playlist videos: ${
            dependenciesStatus.ytDlpPath
          } ${args.join(" ")}`
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
              if (!info.entries || !Array.isArray(info.entries)) {
                if (info.id && info.title) {
                  reject(
                    new Error(
                      "This appears to be a single video URL, not a playlist."
                    )
                  )
                  return
                }
                throw new Error("Invalid playlist data received from yt-dlp.")
              }
              const items: PlaylistItem[] = info.entries.map((entry: any) => ({
                id: entry.id,
                url: entry.url,
                title: entry.title || `Video ${entry.id}`,
                thumbnail: entry.thumbnail,
              }))
              console.log(`Fetched ${items.length} videos from playlist.`)
              resolve(items)
            } catch (e: any) {
              console.error(
                "Playlist JSON Parse Error:",
                e,
                "\nRaw JSON:",
                jsonData.substring(0, 1000)
              )
              reject(
                new Error(
                  `Failed to parse playlist info: ${
                    e.message
                  }. stderr: ${errData.trim()}`
                )
              )
            }
          } else {
            console.error(
              `yt-dlp playlist fetch failed (code ${code}): ${errData.trim()}`
            )
            reject(
              new Error(
                `yt-dlp failed (code ${code}): ${
                  errData.trim() || "Playlist not found or private?"
                }`
              )
            )
          }
        })
        proc.on("error", (e) => {
          console.error(`yt-dlp spawn error for playlist fetch: ${e.message}`)
          reject(e)
        })
      })
    }
  )
  ipcMain.handle(
    "yt:download-playlist-items",
    async (
      _event,
      items: PlaylistItem[],
      options: PlaylistDownloadOptions
    ): Promise<{ success: boolean; message: string }> => {
      if (!items || items.length === 0) {
        return {
          success: false,
          message: "No playlist items selected for download.",
        }
      }
      console.log(
        `Received request to download ${items.length} playlist items with options:`,
        options
      )
      let successes = 0
      let failures = 0
      for (const item of items) {
        const result = await triggerSingleDownload(item, options)
        if (result.success) {
          successes++
        } else {
          failures++
          console.warn(`Failed playlist item ${item.id}: ${result.message}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      const message = `Playlist download initiated: ${successes} started successfully, ${failures} failed to start.`
      console.log(message)
      return { success: failures === 0, message }
    }
  )
} // <--- Correct END of the 'else' block for the single instance lock
