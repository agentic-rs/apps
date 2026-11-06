import { learnedCount } from '../lib/model';
import type { Topic } from '../lib/types';
import { Icon } from './Icon';

export function TopicOverview({
  topic,
  select,
  memory,
  chooseModel,
  generate,
  locked,
  available,
}: {
  topic: Topic;
  select: (id: string) => void;
  memory: () => void;
  chooseModel: () => void;
  generate: () => void;
  locked: boolean;
  available: boolean;
}) {
  const learned = learnedCount(topic);
  const remembered = topic.key_points.filter((point) => point.memory).length;
  return (
    <section className="screen-body topic-overview">
      {topic.goal && (
        <div className="topic-context">
          <h2>Your goal</h2>
          <p>{topic.goal}</p>
        </div>
      )}
      {!topic.key_points.length ? (
        <>
          <button
            className="model-row"
            disabled={locked || !available}
            onClick={chooseModel}
          >
            <Icon name="spark" size={21} />
            <span>
              <strong>AI model</strong>
              <small>{topic.model?.model_id ?? 'Choose a model'}</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
          <div className="empty-state plan-empty">
            <span className="empty-icon">
              <Icon name="spark" size={30} />
            </span>
            <h2>Start with the key points</h2>
            <p>
              Your guide will break this topic into a few ideas you can explore
              in any order.
            </p>
            <button
              className="primary"
              disabled={locked || !available}
              onClick={generate}
            >
              Generate key points
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="topic-progress">
            <span>
              {learned} of {topic.key_points.length} learned
            </span>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Points learned"
              aria-valuemin={0}
              aria-valuemax={topic.key_points.length}
              aria-valuenow={learned}
            >
              <span
                style={{
                  width: `${(learned / topic.key_points.length) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="section-heading">
            <h2>Key points</h2>
            <span>Choose one to explore</span>
          </div>
          <div className="point-list">
            {topic.key_points.map((point, index) => (
              <button
                className={`point-row ${point.memory?.learned ? 'learned' : ''}`}
                key={point.id}
                disabled={locked}
                onClick={() => select(point.id)}
              >
                <span className="point-number">
                  {point.memory?.learned ? (
                    <Icon name="check" size={20} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="point-row-content">
                  <h3>{point.title}</h3>
                  <p>{point.description}</p>
                  <span className="point-state">
                    {point.memory?.learned
                      ? 'Learned'
                      : point.turns.length
                        ? 'Exploring'
                        : 'Not started'}
                  </span>
                </span>
                <Icon name="arrow" size={17} />
              </button>
            ))}
          </div>
          <button className="memory-link" disabled={locked} onClick={memory}>
            <Icon name="leaf" size={22} />
            <span>
              <strong>Learning memory</strong>
              <small>
                {remembered
                  ? `${remembered} ${remembered === 1 ? 'note' : 'notes'} · updated automatically`
                  : 'Your guide remembers as you chat'}
              </small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </>
      )}
    </section>
  );
}
