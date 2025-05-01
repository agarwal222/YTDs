import { Button } from "@/components/ui/button"
import { Download, Settings } from "lucide-react"

interface TopBarProps {
  onNewDownloadClick: () => void
  onSettingsClick: () => void
}

function TopBar({ onNewDownloadClick, onSettingsClick }: TopBarProps) {
  return (
    <header className="flex items-center justify-between p-2 border-b border-border h-14 flex-shrink-0">
      <h1 className="text-lg font-semibold px-2">YT Downloader</h1>
      <div className="flex gap-2 px-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onNewDownloadClick}
          title="New Download"
        >
          <Download className="h-4 w-4" />
          <span className="sr-only">New Download</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onSettingsClick}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">Settings</span>
        </Button>
      </div>
    </header>
  )
}

export default TopBar
