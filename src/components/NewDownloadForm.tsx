// src/components/NewDownloadForm.tsx
import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch" // Import Switch
import { Checkbox } from "@/components/ui/checkbox" // Import Checkbox
import { ScrollArea } from "@/components/ui/scroll-area" // Import ScrollArea for playlist
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
import {
  Loader2,
  AlertTriangle,
  Download,
  ImageOff,
  ListVideo,
  Video,
} from "lucide-react" // Add ListVideo, Video
import type {
  DetailedFormat,
  DownloadOptions,
  DownloadResult,
  PlaylistItem,
  PlaylistDownloadOptions, // Import new types
} from "../../electron/preload"
import { Separator } from "./ui/separator"
import { cn } from "@/lib/utils"

interface NewDownloadFormProps {
  dependenciesOk: boolean
  onDownloadStarted?: (result: DownloadResult) => void // Maybe update this later if playlist needs different signal
}

// Helper to check if URL looks like a playlist
const isPlaylistUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.searchParams.has("list")
  } catch {
    return false // Invalid URL
  }
}

function NewDownloadForm({
  dependenciesOk,
  onDownloadStarted,
}: NewDownloadFormProps) {
  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<"single" | "playlist">("single") // 'single' or 'playlist'

  // Single Video State
  const [formats, setFormats] = useState<DetailedFormat[]>([])
  const [selectedFormat, setSelectedFormat] = useState<string>("")
  const [selectedOutputFormat, setSelectedOutputFormat] = useState<string>("")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [singleVideoThumbnailUrl, setSingleVideoThumbnailUrl] = useState<
    string | null
  >(null)
  const [singleVideoTitle, setSingleVideoTitle] = useState<string | null>(null)

  // Playlist State
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([])
  const [selectedPlaylistItems, setSelectedPlaylistItems] = useState<
    Set<string>
  >(new Set()) // Store selected IDs

  // Common State
  const [isLoading, setIsLoading] = useState(false) // Combined loading state
  const [isDownloading, setIsDownloading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const { toast } = useToast()
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const formContainerRef = useRef<HTMLDivElement>(null) // Ref for scrolling

  // --- Fetching Logic ---
  const fetchData = useCallback(
    async (fetchUrl: string) => {
      if (!dependenciesOk) {
        setFetchError("Dependencies missing/invalid.")
        setIsLoading(false) // Ensure loading stops if deps are bad
        return
      }
      if (!fetchUrl) return

      setIsLoading(true)
      setFetchError(null)
      // Clear previous results for BOTH modes
      setFormats([])
      setSelectedFormat("")
      setPlaylistItems([])
      setSelectedPlaylistItems(new Set())
      setSingleVideoThumbnailUrl(null)
      setSingleVideoTitle(null)

      try {
        if (!window.electronAPI) throw new Error("Backend API unavailable.")

        const looksLikePlaylist = isPlaylistUrl(fetchUrl)
        let currentMode = mode // Use local var to avoid race conditions with state update

        // Decide primary fetch target based on explicit mode or URL structure
        if (
          currentMode === "playlist" ||
          (currentMode === "single" && looksLikePlaylist)
        ) {
          try {
            console.log(`Form: Attempting fetch playlist: ${fetchUrl}`)
            const items = await window.electronAPI.fetchPlaylistVideos(fetchUrl)
            // It's definitely a playlist if this succeeds
            setPlaylistItems(items)
            setSelectedPlaylistItems(new Set(items.map((item) => item.id)))
            setMode("playlist") // Ensure mode is playlist
            currentMode = "playlist" // Update local var

            // Now fetch formats for the *first* video in the playlist to populate quality dropdown
            if (items.length > 0) {
              console.log(
                `Form: Fetching formats for first playlist item: ${items[0].url}`
              )
              try {
                const formatResult = await window.electronAPI.fetchFormats(
                  items[0].url
                )
                setFormats(formatResult.formats)
                // Set default quality based on these formats
                const defaultQuality =
                  formatResult.formats.find(
                    (f) => f.group === "Best Quality"
                  ) || formatResult.formats[0]
                setSelectedFormat(defaultQuality?.id || "")
              } catch (formatError) {
                console.error(
                  "Failed to fetch formats for playlist quality options:",
                  formatError
                )
                setFetchError("Could not fetch quality options for playlist.")
                // Keep playlist items, but quality selection might be broken
              }
            }
            setTimeout(
              () =>
                formContainerRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                }),
              100
            )
          } catch (playlistError: any) {
            // Playlist fetch failed, was it because it's a single video?
            if (
              mode === "single" &&
              playlistError.message?.includes("single video URL")
            ) {
              console.log("Playlist fetch failed, trying as single video...")
              const result = await window.electronAPI.fetchFormats(fetchUrl)
              if (result && result.formats.length > 0) {
                setFormats(result.formats)
                setSingleVideoThumbnailUrl(result.thumbnailUrl || null)
                setSingleVideoTitle(result.title || null)
                const defaultSelection =
                  result.formats.find((f) => f.group === "Best Quality") ||
                  result.formats[0]
                setSelectedFormat(defaultSelection?.id || "")
                setMode("single") // Ensure mode is single
                currentMode = "single"
              } else {
                throw new Error("No formats found for this URL.")
              }
            } else {
              // It wasn't a single video error, or mode was explicitly playlist - throw the error
              throw playlistError
            }
          }
        } else {
          // mode === 'single' and doesn't look like playlist
          console.log(`Form: Fetching single video formats: ${fetchUrl}`)
          const result = await window.electronAPI.fetchFormats(fetchUrl)
          if (result && result.formats.length > 0) {
            setFormats(result.formats)
            setSingleVideoThumbnailUrl(result.thumbnailUrl || null)
            setSingleVideoTitle(result.title || null)
            const defaultSelection =
              result.formats.find((f) => f.group === "Best Quality") ||
              result.formats[0]
            setSelectedFormat(defaultSelection?.id || "")
          } else {
            throw new Error("No formats found for this URL.")
          }
        }
      } catch (error: any) {
        console.error("Form: Error fetching data:", error)
        setFetchError(error.message || "Could not fetch video data.")
        // Clear all results on error
        setFormats([])
        setPlaylistItems([])
        setSelectedPlaylistItems(new Set())
        setSingleVideoThumbnailUrl(null)
        setSingleVideoTitle(null)
      } finally {
        setIsLoading(false)
      }
    },
    [dependenciesOk, mode]
  ) // Depend on mode

  // Debounced Fetch Trigger
  useEffect(() => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    if (!url || (!url.includes("youtube.com/") && !url.includes("youtu.be/"))) {
      setFormats([])
      setSelectedFormat("")
      setFetchError(null)
      setPlaylistItems([])
      setSelectedPlaylistItems(new Set())
      setSingleVideoThumbnailUrl(null)
      setSingleVideoTitle(null)
      setIsLoading(false)
      return
    }
    // Clear previous results immediately on new URL input before debounce
    setFormats([])
    setSelectedFormat("")
    setPlaylistItems([])
    setSelectedPlaylistItems(new Set())
    setSingleVideoThumbnailUrl(null)
    setSingleVideoTitle(null)
    setIsLoading(true)
    setFetchError("Checking URL...") // Indicate activity

    debounceTimeoutRef.current = setTimeout(() => {
      fetchData(url)
    }, 800)
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    }
  }, [url, fetchData]) // Depend on url and the fetchData callback

  // Reset state when mode changes via the switch
  useEffect(() => {
    setUrl("") // Clear URL on mode switch is good UX
    // Clear all results
    setFormats([])
    setSelectedFormat("")
    setPlaylistItems([])
    setSelectedPlaylistItems(new Set())
    setSingleVideoThumbnailUrl(null)
    setSingleVideoTitle(null)
    setFetchError(null)
    setIsLoading(false)
    setStartTime("")
    setEndTime("")
  }, [mode])

  // --- Playlist Item Selection ---
  const handlePlaylistItemToggle = (itemId: string, checked: boolean) => {
    setSelectedPlaylistItems((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(itemId)
      } else {
        newSet.delete(itemId)
      }
      return newSet
    })
  }
  const handleSelectAllPlaylistItems = (select: boolean) => {
    if (select) {
      setSelectedPlaylistItems(new Set(playlistItems.map((item) => item.id)))
    } else {
      setSelectedPlaylistItems(new Set())
    }
  }

  // --- Download Logic ---
  const handleDownload = async () => {
    if (!dependenciesOk) {
      toast({ title: "Deps Missing", variant: "destructive" })
      return
    }
    if (!url && (mode === "single" || playlistItems.length === 0)) {
      toast({ title: "URL Missing", variant: "destructive" })
      return
    } // Check url only if needed

    // Quality check is common
    if (!selectedFormat) {
      toast({
        title: "Quality Not Selected",
        description: "Please select a download quality.",
        variant: "destructive",
      })
      return
    }

    setIsDownloading(true)
    setFetchError(null)

    try {
      if (!window.electronAPI) throw new Error("Backend API unavailable.")

      if (mode === "single") {
        // Single video download logic (uses DownloadOptions)
        const options: DownloadOptions = {
          url: url,
          formatCode: selectedFormat,
          outputFormat:
            selectedOutputFormat === "default" || selectedOutputFormat === ""
              ? undefined
              : selectedOutputFormat,
          hasVideo: formats.find((f) => f.id === selectedFormat)?.hasVideo, // Get from loaded formats
          hasAudio: formats.find((f) => f.id === selectedFormat)?.hasAudio,
          startTime: startTime.trim() || undefined,
          endTime: endTime.trim() || undefined,
        }
        console.log("Form: Sending single download request:", options)
        const result = await window.electronAPI.downloadVideo(options)
        if (!result.success)
          throw new Error(result.message || "Failed to start download.")
        toast({ title: "Download Started", description: result.message })
      } else {
        // mode === 'playlist'
        // Playlist download logic (uses PlaylistDownloadOptions)
        const itemsToDownload = playlistItems.filter((item) =>
          selectedPlaylistItems.has(item.id)
        )
        if (itemsToDownload.length === 0) {
          toast({ title: "No Videos Selected", variant: "destructive" })
          throw new Error("No selection")
        }

        // Need to get hasVideo/hasAudio from the *shared* quality selection
        // Requires formats to be loaded (even if just from the first video)
        const selectedFormatDetails = formats.find(
          (f) => f.id === selectedFormat
        )
        if (!selectedFormatDetails) {
          // This might happen if formats failed to load for the playlist quality check
          toast({
            title: "Quality Info Missing",
            description:
              "Cannot determine video/audio type for selected quality.",
            variant: "destructive",
          })
          throw new Error("Quality info missing")
        }

        const commonOptions: PlaylistDownloadOptions = {
          formatCode: selectedFormat,
          outputFormat:
            selectedOutputFormat === "default" || selectedOutputFormat === ""
              ? undefined
              : selectedOutputFormat,
          hasVideo: selectedFormatDetails.hasVideo,
          hasAudio: selectedFormatDetails.hasAudio,
        }
        console.log(
          `Form: Sending playlist download request for ${itemsToDownload.length} items:`,
          commonOptions
        )
        const result = await window.electronAPI.downloadPlaylistItems(
          itemsToDownload,
          commonOptions
        )
        if (!result.success && failures > 0) {
          // Check if *any* failed
          toast({
            title: "Playlist Download Issue",
            description: result.message,
            variant: "warning",
          }) // Use warning if some failed
        } else if (!result.success) {
          // All failed to start
          throw new Error(
            result.message || "Failed to start playlist download."
          )
        } else {
          // All started successfully
          toast({
            title: "Playlist Download Started",
            description: result.message,
          })
        }
      }

      // Reset form on successful *initiation* (for both modes)
      setUrl("")
      setStartTime("")
      setEndTime("")
      setFormats([])
      setSelectedFormat("")
      setSelectedOutputFormat("")
      setFetchError(null)
      setSingleVideoThumbnailUrl(null)
      setSingleVideoTitle(null)
      setPlaylistItems([])
      setSelectedPlaylistItems(new Set())
      // Signal download process started (generic)
      if (onDownloadStarted)
        onDownloadStarted({ success: true, message: "Download(s) initiated." })
    } catch (error: any) {
      // Avoid double toasts for specific handled errors
      if (
        error.message !== "No selection" &&
        error.message !== "Quality info missing"
      ) {
        console.error("Form: Download error:", error)
        setFetchError(`Download failed: ${error.message || "Unknown error"}`)
        toast({
          title: "Download Failed",
          description: error.message || "Unknown error",
          variant: "destructive",
        })
      }
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div
      ref={formContainerRef}
      className="p-4 border-b border-border flex-shrink-0 bg-muted/30 mb-3 scroll-mt-4"
    >
      <div className="flex flex-col gap-4">
        {/* Mode Switch and URL */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex items-center space-x-2 flex-shrink-0 pt-1.5">
            <Video
              className={cn(
                "h-5 w-5",
                mode === "single" ? "text-primary" : "text-muted-foreground"
              )}
            />
            <Switch
              id="mode-switch"
              checked={mode === "playlist"}
              onCheckedChange={(checked) =>
                setMode(checked ? "playlist" : "single")
              }
              disabled={isLoading || isDownloading}
              aria-label="Toggle between single video and playlist mode"
            />
            <ListVideo
              className={cn(
                "h-5 w-5",
                mode === "playlist" ? "text-primary" : "text-muted-foreground"
              )}
            />
          </div>
          <div className="space-y-1.5 flex-grow w-full">
            <Label htmlFor="url-input">
              {mode === "single" ? "Video URL" : "Playlist URL"}
            </Label>
            <Input
              id="url-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={`Paste ${
                mode === "single" ? "Video" : "Playlist"
              } URL...`}
              disabled={isLoading || isDownloading}
              className={cn(
                "h-9",
                fetchError && !isLoading && !!url ? "border-destructive" : ""
              )}
            />
          </div>
        </div>

        {/* Single Video Preview (Conditional) */}
        {mode === "single" &&
          (singleVideoTitle ||
            singleVideoThumbnailUrl ||
            (isLoading && url && dependenciesOk)) && (
            <div
              className={cn(
                "flex gap-3 items-center bg-background/50 p-2 rounded-md border border-border/50 mb-1 min-h-[65px]",
                isLoading && "opacity-70 animate-pulse"
              )}
            >
              <div className="w-24 h-[56.25px] flex items-center justify-center bg-secondary rounded shrink-0 border relative overflow-hidden">
                {singleVideoThumbnailUrl ? (
                  <img
                    src={singleVideoThumbnailUrl}
                    alt="Thumbnail"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement
                      img.style.display = "none"
                      const p = img.nextElementSibling
                      if (p) (p as HTMLElement).style.display = "flex"
                    }}
                  />
                ) : (
                  <ImageOff className="w-6 h-6 text-muted-foreground" />
                )}
                <div
                  style={{ display: singleVideoThumbnailUrl ? "none" : "flex" }}
                  className="absolute inset-0 w-full h-full items-center justify-center bg-secondary"
                >
                  <ImageOff className="w-6 h-6 text-muted-foreground" />
                </div>
              </div>
              <div className="flex-grow">
                {singleVideoTitle ? (
                  <p
                    className="text-sm font-medium leading-tight line-clamp-2"
                    title={singleVideoTitle}
                  >
                    {singleVideoTitle}
                  </p>
                ) : isLoading ? (
                  <p className="text-sm text-muted-foreground italic">
                    Loading title...
                  </p>
                ) : null}
              </div>
            </div>
          )}

        {/* Options Row (Common for Quality/Output, conditional for time) */}
        {/* Render options row only if URL is entered or formats/items exist */}
        {(url || formats.length > 0 || playlistItems.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
            {/* Quality (Needed for both modes) */}
            <div className="space-y-1.5">
              <Label htmlFor="quality">Quality</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedFormat}
                  onValueChange={setSelectedFormat}
                  disabled={
                    !dependenciesOk ||
                    isLoading ||
                    isDownloading ||
                    formats.length === 0
                  }
                >
                  <SelectTrigger id="quality" className="flex-1 truncate h-9">
                    <SelectValue
                      placeholder={
                        isLoading
                          ? "Loading..."
                          : !dependenciesOk
                          ? "Deps missing"
                          : formats.length === 0
                          ? "No formats yet"
                          : "Select quality..."
                      }
                    >
                      <span>
                        {formats.find((f) => f.id === selectedFormat)?.label ??
                          (isLoading
                            ? "Loading..."
                            : formats.length === 0
                            ? "No formats yet"
                            : "Select quality...")}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[var(--radix-select-content-available-height)] overflow-y-auto">
                    {formats.length > 0 && (
                      <>
                        {formats
                          .filter((f) => f.group === "Best Quality")
                          .map((format) => (
                            <SelectItem
                              key={format.id}
                              value={format.id}
                              title={format.label}
                            >
                              🌟 {format.label}
                            </SelectItem>
                          ))}
                        {formats.filter(
                          (f) => f.group === "Video + Audio (Single File)"
                        ).length > 0 && (
                          <SelectGroup>
                            <SelectLabel>
                              Video + Audio (Single File)
                            </SelectLabel>
                            {formats
                              .filter(
                                (f) => f.group === "Video + Audio (Single File)"
                              )
                              .map((format) => (
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
                        {formats.filter(
                          (f) =>
                            f.group === "Video + Best Audio (Requires Merge)"
                        ).length > 0 && (
                          <SelectGroup>
                            <SelectLabel>
                              Video + Best Audio (Requires Merge)
                            </SelectLabel>
                            {formats
                              .filter(
                                (f) =>
                                  f.group ===
                                  "Video + Best Audio (Requires Merge)"
                              )
                              .map((format) => (
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
                        {formats.filter((f) => f.group === "Video Only")
                          .length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Video Only</SelectLabel>
                            {formats
                              .filter((f) => f.group === "Video Only")
                              .map((format) => (
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
                        {formats.filter((f) => f.group === "Audio Only")
                          .length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Audio Only</SelectLabel>
                            {formats
                              .filter((f) => f.group === "Audio Only")
                              .map((format) => (
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
                      !isLoading &&
                      url &&
                      dependenciesOk && (
                        <SelectItem value="-" disabled>
                          No formats available
                        </SelectItem>
                      )}
                    {formats.length === 0 && isLoading && (
                      <SelectItem value="-" disabled>
                        Loading formats...
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {/* Keep loader outside Select */}
                {isLoading && dependenciesOk && (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                )}
              </div>
            </div>

            {/* Output Format (Needed for both modes) */}
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
                  isLoading ||
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
                  <SelectItem value="default">
                    Default (match quality)
                  </SelectItem>
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

            {/* Start Time (Single Mode Only) */}
            <div
              className={cn(
                "space-y-1.5",
                mode === "playlist" && "opacity-50 pointer-events-none"
              )}
            >
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
                disabled={mode === "playlist" || isLoading || isDownloading}
                className="h-9 text-sm"
              />
            </div>

            {/* End Time (Single Mode Only) */}
            <div
              className={cn(
                "space-y-1.5",
                mode === "playlist" && "opacity-50 pointer-events-none"
              )}
            >
              <Label
                htmlFor="end-time"
                className="text-xs text-muted-foreground"
              >
                End Time (Opt.)
              </Label>
              <Input
                id="end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="e.g., 1:30"
                disabled={mode === "playlist" || isLoading || isDownloading}
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}

        {/* Playlist Items List (Conditional) */}
        {mode === "playlist" && playlistItems.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex justify-between items-center px-1">
              <Label className="text-sm font-medium">
                Playlist Videos ({selectedPlaylistItems.size} /{" "}
                {playlistItems.length} selected)
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectAllPlaylistItems(true)}
                  disabled={isLoading || isDownloading}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleSelectAllPlaylistItems(false)}
                  disabled={isLoading || isDownloading}
                >
                  Deselect All
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[200px] border rounded-md bg-background/30">
              {" "}
              {/* Max height + scroll */}
              <div className="p-2 space-y-1">
                {playlistItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`item-${item.id}`}
                      checked={selectedPlaylistItems.has(item.id)}
                      onCheckedChange={(checked) =>
                        handlePlaylistItemToggle(item.id, !!checked)
                      }
                      disabled={isLoading || isDownloading}
                      aria-labelledby={`label-${item.id}`}
                    />
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="w-12 aspect-video h-auto rounded object-cover border shrink-0"
                      />
                    )}
                    <label
                      id={`label-${item.id}`}
                      htmlFor={`item-${item.id}`}
                      className="text-xs line-clamp-2 flex-grow cursor-pointer"
                      title={item.title}
                    >
                      {" "}
                      {item.title}{" "}
                    </label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Status and Download Button Row */}
        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="flex-grow min-h-[20px] pr-4">
            {fetchError && !isLoading ? (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p className="leading-tight">{fetchError}</p>
              </div>
            ) : null}
          </div>
          <Button
            onClick={handleDownload}
            disabled={
              !dependenciesOk ||
              isLoading ||
              isDownloading ||
              (!url && mode === "single" && playlistItems.length === 0) ||
              !selectedFormat ||
              (mode === "playlist" && selectedPlaylistItems.size === 0) ||
              (!!fetchError && !isLoading)
            }
            className="h-9 min-w-[150px] shrink-0" // Slightly wider button
          >
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isDownloading
              ? "Starting..."
              : mode === "playlist"
              ? `Download ${selectedPlaylistItems.size} Video${
                  selectedPlaylistItems.size !== 1 ? "s" : ""
                }`
              : "Download Video"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default NewDownloadForm
