// src/components/modals/NewDownloadModal.tsx
import { useState, useEffect, useCallback, useRef } from "react"
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
import {
  Select,
  SelectContent,
  SelectGroup, // Import SelectGroup
  SelectItem,
  SelectLabel, // Import SelectLabel
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast" // Ensure this path is correct
import { Loader2, AlertTriangle } from "lucide-react"
// Import the detailed format type
import type {
  DetailedFormat,
  DownloadOptions,
  DownloadResult,
} from "../../../electron/preload" // Adjust path if needed

interface NewDownloadModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onDownloadStarted?: (result: DownloadResult) => void
  dependenciesOk: boolean // Receive dependency status
}

function NewDownloadModal({
  isOpen,
  onOpenChange,
  onDownloadStarted,
  dependenciesOk, // Destructure prop
}: NewDownloadModalProps) {
  const [url, setUrl] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [formats, setFormats] = useState<DetailedFormat[]>([]) // State holds the detailed list
  const [selectedFormat, setSelectedFormat] = useState<string>("") // State holds the selected format ID(s) string
  const [selectedOutputFormat, setSelectedOutputFormat] = useState<string>("") // New state for output format
  const [isFetchingFormats, setIsFetchingFormats] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const { toast } = useToast()
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setUrl("")
      setStartTime("")
      setEndTime("")
      setFormats([])
      setSelectedFormat("")
      setSelectedOutputFormat("") // Reset output format
      setIsFetchingFormats(false)
      setIsDownloading(false)
      setFetchError(null)
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    }
  }, [isOpen])

  // Debounced format fetching function (expects detailed format from backend)
  const fetchVideoFormats = useCallback(
    async (videoUrl: string) => {
      if (
        !videoUrl ||
        (!videoUrl.includes("youtube.com/") && !videoUrl.includes("youtu.be/"))
      ) {
        setFormats([])
        setSelectedFormat("")
        setFetchError(null)
        return
      }
      if (!dependenciesOk) {
        setFetchError("Dependencies (yt-dlp) missing or invalid.")
        setFormats([])
        setSelectedFormat("")
        setIsFetchingFormats(false)
        return
      }

      console.log(`Modal: Debounced fetch for detailed formats: ${videoUrl}`)
      setIsFetchingFormats(true)
      setFetchError(null)
      setFormats([])
      setSelectedFormat("")

      try {
        if (!window.electronAPI)
          throw new Error("Backend API is not available.")
        const fetchedFormats: DetailedFormat[] =
          await window.electronAPI.fetchFormats(videoUrl)
        console.log("Modal: Received detailed formats:", fetchedFormats)

        if (fetchedFormats && fetchedFormats.length > 0) {
          const safeFormats = Array.isArray(fetchedFormats)
            ? fetchedFormats
            : []
          setFormats(safeFormats)
          // Set default selection: Prioritize 'Best', then first 'Video+Audio (Direct)', then first 'Video+Audio (Combined)', then first overall
          const defaultSelection =
            safeFormats.find((f) => f.group === "Best") ||
            safeFormats.find((f) => f.group === "Video+Audio (Direct)") ||
            safeFormats.find((f) => f.group === "Video+Audio (Combined)") ||
            safeFormats[0] // Fallback to the very first format
          setSelectedFormat(
            defaultSelection ? defaultSelection.id : safeFormats[0]?.id || ""
          )
        } else {
          setFetchError("No formats found or returned for this video.")
          setFormats([])
          setSelectedFormat("")
        }
      } catch (error: any) {
        console.error("Modal: Error fetching detailed formats:", error)
        const errorMessage = error?.message || "Could not fetch video formats."
        setFetchError(errorMessage)
        toast({
          title: "Error Fetching Formats",
          description: errorMessage,
          variant: "destructive",
        })
        setFormats([])
        setSelectedFormat("")
      } finally {
        setIsFetchingFormats(false)
      }
    },
    [toast, dependenciesOk]
  ) // Include dependencies

  // Effect to trigger debounced fetch
  useEffect(() => {
    if (!isOpen || !url) {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
      setFormats([])
      setSelectedFormat("")
      setFetchError(null)
      setIsFetchingFormats(false)
      return
    }

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)

    if (dependenciesOk) {
      setIsFetchingFormats(true)
      setFetchError("Checking URL...")
    } else {
      setFetchError("Dependencies missing/invalid. Cannot fetch formats.")
      setIsFetchingFormats(false)
      setFormats([])
      setSelectedFormat("")
      return
    }

    debounceTimeoutRef.current = setTimeout(() => {
      fetchVideoFormats(url)
    }, 800) // Debounce time

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    }
  }, [url, fetchVideoFormats, isOpen, dependenciesOk]) // Add dependencies

  // Handle Download Button Click
  const handleDownload = async () => {
    if (!dependenciesOk) {
      toast({ title: "Dependencies Missing", variant: "destructive" })
      return
    }
    if (!url || (!url.includes("youtube.com/") && !url.includes("youtu.be/"))) {
      toast({ title: "Invalid URL", variant: "destructive" })
      return
    }
    if (!selectedFormat) {
      toast({ title: "Quality Not Selected", variant: "destructive" })
      return
    }

    setIsDownloading(true)
    setFetchError(null)

    // Find the selected format details
    const selectedFormatDetails = formats.find((f) => f.id === selectedFormat)

    const options: DownloadOptions = {
      url: url,
      formatCode: selectedFormat, // Pass the selected format ID(s) string
      outputFormat: selectedOutputFormat || undefined, // Pass the selected output format
      hasVideo: selectedFormatDetails?.hasVideo, // Pass hasVideo
      hasAudio: selectedFormatDetails?.hasAudio, // Pass hasAudio
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
    }

    try {
      if (!window.electronAPI) throw new Error("Backend API is not available.")
      console.log("Modal: Sending download request:", options)
      const result = (await window.electronAPI.downloadVideo(
        options
      )) as DownloadResult // Cast to DownloadResult
      console.log("Modal: Download request response:", result)
      if (result.success) {
        toast({
          title: "Download Started",
          description: result.message || `Downloading ${url}`,
        })
        if (onDownloadStarted) onDownloadStarted(result)
        onOpenChange(false) // Close modal on successful start
      } else {
        throw new Error(result.message || "Failed to start download.")
      }
    } catch (error: any) {
      console.error("Modal: Download error:", error)
      const errorMessage = error?.message || "An unknown error occurred."
      setFetchError(`Download failed: ${errorMessage}`)
      toast({
        title: "Download Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  // Group formats for display in Select component based on the new refined groups
  const bestFormats = formats.filter((f) => f.group === "Best")
  const directCombinedFormats = formats.filter(
    (f) => f.group === "Video+Audio (Direct)"
  )
  const generatedCombinedFormats = formats.filter(
    (f) => f.group === "Video+Audio (Combined)"
  )
  const audioOnlyFormats = formats.filter((f) => f.group === "Audio Only")

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px]">
        {" "}
        {/* Adjusted width */}
        <DialogHeader>
          <DialogTitle>New Download</DialogTitle>
          <DialogDescription>
            Paste YouTube URL. Optionally clip time & select quality.
          </DialogDescription>
        </DialogHeader>
        {/* Form Fields */}
        <div className="grid gap-4 py-4">
          {/* URL Input */}
          <div className="space-y-1.5">
            <Label htmlFor="url-input">Video URL</Label>
            <Input
              id="url-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={isDownloading}
              className={
                fetchError && !isFetchingFormats
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }
            />
          </div>

          {/* Time Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              {" "}
              <Label htmlFor="start-time">Start Time (Optional)</Label>{" "}
              <Input
                id="start-time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="e.g., 0:15 or 1:30:05"
                disabled={isDownloading}
              />{" "}
            </div>
            <div className="space-y-1.5">
              {" "}
              <Label htmlFor="end-time">End Time (Optional)</Label>{" "}
              <Input
                id="end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="e.g., 0:45 or 2:10:00"
                disabled={isDownloading}
              />{" "}
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            {" "}
            Format: HH:MM:SS, MM:SS, or SS.{" "}
          </p>

          {/* Quality Select (Using Detailed Formats and Grouping) */}
          <div className="space-y-1.5">
            <Label htmlFor="quality">Quality</Label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedFormat} // Value is the format ID(s) string
                onValueChange={setSelectedFormat} // Updates the selected ID string
                disabled={
                  !dependenciesOk ||
                  isFetchingFormats ||
                  isDownloading ||
                  formats.length === 0
                }
              >
                <SelectTrigger id="quality" className="flex-1 truncate">
                  {" "}
                  {/* Truncate long labels */}
                  {/* Display the label of the selected format ID */}
                  <SelectValue
                    placeholder={
                      isFetchingFormats
                        ? "Loading..."
                        : !dependenciesOk
                        ? "Dependencies missing"
                        : "Select quality..."
                    }
                  >
                    {/* Wrap the text content in a span */}
                    <span>
                      {formats.find((f) => f.id === selectedFormat)?.label ??
                        (isFetchingFormats
                          ? "Loading..."
                          : "Select quality...")}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* Render Best Option(s) */}
                  {bestFormats.length > 0 &&
                    bestFormats.map((format) => (
                      <SelectItem
                        key={format.id}
                        value={format.id}
                        title={format.label}
                      >
                        🌟 {format.label}
                      </SelectItem>
                    ))}

                  {/* Render Direct Combined Group */}
                  {directCombinedFormats.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Video + Audio (Direct)</SelectLabel>
                      {directCombinedFormats.map((format) => (
                        // Set value to the format ID, display the user-friendly label
                        <SelectItem
                          key={format.id}
                          value={format.id}
                          title={format.label}
                        >
                          {format.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Render Generated Combined Group */}
                  {generatedCombinedFormats.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Video + Audio (Combined)</SelectLabel>
                      {generatedCombinedFormats.map((format) => (
                        // Set value to the combined format ID (e.g., "137+140")
                        <SelectItem
                          key={format.id}
                          value={format.id}
                          title={format.label}
                        >
                          {format.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Render Audio Only Group */}
                  {audioOnlyFormats.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Audio Only</SelectLabel>
                      {audioOnlyFormats.map((format) => (
                        <SelectItem
                          key={format.id}
                          value={format.id}
                          title={format.label}
                        >
                          {format.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Handle empty/loading state */}
                  {formats.length === 0 &&
                    !isFetchingFormats &&
                    url &&
                    dependenciesOk && (
                      <SelectItem value="-" disabled>
                        No formats available
                      </SelectItem>
                    )}
                  {formats.length === 0 && isFetchingFormats && (
                    <SelectItem value="-" disabled>
                      Loading formats...
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {/* Show loader only if fetching and dependencies are OK */}
              {isFetchingFormats && dependenciesOk && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Output Format Select */}
          <div className="space-y-1.5">
            <Label htmlFor="output-format">Output Format</Label>
            <Select
              value={selectedOutputFormat}
              onValueChange={setSelectedOutputFormat}
              disabled={
                !dependenciesOk ||
                isFetchingFormats ||
                isDownloading ||
                formats.length === 0
              }
            >
              <SelectTrigger id="output-format" className="flex-1 truncate">
                <SelectValue placeholder="Select output format...">
                  {selectedOutputFormat || "Select output format..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {/* Basic list of common formats */}
                <SelectItem value="mp4">MP4 (Video)</SelectItem>
                <SelectItem value="mkv">MKV (Video)</SelectItem>
                <SelectItem value="webm">WebM (Video)</SelectItem>
                <SelectItem value="mp3">MP3 (Audio)</SelectItem>
                <SelectItem value="aac">AAC (Audio)</SelectItem>
                <SelectItem value="opus">Opus (Audio)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Error/Warning Display */}
          {(fetchError && !isFetchingFormats) || !dependenciesOk ? (
            <div className="flex items-center gap-2 text-sm text-destructive px-1">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <p>
                {!dependenciesOk
                  ? "Dependencies missing/invalid. Check Settings."
                  : fetchError}
              </p>
            </div>
          ) : null}
        </div>
        {/* Dialog Footer */}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDownloading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDownload}
            // Ensure download button is disabled if no format is selected or fetching/error state
            disabled={
              !dependenciesOk ||
              isFetchingFormats ||
              isDownloading ||
              !url ||
              !selectedFormat ||
              !!fetchError
            }
          >
            <>
              {" "}
              {/* Wrap content in a fragment */}
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isDownloading ? "Downloading..." : "Download"}
            </>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NewDownloadModal
