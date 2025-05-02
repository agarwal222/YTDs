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
  fileExists?: boolean
  errorInfo?: string
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
  outputFormat?: string
  hasVideo?: boolean
  hasAudio?: boolean
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
  ytDlpPath: string // May be empty if using PATH
  ffmpegPath: string // May be empty if using PATH
}
export interface DependenciesStatus {
  ytDlpOk: boolean
  ffmpegOk: boolean
  checked: boolean // Has the check been performed at least once?
  ytDlpPath: string // Path used for check (could be command name or full path)
  ffmpegPath: string // Path used for check
}

// --- Define ElectronAPI Shape ---
export interface ElectronAPI {
  // Settings
  getSettingsPaths: () => Promise<SettingsPaths>
  selectDownloadPath: () => Promise<string | null> // Returns new path or null if cancelled
  selectExecutablePath: (name: "yt-dlp" | "ffmpeg") => Promise<string | null> // Returns new path or null

  // Downloads
  getDownloads: () => Promise<DownloadItem[]>
  onDownloadsUpdated: (callback: () => void) => () => void // Listener for list changes
  openItemFolder: (filePath: string) => Promise<boolean> // Action
  removeItem: (itemId: string) => Promise<boolean> // Action
  copyItemPath: (filePath: string) => Promise<boolean> // Kept for potential use, but renderer uses navigator.clipboard
  retryDownload: (itemId: string) => Promise<DownloadResult> // Action

  // YouTube Actions
  fetchFormats: (url: string) => Promise<DetailedFormat[]>
  downloadVideo: (options: DownloadOptions) => Promise<DownloadResult>
  onDownloadProgress: (
    callback: (progressData: ProgressData) => void
  ) => () => void // Listener for progress

  // Dependencies
  checkDependencies: () => Promise<boolean> // Trigger re-check, returns overall status after check
  getDependenciesStatus: () => Promise<DependenciesStatus> // Get current status immediately
  onDependenciesStatusUpdate: (
    callback: (status: DependenciesStatus) => void
  ) => () => void // Listen for status changes pushed from main

  // Other
  onMainProcessMessage: (callback: (message: string) => void) => () => void
  // --- Notification ---
  showNotification: (options: { title: string; body: string }) => Promise<void> // Can be called from renderer if needed
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
    const listener = () => callback()
    ipcRenderer.on("downloads:updated", listener)
    // Return cleanup function
    return () => ipcRenderer.removeListener("downloads:updated", listener)
  },
  openItemFolder: (filePath) =>
    ipcRenderer.invoke("downloads:open-folder", filePath),
  removeItem: (itemId) => ipcRenderer.invoke("downloads:remove-item", itemId),
  copyItemPath: (
    filePath // Keep exposed if needed, but prefer renderer clipboard
  ) => ipcRenderer.invoke("downloads:copy-path", filePath),
  retryDownload: (itemId) => ipcRenderer.invoke("downloads:retry", itemId),

  // YouTube Actions
  fetchFormats: (url) => ipcRenderer.invoke("yt:fetch-formats", url),
  downloadVideo: (options) => ipcRenderer.invoke("yt:download", options),
  onDownloadProgress: (callback) => {
    const listener = (_event: any, progressData: ProgressData) =>
      callback(progressData)
    ipcRenderer.on("yt:download-progress", listener)
    // Return cleanup function
    return () => ipcRenderer.removeListener("yt:download-progress", listener)
  },

  // Dependencies
  checkDependencies: () => ipcRenderer.invoke("app:check-dependencies"),
  getDependenciesStatus: () =>
    ipcRenderer.invoke("app:get-dependencies-status"),
  onDependenciesStatusUpdate: (callback) => {
    const listener = (_event: any, status: DependenciesStatus) =>
      callback(status)
    ipcRenderer.on("dependencies-status-update", listener)
    // Return cleanup function
    return () =>
      ipcRenderer.removeListener("dependencies-status-update", listener)
  },

  // Other
  onMainProcessMessage: (callback) => {
    const listener = (_event: any, message: string) => callback(message)
    ipcRenderer.on("main-process-message", listener)
    // Return cleanup function
    return () => ipcRenderer.removeListener("main-process-message", listener)
  },

  // --- Notification ---
  showNotification: (
    options // Expose the handler
  ) => ipcRenderer.invoke("app:show-notification", options),
}

// --- Securely expose the API ---
try {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI)
  console.log("electronAPI exposed successfully.")
} catch (error) {
  console.error("Failed to expose electronAPI:", error)
}

// --- Global Type Declaration for Renderer ---
// Ensure this is available for your React components
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
