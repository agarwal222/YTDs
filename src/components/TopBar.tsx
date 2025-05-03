// src/components/TopBar.tsx
import { Button } from "@/components/ui/button"
import { Settings, Minus, Square, X } from "lucide-react" // Import new icons
import { cn } from "@/lib/utils"
import React from "react" // Import React for CSSProperties typing

interface TopBarProps {
  onSettingsClick: () => void
}

function TopBar({ onSettingsClick }: TopBarProps) {
  // Check if running on macOS
  const isMac = navigator.userAgent.toUpperCase().includes("MAC")

  // --- Window Control Handlers ---
  const handleMinimize = () => {
    window.electronAPI?.windowMinimize()
  }
  const handleMaximize = () => {
    window.electronAPI?.windowToggleMaximize()
  }
  const handleClose = () => {
    window.electronAPI?.windowClose()
  }
  // --- End Handlers ---

  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-border h-14 flex-shrink-0 bg-background",
        // Still need padding for macOS traffic lights with titleBarStyle:'hidden'
        isMac ? "pl-[76px]" : "pl-3 pr-1", // Adjust non-mac padding
        "py-2"
      )}
      // Header area is draggable
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Title - Non-draggable */}
      <h1
        className="text-lg font-semibold"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        YT Downloader
      </h1>

      {/* Right Aligned Controls Area - Non-draggable */}
      <div
        className="flex gap-1 items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Settings Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onSettingsClick}
          title="Settings"
          className="h-8 w-8"
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">Settings</span>
        </Button>

        {/* --- Custom Window Controls (Windows/Linux Only) --- */}
        {!isMac && (
          <div className="flex items-center ml-2">
            {" "}
            {/* Add margin */}
            {/* Minimize */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMinimize}
              title="Minimize"
              className="h-8 w-8 hover:bg-muted/80"
            >
              <Minus className="h-4 w-4" />
              <span className="sr-only">Minimize</span>
            </Button>
            {/* Maximize/Restore */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMaximize}
              title="Maximize"
              className="h-8 w-8 hover:bg-muted/80"
            >
              {/* Use Square icon for now, could change based on state later */}
              <Square className="h-[14px] w-[14px]" />
              <span className="sr-only">Maximize</span>
            </Button>
            {/* Close */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              title="Close"
              className="h-8 w-8 hover:bg-destructive/80 hover:text-destructive-foreground"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        )}
        {/* --- End Custom Window Controls --- */}
      </div>
    </header>
  )
}

export default TopBar
