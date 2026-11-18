import {liquidityDepthPlugin} from './liquidity-depth-server.mjs';
import {dailyMoversPlugin} from './daily-movers-server.mjs';
import {marketNewsPlugin} from './market-news-server.mjs';
import {liveRestPlugin} from './spot-live-rest-server.mjs';
import { spotNetflowPlugin } from './spot-netflow-server.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { marketApiPlugin } from './market-api.mjs';
import { createIexFlowPlugin } from './alpaca-flow-server.mjs';

export default defineConfig({
  plugins: [liquidityDepthPlugin(), dailyMoversPlugin(), marketNewsPlugin(), liveRestPlugin(), spotNetflowPlugin(), react(), marketApiPlugin(), createIexFlowPlugin()],
});
