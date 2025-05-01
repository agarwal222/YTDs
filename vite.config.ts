// vite.config.ts
import { defineConfig } from "vite"
import path from "path" // <<< Import path
import react from "@vitejs/plugin-react"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // <<< Add this section
    alias: {
      "@": path.resolve(__dirname, "./src"), // Map "@" to the "src" folder
    },
  }, // <<< End of added section
})
