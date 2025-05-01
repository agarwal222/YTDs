// electron/preload.ts
import { contextBridge, ipcRenderer } from "electron"

// --- Type Definitions ---
export interface DownloadItem {
  id: string
  title: string
  path: string
  status: "pending" | "downloading" | "completed" | "error"
  url: string
  progress?: number
  timestamp?: number
  fileExists?: boolean // Set by main process get-list handler
  errorInfo?: string // Set by main process on error
}
export interface DetailedFormat {
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
export interface DownloadOptions {
  url: string
  formatCode?: string
  startTime?: string
  endTime?: string
}
export interface DownloadResult {
  success: boolean
  message: string
  videoId?: string
  error?: string
}
export interface ProgressData {
  videoId: string
  progress: number
}
export interface SettingsPaths {
  downloadPath: string
  ytDlpPath: string
  ffmpegPath: string
}
export interface DependenciesStatus {
  ytDlpOk: boolean
  ffmpegOk: boolean
  checked: boolean
  ytDlpPath: string
  ffmpegPath: string
}

// --- Define ElectronAPI Shape ---
export interface ElectronAPI {
  // Settings
  getSettingsPaths: () => Promise<SettingsPaths>
  selectDownloadPath: () => Promise<string | null>
  selectExecutablePath: (name: "yt-dlp" | "ffmpeg") => Promise<string | null>

  // Downloads
  getDownloads: () => Promise<DownloadItem[]>
  onDownloadsUpdated: (callback: () => void) => () => void // Listener for list changes
  openItemFolder: (filePath: string) => Promise<boolean> // Action
  removeItem: (itemId: string) => Promise<boolean> // Action
  copyItemPath: (filePath: string) => Promise<boolean> // Action
  retryDownload: (itemId: string) => Promise<DownloadResult> // Action

  // YouTube Actions
  fetchFormats: (url: string) => Promise<DetailedFormat[]>
  downloadVideo: (options: DownloadOptions) => Promise<DownloadResult>
  onDownloadProgress: (
    callback: (progressData: ProgressData) => void
  ) => () => void // Listener for progress

  // Dependencies
  checkDependencies: () => Promise<boolean> // Trigger re-check
  getDependenciesStatus: () => Promise<DependenciesStatus> // Get current status
  onDependenciesStatusUpdate: (
    callback: (status: DependenciesStatus) => void
  ) => () => void // Listen for status changes

  // Other
  onMainProcessMessage: (callback: (message: string) => void) => () => void
}

// --- Implementation Mapping IPC ---
const electronAPI: ElectronAPI = {
  // Settings
  getSettingsPaths: () => ipcRenderer.invoke("settings:get-paths"),
  selectDownloadPath: () => ipcRenderer.invoke("settings:select-download-path"),
  selectExecutablePath: (name) =>
    ipcRenderer.invoke("settings:select-executable-path", name),

  // Downloads
  getDownloads: () => ipcRenderer.invoke("downloads:get-list"),
  onDownloadsUpdated: (callback) => {
    const l = () => callback()
    ipcRenderer.on("downloads:updated", l)
    return () => ipcRenderer.removeListener("downloads:updated", l)
  },
  openItemFolder: (filePath) =>
    ipcRenderer.invoke("downloads:open-folder", filePath),
  removeItem: (itemId) => ipcRenderer.invoke("downloads:remove-item", itemId),
  copyItemPath: (filePath) =>
    ipcRenderer.invoke("downloads:copy-path", filePath),
  retryDownload: (itemId) => ipcRenderer.invoke("downloads:retry", itemId),

  // YouTube Actions
  fetchFormats: (url) => ipcRenderer.invoke("yt:fetch-formats", url),
  downloadVideo: (options) => ipcRenderer.invoke("yt:download", options),
  onDownloadProgress: (callback) => {
    const l = (_e: any, v: ProgressData) => callback(v)
    ipcRenderer.on("yt:download-progress", l)
    return () => ipcRenderer.removeListener("yt:download-progress", l)
  },

  // Dependencies
  checkDependencies: () => ipcRenderer.invoke("app:check-dependencies"),
  getDependenciesStatus: () =>
    ipcRenderer.invoke("app:get-dependencies-status"),
  onDependenciesStatusUpdate: (callback) => {
    const l = (_e: any, s: DependenciesStatus) => callback(s)
    ipcRenderer.on("dependencies-status-update", l)
    return () => ipcRenderer.removeListener("dependencies-status-update", l)
  },

  // Other
  onMainProcessMessage: (callback) => {
    const l = (_e: any, m: string) => callback(m)
    ipcRenderer.on("main-process-message", l)
    return () => ipcRenderer.removeListener("main-process-message", l)
  },
}

// --- Securely expose the API ---
try {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI)
  console.log("electronAPI exposed successfully.")
} catch (error) {
  console.error("Failed to expose electronAPI:", error)
}

// --- Global Type Declaration for Renderer ---
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
