// src/components/DownloadList.tsx
import { JSX } from "react"
import { cn } from "@/lib/utils" // For conditional classes
import { Progress } from "@/components/ui/progress" // Shadcn Progress bar
import { Button } from "@/components/ui/button" // Shadcn Button
import {
  AlertCircle,
  CheckCircle2,
  DownloadCloud,
  Hourglass,
  FolderOpen,
  Trash2,
  RotateCcw,
  Copy,
  FileQuestion,
} from "lucide-react" // Icons
// Ensure this path correctly points to where your types are defined or exported from preload
import type { DownloadItem } from "../../electron/preload"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip" // Shadcn Tooltip

// Props expected from App.tsx
interface DownloadListProps {
  downloads: DownloadItem[]
  onRemoveItem: (itemId: string) => void
  onOpenFolder: (filePath: string | undefined) => void
  onRetry: (item: DownloadItem) => void // Pass full item for retry context
}

function DownloadList({
  downloads,
  onRemoveItem,
  onOpenFolder,
  onRetry,
}: DownloadListProps) {
  // Guard against non-array downloads prop or empty list
  if (!Array.isArray(downloads) || downloads.length === 0) {
    return (
      <p className="text-muted-foreground px-4 text-sm pt-4 text-center">
        No downloads yet.
      </p>
    )
  }

  // Helper to render status icon and associated text color class
  const renderStatus = (
    item: DownloadItem
  ): { icon: JSX.Element; textClass: string; text: string } => {
    const progressPercent =
      typeof item.progress === "number" ? Math.round(item.progress) : 0 // Round progress
    switch (item.status) {
      case "pending":
        return {
          icon: <Hourglass className="h-3 w-3 mr-1.5 text-blue-500 shrink-0" />,
          textClass: "text-blue-500",
          text: "Pending...",
        }
      case "downloading":
        return {
          icon: (
            <DownloadCloud className="h-3 w-3 mr-1.5 animate-pulse text-blue-600 shrink-0" />
          ),
          textClass: "text-blue-600",
          text: `Downloading (${progressPercent}%)`,
        }
      case "completed":
        // Display check only if file existence was confirmed by main process
        return item.fileExists
          ? {
              icon: (
                <CheckCircle2 className="h-3 w-3 mr-1.5 text-green-600 shrink-0" />
              ),
              textClass: "text-green-600",
              text: "Completed",
            }
          : {
              icon: (
                <FileQuestion className="h-3 w-3 mr-1.5 text-amber-600 shrink-0" />
              ),
              textClass: "text-amber-600",
              text: "Completed (File Missing?)",
            }
      case "error":
        return {
          icon: (
            <AlertCircle className="h-3 w-3 mr-1.5 text-destructive shrink-0" />
          ),
          textClass: "text-destructive",
          text: "Error",
        }
      default:
        return {
          icon: (
            <AlertCircle className="h-3 w-3 mr-1.5 text-gray-500 shrink-0" />
          ),
          textClass: "text-gray-500",
          text: "Unknown",
        }
    }
  }

  // Function to copy path to clipboard
  const copyPath = async (text: string | undefined) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      // TODO: Consider showing a success toast notification here
      console.log("Path copied to clipboard")
    } catch (err) {
      console.error("Failed to copy path: ", err)
      // TODO: Show an error toast notification here
    }
  }

  return (
    // TooltipProvider wraps the entire list
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-1 p-1">
        {" "}
        {/* Padding around the list */}
        {/* Sort list items by timestamp descending (newest first) */}
        {downloads
          .slice()
          .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
          .map((item) => {
            // Determine item states for conditional rendering/styling
            const isCompleted = item.status === "completed"
            const isError = item.status === "error"
            const isProcessing =
              item.status === "pending" || item.status === "downloading"
            // Clickable/Openable only if completed and file confirmed to exist
            const canInteractWithPath =
              isCompleted && !!item.fileExists && !!item.path

            // Determine display title
            const displayTitle =
              isCompleted || isProcessing
                ? item.title || `Video ID: ${item.id}`
                : isError
                ? `Error: ${item.url.substring(0, 50)}...`
                : `Unknown: ${item.id}`
            const truncatedTitle =
              displayTitle.length > 80
                ? displayTitle.substring(0, 77) + "..."
                : displayTitle

            // Determine content for the main tooltip (shown on item hover)
            const tooltipContent = canInteractWithPath
              ? item.path // Show full path if completed & file exists
              : isError
              ? item.errorInfo || item.title || "Unknown Error" // Show error details
              : isCompleted && !canInteractWithPath
              ? "File missing or inaccessible at stored path." // Specific message if file missing
              : item.url || "No details" // Fallback to URL

            // Get status details for display
            const statusDetails = renderStatus(item)

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  {/* Outer div for the list item */}
                  <div
                    className={cn(
                      "w-full text-left p-2.5 rounded-md border flex flex-col gap-1.5 transition-colors duration-150", // Using flex-col layout
                      // Conditional border/background based on status
                      isCompleted && canInteractWithPath
                        ? "border-green-500/30"
                        : "border-border", // Default border, green if completed+exists
                      isCompleted && !canInteractWithPath
                        ? "border-amber-500/30 opacity-75"
                        : "", // Amber border/dimmed if completed but file missing
                      isError ? "border-destructive/40 bg-destructive/5" : "",
                      isProcessing ? "border-blue-500/20 bg-blue-500/5" : ""
                    )}
                  >
                    {/* Line 1: Title and Action Buttons */}
                    <div className="flex justify-between items-start gap-2">
                      {/* Main title - tooltip attached here */}
                      <p
                        className={cn(
                          "flex-grow text-sm font-medium leading-tight truncate cursor-help",
                          isError ? "text-destructive" : ""
                        )}
                      >
                        {truncatedTitle}
                      </p>

                      {/* Action Buttons Container */}
                      <div className="flex gap-0.5 flex-shrink-0 -mr-1 -mt-1">
                        {canInteractWithPath && ( // Show Open Folder only if completed and file exists
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenFolder(item.path)
                            }}
                            title="Open Containing Folder"
                          >
                            <FolderOpen className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                          </Button>
                        )}
                        {canInteractWithPath && ( // Show Copy Path only if completed and file exists
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              copyPath(item.path)
                            }}
                            title="Copy File Path"
                          >
                            <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                          </Button>
                        )}
                        {isError && ( // Show Retry only on error
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRetry(item)
                            }}
                            title="Retry Download"
                          >
                            <RotateCcw className="h-4 w-4 text-muted-foreground hover:text-primary" />
                          </Button>
                        )}
                        {/* Always show Remove button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveItem(item.id)
                          }}
                          title="Remove From List"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Line 2: Status Icon/Text and Error Snippet */}
                    <div
                      className={cn(
                        "text-xs truncate flex items-center",
                        statusDetails.textClass
                      )}
                    >
                      {statusDetails.icon}
                      <span className="ml-0.5">{statusDetails.text}</span>
                      {/* Show snippet of error info directly if status is error */}
                      {isError && item.errorInfo && (
                        <span className="ml-1.5 text-muted-foreground truncate">
                          : {item.errorInfo.substring(0, 60)}...
                        </span>
                      )}
                    </div>

                    {/* Progress Bar - only shown when downloading */}
                    {item.status === "downloading" &&
                      typeof item.progress === "number" && (
                        <div className="mt-1.5">
                          {" "}
                          <Progress
                            value={item.progress}
                            className="h-1.5 w-full"
                          />{" "}
                        </div>
                      )}
                  </div>
                </TooltipTrigger>
                {/* Tooltip Content - Shows full path or error */}
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-xs break-words bg-popover text-popover-foreground shadow-md rounded-md px-3 py-1.5 text-xs"
                >
                  <p>{tooltipContent}</p>
                  {/* Add timestamp info to tooltip */}
                  {item.timestamp && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.status} on:{" "}
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  )}
                  {item.url && (
                    <p className="text-xs text-muted-foreground mt-1">
                      URL: {item.url}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
      </div>
    </TooltipProvider>
  )
}

export default DownloadList
