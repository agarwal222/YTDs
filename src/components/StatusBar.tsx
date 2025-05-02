// src/components/StatusBar.tsx
import { cn } from "@/lib/utils"
import {
  CheckCircle2,
  Database,
  XCircle,
  HelpCircle,
  ServerCrash,
} from "lucide-react"
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
}

function StatusBar({ itemCount, ytDlpOk, ffmpegOk, checked }: StatusBarProps) {
  // Helper to render dependency status icon and tooltip
  const renderDepStatus = (
    ok: boolean | undefined,
    depName: string
  ): React.ReactNode => {
    let icon: React.ReactNode
    let tooltipText: string
    let iconClass: string = "text-muted-foreground" // Default color

    if (!checked) {
      icon = <HelpCircle className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Status Unknown`
      iconClass = "text-muted-foreground animate-pulse" // Pulse while checking
    } else if (ok === true) {
      icon = <CheckCircle2 className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Found and working`
      iconClass = "text-green-600"
    } else {
      // ok is false or undefined after check
      icon = <XCircle className="h-3.5 w-3.5" />
      tooltipText = `${depName}: Not found or invalid. Check Settings.`
      iconClass = "text-destructive"
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Add span wrapper for tooltip to attach correctly */}
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
          "bg-background" // Consistent background
        )}
      >
        {/* Left side: Item Count */}
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          <span>
            {itemCount} Item{itemCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Right side: Dependency Status */}
        <div className="flex items-center gap-3">
          {/* yt-dlp Status */}
          <span className="flex items-center gap-1">
            yt-dlp: {renderDepStatus(ytDlpOk, "yt-dlp")}
          </span>
          {/* ffmpeg Status */}
          <span className="flex items-center gap-1">
            ffmpeg: {renderDepStatus(ffmpegOk, "ffmpeg")}
          </span>
        </div>
      </footer>
    </TooltipProvider>
  )
}

export default StatusBar
