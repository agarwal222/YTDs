// src/components/StatusBar.tsx
import { cn } from "@/lib/utils"
import {
  CheckCircle2,
  Database,
  XCircle,
  HelpCircle,
  ServerCrash,
  Download,
} from "lucide-react" // Add Download
import { Progress } from "@/components/ui/progress" // Import Progress
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface StatusBarProps {
  itemCount: number
  ytDlpOk: boolean | undefined // Use undefined for initial/unchecked state
  ffmpegOk: boolean | undefined
  checked: boolean | undefined // Has the check finished?
  updateProgress: number | null // Add prop for update progress (null if no download)
}

function StatusBar({
  itemCount,
  ytDlpOk,
  ffmpegOk,
  checked,
  updateProgress,
}: StatusBarProps) {
  // Helper to render dependency status icon and tooltip
  const renderDepStatus = (
    ok: boolean | undefined,
    depName: string
  ): React.ReactNode => {
    let icon: React.ReactNode
    let tooltipText: string
    let iconClass: string = "text-muted-foreground"
    if (!checked) {
      icon = <HelpCircle className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Status Unknown`
      iconClass = "text-muted-foreground animate-pulse"
    } else if (ok === true) {
      icon = <CheckCircle2 className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Found and working`
      iconClass = "text-green-600"
    } else {
      icon = <XCircle className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Not found or invalid. Check Settings.`
      iconClass = "text-destructive"
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("flex items-center", iconClass)}>{icon}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <TooltipProvider delayDuration={100}>
      <footer
        className={cn(
          "h-7 px-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground flex-shrink-0",
          "bg-background"
        )}
      >
        {/* Left side: Item Count */}
        <div className="flex items-center gap-1.5">
          {" "}
          <Database className="h-3.5 w-3.5" />{" "}
          <span>
            {itemCount} Item{itemCount !== 1 ? "s" : ""}
          </span>{" "}
        </div>

        {/* Center: Update Progress (Conditional) */}
        {updateProgress !== null && (
          <div
            className="flex items-center gap-2 flex-grow justify-center max-w-xs px-4"
            title={`Downloading update... ${Math.round(updateProgress)}%`}
          >
            <Download className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
            <Progress
              value={updateProgress}
              className="h-1.5 w-full bg-primary/20"
              indicatorClassName="bg-blue-500"
            />
            <span className="text-xs text-blue-600 font-medium">
              {Math.round(updateProgress)}%
            </span>
          </div>
        )}

        {/* Right side: Dependency Status */}
        {/* Add flex-grow if updateProgress is null to push deps to the right */}
        <div
          className={cn(
            "flex items-center gap-3",
            updateProgress === null && "flex-grow justify-end"
          )}
        >
          <span className="flex items-center gap-1">
            {" "}
            yt-dlp: {renderDepStatus(ytDlpOk, "yt-dlp")}{" "}
          </span>
          <span className="flex items-center gap-1">
            {" "}
            ffmpeg: {renderDepStatus(ffmpegOk, "ffmpeg")}{" "}
          </span>
        </div>
      </footer>
    </TooltipProvider>
  )
}

export default StatusBar
