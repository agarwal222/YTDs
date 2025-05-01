// src/App.tsx
import { useState, useEffect, useCallback } from "react"
import TopBar from "@/components/TopBar"
import DownloadList from "@/components/DownloadList"
// import VideoPlayer from '@/components/VideoPlayer'; // REMOVED
import NewDownloadModal from "@/components/modals/NewDownloadModal"
import SettingsModal from "@/components/modals/SettingsModal"
import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/hooks/use-toast"
import type {
  DownloadItem,
  DownloadResult,
  ProgressData,
  DependenciesStatus,
} from "../electron/preload"
// import { AlertTriangle } from 'lucide-react';
// import { Button } from '@/components/ui/button';
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertTriangle } from "lucide-react"
import { Button } from "./components/ui/button"

function App() {
  const [isNewDownloadOpen, setIsNewDownloadOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  // const [selectedVideoPath, setSelectedVideoPath] = useState<string | null>(null); // REMOVED
  const [downloadList, setDownloadList] = useState<DownloadItem[]>([])
  const [loadingDownloads, setLoadingDownloads] = useState(true)
  const [dependenciesOk, setDependenciesOk] = useState(true)
  const [checkingDeps, setCheckingDeps] = useState(true)
  const { toast } = useToast()

  // Memoized fetchDownloads (No changes needed here)
  const fetchDownloads = useCallback(async () => {
    console.log("App: Fetching downloads...")
    // setLoadingDownloads(true);
    try {
      if (window.electronAPI) {
        const list = await window.electronAPI.getDownloads()
        console.log("App: Received downloads list:", list)
        setDownloadList(Array.isArray(list) ? list : [])
      } else {
        console.error(
          "App: electronAPI not available yet for fetching downloads."
        )
        setDownloadList([])
      }
    } catch (error: any) {
      console.error("App: Failed to fetch downloads:", error)
      toast({
        title: "Error Loading Downloads",
        description: error?.message || "Could not load download history.",
        variant: "destructive",
      })
      setDownloadList([])
    } finally {
      // setLoadingDownloads(false);
    }
  }, [toast])

  // Effect for listeners and initial load (No changes needed here)
  useEffect(() => {
    if (!window.electronAPI) {
      console.warn("App: electronAPI not available on initial mount.")
      setCheckingDeps(false)
      setDependenciesOk(false)
      setLoadingDownloads(false)
      return
    }
    setLoadingDownloads(true)
    fetchDownloads()

    console.log("App: Setting up listeners...")
    const removeUpdateListener = window.electronAPI.onDownloadsUpdated(() => {
      fetchDownloads()
    })
    const removeProgressListener = window.electronAPI.onDownloadProgress(
      (progressData: ProgressData) => {
        setDownloadList((currentList) =>
          (Array.isArray(currentList) ? currentList : []).map((item) =>
            item.id === progressData.videoId
              ? {
                  ...item,
                  progress: progressData.progress,
                  status: "downloading",
                }
              : item
          )
        )
      }
    )
    let initialStatusReceived = false
    const removeDepListener = window.electronAPI.onDependenciesStatusUpdate(
      (status: DependenciesStatus) => {
        setDependenciesOk(status.ytDlpOk && status.ffmpegOk)
        if (status.checked) {
          setCheckingDeps(false)
          initialStatusReceived = true
        }
      }
    )
    const removeMainMessageListener = window.electronAPI.onMainProcessMessage(
      (message: string) => {
        console.log("App: Message from Main:", message)
      }
    )
    const performInitialCheck = async () => {
      console.log("App: Getting initial dependency status...")
      setCheckingDeps(true)
      try {
        const status = await window.electronAPI.getDependenciesStatus()
        setDependenciesOk(status.ytDlpOk && status.ffmpegOk)
        if (status.checked) initialStatusReceived = true
      } catch (e: any) {
        console.error("Error getting initial dep status", e)
        setDependenciesOk(false)
        toast({
          title: "Error",
          description: `Could not check dependencies: ${e.message}`,
          variant: "destructive",
        })
      } finally {
        setCheckingDeps(false)
        setLoadingDownloads(false)
      }
    }
    performInitialCheck()

    return () => {
      console.log("App: Cleaning up listeners...")
      removeUpdateListener?.()
      removeProgressListener?.()
      removeDepListener?.()
      removeMainMessageListener?.()
    }
  }, [fetchDownloads]) // Keep fetchDownloads dependency

  // Callback when download starts (No changes needed here)
  const handleDownloadStarted = (result: DownloadResult) => {
    console.log("App: Download initiated signal received:", result)
  }

  // --- NEW: Handlers for actions passed down to DownloadList ---
  const handleRemoveItem = async (itemId: string) => {
    console.log(`App: Requesting removal of item ${itemId}`)
    if (!window.electronAPI?.removeItem) {
      // Check if function exists on API
      console.error("App: removeItem function not available on electronAPI.")
      toast({
        title: "Error",
        description: "Cannot remove item: Feature not available.",
        variant: "destructive",
      })
      return
    }
    try {
      const success = await window.electronAPI.removeItem(itemId)
      if (success) {
        toast({
          title: "Item Removed",
          description: "Removed item from download history.",
        })
        // The backend should send 'downloads:updated', triggering a list refresh.
        // Alternatively, filter the list immediately for faster UI update:
        // setDownloadList(current => current.filter(item => item.id !== itemId));
      } else {
        toast({
          title: "Error",
          description: "Failed to remove item from history.",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("App: Error removing item:", error)
      toast({
        title: "Error",
        description: error.message || "Could not remove item.",
        variant: "destructive",
      })
    }
  }

  const handleOpenFolder = async (filePath: string | undefined) => {
    console.log(`App: Requesting to open folder for: ${filePath}`)
    if (!filePath) {
      toast({
        title: "Error",
        description: "No file path available for this item.",
        variant: "destructive",
      })
      return
    }
    if (!window.electronAPI?.openItemFolder) {
      console.error(
        "App: openItemFolder function not available on electronAPI."
      )
      toast({
        title: "Error",
        description: "Cannot open folder: Feature not available.",
        variant: "destructive",
      })
      return
    }
    try {
      await window.electronAPI.openItemFolder(filePath)
    } catch (error: any) {
      console.error("App: Error opening folder:", error)
      toast({
        title: "Error Opening Folder",
        description: error.message || "Could not open file location.",
        variant: "destructive",
      })
    }
  }

  const handleRetryDownload = async (item: DownloadItem) => {
    console.log(`App: Requesting retry for item ${item.id}`)
    if (!window.electronAPI?.retryDownload) {
      console.error("App: retryDownload function not available on electronAPI.")
      toast({
        title: "Error",
        description: "Cannot retry download: Feature not available.",
        variant: "destructive",
      })
      return
    }
    try {
      // We only need to pass the ID, main process retrieves details from store
      const result = await window.electronAPI.retryDownload(item.id)
      if (result.success) {
        toast({ title: "Retry Started", description: result.message })
        // Backend should add pending item and send update event
      } else {
        toast({
          title: "Retry Failed",
          description: result.message || "Could not start retry.",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("App: Error retrying download:", error)
      toast({
        title: "Retry Error",
        description: error.message || "Could not retry download.",
        variant: "destructive",
      })
    }
  }
  // --- End New Handlers ---

  return (
    // Main container div
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Top Bar Component */}
      <TopBar
        onNewDownloadClick={() => setIsNewDownloadOpen(true)}
        onSettingsClick={() => setIsSettingsOpen(true)}
      />

      {/* Dependency Status Banner Area (Keep as is) */}
      <div className="flex-shrink-0">
        {" "}
        {/* Prevent banner from shrinking */}
        {
          checkingDeps ? (
            // --- Checking Banner ---
            <div className="bg-blue-500/10 text-blue-700 dark:text-blue-300 px-4 py-1.5 flex items-center justify-center gap-2 text-sm animate-pulse">
              <span>Checking dependencies (yt-dlp, ffmpeg)...</span>
            </div>
          ) : !dependenciesOk ? (
            // --- Error Banner ---
            <div className="bg-destructive/10 border-b border-destructive/30 text-destructive px-4 py-2 flex items-center gap-2 text-sm">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <span className="flex-grow">
                Required dependencies missing or invalid. Check Settings.
              </span>
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => setIsSettingsOpen(true)}
              >
                Open Settings
              </Button>
            </div>
          ) : null /* Render nothing if deps are OK and not checking */
        }
      </div>

      {/* Main Content Area - Single Panel for Download List */}
      <div className="flex-1 overflow-hidden p-2">
        {" "}
        {/* Use flex-1 to take remaining space, add padding */}
        <ScrollArea className="h-full rounded-md border">
          {" "}
          {/* Scroll the list area */}
          {loadingDownloads && downloadList.length === 0 ? (
            <p className="text-muted-foreground p-10 text-center">
              Loading downloads...
            </p>
          ) : (
            <DownloadList
              downloads={downloadList}
              // Pass action handlers down to the list items
              onRemoveItem={handleRemoveItem}
              onOpenFolder={handleOpenFolder}
              onRetry={handleRetryDownload}
            />
          )}
        </ScrollArea>
      </div>

      {/* Modals (Keep as is) */}
      <NewDownloadModal
        isOpen={isNewDownloadOpen}
        onOpenChange={setIsNewDownloadOpen}
        onDownloadStarted={handleDownloadStarted}
        dependenciesOk={dependenciesOk}
      />
      <SettingsModal isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />

      {/* Toast Container */}
      <Toaster />
    </div>
  )
}

export default App
