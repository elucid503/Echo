import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "es2022",
    },
    server: {
        port: 5173,
        proxy: {
            "/ws": {
                target: "ws://localhost:8080",
                ws: true,
            },
            "/status": "http://localhost:8080",
            "/clip": "http://localhost:8080",
            "/join": "http://localhost:8080",
            "/leave": "http://localhost:8080",
        },
    },
});
