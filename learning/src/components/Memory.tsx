import { needsMemoryUpdate } from '../lib/model';
import type { LearningMemory, Topic } from '../lib/types';
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
    <section className="memory-editor">
      <p className="editor-help">
        Memory updates automatically. Correct anything the guide misunderstood.
      </p>
      <label htmlFor="memory-summary">Your learning memory</label>
      <textarea
        id="memory-summary"
        rows={8}
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
        />
        I understand this key point
      </label>
      <div className="editor-actions">
        <button
          type="button"
          className="quiet"
          disabled={locked}
          onClick={cancel}
        >
          Discard edits
        </button>
        <button
          type="button"
          className="primary"
          disabled={locked || !memory.summary.trim()}
          onClick={() => void save()}
        >
          Save changes
        </button>
      </div>
    </section>
  );
}

export function MemoryList({
  topic,
  select,
  edit,
  revisit,
  locked,
}: {
  topic: Topic;
  select: (id: string) => void;
  edit: (id: string) => void;
  revisit: (id: string) => void;
  locked: boolean;
}) {
  const remembered = topic.key_points.filter((point) => point.memory);
  if (!remembered.length) {
    return (
      <section className="empty-memory">
        <Icon name="book" size={28} />
        <h2>No memories yet</h2>
        <p>
          Explore a key point. Your guide will automatically save what you learn
          and what needs more practice.
        </p>
      </section>
    );
  }
  return (
    <section className="memory-list" aria-label="Learning memories">
      {remembered.map((point) => {
        const memory = point.memory!;
        return (
          <article
            className="memory-card"
            key={point.id}
            aria-labelledby={`memory-title-${point.id}`}
          >
            <div className="memory-card-meta">
              <span
                className={`memory-badge ${memory.learned ? 'learned' : ''}`}
              >
                <Icon name={memory.learned ? 'check' : 'leaf'} size={16} />
                {memory.learned ? 'Learned' : 'Still exploring'}
              </span>
              <time dateTime={memory.updated_at}>
                {new Date(memory.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </time>
            </div>
            <h2 id={`memory-title-${point.id}`}>{point.title}</h2>
            <p className="memory-summary">{memory.summary}</p>
            {needsMemoryUpdate(point) && (
              <p className="memory-stale">
                Latest exchange hasn’t been added yet.
              </p>
            )}
            <div className="memory-actions">
              <button
                type="button"
                className="quiet"
                disabled={locked}
                onClick={() => select(point.id)}
              >
                Open conversation
              </button>
              <button
                type="button"
                className="quiet"
                disabled={locked}
                onClick={() => edit(point.id)}
              >
                Edit memory
              </button>
              {memory.learned && (
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() => revisit(point.id)}
                >
                  Mark as still exploring
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
