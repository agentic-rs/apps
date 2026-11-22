import type { PhotoAsset, TravelPlatform } from '../lib/types';
import { Icon } from './Icon';
import { Photo } from './Photo';

export function DraftPhotos({
  photos,
  platform,
  onRemove,
}: {
  photos: PhotoAsset[];
  platform: TravelPlatform;
  onRemove(id: string): void;
}) {
  return (
    <div className="draft-photos">
      {photos.map((photo, index) => (
        <div key={photo.id}>
          <Photo photo={photo} platform={platform} alt={`Attached photo ${index + 1}`} />
          <button
            type="button"
            className="remove-photo"
            aria-label={`Remove photo ${index + 1}`}
            onClick={() => onRemove(photo.id)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
