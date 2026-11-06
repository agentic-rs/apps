import { createBrowserPlatform } from './browser';
import type { RecorderPlatform } from './types';

export async function createPlatform(): Promise<RecorderPlatform> {
  if (window.parent === window) return createBrowserPlatform();
  // Importing the SDK installs its message-channel handshake receiver.
  const { createNativePlatform } = await import('./native');
  return createNativePlatform();
}
