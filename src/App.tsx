// src/App.tsx
import { useState, useEffect, useCallback } from "react"
import TopBar from "@/components/TopBar"
import DownloadList from "@/components/DownloadList"
import NewDownloadForm from "@/components/NewDownloadForm"
import SettingsModal from "@/components/modals/SettingsModal"
import StatusBar from "@/components/StatusBar"
import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/hooks/use-toast"
import type {
  DownloadItem,
  DownloadResult,
  ProgressData,
  DependenciesStatus,
} from "../electron/preload" // Types from preload

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [downloadList, setDownloadList] = useState<DownloadItem[]>([])
  const [loadingDownloads, setLoadingDownloads] = useState(true)
  const [depStatus, setDepStatus] = useState<Partial<DependenciesStatus>>({
    ytDlpOk: undefined,
    ffmpegOk: undefined,
    checked: undefined,
    ytDlpPath: undefined,
    ffmpegPath: undefined,
  })
  const dependenciesOkForDownload = !!(depStatus.checked && depStatus.ytDlpOk)
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState<
    number | null
  >(null) // State for update progress

  const { toast } = useToast()

  // --- Callbacks and Effects ---
  const fetchDownloads = useCallback(async () => {
    console.log("App: Fetching downloads...")
    try {
      if (window.electronAPI) {
        const list = await window.electronAPI.getDownloads()
        console.log("App: Received downloads list:", list.length, "items")
        setDownloadList(Array.isArray(list) ? list : [])
      } else {
        console.error("App: electronAPI not available for fetching downloads.")
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
    }
  }, [toast])

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn(
        "App: electronAPI not available on initial mount. Retrying soon..."
      )
      setDepStatus({
        ytDlpOk: false,
        ffmpegOk: false,
        checked: true,
        ytDlpPath: "Error",
        ffmpegPath: "Error",
      })
      setLoadingDownloads(false)
      return
    }

    console.log("App: API ready. Setting up listeners and initial checks...")
    setLoadingDownloads(true)

    // --- Setup Listeners ---
    const removeUpdateListener = window.electronAPI.onDownloadsUpdated(() => {
      console.log("App: Received downloads:updated signal. Refetching list.")
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
    const removeDepListener = window.electronAPI.onDependenciesStatusUpdate(
      (status: DependenciesStatus) => {
        console.log("App: Received dependencies-status-update:", status)
        setDepStatus(status)
      }
    )
    const removeMainMessageListener = window.electronAPI.onMainProcessMessage(
      (message: string) => {
        console.log("App: Message from Main:", message)
      }
    )
    // Auto Update Progress Listener
    let removeUpdateProgressListener: (() => void) | undefined
    if (window.electronAPI?.onUpdateDownloadProgress) {
      removeUpdateProgressListener =
        window.electronAPI.onUpdateDownloadProgress((percent) => {
          console.log(`App: Update progress: ${percent}%`)
          setUpdateDownloadPercent(percent)
          // Reset progress if it hits 100 or an error occurs elsewhere (handled by app restart/main process)
          if (percent >= 100) {
            setTimeout(() => setUpdateDownloadPercent(null), 2000) // Clear after a delay
          }
        })
    } else {
      console.warn("onUpdateDownloadProgress API not available")
    }

    // --- Perform Initial Checks ---
    const performInitialLoad = async () => {
      try {
        console.log("App: Performing initial fetchDownloads()...")
        await fetchDownloads()
        console.log("App: Performing initial getDependenciesStatus()...")
        const initialStatus = await window.electronAPI.getDependenciesStatus()
        setDepStatus(initialStatus)
        console.log("App: Initial dependency status:", initialStatus)
      } catch (error: any) {
        console.error("App: Error during initial load:", error)
        toast({
          title: "Initialization Error",
          description: error.message,
          variant: "destructive",
        })
        setDownloadList([])
        setDepStatus({
          ytDlpOk: false,
          ffmpegOk: false,
          checked: true,
          ytDlpPath: "Error",
          ffmpegPath: "Error",
        })
      } finally {
        console.log("App: Initial load sequence finished.")
        setLoadingDownloads(false)
      }
    }
    performInitialLoad()

    // --- Cleanup Function ---
    return () => {
      console.log("App: Cleaning up listeners...")
      removeUpdateListener?.()
      removeProgressListener?.()
      removeDepListener?.()
      removeMainMessageListener?.()
      removeUpdateProgressListener?.() // Cleanup update listener
    }
  }, [fetchDownloads, toast])

  const handleDownloadStarted = (result: DownloadResult) => {
    console.log("App: Download initiated signal received:", result)
  }

  // --- Action Handlers ---
  const handleRemoveItem = async (itemId: string) => {
    console.log(`App: Requesting removal of item ${itemId}`)
    if (!window.electronAPI?.removeItem) {
      console.error("App: removeItem function not available.")
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
        toast({ description: "Removed item from history." })
      } else {
        toast({
          title: "Error",
          description: "Failed to remove item.",
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
      console.error("App: openItemFolder function not available.")
      toast({
        title: "Error",
        description: "Cannot open folder: Feature not available.",
        variant: "destructive",
      })
      return
    }
    try {
      const success = await window.electronAPI.openItemFolder(filePath)
      if (!success) {
        toast({
          title: "Warning",
          description: "Could not open folder or file was missing.",
          variant: "default",
        })
      }
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
    console.log(`App: Requesting retry for item ${item.id} - URL: ${item.url}`)
    if (!window.electronAPI?.retryDownload) {
      console.error("App: retryDownload function not available.")
      toast({
        title: "Error",
        description: "Cannot retry download: Feature not available.",
        variant: "destructive",
      })
      return
    }
    try {
      const result = await window.electronAPI.retryDownload(item.id)
      if (result.success) {
        toast({
          title: "Retry Started",
          description: result.message || `Retrying download for ${item.title}`,
        })
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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden antialiased">
      <TopBar onSettingsClick={() => setIsSettingsOpen(true)} />
      <NewDownloadForm
        dependenciesOk={dependenciesOkForDownload}
        onDownloadStarted={handleDownloadStarted}
      />

      {/* Main Content Area (Scrollable List) */}
      <div className="flex-1 overflow-y-auto">
        {loadingDownloads ? (
          <p className="text-muted-foreground p-10 text-center animate-pulse">
            Loading downloads...
          </p>
        ) : downloadList.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center">
            No downloads yet. Add one above.
          </p>
        ) : (
          <DownloadList
            downloads={downloadList}
            onRemoveItem={handleRemoveItem}
            onOpenFolder={handleOpenFolder}
            onRetry={handleRetryDownload}
          />
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        itemCount={downloadList.length}
        ytDlpOk={depStatus.ytDlpOk}
        ffmpegOk={depStatus.ffmpegOk}
        checked={depStatus.checked}
        updateProgress={updateDownloadPercent} // Pass down state
      />

      <SettingsModal isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <Toaster />
    </div>
  )
}

export default App
