import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
  },
  server: {
    watch: {
      // O Vite observa a raiz do projeto, e a raiz aqui guarda coisas que não
      // são código da interface: o `.venv` sozinho tem ~200 pacotes e 1,5 GB.
      // Observá-lo custa caro no Windows e produz recarga espúria — durante o
      // preparo desta máquina o log registrou um `page reload` disparado por
      // um arquivo do torch. Nenhuma destas pastas afeta o que o Vite serve.
      ignored: [
        "**/.venv/**",
        "**/python-backend/**",
        "**/resources/**",
        "**/release/**",
        "**/dist-electron/**",
      ],
    },
  },
});
