// src/components/DownloadList.tsx
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
import type { DownloadItem } from "../../electron/preload" // Or import from a shared types file
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip" // Shadcn Tooltip
import React from "react" // Standard React import

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
  ): { icon: React.ReactNode; textClass: string; text: string } => {
    // Use React.ReactNode for icon type
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
      default: // Fallback for unknown status
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
    if (!text || !navigator.clipboard) {
      // Check if clipboard API is available
      console.error("Clipboard API not available or path is empty.")
      // TODO: Show error toast
      return
    }
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
      <div className="flex flex-col gap-2 p-2">
        {" "}
        {/* List container */}
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
                ? item.title || `Video ID: ${item.id}` // Show actual title if available
                : isError
                ? `Error: ${item.url.substring(0, 50)}...` // Generic title for errors
                : `Unknown: ${item.id}`
            const truncatedTitle =
              displayTitle.length > 80
                ? displayTitle.substring(0, 77) + "..."
                : displayTitle // Truncate long titles

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
                      "w-full text-left p-3 rounded-md border flex flex-row items-center gap-3 transition-colors duration-150 hover:bg-muted/50", // Base styles using flex-row
                      // Conditional border/background based on status
                      isCompleted && canInteractWithPath
                        ? "border-green-600/40"
                        : "border-border", // Default border, green if completed+exists
                      isCompleted && !canInteractWithPath
                        ? "border-amber-500/30 opacity-75"
                        : "", // Amber border/dimmed if completed but file missing
                      isError ? "border-destructive/50 bg-destructive/10" : "",
                      isProcessing ? "border-blue-500/30 bg-blue-500/10" : ""
                    )}
                  >
                    {/* Main Content Area (Title, Status, Progress) */}
                    <div className="flex-grow flex flex-col gap-1 overflow-hidden">
                      {/* Title */}
                      <p
                        className={cn(
                          "text-sm font-medium leading-tight truncate",
                          isError ? "text-destructive" : ""
                        )}
                      >
                        {truncatedTitle}
                      </p>

                      {/* Status Icon/Text and Error Snippet */}
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
                            : {item.errorInfo.substring(0, 50)}...
                          </span>
                        )}
                      </div>

                      {/* Progress Bar */}
                      {item.status === "downloading" &&
                        typeof item.progress === "number" && (
                          <div className="mt-1">
                            <Progress
                              value={item.progress}
                              className="h-1.5 w-full"
                            />
                          </div>
                        )}
                    </div>

                    {/* Action Buttons Container */}
                    <div className="flex gap-0 flex-shrink-0 items-center">
                      {/* Open Folder Button */}
                      {canInteractWithPath && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenFolder(item.path)
                              }}
                            >
                              <FolderOpen className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Open Folder</TooltipContent>
                        </Tooltip>
                      )}
                      {/* Copy Path Button */}
                      {canInteractWithPath && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation()
                                copyPath(item.path)
                              }}
                            >
                              <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy Path</TooltipContent>
                        </Tooltip>
                      )}
                      {/* Retry Button */}
                      {isError && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRetry(item)
                              }}
                            >
                              <RotateCcw className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Retry</TooltipContent>
                        </Tooltip>
                      )}
                      {/* Remove Button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              onRemoveItem(item.id)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipTrigger>
                {/* Tooltip Content (Main Trigger) */}
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-xs break-words bg-popover text-popover-foreground shadow-md rounded-md px-3 py-1.5 text-xs"
                >
                  <p>{tooltipContent}</p>
                  {typeof item.timestamp === "number" && (
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

// Export the component directly without the ErrorBoundary wrapper here
export default DownloadList
