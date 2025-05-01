interface VideoPlayerProps {
  videoPath: string | null
}

function VideoPlayer({ videoPath }: VideoPlayerProps) {
  if (!videoPath) {
    return (
      <div className="flex items-center justify-center h-64 w-full bg-muted rounded-lg border border-dashed">
        <p className="text-muted-foreground text-center px-4">
          Select a completed download from the list to play the video.
        </p>
      </div>
    )
  }

  // --- Revisit src generation ---
  // 1. Replace backslashes FIRST
  const normalizedPath = videoPath.replace(/\\/g, "/")
  // 2. Create the URL (NO encodeURI needed here, let the browser handle it for protocol part)
  const videoSrc = `local-video://${normalizedPath}`
  // --- End Revisit ---

  console.log("VideoPlayer trying to load:", videoSrc) // Log the exact URL passed

  console.log("VideoPlayer trying to load:", videoSrc) // Debugging line

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <video
        key={videoPath} // Force re-render on path change
        controls
        autoPlay={false} // Let user click play
        className="max-w-full max-h-full rounded-lg shadow-md bg-black" // bg-black helps with letterboxing
        onError={(e) => {
          console.error("Video playback error:", e)
          const videoElement = e.target as HTMLVideoElement
          console.error("Error code:", videoElement.error?.code)
          console.error("Error message:", videoElement.error?.message)
          alert(
            `Error playing video: ${
              videoElement.error?.message || "Unknown error"
            }. Check file path and format.`
          )
        }}
      >
        <source src={videoSrc} type="video/mp4" />{" "}
        {/* Adjust type based on actual downloads */}
        {/* Add more source types if you download different formats (webm, mkv etc) */}
        {/* <source src={videoSrc} type="video/webm" /> */}
        Your browser doesn't support HTML video, or the file is
        inaccessible/corrupted.
        <p className="text-xs mt-2">Path: {videoSrc}</p>{" "}
        {/* Show encoded path for debugging */}
      </video>
    </div>
  )
}

export default VideoPlayer
