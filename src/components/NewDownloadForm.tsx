// src/components/NewDownloadForm.tsx
import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Loader2, AlertTriangle, Download } from "lucide-react"
import type {
  DetailedFormat,
  DownloadOptions,
  DownloadResult,
} from "../../electron/preload" // Adjust path if needed
import { Separator } from "./ui/separator"
import { cn } from "@/lib/utils" // Import cn

interface NewDownloadFormProps {
  dependenciesOk: boolean
  onDownloadStarted?: (result: DownloadResult) => void
}

function NewDownloadForm({
  dependenciesOk,
  onDownloadStarted,
}: NewDownloadFormProps) {
  const [url, setUrl] = useState("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [formats, setFormats] = useState<DetailedFormat[]>([])
  const [selectedFormat, setSelectedFormat] = useState<string>("")
  const [selectedOutputFormat, setSelectedOutputFormat] = useState<string>("")
  const [isFetchingFormats, setIsFetchingFormats] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const { toast } = useToast()
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // --- Callbacks and Effects ---
  const fetchVideoFormats = useCallback(
    async (videoUrl: string) => {
      if (
        !videoUrl ||
        (!videoUrl.includes("youtube.com/") && !videoUrl.includes("youtu.be/"))
      ) {
        setFormats([])
        setSelectedFormat("")
        setFetchError(null)
        return // Exit if URL is invalid/empty
      }
      if (!dependenciesOk) {
        // Don't clear formats if deps are missing, just show error
        setFetchError("Dependencies (yt-dlp) missing or invalid.")
        setIsFetchingFormats(false)
        return
      }

      console.log(`Form: Debounced fetch for detailed formats: ${videoUrl}`)
      setIsFetchingFormats(true)
      setFetchError(null) // Clear previous errors
      setFormats([]) // Clear formats while fetching
      setSelectedFormat("") // Reset selection

      try {
        if (!window.electronAPI)
          throw new Error("Backend API is not available.")
        const fetchedFormats: DetailedFormat[] =
          await window.electronAPI.fetchFormats(videoUrl)
        console.log("Form: Received detailed formats:", fetchedFormats)

        if (fetchedFormats && fetchedFormats.length > 0) {
          const safeFormats = Array.isArray(fetchedFormats)
            ? fetchedFormats
            : []
          setFormats(safeFormats)
          // Set default selection
          const defaultSelection =
            safeFormats.find((f) => f.group === "Best") ||
            safeFormats.find((f) => f.group === "Video+Audio (Direct)") ||
            safeFormats.find((f) => f.group === "Video+Audio (Combined)") ||
            safeFormats[0]
          setSelectedFormat(defaultSelection ? defaultSelection.id : "")
        } else {
          setFetchError("No formats found for this URL.")
          setFormats([])
        }
      } catch (error: any) {
        console.error("Form: Error fetching detailed formats:", error)
        const errorMessage = error?.message || "Could not fetch video formats."
        setFetchError(errorMessage)
        // No toast here, error is displayed inline
        setFormats([])
      } finally {
        setIsFetchingFormats(false)
      }
    },
    [dependenciesOk] // Dependency: re-run if dependenciesOk changes
  )

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    if (!url || (!url.includes("youtube.com/") && !url.includes("youtu.be/"))) {
      // Clear formats and error if URL becomes invalid/empty
      setFormats([])
      setSelectedFormat("")
      setFetchError(null)
      setIsFetchingFormats(false)
      return
    }

    // Show loading/checking state immediately if deps are OK
    if (dependenciesOk) {
      setIsFetchingFormats(true)
      setFetchError("Checking URL...") // Indicate activity
    } else {
      // Show dependency error clearly
      setFetchError("Dependencies missing/invalid. Cannot fetch formats.")
      setIsFetchingFormats(false)
      setFormats([]) // Clear formats if deps are bad
      setSelectedFormat("")
      return // Don't debounce if deps are bad
    }

    // Start debounce timer
    debounceTimeoutRef.current = setTimeout(() => {
      fetchVideoFormats(url)
    }, 800) // 800ms debounce

    // Cleanup function
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [url, fetchVideoFormats, dependenciesOk]) // Re-run if URL, fetch function, or dep status changes

  const handleDownload = async () => {
    if (!dependenciesOk) {
      toast({
        title: "Dependencies Missing",
        description: "Cannot download, check settings.",
        variant: "destructive",
      })
      return
    }
    if (!url || (!url.includes("youtube.com/") && !url.includes("youtu.be/"))) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid YouTube URL.",
        variant: "destructive",
      })
      return
    }
    if (!selectedFormat) {
      toast({
        title: "Quality Not Selected",
        description: "Please select a download quality.",
        variant: "destructive",
      })
      return
    }

    setIsDownloading(true)
    setFetchError(null) // Clear errors before attempting download

    const selectedFormatDetails = formats.find((f) => f.id === selectedFormat)
    const options: DownloadOptions = {
      url: url,
      formatCode: selectedFormat,
      // Check if selectedOutputFormat is "default" or empty, pass undefined if so
      outputFormat:
        selectedOutputFormat === "default" || selectedOutputFormat === ""
          ? undefined
          : selectedOutputFormat,
      hasVideo: selectedFormatDetails?.hasVideo,
      hasAudio: selectedFormatDetails?.hasAudio,
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
    }

    try {
      if (!window.electronAPI) throw new Error("Backend API is not available.")
      console.log("Form: Sending download request:", options) // Log the actual options sent
      const result = (await window.electronAPI.downloadVideo(
        options
      )) as DownloadResult
      console.log("Form: Download request response:", result)
      if (result.success) {
        toast({
          title: "Download Started",
          description: result.message || `Download for ${url} initiated.`,
        })
        if (onDownloadStarted) onDownloadStarted(result)
        // Reset form fields after successful start
        setUrl("")
        setStartTime("")
        setEndTime("")
        setFormats([])
        setSelectedFormat("")
        setSelectedOutputFormat("") // Reset to empty string which corresponds to "default" visually
        setFetchError(null)
      } else {
        // Throw error to be caught below if backend reports failure
        throw new Error(result.message || "Failed to start download.")
      }
    } catch (error: any) {
      console.error("Form: Download error:", error)
      const errorMessage = error?.message || "An unknown error occurred."
      // Display error inline instead of just toast
      setFetchError(`Download failed: ${errorMessage}`)
      toast({
        title: "Download Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsDownloading(false) // Reset download button state
    }
  }
  // --- End Callbacks and Effects ---

  // Group formats for display
  const bestFormats = formats.filter((f) => f.group === "Best")
  const directCombinedFormats = formats.filter(
    (f) => f.group === "Video+Audio (Direct)"
  )
  const generatedCombinedFormats = formats.filter(
    (f) => f.group === "Video+Audio (Combined)"
  )
  const audioOnlyFormats = formats.filter((f) => f.group === "Audio Only")

  return (
    // Add bottom margin for spacing, keep padding
    <div className="p-4 border-b border-border flex-shrink-0 bg-muted/30 mb-3">
      {/* Use flex column layout */}
      <div className="flex flex-col gap-3">
        {/* Row 1: URL Input */}
        <div className="space-y-1.5">
          <Label htmlFor="url-input">Video URL</Label>
          <Input
            id="url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube URL here..."
            disabled={isDownloading}
            className={cn(
              "h-9", // Standard input height
              fetchError && !isFetchingFormats && !!url
                ? "border-destructive focus-visible:ring-destructive"
                : ""
            )}
          />
        </div>

        {/* Row 2: Quality, Output, Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          {/* Quality */}
          <div className="space-y-1.5">
            <Label htmlFor="quality">Quality</Label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedFormat}
                onValueChange={setSelectedFormat}
                disabled={
                  !dependenciesOk ||
                  isFetchingFormats ||
                  isDownloading ||
                  (formats.length === 0 && !!url)
                }
              >
                <SelectTrigger id="quality" className="flex-1 truncate h-9">
                  <SelectValue
                    placeholder={
                      isFetchingFormats
                        ? "Loading..."
                        : !dependenciesOk
                        ? "Deps missing"
                        : !url
                        ? "Enter URL first"
                        : "Select quality..."
                    }
                  >
                    <span>
                      {formats.find((f) => f.id === selectedFormat)?.label ??
                        (isFetchingFormats
                          ? "Loading..."
                          : !url
                          ? "Enter URL first"
                          : "Select quality...")}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* Format Options */}
                  {formats.length > 0 && (
                    <>
                      {bestFormats.map((format) => (
                        <SelectItem
                          key={format.id}
                          value={format.id}
                          title={format.label}
                        >
                          🌟 {format.label}
                        </SelectItem>
                      ))}
                      {directCombinedFormats.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Video + Audio (Direct)</SelectLabel>
                          {directCombinedFormats.map((format) => (
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
                      {generatedCombinedFormats.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Video + Audio (Combined)</SelectLabel>
                          {generatedCombinedFormats.map((format) => (
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
                    </>
                  )}
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
              {isFetchingFormats && dependenciesOk && (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
              )}
            </div>
          </div>

          {/* Output Format */}
          <div className="space-y-1.5">
            <Label
              htmlFor="output-format"
              className="text-xs text-muted-foreground"
            >
              Output Format (Opt.)
            </Label>
            <Select
              value={selectedOutputFormat}
              onValueChange={setSelectedOutputFormat}
              disabled={
                !selectedFormat ||
                !dependenciesOk ||
                isFetchingFormats ||
                isDownloading
              }
            >
              <SelectTrigger
                id="output-format"
                className="flex-1 truncate h-9 text-sm"
              >
                <SelectValue placeholder="Default">
                  {selectedOutputFormat === "default"
                    ? "Default"
                    : selectedOutputFormat || "Default"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (match quality)</SelectItem>
                <Separator />
                <SelectGroup>
                  <SelectLabel>Video Containers</SelectLabel>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="mkv">MKV</SelectItem>
                  <SelectItem value="webm">WebM</SelectItem>
                </SelectGroup>
                <Separator />
                <SelectGroup>
                  <SelectLabel>Audio Formats</SelectLabel>
                  <SelectItem value="mp3">MP3</SelectItem>
                  <SelectItem value="aac">AAC</SelectItem>
                  <SelectItem value="m4a">M4A</SelectItem>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="flac">FLAC</SelectItem>
                  <SelectItem value="wav">WAV</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Start Time */}
          <div className="space-y-1.5">
            <Label
              htmlFor="start-time"
              className="text-xs text-muted-foreground"
            >
              Start Time (Opt.)
            </Label>
            <Input
              id="start-time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="0:00"
              disabled={isDownloading}
              className="h-9 text-sm"
            />
          </div>

          {/* End Time */}
          <div className="space-y-1.5">
            <Label htmlFor="end-time" className="text-xs text-muted-foreground">
              End Time (Opt.)
            </Label>
            <Input
              id="end-time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="e.g., 1:30"
              disabled={isDownloading}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Row 3: Status and Download Button */}
        <div className="flex items-center justify-between gap-4 pt-1">
          {/* Status/Error Message Area */}
          <div className="flex-grow min-h-[20px] pr-4">
            {" "}
            {/* Reserve space and add padding */}
            {fetchError && !isFetchingFormats ? (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <p className="leading-tight">{fetchError}</p>
              </div>
            ) : null}
          </div>

          {/* Download Button */}
          <Button
            onClick={handleDownload}
            disabled={
              !dependenciesOk ||
              isFetchingFormats ||
              isDownloading ||
              !url ||
              !selectedFormat ||
              (!!fetchError && !isFetchingFormats)
            }
            className="h-9 min-w-[120px] shrink-0" // Ensure button has min width
          >
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isDownloading ? "Starting..." : "Download"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default NewDownloadForm
