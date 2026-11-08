import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// প্রোডাকশনে (Render-এ) একই Express সার্ভার থেকেই frontend/dist এবং /api ও /socket.io চলে।
// লোকাল ডেভেলপমেন্টে (npm run dev) Vite 5173 পোর্টে চলে এবং নিচের proxy দিয়ে 5000 পোর্টের Node ব্যাকএন্ডে যুক্ত হয়।
export default defineConfig({
    plugins: [react()],
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
