// src/components/DownloadList.tsx
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  CheckCircle2,
  DownloadCloud,
  Hourglass,
  FolderOpen,
  Trash2,
  RotateCcw,
  Copy,
  Link as LinkIcon, // Rename to avoid conflict with React Router Link
  FileQuestion,
  ExternalLink,
} from "lucide-react"
import type { DownloadItem } from "../../electron/preload"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import React from "react"
import { useToast } from "@/hooks/use-toast"

interface DownloadListProps {
  downloads: DownloadItem[]
  onRemoveItem: (itemId: string) => void
  onOpenFolder: (filePath: string | undefined) => void
  onRetry: (item: DownloadItem) => void
}

function DownloadList({
  downloads,
  onRemoveItem,
  onOpenFolder,
  onRetry,
}: DownloadListProps) {
  const { toast } = useToast()

  // Helper to render status icon and text
  const renderStatus = (
    item: DownloadItem
  ): {
    icon: React.ReactNode
    textClass: string
    text: string
    shortLabel?: string
  } => {
    const progressPercent =
      typeof item.progress === "number" ? Math.round(item.progress) : 0
    switch (item.status) {
      case "pending":
        return {
          icon: (
            <Hourglass className="h-3.5 w-3.5 mr-1.5 text-blue-500 shrink-0" />
          ),
          textClass: "text-blue-500",
          text: "Pending...",
          shortLabel: "Wait",
        }
      case "downloading":
        return {
          icon: (
            <DownloadCloud className="h-3.5 w-3.5 mr-1.5 animate-pulse text-blue-600 shrink-0" />
          ),
          textClass: "text-blue-600",
          text: `Downloading (${progressPercent}%)`,
          shortLabel: `${progressPercent}%`,
        }
      case "completed":
        return item.fileExists
          ? {
              icon: (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600 shrink-0" />
              ),
              textClass: "text-green-600",
              text: "Completed",
              shortLabel: "Done",
            }
          : {
              icon: (
                <FileQuestion className="h-3.5 w-3.5 mr-1.5 text-amber-600 shrink-0" />
              ),
              textClass: "text-amber-600",
              text: "Completed (File Missing?)",
              shortLabel: "Missing",
            }
      case "error":
        return {
          icon: (
            <AlertCircle className="h-3.5 w-3.5 mr-1.5 text-destructive shrink-0" />
          ),
          textClass: "text-destructive",
          text: "Error",
          shortLabel: "Error",
        }
      default:
        return {
          icon: (
            <AlertCircle className="h-3.5 w-3.5 mr-1.5 text-gray-500 shrink-0" />
          ),
          textClass: "text-gray-500",
          text: "Unknown",
          shortLabel: "??",
        }
    }
  }

  // Function to copy text to clipboard (used for both path and URL)
  const copyToClipboard = async (
    text: string | undefined,
    type: "Path" | "URL"
  ) => {
    if (!text || !navigator.clipboard) {
      console.error(`Clipboard API not available or ${type} is empty.`)
      toast({
        title: `Error Copying ${type}`,
        description: `Could not copy ${type.toLowerCase()} to clipboard.`,
        variant: "destructive",
      })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      console.log(`${type} copied to clipboard`)
      toast({
        title: `${type} Copied`,
        description: `${type} copied to clipboard.`,
      })
    } catch (err) {
      console.error(`Failed to copy ${type}: `, err)
      toast({
        title: `Error Copying ${type}`,
        description: `Failed to copy ${type.toLowerCase()}.`,
        variant: "destructive",
      })
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* Use ul for semantic list, no outer padding */}
      <ul className="flex flex-col gap-0 p-0">
        {downloads
          .slice() // Create a shallow copy before sorting
          .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)) // Sort by timestamp desc
          .map((item) => {
            // Determine item states
            const isCompleted = item.status === "completed"
            const isError = item.status === "error"
            const canInteractWithPath =
              isCompleted && !!item.fileExists && !!item.path

            // Prepare display text and status
            const displayTitle = item.title || `Video ID: ${item.id}`
            // Truncate title visually, show full in tooltip
            const truncatedTitle = displayTitle // Handled by CSS truncate now

            const statusDetails = renderStatus(item)

            return (
              // List item with group class for hover effects
              <li
                key={item.id}
                className={cn(
                  "group relative w-full text-left border-b border-border flex flex-row items-stretch", // Use items-stretch
                  "transition-colors duration-150 hover:bg-muted/50",
                  canInteractWithPath ? "cursor-pointer" : "cursor-default"
                )}
                // Click action for completed items
                onClick={() => {
                  if (canInteractWithPath) {
                    onOpenFolder(item.path)
                  }
                }}
                title={
                  canInteractWithPath
                    ? `Click to open folder for: ${displayTitle}`
                    : displayTitle
                } // Basic title attr
              >
                {/* Main Item Content Area (Takes most space) */}
                <div className="flex-grow flex flex-col gap-1 overflow-hidden p-3">
                  {/* Title (truncates) */}
                  <p
                    className={cn(
                      "text-sm font-medium leading-tight truncate",
                      isError ? "text-destructive" : ""
                    )}
                  >
                    {truncatedTitle}
                  </p>

                  {/* Status Icon/Text */}
                  <div
                    className={cn(
                      "text-xs truncate flex items-center",
                      statusDetails.textClass
                    )}
                  >
                    {statusDetails.icon}
                    <span className="ml-0.5">{statusDetails.text}</span>
                    {/* Show concise error in status line */}
                    {isError && item.errorInfo && (
                      <span
                        className="ml-1.5 text-muted-foreground truncate"
                        title={item.errorInfo}
                      >
                        : {item.errorInfo.split("\n")[0].substring(0, 50)}...
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {item.status === "downloading" &&
                    typeof item.progress === "number" && (
                      <div className="mt-1.5">
                        <Progress
                          value={item.progress}
                          className="h-1 w-full"
                        />
                      </div>
                    )}
                </div>

                {/* Action Buttons Area (Fixed width, shows on hover) */}
                <div
                  className={cn(
                    "flex-shrink-0 flex gap-0 items-center justify-end px-2", // Align items center vertically
                    "opacity-0 group-hover:opacity-100 focus-within:opacity-100", // Show on hover or if button focused
                    "transition-opacity duration-150"
                  )}
                >
                  {/* Buttons appear here */}
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
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open Folder</TooltipContent>
                    </Tooltip>
                  )}
                  {canInteractWithPath && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyToClipboard(item.path, "Path")
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy Path</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(item.url, "URL")
                        }}
                      >
                        <LinkIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy URL</TooltipContent>
                  </Tooltip>
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
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Retry</TooltipContent>
                    </Tooltip>
                  )}
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

                {/* Visual cue for clickable items (Optional) */}
                {/*
                 {canInteractWithPath && (
                    <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-50 transition-opacity duration-150 pointer-events-none">
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                 )}
                 */}
              </li>
            )
          })}
      </ul>
    </TooltipProvider>
  )
}

export default DownloadList
