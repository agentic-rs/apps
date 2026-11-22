import { expect, test } from 'bun:test';
import sharp, { type Exif } from 'sharp';
import { readPhotoMetadata } from '../src/lib/photo-metadata';

const camera_clock = { DateTimeOriginal: '2024:02:29 23:59:58', OffsetTimeOriginal: '-03:30' };
const position = {
  GPSLatitudeRef: 'S',
  GPSLatitude: '30/1 15/1 0/1',
  GPSLongitudeRef: 'W',
  GPSLongitude: '45/1 30/1 0/1',
};

type ImageFormat = 'jpeg' | 'avif' | 'webp' | 'png' | 'gif';

async function photo(exif: Exif, format: ImageFormat = 'jpeg'): Promise<Blob> {
  const pixels = sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } });
  const bytes = await pixels.withExif(exif).toFormat(format).toBuffer();
  return new Blob([Uint8Array.from(bytes)], { type: `image/${format}` });
}

for (const format of ['jpeg', 'avif', 'png', 'webp'] as const) {
  test(`reads signed GPS and a timezone-aware camera clock from ${format} bytes`, async () => {
    const image = await photo(
      {
        IFD0: { Artist: 'Test artist', ImageDescription: 'Test caption' },
        IFD2: camera_clock,
        IFD3: position,
      },
      format,
    );
    expect(await readPhotoMetadata(image)).toEqual({
      local_time: '2024-02-29T23:59',
      utc_offset_minutes: -210,
      location: { latitude: -30.25, longitude: -45.5 },
    });
  });
}

test('retains an unzoned camera clock and validates GPS hemisphere references', async () => {
  const image = await photo({
    IFD2: { DateTimeOriginal: camera_clock.DateTimeOriginal },
    IFD3: { ...position, GPSLatitudeRef: 'X' },
  });
  expect(await readPhotoMetadata(image)).toEqual({
    local_time: '2024-02-29T23:59',
    utc_offset_minutes: null,
    location: null,
  });
});

test('falls back to a full UTC GPS timestamp when camera time is unavailable', async () => {
  const image = await photo({
    IFD3: {
      ...position,
      GPSLatitude: '0/1 0/1 0/1',
      GPSLatitudeRef: 'N',
      GPSDateStamp: '2024:03:01',
      GPSTimeStamp: '3/1 29/1 583/10',
    },
  });
  expect(await readPhotoMetadata(image)).toEqual({
    local_time: '2024-03-01T03:29',
    utc_offset_minutes: 0,
    location: { latitude: 0, longitude: -45.5 },
  });
});

test('ignores editing and filesystem times, impossible dates, and corrupt metadata', async () => {
  const empty = { local_time: null, utc_offset_minutes: null, location: null };
  const image = await photo({
    IFD0: { DateTime: '2026:01:02 01:02:03' },
    IFD2: { ...camera_clock, DateTimeOriginal: '2026:02:29 00:00:00' },
  });
  expect(
    await readPhotoMetadata(new File([image], 'scan.jpg', { lastModified: Date.now() })),
  ).toEqual(empty);
  expect(await readPhotoMetadata(new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xe1)]))).toEqual(empty);
  expect(await readPhotoMetadata(await photo({}, 'gif'))).toEqual(empty);
});
