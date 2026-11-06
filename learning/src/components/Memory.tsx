import { needsMemoryUpdate } from '../lib/model';
import type { KeyPoint, LearningMemory, Topic } from '../lib/types';
import { Icon } from './Icon';

export function MemoryEditor({
  memory,
  setMemory,
  save,
  cancel,
  locked,
}: {
  memory: LearningMemory;
  setMemory: (value: LearningMemory) => void;
  save: () => Promise<void>;
  cancel: () => void;
  locked: boolean;
}) {
  return (
    <section className="memory-review">
      <div className="memory-emblem">
        <Icon name="leaf" size={27} />
      </div>
      <p className="eyebrow">Make it yours</p>
      <h3>Keep your memory accurate.</h3>
      <p>
        Your guide updates memory automatically as you talk. You can correct its
        notes or change whether you understand this point.
      </p>
      <label htmlFor="memory-summary">Your learning memory</label>
      <textarea
        id="memory-summary"
        rows={10}
        maxLength={8000}
        value={memory.summary}
        disabled={locked}
        onChange={(event) =>
          setMemory({ ...memory, summary: event.target.value })
        }
      />
      <label className="memory-understanding">
        <input
          type="checkbox"
          checked={memory.learned}
          disabled={locked}
          onChange={(event) =>
            setMemory({ ...memory, learned: event.target.checked })
          }
        />{' '}
        I understand this key point
      </label>
      <div className="review-actions">
        <button className="quiet" disabled={locked} onClick={cancel}>
          Discard edits
        </button>
        <button
          className="primary"
          disabled={locked || !memory.summary.trim()}
          onClick={() => void save()}
        >
          <Icon name="check" size={17} /> Save changes
        </button>
      </div>
    </section>
  );
}

export function MemoryList({
  topic,
  select,
  locked,
}: {
  topic: Topic;
  select: (id: string) => void;
  locked: boolean;
}) {
  const remembered = topic.key_points.filter((point) => point.memory);
  return (
    <section className="memory-list">
      <div className="memory-heading">
        <Icon name="leaf" size={26} />
        <h3>Knowledge you can return to.</h3>
        <p>
          Your guide remembers what you understand and what still needs
          exploring. Memory updates automatically after each exchange.
        </p>
      </div>
      {!remembered.length ? (
        <div className="empty-memory">
          <Icon name="book" size={35} />
          <h4>A little learning goes a long way.</h4>
          <p>
            Start a conversation about any key point. Your guide will record
            what you learn here.
          </p>
        </div>
      ) : (
        remembered.map((point) => (
          <article className="memory-card" key={point.id}>
            <div>
              <span>
                <Icon
                  name={point.memory!.learned ? 'check' : 'leaf'}
                  size={14}
                />
                {point.memory!.learned ? 'Learned' : 'Still exploring'}
              </span>
              <time dateTime={point.memory!.updated_at}>
                {new Date(point.memory!.updated_at).toLocaleDateString(
                  undefined,
                  { month: 'short', day: 'numeric' },
                )}
              </time>
            </div>
            <h4>{point.title}</h4>
            <p>{point.memory!.summary}</p>
            {needsMemoryUpdate(point) && (
              <p className="memory-stale">
                Latest exchange hasn’t been added yet.
              </p>
            )}
            <button
              className="text-button"
              disabled={locked}
              onClick={() => select(point.id)}
            >
              Return to this point <Icon name="arrow" size={14} />
            </button>
          </article>
        ))
      )}
    </section>
  );
}

export function SavedMemory({
  point,
  edit,
  revisit,
  locked,
}: {
  point: KeyPoint;
  edit: () => void;
  revisit: () => Promise<void>;
  locked: boolean;
}) {
  if (!point.memory) return null;
  return (
    <details className="saved-memory">
      <summary>
        <span>
          <Icon name="leaf" size={15} />
          Learning memory saved
        </span>
        <span>{point.memory.learned ? 'Learned' : 'Still exploring'}</span>
      </summary>
      <p>{point.memory.summary}</p>
      {needsMemoryUpdate(point) && (
        <p className="memory-stale">Latest exchange hasn’t been added yet.</p>
      )}
      <div>
        <button disabled={locked} onClick={edit}>
          Edit memory
        </button>
        {point.memory.learned && (
          <button disabled={locked} onClick={() => void revisit()}>
            Mark as still exploring
          </button>
        )}
      </div>
    </details>
  );
}
