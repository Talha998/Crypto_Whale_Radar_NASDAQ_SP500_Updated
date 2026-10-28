import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { marketApiPlugin } from './market-api.mjs';
import { createIexFlowPlugin } from './alpaca-flow-server.mjs';

export default defineConfig({
  plugins: [react(), marketApiPlugin(), createIexFlowPlugin()],
});
