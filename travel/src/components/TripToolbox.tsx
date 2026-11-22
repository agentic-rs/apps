import { useState } from 'react';
import { packingItems } from '../lib/packing';
import type { Trip } from '../lib/types';
import { Expenses } from './Expenses';
import { PackingList } from './PackingList';
import { Icon } from './Icon';
import '../toolbox.css';

export function TripToolbox({
  trip,
  day,
  onChange,
}: {
  trip: Trip;
  day: string;
  onChange(update: (current: Trip) => Trip): Promise<void>;
}) {
  const [tool, setTool] = useState<'packing' | 'expenses' | null>(null);
  const items = packingItems(trip);
  const count = trip.expenses?.length ?? 0;
  return (
    <div className="toolbox" key={trip.id}>
      {tool ? (
        <>
          <button className="tool-back" onClick={() => setTool(null)}>
            <Icon name="back" size={16} />
            Toolbox
          </button>
          {tool === 'packing' ? (
            <PackingList trip={trip} onChange={onChange} />
          ) : (
            <Expenses trip={trip} day={day} onChange={onChange} />
          )}
        </>
      ) : (
        <>
          <h2>Trip toolbox</h2>
          <ul className="tool-rows">
            <li>
              <button aria-label="Open packing list" onClick={() => setTool('packing')}>
                <span className="tool-icon">
                  <Icon name="checklist" size={23} />
                </span>
                <span className="tool-row-copy">
                  <strong>Packing list</strong>
                  <small>
                    {items.filter((item) => item.packed).length} of {items.length} packed
                  </small>
                </span>
                <Icon name="next" size={17} />
              </button>
            </li>
            <li>
              <button aria-label="Open expenses" onClick={() => setTool('expenses')}>
                <span className="tool-icon expense-icon">
                  <Icon name="wallet" size={23} />
                </span>
                <span className="tool-row-copy">
                  <strong>Expenses</strong>
                  <small>
                    {count} {count === 1 ? 'expense' : 'expenses'}
                  </small>
                </span>
                <Icon name="next" size={17} />
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
