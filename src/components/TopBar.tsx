// src/components/TopBar.tsx
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils" // Import cn

interface TopBarProps {
  onSettingsClick: () => void
}

function TopBar({ onSettingsClick }: TopBarProps) {
  // Check if running on macOS (This is a renderer-side check, reasonably reliable for styling)
  // Note: A more robust way might involve getting platform info via IPC if needed for logic.
  const isMac = navigator.userAgent.toUpperCase().includes("MAC")

  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-border h-14 flex-shrink-0 bg-background",
        // Add more left padding only on Mac to avoid traffic lights
        // Adjust the padding value (e.g., pl-20) if needed based on your UI
        isMac ? "pl-[76px]" : "px-3", // Keep right padding consistent or adjust as needed
        "py-2" // Keep vertical padding
      )}
      // Apply the draggable style. This style is only interpreted by Electron.
      // Use type assertion because TypeScript doesn't know about -webkit-app-region by default.
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Title - Make sure it's NOT draggable */}
      {/* Apply no-drag ONLY to interactive elements within the drag region */}
      <h1
        className="text-lg font-semibold"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        YT Downloader
      </h1>

      {/* Button Container - Make sure it's NOT draggable */}
      <div
        className="flex gap-2 pr-1" // Add slight right padding if needed
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Button
          variant="ghost" // Use ghost for less emphasis maybe? Or keep outline.
          size="icon"
          onClick={onSettingsClick}
          title="Settings"
          // Buttons inside a no-drag region are clickable by default
        >
          <Settings className="h-5 w-5" />
          <span className="sr-only">Settings</span>
        </Button>
      </div>
    </header>
  )
}

export default TopBar
