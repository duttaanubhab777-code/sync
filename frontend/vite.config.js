import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production, the Express server serves frontend/dist together with the API and Socket.IO.
// During local development, Vite runs on port 5173 and proxies requests to the Node backend.
export default defineConfig({
    plugins: [react()],
    publicDir: "../assets",
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: false
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: process.env.VITE_BACKEND_PROXY || "http://localhost:5000",
                changeOrigin: true
            },
            "/health": {
                target: process.env.VITE_BACKEND_PROXY || "http://localhost:5000",
                changeOrigin: true
            },
            "/socket.io": {
                target: process.env.VITE_BACKEND_PROXY || "http://localhost:5000",
                ws: true,
                changeOrigin: true
            }
        }
    }
});
