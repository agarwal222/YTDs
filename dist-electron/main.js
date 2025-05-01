"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// electron/main.ts
const electron_1 = require("electron"); // Added shell, clipboard; Removed protocol
const path = require("node:path");
const electron_store_1 = __importDefault(require("electron-store")); // Using v8.2.0 via package.json
const node_child_process_1 = require("node:child_process"); // Use spawn
const fs = require("node:fs"); // Import fs
// --- Constants ---
const YTD_SUBFOLDER = "YTDs"; // Name for the dedicated download subfolder
// --- Store Initialization ---
const store = new electron_store_1.default({});
// --- Global State ---
let win;
let dependenciesStatus = {
    ytDlpOk: false,
    ffmpegOk: false,
    checked: false,
    ytDlpPath: "yt-dlp",
    ffmpegPath: "ffmpeg",
};
// --- Path Calculations ---
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron_1.app.isPackaged
    ? process.env.DIST
    : path.join(process.env.DIST, "../public");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
// ==================================
// --- Helper Functions -----------
// ==================================
async function checkCommand(commandOrPath, name) {
    let effectivePath = commandOrPath;
    let checkViaPath = false;
    const versionArg = name === "ffmpeg" ? "-version" : "--version";
    // console.log(`Checking dependency: ${name} with input path: ${commandOrPath || '(empty, checking PATH)'}`); // Verbose log
    if (commandOrPath &&
        (path.isAbsolute(commandOrPath) || commandOrPath.includes(path.sep))) {
        try {
            if (!fs.existsSync(commandOrPath)) {
                return {
                    ok: false,
                    pathUsed: commandOrPath,
                    errorMsg: `Path not found: ${commandOrPath}`,
                };
            }
            if (!fs.statSync(commandOrPath).isFile()) {
                return {
                    ok: false,
                    pathUsed: commandOrPath,
                    errorMsg: `Path not file: ${commandOrPath}`,
                };
            }
            effectivePath = commandOrPath;
        }
        catch (err) {
            return {
                ok: false,
                pathUsed: commandOrPath,
                errorMsg: `Error accessing path: ${err.message}`,
            };
        }
    }
    else {
        effectivePath = name;
        checkViaPath = true;
    }
    return new Promise((resolve) => {
        try {
            // console.log(`[DepCheck-${name}] Spawning: "${effectivePath}" ${versionArg}`); // Verbose log
            const proc = (0, node_child_process_1.spawn)(effectivePath, [versionArg]);
            let out = "";
            let errOut = "";
            proc.stdout.on("data", (d) => (out += d.toString()));
            proc.stderr.on("data", (d) => (errOut += d.toString()));
            proc.on("close", (code) => {
                const info = (out || errOut).trim();
                const ok = code === 0 && !!info;
                resolve({
                    ok,
                    pathUsed: effectivePath,
                    errorMsg: ok
                        ? undefined
                        : `Exit Code ${code}. Stderr: ${errOut.trim()}`,
                });
            });
            proc.on("error", (err) => resolve({
                ok: false,
                pathUsed: effectivePath,
                errorMsg: `Spawn Error: ${err.message}`,
            }));
        }
        catch (e) {
            resolve({
                ok: false,
                pathUsed: effectivePath,
                errorMsg: `Sync Spawn Error: ${e.message}`,
            });
        }
    });
}
async function checkAndStoreDependencies() {
    console.log("Starting dependency check...");
    dependenciesStatus.checked = false;
    const ytDlpUserPath = store.get("ytDlpExecutablePath");
    const ffmpegUserPath = store.get("ffmpegExecutablePath");
    const [ytDlpCheck, ffmpegCheck] = await Promise.all([
        checkCommand(ytDlpUserPath || "", "yt-dlp"),
        checkCommand(ffmpegUserPath || "", "ffmpeg"),
    ]);
    dependenciesStatus = {
        ytDlpOk: ytDlpCheck.ok,
        ffmpegOk: ffmpegCheck.ok,
        checked: true,
        ytDlpPath: ytDlpCheck.ok ? ytDlpCheck.pathUsed : ytDlpUserPath || "yt-dlp",
        ffmpegPath: ffmpegCheck.ok
            ? ffmpegCheck.pathUsed
            : ffmpegUserPath || "ffmpeg",
    };
    console.log("Dependency check complete. Status:", dependenciesStatus);
    if (win)
        win.webContents.send("dependencies-status-update", dependenciesStatus);
    const ok = dependenciesStatus.ytDlpOk && dependenciesStatus.ffmpegOk;
    if (!ok) {
        if (win) {
            let missing = [];
            if (!dependenciesStatus.ytDlpOk)
                missing.push("yt-dlp");
            if (!dependenciesStatus.ffmpegOk)
                missing.push("ffmpeg");
            electron_1.dialog
                .showMessageBox(win, {
                type: "warning",
                title: "Deps Missing",
                message: `Cannot find/execute: ${missing.join(" & ")}. Check PATH or Settings.`,
                buttons: ["OK", "Instructions"],
            })
                .then((r) => {
                if (r.response === 1) {
                    // TODO: Add actual URLs for instructions
                    electron_1.shell.openExternal("https://github.com/yt-dlp/yt-dlp#installation"); // Placeholder URL
                    electron_1.shell.openExternal("https://ffmpeg.org/download.html"); // Placeholder URL
                }
            });
        }
    }
    return ok;
}
function parseAndCombineFormats(formats) {
    // ... (Keep the full implementation from previous responses - this parses yt-dlp -J output) ...
    const results = [];
    if (!Array.isArray(formats))
        return results;
    const bestAudio = formats
        .filter((f) => f.format_id && f.vcodec === "none" && f.acodec !== "none" && f.abr)
        .sort((a, b) => (b.preference ?? -99) - (a.preference ?? -99) ||
        (b.abr ?? 0) - (a.abr ?? 0))[0];
    const bestVideoOnly = formats
        .filter((f) => f.format_id && f.vcodec !== "none" && f.acodec === "none" && f.height)
        .sort((a, b) => (b.preference ?? -99) - (a.preference ?? -99) ||
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.vbr ?? b.tbr ?? 0) - (a.vbr ?? a.tbr ?? 0))[0];
    const bestAudioId = bestAudio?.format_id;
    const bestAudioCodec = bestAudio?.acodec?.split(".")[0] ?? "audio";
    const bestAudioExt = bestAudio?.ext ?? "unk";
    results.push({
        id: "bestvideo+bestaudio/best",
        label: "Best Quality (Auto - Recommended)",
        group: "Best",
        hasVideo: true,
        hasAudio: true,
    });
    const addedDirectResolutions = new Set();
    formats
        .filter((f) => f.format_id &&
        f.vcodec !== "none" &&
        f.acodec !== "none" &&
        f.resolution &&
        f.ext)
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) ||
        (b.fps ?? 0) - (a.fps ?? 0) ||
        (b.tbr ?? 0) - (a.tbr ?? 0))
        .forEach((f) => {
        const qKey = `${f.height}p${f.fps > 30 ? f.fps : ""}`;
        if (addedDirectResolutions.has(qKey))
            return;
        const lParts = [qKey];
        if (f.vcodec)
            lParts.push(f.vcodec.split(".")[0]);
        lParts.push(`(${f.ext.toUpperCase()})`);
        if (f.filesize_approx)
            lParts.push(`~${(f.filesize_approx / (1024 * 1024)).toFixed(1)}MB`);
        else if (f.tbr)
            lParts.push(`~${Math.round(f.tbr)}k`);
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
        });
        addedDirectResolutions.add(qKey);
    });
    if (bestAudioId && bestVideoOnly) {
        formats
            .filter((f) => f.format_id &&
            f.vcodec !== "none" &&
            f.acodec === "none" &&
            f.height &&
            f.ext)
            .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) ||
            (b.fps ?? 0) - (a.fps ?? 0) ||
            (b.vbr ?? b.tbr ?? 0) - (a.vbr ?? a.tbr ?? 0))
            .forEach((f) => {
            const qKey = `${f.height}p${f.fps > 30 ? f.fps : ""}`;
            if (addedDirectResolutions.has(qKey))
                return;
            const cId = `${f.format_id}+${bestAudioId}`;
            const lParts = [qKey];
            if (f.vcodec)
                lParts.push(f.vcodec.split(".")[0]);
            lParts.push(`+ Audio`);
            lParts.push(`(${f.ext.toUpperCase()}+${bestAudioExt.toUpperCase()})`);
            let cSize;
            if (f.filesize_approx && bestAudio?.filesize_approx) {
                cSize = f.filesize_approx + bestAudio.filesize_approx;
                lParts.push(`~${(cSize / (1024 * 1024)).toFixed(1)}MB`);
            }
            else if (f.vbr && bestAudio?.abr) {
                lParts.push(`~${Math.round(f.vbr + bestAudio.abr)}k`);
            }
            else if (f.tbr && bestAudio?.abr) {
                lParts.push(`~${Math.round(f.tbr + bestAudio.abr)}k`);
            }
            results.push({
                id: cId,
                label: lParts.join(" "),
                // sizeMb: cSize ? parseFloat((cSize / (1024 * 1024)).toFixed(1)) : undefined, // Handle undefined cSize
                isCombined: true, // NOTE: isCombined is also not in DetailedFormat, consider removing or adding to type
                vcodec: f.vcodec,
                acodec: bestAudio?.acodec,
                ext: f.ext, // Keep video ext for combined
            });
            addedDirectResolutions.add(qKey);
        });
    }
    if (bestAudio) {
        const lParts = ["Audio Only"];
        if (bestAudio.acodec)
            lParts.push(bestAudio.acodec.split(".")[0]);
        lParts.push(`(${bestAudio.ext.toUpperCase()})`);
        if (bestAudio.abr)
            lParts.push(`~${Math.round(bestAudio.abr)}k`);
        if (bestAudio.filesize_approx)
            lParts.push(`~${(bestAudio.filesize_approx / (1024 * 1024)).toFixed(1)}MB`);
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
        });
    }
    results.sort((a, b) => {
        const groupOrder = {
            Best: 0,
            "Video+Audio (Direct)": 1,
            "Video+Audio (Combined)": 2,
            "Audio Only": 3,
        };
        if (groupOrder[a.group] !== groupOrder[b.group]) {
            return groupOrder[a.group] - groupOrder[b.group];
        }
        const qA = (a.hasVideo
            ? (a.resolution ? parseInt(a.resolution.split("x")[1]) : 0) *
                (a.fps ?? 30)
            : 0) + (a.abr ?? a.tbr ?? 0);
        const qB = (b.hasVideo
            ? (b.resolution ? parseInt(b.resolution.split("x")[1]) : 0) *
                (b.fps ?? 30)
            : 0) + (b.abr ?? b.tbr ?? 0);
        return qB - qA;
    });
    return results;
}
// ==================================
// --- Create Window & App Lifecycle ---
// ==================================
function createWindow() {
    const publicPath = process.env.VITE_PUBLIC ?? "";
    const iconPath = path.join(publicPath, "electron-vite.svg"); // Ensure this icon exists in /public
    win = new electron_1.BrowserWindow({
        width: 1024,
        height: 768,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    });
    win.webContents.on("did-finish-load", () => {
        win?.webContents.send("main-process-message", `Backend loaded: ${new Date().toLocaleString()}`);
        if (dependenciesStatus.checked && win) {
            // Send initial status if check completed before window loaded
            win.webContents.send("dependencies-status-update", dependenciesStatus);
        }
    });
    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
        win.webContents.openDevTools();
    }
    else {
        win.loadFile(path.join(process.env.DIST ?? "", "index.html"));
    }
    win.on("closed", () => {
        win = null;
    });
}
// app.disableHardwareAcceleration(); // Uncomment only if troubleshooting video playback later
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
electron_1.app.whenReady().then(() => {
    // --- REMOVED protocol registration ---
    createWindow();
    // Initial dependency check after window is created
    setTimeout(checkAndStoreDependencies, 1500);
});
// ==================================
// --- IPC Handlers ---------------
// ==================================
// --- Settings ---
electron_1.ipcMain.handle("settings:get-paths", () => ({
    downloadPath: store.get("downloadPath", electron_1.app.getPath("downloads")),
    ytDlpPath: store.get("ytDlpExecutablePath", ""),
    ffmpegPath: store.get("ffmpegExecutablePath", ""),
}));
electron_1.ipcMain.handle("settings:select-download-path", async () => {
    if (!win)
        return store.get("downloadPath", electron_1.app.getPath("downloads"));
    const r = await electron_1.dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (!r.canceled && r.filePaths.length > 0) {
        store.set("downloadPath", r.filePaths[0]);
        return r.filePaths[0];
    }
    return store.get("downloadPath", electron_1.app.getPath("downloads"));
});
electron_1.ipcMain.handle("settings:select-executable-path", async (_e, name) => {
    if (!win)
        return null;
    const r = await electron_1.dialog.showOpenDialog(win, {
        properties: ["openFile"],
        title: `Select ${name}`,
    });
    if (!r.canceled && r.filePaths.length > 0) {
        const p = r.filePaths[0];
        if (name === "yt-dlp")
            store.set("ytDlpExecutablePath", p);
        else
            store.set("ffmpegExecutablePath", p);
        await checkAndStoreDependencies();
        return p;
    }
    return null;
});
// --- Dependencies ---
electron_1.ipcMain.handle("app:check-dependencies", async () => await checkAndStoreDependencies());
electron_1.ipcMain.handle("app:get-dependencies-status", () => dependenciesStatus);
// --- Downloads ---
electron_1.ipcMain.handle("downloads:get-list", () => {
    try {
        const h = store.get("downloadHistory", []);
        return h
            .filter((i) => i.status !== "completed" || !i.path || fs.existsSync(i.path))
            .map((i) => ({
            ...i,
            fileExists: i.status === "completed" && !!i.path && fs.existsSync(i.path),
        }));
    }
    catch (e) {
        console.error("Error in get-list:", e);
        return [];
    }
});
electron_1.ipcMain.handle("downloads:open-folder", async (_e, filePath) => {
    if (!filePath)
        return false;
    try {
        if (!fs.existsSync(filePath)) {
            electron_1.dialog.showErrorBox("Error", `File/Folder not found:\n${filePath}`);
            return false;
        }
        electron_1.shell.showItemInFolder(path.normalize(filePath));
        return true;
    }
    catch (e) {
        console.error(`Failed open folder for ${filePath}:`, e);
        electron_1.dialog.showErrorBox("Error", `Cannot open folder: ${e.message}`);
        return false;
    }
});
electron_1.ipcMain.handle("downloads:remove-item", async (_e, itemId) => {
    if (!itemId)
        return false;
    try {
        const h = store.get("downloadHistory", []);
        const u = h.filter((i) => i.id !== itemId);
        if (u.length < h.length) {
            store.set("downloadHistory", u);
            if (win)
                win.webContents.send("downloads:updated");
            return true;
        }
        return false;
    }
    catch (e) {
        console.error(`Failed remove item ${itemId}:`, e);
        return false;
    }
});
electron_1.ipcMain.handle("downloads:copy-path", async (_e, filePath) => {
    if (!filePath)
        return false;
    try {
        electron_1.clipboard.writeText(path.normalize(filePath));
        return true;
    }
    catch (e) {
        console.error(`Failed copy path ${filePath}:`, e);
        return false;
    }
});
electron_1.ipcMain.handle("downloads:retry", async (event, itemId) => {
    if (!itemId)
        return { success: false, message: "Invalid ID." };
    try {
        const h = store.get("downloadHistory", []);
        const item = h.find((i) => i.id === itemId);
        if (!item)
            return { success: false, message: "Item not found." };
        console.log(`Retrying download for ${item.url}`);
        // Pass only event and the necessary options for download
        // NOTE: The handle itself is defined elsewhere, this calls that handle.
        // The target handle 'yt:download' expects (event, options), so we pass event and options.
        return await electron_1.ipcMain.handle("yt:download", event, {
            url: item.url,
            formatId: item.formatId, // Pass original format if available
        });
    }
    catch (e) {
        return { success: false, message: `Retry error: ${e.message}` };
    }
});
// --- YouTube Actions ---
electron_1.ipcMain.handle("yt:fetch-formats", async (_e, url) => {
    if (!dependenciesStatus.checked)
        await checkAndStoreDependencies();
    if (!dependenciesStatus.ytDlpOk)
        throw new Error("yt-dlp invalid/missing.");
    return new Promise((resolve, reject) => {
        const args = ["-J", url];
        const proc = (0, node_child_process_1.spawn)(dependenciesStatus.ytDlpPath, args);
        let json = "";
        let err = "";
        proc.stdout.on("data", (d) => (json += d));
        proc.stderr.on("data", (d) => (err += d));
        proc.on("close", (code) => {
            if (code === 0 && json) {
                try {
                    const info = JSON.parse(json);
                    if (!info?.formats)
                        throw new Error("Missing formats array.");
                    resolve(parseAndCombineFormats(info.formats));
                }
                catch (e) {
                    console.error("JSON Parse Error:", e, "\nRaw JSON:", json.substring(0, 1000));
                    reject(e);
                }
            }
            else {
                reject(new Error(`yt-dlp failed (code ${code}): ${err.trim() || "Unknown"}`));
            }
        });
        proc.on("error", (e) => reject(e));
    });
});
electron_1.ipcMain.handle("yt:download", async (event, options) => {
    if (!dependenciesStatus.checked)
        await checkAndStoreDependencies();
    if (!dependenciesStatus.ytDlpOk)
        return { success: false, message: "yt-dlp invalid/missing." };
    if (!dependenciesStatus.ffmpegOk)
        return { success: false, message: "ffmpeg invalid/missing." };
    const { url } = options;
    if (!url)
        return { success: false, message: "Missing URL." };
    const videoId = crypto.randomUUID(); // Generate unique ID
    const eventSender = event.sender; // Get sender for progress updates
    try {
        // --- Create and store initial download item FIRST ---
        const newItem = {
            id: videoId,
            title: "Fetching title...", // Placeholder title
            path: "", // Will be determined
            status: "pending",
            url,
            timestamp: Date.now(),
            formatId: options.formatId, // Save formatId
        };
        updateHistory(newItem);
        win?.webContents.send("downloads:updated"); // Notify UI immediately
        // --- End of initial item creation ---
        // --- Now, prepare and start the actual download process ---
        const downloadDir = path.join(store.get("downloadPath", electron_1.app.getPath("downloads")), YTD_SUBFOLDER);
        try {
            if (!fs.existsSync(downloadDir))
                fs.mkdirSync(downloadDir, { recursive: true });
        }
        catch (e) {
            return { success: false, message: `Failed create dir: ${e.message}` };
        }
        const args = [
            "--progress-template",
            "progress:%(progress.eta)s", // Simple progress reporting
            "--newline",
            "-o",
            path.join(downloadDir, "%(title)s [%(id)s].%(ext)s"),
            "--ffmpeg-location",
            dependenciesStatus.ffmpegPath,
        ];
        if (options.formatId)
            args.push("-f", options.formatId);
        args.push(url);
        console.log(`[DL ${videoId}] Spawning: ${dependenciesStatus.ytDlpPath} ${args.join(" ")}`);
        const proc = (0, node_child_process_1.spawn)(dependenciesStatus.ytDlpPath, args);
        let stdout = "";
        let stderr = "";
        let finalPath = "";
        let title = "";
        proc.stdout.on("data", (d) => {
            stdout += d.toString();
            let nl;
            while ((nl = stdout.indexOf("\n")) >= 0) {
                const l = stdout.substring(0, nl).trim();
                stdout = stdout.substring(nl + 1);
                if (!l)
                    continue;
                const pM = l.match(/^progress:(\d+\.?\d*)%$/);
                if (pM?.[1]) {
                    const p = parseFloat(pM[1]);
                    eventSender.send("yt:download-progress", { videoId, progress: p });
                    try {
                        const h = store.get("downloadHistory", []);
                        store.set("downloadHistory", h.map((i) => i.id === videoId
                            ? { ...i, progress: p, status: "downloading" }
                            : i));
                    }
                    catch (e) { }
                }
                const dM = l.match(/Destination: "?(.*)"?$/) ||
                    l.match(/Merging formats into "?(.*)"?/);
                if (dM?.[1]) {
                    finalPath = path.normalize(dM[1].trim().replace(/^"|"$/g, ""));
                    try {
                        title = path
                            .basename(finalPath, path.extname(finalPath))
                            .replace(/ \[[^\]]+\]$/, "")
                            .trim();
                    }
                    catch { }
                    console.log(`[DL ${videoId}] Detected Path: ${finalPath}, Title: ${title}`);
                    try {
                        const h = store.get("downloadHistory", []);
                        store.set("downloadHistory", h.map((i) => (i.id === videoId ? { ...i, title } : i)));
                    }
                    catch (e) { }
                }
            }
        });
        proc.stderr.on("data", (d) => {
            const l = d.toString().trim();
            if (l) {
                console.error(`[stderr ${videoId}]: ${l}`);
                stderr += l + "\n";
            }
        });
        proc.on("close", (code) => {
            console.log(`[close ${videoId}] Code: ${code}`);
            let exists = false; // Ensure type is boolean
            try {
                exists = !!(finalPath && fs.existsSync(finalPath)); // Ensure boolean assignment
            }
            catch { }
            const status = code === 0 && exists ? "completed" : "error";
            let eInfo = code !== 0
                ? stderr.trim() || `Exit Code ${code}`
                : !exists
                    ? `File missing: ${finalPath || "(path not detected)"}`
                    : undefined;
            if (code === 0 && !finalPath)
                eInfo = "Completed, path undetected.";
            const fTitle = status === "completed"
                ? title
                : `Failed: ${options.url.substring(0, 40)}...`;
            try {
                const h = store.get("downloadHistory", []);
                const fItem = {
                    id: videoId,
                    title: fTitle,
                    path: status === "completed" ? finalPath : "",
                    url: options.url,
                    status,
                    progress: status === "completed" ? 100 : undefined,
                    timestamp: Date.now(),
                    errorInfo: eInfo,
                    formatId: options.formatId // Keep formatId on final item
                };
                const fH = h.map((i) => (i.id === videoId ? fItem : i));
                if (!fH.some((i) => i.id === videoId))
                    fH.push(fItem); // Should not happen if newItem was added
                store.set("downloadHistory", fH);
                eventSender.send("downloads:updated");
            }
            catch (e) {
                console.error(`Error finalizing status for ${videoId}:`, e);
            }
        });
        proc.on("error", (err) => {
            console.error(`[spawn error ${videoId}]:`, err);
            const eInfo = `Spawn failed: ${err.message}`;
            try {
                const h = store.get("downloadHistory", []);
                const fItem = {
                    id: videoId,
                    title: "Spawn Error",
                    path: "",
                    url: options.url,
                    status: "error",
                    timestamp: Date.now(),
                    errorInfo: eInfo,
                    formatId: options.formatId // Keep formatId on error item
                };
                const fH = h.map((i) => (i.id === videoId ? fItem : i));
                if (!fH.some((i) => i.id === videoId))
                    fH.push(fItem);
                store.set("downloadHistory", fH);
                eventSender.send("downloads:updated");
            }
            catch (e) { }
        });
        // Return success *after* creating the pending item and *before* spawn finishes
        return {
            success: true,
            message: "Download process initiated.",
            videoId: videoId,
        };
    }
    catch (e) {
        // This catch handles errors *before* spawn (e.g., directory creation)
        console.error(`[Sync spawn error ${videoId}]:`, e);
        // Update history to reflect pre-spawn error if possible
        try {
            const h = store.get("downloadHistory", []);
            store.set("downloadHistory", h.map(i => i.id === videoId ? { ...i, status: 'error', errorInfo: `Setup failed: ${e.message}` } : i));
            win?.webContents.send("downloads:updated");
        }
        catch { }
        return { success: false, message: `Setup failed: ${e.message}` };
    }
});
// Ensure no extraneous code remains here
//# sourceMappingURL=main.js.map