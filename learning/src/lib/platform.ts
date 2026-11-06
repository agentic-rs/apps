import { createBrowserStore } from './browser-storage';
import { createNativeGuide, createUnavailableGuide } from './guide';
import { createNativeStore } from './native-storage';
import type { LearningPlatform } from './types';

export async function createPlatform(): Promise<LearningPlatform> {
  if (window.parent === window) {
    return {
      store: createBrowserStore(),
      guide: createUnavailableGuide(),
      native: false,
    };
  }
  // Importing the SDK installs the host's message-channel handshake receiver.
  const { fs, llm } = await import('@apell/sdk');
  return {
    store: createNativeStore(fs),
    guide: createNativeGuide(llm),
    native: true,
  };
}
