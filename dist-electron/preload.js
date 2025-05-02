"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts
const electron_1 = require("electron");
// --- Implementation Mapping IPC ---
const electronAPI = {
    // Settings
    getSettingsPaths: () => electron_1.ipcRenderer.invoke("settings:get-paths"),
    selectDownloadPath: () => electron_1.ipcRenderer.invoke("settings:select-download-path"),
    selectExecutablePath: (name) => electron_1.ipcRenderer.invoke("settings:select-executable-path", name),
    // Downloads
    getDownloads: () => electron_1.ipcRenderer.invoke("downloads:get-list"),
    onDownloadsUpdated: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on("downloads:updated", listener);
        // Return cleanup function
        return () => electron_1.ipcRenderer.removeListener("downloads:updated", listener);
    },
    openItemFolder: (filePath) => electron_1.ipcRenderer.invoke("downloads:open-folder", filePath),
    removeItem: (itemId) => electron_1.ipcRenderer.invoke("downloads:remove-item", itemId),
    copyItemPath: (filePath // Keep exposed if needed, but prefer renderer clipboard
    ) => electron_1.ipcRenderer.invoke("downloads:copy-path", filePath),
    retryDownload: (itemId) => electron_1.ipcRenderer.invoke("downloads:retry", itemId),
    // YouTube Actions
    fetchFormats: (url) => electron_1.ipcRenderer.invoke("yt:fetch-formats", url),
    downloadVideo: (options) => electron_1.ipcRenderer.invoke("yt:download", options),
    onDownloadProgress: (callback) => {
        const listener = (_event, progressData) => callback(progressData);
        electron_1.ipcRenderer.on("yt:download-progress", listener);
        // Return cleanup function
        return () => electron_1.ipcRenderer.removeListener("yt:download-progress", listener);
    },
    // Dependencies
    checkDependencies: () => electron_1.ipcRenderer.invoke("app:check-dependencies"),
    getDependenciesStatus: () => electron_1.ipcRenderer.invoke("app:get-dependencies-status"),
    onDependenciesStatusUpdate: (callback) => {
        const listener = (_event, status) => callback(status);
        electron_1.ipcRenderer.on("dependencies-status-update", listener);
        // Return cleanup function
        return () => electron_1.ipcRenderer.removeListener("dependencies-status-update", listener);
    },
    // Other
    onMainProcessMessage: (callback) => {
        const listener = (_event, message) => callback(message);
        electron_1.ipcRenderer.on("main-process-message", listener);
        // Return cleanup function
        return () => electron_1.ipcRenderer.removeListener("main-process-message", listener);
    },
    // --- Notification ---
    showNotification: (options // Expose the handler
    ) => electron_1.ipcRenderer.invoke("app:show-notification", options),
};
// --- Securely expose the API ---
try {
    electron_1.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
    console.log("electronAPI exposed successfully.");
}
catch (error) {
    console.error("Failed to expose electronAPI:", error);
}
//# sourceMappingURL=preload.js.map