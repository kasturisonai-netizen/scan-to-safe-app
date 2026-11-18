import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scantosafe.app',
  appName: 'Scan to Safe',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#f4f7f4',
    allowMixedContent: false
  }
};

export default config;
