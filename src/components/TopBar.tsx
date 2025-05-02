// src/components/TopBar.tsx
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react" // Removed Download icon import

interface TopBarProps {
  // Removed onNewDownloadClick from props
  onSettingsClick: () => void
}

function TopBar({ onSettingsClick }: TopBarProps) {
  return (
    // Keep height consistent, adjust padding if needed
    <header className="flex items-center justify-between px-3 py-2 border-b border-border h-14 flex-shrink-0 bg-background">
      <h1 className="text-lg font-semibold">YT Downloader</h1>
      <div className="flex gap-2">
        {/* Settings Button is the only one remaining here */}
        <Button
          variant="ghost" // Use ghost for less emphasis maybe? Or keep outline.
          size="icon"
          onClick={onSettingsClick}
          title="Settings"
        >
          <Settings className="h-5 w-5" /> {/* Slightly larger icon */}
          <span className="sr-only">Settings</span>
        </Button>
      </div>
    </header>
  )
}

export default TopBar
