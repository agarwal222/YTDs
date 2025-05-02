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
  Link as LinkIcon,
  FileQuestion,
  ExternalLink,
  ImageOff, // Add ImageOff
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

  // Function to copy text to clipboard
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
      <ul className="flex flex-col gap-0 p-0">
        {downloads
          .slice()
          .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
          .map((item) => {
            const isCompleted = item.status === "completed"
            const isError = item.status === "error"
            const canInteractWithPath =
              isCompleted && !!item.fileExists && !!item.path
            const displayTitle = item.title || `Video ID: ${item.id}`
            const statusDetails = renderStatus(item)

            return (
              <li
                key={item.id}
                className={cn(
                  "group relative w-full text-left border-b border-border flex flex-row items-stretch", // Use items-stretch
                  "transition-colors duration-150 hover:bg-muted/50",
                  canInteractWithPath ? "cursor-pointer" : "cursor-default"
                )}
                onClick={() => {
                  if (canInteractWithPath) {
                    onOpenFolder(item.path)
                  }
                }}
                title={
                  canInteractWithPath
                    ? `Click to open folder for: ${displayTitle}`
                    : displayTitle
                }
              >
                {/* --- Thumbnail Column --- */}
                <div className="flex-shrink-0 w-24 p-2 hidden sm:block">
                  {" "}
                  {/* Fixed width, hidden on small screens */}
                  <div className="w-full aspect-video rounded border bg-secondary overflow-hidden relative">
                    {" "}
                    {/* Aspect ratio container */}
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt="Thumbnail"
                        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300" // Use absolute positioning
                        loading="lazy"
                        onError={(e) => {
                          // Hide img and show placeholder sibling on error
                          const img = e.target as HTMLImageElement
                          img.style.opacity = "0" // Fade out smoothly
                          img.style.pointerEvents = "none"
                          const placeholder = img.nextElementSibling
                          if (placeholder)
                            (placeholder as HTMLElement).style.opacity = "1"
                        }}
                        onLoad={(e) => {
                          // Ensure image is visible on load
                          ;(e.target as HTMLImageElement).style.opacity = "1"
                        }}
                        style={{ opacity: 0 }} // Start hidden, fade in on load
                      />
                    ) : null}
                    {/* Placeholder always present but shown based on img error/load */}
                    <div
                      className={cn(
                        "absolute inset-0 w-full h-full flex items-center justify-center bg-secondary transition-opacity duration-300",
                        item.thumbnailUrl ? "opacity-0" : "opacity-100" // Show if no URL
                      )}
                    >
                      <ImageOff className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
                {/* --- End Thumbnail Column --- */}

                {/* Main Item Content Area */}
                <div className="flex-grow flex flex-col gap-1 overflow-hidden py-3 pl-3 pr-1 sm:pl-0">
                  {" "}
                  {/* Adjust padding for thumb */}
                  {/* Title */}
                  <p
                    className={cn(
                      "text-sm font-medium leading-tight truncate",
                      isError ? "text-destructive" : ""
                    )}
                  >
                    {" "}
                    {displayTitle}{" "}
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
                    {isError && item.errorInfo && (
                      <span
                        className="ml-1.5 text-muted-foreground truncate"
                        title={item.errorInfo}
                      >
                        {" "}
                        : {item.errorInfo
                          .split("\n")[0]
                          .substring(0, 50)}...{" "}
                      </span>
                    )}
                  </div>
                  {/* Progress Bar */}
                  {item.status === "downloading" &&
                    typeof item.progress === "number" && (
                      <div className="mt-1.5">
                        {" "}
                        <Progress
                          value={item.progress}
                          className="h-1 w-full"
                        />{" "}
                      </div>
                    )}
                </div>

                {/* Action Buttons Area */}
                <div
                  className={cn(
                    "flex-shrink-0 flex gap-0 items-center justify-end px-2",
                    "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                    "transition-opacity duration-150"
                  )}
                >
                  {/* Buttons */}
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
              </li>
            )
          })}
      </ul>
    </TooltipProvider>
  )
}

export default DownloadList
