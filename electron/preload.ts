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
  thumbnailUrl?: string // Added thumbnail URL
}
export interface DetailedFormat {
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
export interface DownloadOptions {
  // Options for a SINGLE video download
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

// --- Playlist Item Type ---
export interface PlaylistItem {
  id: string // Video ID
  url: string // Video URL
  title: string // Video Title
  thumbnail?: string // Thumbnail URL
}
// --- Playlist Download Options Type ---
export interface PlaylistDownloadOptions {
  formatCode?: string
  outputFormat?: string
  hasVideo?: boolean
  hasAudio?: boolean
}

// --- Define ElectronAPI Shape ---
export interface ElectronAPI {
  // Settings
  getSettingsPaths: () => Promise<SettingsPaths>
  selectDownloadPath: () => Promise<string | null>
  selectExecutablePath: (name: "yt-dlp" | "ffmpeg") => Promise<string | null>

  // Downloads
  getDownloads: () => Promise<DownloadItem[]>
  onDownloadsUpdated: (callback: () => void) => () => void
  openItemFolder: (filePath: string) => Promise<boolean>
  removeItem: (itemId: string) => Promise<boolean>
  copyItemPath: (filePath: string) => Promise<boolean>
  retryDownload: (itemId: string) => Promise<DownloadResult>

  // YouTube Actions
  fetchFormats: (
    url: string
  ) => Promise<{
    formats: DetailedFormat[]
    thumbnailUrl?: string
    title?: string
  }> // For single video info
  downloadVideo: (options: DownloadOptions) => Promise<DownloadResult> // For single video download
  onDownloadProgress: (
    callback: (progressData: ProgressData) => void
  ) => () => void // Listener for download progress

  // --- Playlist Handlers ---
  fetchPlaylistVideos: (playlistUrl: string) => Promise<PlaylistItem[]>
  downloadPlaylistItems: (
    items: PlaylistItem[],
    options: PlaylistDownloadOptions
  ) => Promise<{ success: boolean; message: string }>

  // Dependencies
  checkDependencies: () => Promise<boolean>
  getDependenciesStatus: () => Promise<DependenciesStatus>
  onDependenciesStatusUpdate: (
    callback: (status: DependenciesStatus) => void
  ) => () => void

  // Auto Update Progress Listener
  onUpdateDownloadProgress: (callback: (percent: number) => void) => () => void

  // --- NEW: Window Control Methods ---
  windowMinimize: () => void
  windowToggleMaximize: () => void // Toggles between maximize and restore
  windowClose: () => void

  // Other
  onMainProcessMessage: (callback: (message: string) => void) => () => void
  showNotification: (options: { title: string; body: string }) => Promise<void>
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
    return () => ipcRenderer.removeListener("downloads:updated", listener)
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
    const listener = (_event: any, progressData: ProgressData) =>
      callback(progressData)
    ipcRenderer.on("yt:download-progress", listener)
    return () => ipcRenderer.removeListener("yt:download-progress", listener)
  },

  // Playlist Implementations
  fetchPlaylistVideos: (playlistUrl) =>
    ipcRenderer.invoke("yt:fetch-playlist-videos", playlistUrl),
  downloadPlaylistItems: (items, options) =>
    ipcRenderer.invoke("yt:download-playlist-items", items, options),

  // Dependencies
  checkDependencies: () => ipcRenderer.invoke("app:check-dependencies"),
  getDependenciesStatus: () =>
    ipcRenderer.invoke("app:get-dependencies-status"),
  onDependenciesStatusUpdate: (callback) => {
    const listener = (_event: any, status: DependenciesStatus) =>
      callback(status)
    ipcRenderer.on("dependencies-status-update", listener)
    return () =>
      ipcRenderer.removeListener("dependencies-status-update", listener)
  },

  // Auto Update
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event: any, percent: number) => callback(percent)
    ipcRenderer.on("update-download-progress", listener)
    return () =>
      ipcRenderer.removeListener("update-download-progress", listener)
  },

  // --- NEW: Window Control Implementations ---
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),

  // Other
  onMainProcessMessage: (callback) => {
    const listener = (_event: any, message: string) => callback(message)
    ipcRenderer.on("main-process-message", listener)
    return () => ipcRenderer.removeListener("main-process-message", listener)
  },
  showNotification: (options) =>
    ipcRenderer.invoke("app:show-notification", options),
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
