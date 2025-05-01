// src/components/modals/SettingsModal.tsx
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast" // Corrected import path
import {
  FolderCog,
  Loader2,
  FolderSearch,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import type {
  SettingsPaths,
  DependenciesStatus,
} from "../../../electron/preload" // Adjust path if needed

interface SettingsModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

function SettingsModal({ isOpen, onOpenChange }: SettingsModalProps) {
  const [settingsPaths, setSettingsPaths] = useState<Partial<SettingsPaths>>({}) // Use partial for initial state
  const [depStatus, setDepStatus] = useState<Partial<DependenciesStatus>>({}) // Use partial for initial state
  const [isLoadingPaths, setIsLoadingPaths] = useState(false)
  const [isSelecting, setIsSelecting] = useState<
    "download" | "yt-dlp" | "ffmpeg" | null
  >(null)
  const [isCheckingDeps, setIsCheckingDeps] = useState(false)
  const { toast } = useToast()

  const fetchSettingsAndStatus = async () => {
    setIsLoadingPaths(true)
    setIsCheckingDeps(true) // Assume check happens with path load
    console.log("SettingsModal: Fetching settings and status...")
    try {
      const paths = await window.electronAPI.getSettingsPaths()
      const status = await window.electronAPI.getDependenciesStatus() // Get initial status too
      console.log("SettingsModal: Received paths:", paths)
      console.log("SettingsModal: Received status:", status)
      setSettingsPaths(paths)
      setDepStatus(status)
    } catch (err: any) {
      console.error("SettingsModal: Failed to load settings/status:", err)
      toast({
        title: "Error Loading Settings",
        description: err.message || "Could not load settings.",
        variant: "destructive",
      })
    } finally {
      setIsLoadingPaths(false)
      setIsCheckingDeps(false) // Assume check finished
    }
  }

  // Fetch current paths and status when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSettingsAndStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]) // Removed toast dependency

  // Listen for status updates pushed from main process
  useEffect(() => {
    if (!window.electronAPI) return // Guard if API not ready

    const removeDepListener = window.electronAPI.onDependenciesStatusUpdate(
      (status) => {
        console.log("SettingsModal: Received dependency status update:", status)
        setDepStatus(status)
        // Optionally re-fetch paths if needed, or assume they are consistent
      }
    )

    return () => {
      removeDepListener() // Cleanup on unmount
    }
  }, [])

  const handleSelectPath = async (type: "download" | "yt-dlp" | "ffmpeg") => {
    setIsSelecting(type)
    console.log(`SettingsModal: Requesting selection for ${type}...`)
    try {
      let selectedPath: string | null = null
      if (type === "download") {
        selectedPath = await window.electronAPI.selectDownloadPath()
      } else {
        selectedPath = await window.electronAPI.selectExecutablePath(type)
      }
      console.log(
        `SettingsModal: Path selection result for ${type}:`,
        selectedPath
      )
      if (selectedPath !== null) {
        // Path selected or reconfirmed (null if cancelled)
        // Refetch all paths and status after selection (or update state directly)
        fetchSettingsAndStatus() // Easiest way to update UI after change and re-check
        toast({ title: "Success", description: `${type} path updated.` })
      } else {
        console.log(`SettingsModal: Path selection cancelled for ${type}.`)
      }
    } catch (error: any) {
      console.error(`SettingsModal: Failed to select path for ${type}:`, error)
      toast({
        title: `Error Selecting ${type} Path`,
        description: error?.message || "An unknown error occurred.",
        variant: "destructive",
      })
    } finally {
      setIsSelecting(null)
    }
  }

  const handleRecheckDependencies = async () => {
    setIsCheckingDeps(true)
    try {
      await window.electronAPI.checkDependencies()
      // Status update will be pushed via the listener, no need to set state here
      toast({
        title: "Dependency Check Triggered",
        description: "Checking yt-dlp and ffmpeg...",
      })
    } catch (error: any) {
      console.error("SettingsModal: Failed to trigger dependency check:", error)
      toast({
        title: "Error",
        description: error?.message || "Could not start dependency check.",
        variant: "destructive",
      })
      setIsCheckingDeps(false) // Reset loading state on error
    }
    // setIsLoadingPaths(false) will be handled by the listener updating status
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {" "}
        {/* Increased width */}
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure download location and executable paths.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {" "}
          {/* Increased gap */}
          {/* Download Location */}
          <div className="space-y-1.5">
            <Label htmlFor="download-path">Download Location</Label>
            <div className="flex items-center gap-2">
              <Input
                id="download-path"
                value={
                  isLoadingPaths
                    ? "Loading..."
                    : settingsPaths.downloadPath || "Not set"
                }
                readOnly
                className="flex-grow text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleSelectPath("download")}
                disabled={isLoadingPaths || isSelecting !== null}
                title="Select Download Folder"
              >
                {isSelecting === "download" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderCog className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          {/* Executable Paths */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Executable Paths (Optional)
            </h3>
            {/* yt-dlp Path */}
            <div className="space-y-1.5">
              <Label htmlFor="ytdlp-path" className="flex items-center gap-2">
                yt-dlp Path
                {depStatus.checked &&
                  (depStatus.ytDlpOk ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ))}
                {isCheckingDeps && <Loader2 className="h-4 w-4 animate-spin" />}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ytdlp-path"
                  value={
                    isLoadingPaths
                      ? "Loading..."
                      : settingsPaths.ytDlpPath || "Using PATH"
                  }
                  readOnly
                  placeholder="Leave blank to use system PATH"
                  className="flex-grow text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleSelectPath("yt-dlp")}
                  disabled={isLoadingPaths || isSelecting !== null}
                  title="Select yt-dlp Executable"
                >
                  {isSelecting === "yt-dlp" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderSearch className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {!depStatus.ytDlpOk && depStatus.checked && (
                <p className="text-xs text-destructive">
                  Not found or invalid path.
                </p>
              )}
            </div>

            {/* ffmpeg Path */}
            <div className="space-y-1.5">
              <Label htmlFor="ffmpeg-path" className="flex items-center gap-2">
                ffmpeg Path
                {depStatus.checked &&
                  (depStatus.ffmpegOk ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ))}
                {isCheckingDeps && <Loader2 className="h-4 w-4 animate-spin" />}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ffmpeg-path"
                  value={
                    isLoadingPaths
                      ? "Loading..."
                      : settingsPaths.ffmpegPath || "Using PATH"
                  }
                  readOnly
                  placeholder="Leave blank to use system PATH"
                  className="flex-grow text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleSelectPath("ffmpeg")}
                  disabled={isLoadingPaths || isSelecting !== null}
                  title="Select ffmpeg Executable"
                >
                  {isSelecting === "ffmpeg" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderSearch className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {!depStatus.ffmpegOk && depStatus.checked && (
                <p className="text-xs text-destructive">
                  Not found or invalid path.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          {" "}
          {/* Align buttons */}
          <Button
            variant="outline"
            onClick={handleRecheckDependencies}
            disabled={isCheckingDeps || isSelecting !== null}
          >
            {isCheckingDeps ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Re-check Dependencies
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsModal
