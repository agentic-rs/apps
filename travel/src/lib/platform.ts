import { createBrowserStorage } from './browser-storage';
import { generateEventTitle, type TitleModel } from './event-title';
import { max_photo_bytes } from './model';
import { createId } from './identity';
import { assertPhotoPath, createNativeStorage, type NativeFileSystem } from './native-storage';
import type { PhotoAsset, TravelPlatform, VisitLocation } from './types';

type NativeHost = Pick<typeof import('@apell/sdk'), 'camera' | 'photos' | 'location'> & {
  fs: NativeFileSystem;
  llm: TitleModel;
};
const image_extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};

function validateImage(mime_type: string, size_bytes: number): void {
  if (!Object.hasOwn(image_extensions, mime_type)) {
    throw new Error('Choose a JPEG, PNG, GIF, WebP, HEIC, HEIF, or AVIF photo.');
  }
  if (!Number.isSafeInteger(size_bytes) || size_bytes <= 0 || size_bytes > max_photo_bytes) {
    throw new Error('Choose a nonempty photo no larger than 32 MiB.');
  }
}

function locationFix(
  latitude: number,
  longitude: number,
  accuracy_m: number,
  timestamp_ms: number,
): VisitLocation {
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(accuracy_m) ||
    accuracy_m < 0 ||
    !Number.isFinite(timestamp_ms) ||
    !Number.isFinite(new Date(timestamp_ms).getTime())
  ) {
    throw new Error('The device returned an invalid location. Please try again.');
  }
  return {
    latitude,
    longitude,
    accuracy_m,
    source: 'device',
    captured_at: new Date(timestamp_ms).toISOString(),
  };
}

export function createBrowserPlatform(): TravelPlatform {
  const storage = createBrowserStorage();
  return {
    native: false,
    async generateEventTitle() {
      throw new Error('Open Fieldnotes in Apell to generate a title, or enter one here.');
    },
    load: storage.load,
    save: storage.save,
    async importPhoto(file) {
      if (!file) throw new Error('Choose a photo using the file picker.');
      let mime_type = file.type.toLowerCase();
      if (!mime_type) {
        const extension = file.name.split('.').at(-1)?.toLowerCase();
        mime_type =
          extension === 'jpeg'
            ? 'image/jpeg'
            : (Object.entries(image_extensions).find(([, value]) => value === extension)?.[0] ??
              '');
      }
      validateImage(mime_type, file.size);
      const id = createId();
      const photo: PhotoAsset = {
        id,
        path: `images/${id}.${image_extensions[mime_type]}`,
        mime_type,
        size_bytes: file.size,
      };
      storage.stagePhoto(photo, file.slice(0, file.size, mime_type));
      return photo;
    },
    async capturePhoto() {
      throw new Error('Use Add photos to choose an image or open your device’s camera.');
    },
    readPhoto: storage.readPhoto,
    removePhoto: storage.removePhoto,
    currentLocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Location is unavailable here. You can enter coordinates manually.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            try {
              resolve(
                locationFix(
                  position.coords.latitude,
                  position.coords.longitude,
                  position.coords.accuracy,
                  position.timestamp,
                ),
              );
            } catch (error) {
              reject(error);
            }
          },
          (error) => {
            const message =
              error.code === 1
                ? 'Location permission was declined. Enter coordinates manually or allow location access.'
                : error.code === 3
                  ? 'Getting your location timed out. Try again or enter coordinates manually.'
                  : 'Your device could not determine its location. Try again or enter coordinates manually.';
            reject(new Error(message));
          },
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
        );
      });
    },
  };
}

export function createNativePlatform(host: NativeHost): TravelPlatform {
  const storage = createNativeStorage(host.fs);
  async function imageAsset(
    image: Awaited<ReturnType<NativeHost['photos']['pick']>>,
  ): Promise<PhotoAsset | null> {
    if (!image) return null;
    validateImage(image.mime_type, image.size_bytes);
    const photo = {
      id: createId(),
      path: image.path,
      mime_type: image.mime_type,
      size_bytes: image.size_bytes,
    };
    assertPhotoPath(photo);
    return photo;
  }
  return {
    native: true,
    generateEventTitle: (input, signal) => generateEventTitle(host.llm, input, signal),
    load: storage.load,
    save: storage.save,
    importPhoto: async () => imageAsset(await host.photos.pick()),
    capturePhoto: async () => imageAsset(await host.camera.capture()),
    readPhoto: storage.readPhoto,
    removePhoto: storage.removePhoto,
    async currentLocation() {
      const fix = await host.location.current();
      return fix
        ? locationFix(fix.latitude, fix.longitude, fix.accuracy_m, fix.timestamp_ms)
        : null;
    },
  };
}

export async function createPlatform(): Promise<TravelPlatform> {
  if (window.parent === window) return createBrowserPlatform();
  // Importing the SDK installs its message-channel handshake receiver.
  return createNativePlatform(await import('@apell/sdk'));
}
