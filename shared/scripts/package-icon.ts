import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

type AppIcon = 'recorder' | 'learning' | 'fieldnotes';

export async function writePackageIcon(name: AppIcon): Promise<void> {
  const icon = await sharp(resolve(import.meta.dir, `../assets/${name}.svg`), {
    density: 72,
    limitInputPixels: 1024 * 1024,
  })
    .resize(256, 256)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  await writeFile('dist/icon.png', icon);
  await writeFile('artifacts/icon.png', icon);
}
