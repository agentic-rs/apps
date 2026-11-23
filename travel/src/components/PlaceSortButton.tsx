import { PlaceOptionsButton } from './PlaceOptionsButton';

export type PlaceSortOrder = 'directory' | 'route';

export function PlaceSortButton({
  value,
  specific_area = false,
  onSelect,
  disabled,
}: {
  value: PlaceSortOrder;
  specific_area?: boolean;
  onSelect(value: PlaceSortOrder): void;
  disabled?: boolean;
}) {
  return (
    <PlaceOptionsButton
      title="Sort places"
      icon="sort"
      options={[
        { id: 'directory', label: 'Directory order' },
        { id: 'route', label: specific_area ? 'Nearest to selected place' : 'Nearest to day plan' },
      ]}
      value={value}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}
