import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // OneDrive 폴더에서 파일 변경 감지가 누락되는 문제 → 폴링으로 감시
  server: {port: 5173, watch: {usePolling: true, interval: 500}},
});
