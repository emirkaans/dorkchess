/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Shared CI machines are slower: the bot-vs-bot robustness games get more time there.
    testTimeout: process.env.CI ? 300_000 : 60_000,
  },
});
