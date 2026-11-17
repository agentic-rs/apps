import { learnedCount } from '../lib/model';
import type { Topic } from '../lib/types';
import { Icon } from './Icon';

export function TopicList({
  topics,
  select,
  create,
  locked,
}: {
  topics: Topic[];
  select: (id: string) => void;
  create: () => void;
  locked: boolean;
}) {
  if (!topics.length)
    return (
      <section className="screen-body topics-screen">
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="book" size={32} />
          </span>
          <h2>No topics yet</h2>
          <p>
            Create a topic and explore it with your AI guide. Your learning is
            remembered as you chat.
          </p>
          <button className="primary" disabled={locked} onClick={create}>
            Create your first topic
          </button>
        </div>
      </section>
    );
  const total_learned = topics.reduce(
    (sum, topic) => sum + learnedCount(topic),
    0,
  );
  return (
    <section className="screen-body topics-screen" aria-label="Topic library">
      <p className="list-summary">
        {topics.length} {topics.length === 1 ? 'topic' : 'topics'} ·{' '}
        {total_learned} {total_learned === 1 ? 'point' : 'points'} learned
      </p>
      <div className="topic-list">
        {topics.map((topic) => {
          const learned = learnedCount(topic);
          return (
            <button
              className="topic-row"
              key={topic.id}
              onClick={() => select(topic.id)}
              disabled={locked}
            >
              <span className="topic-symbol">
                <Icon name="book" size={23} />
              </span>
              <span className="topic-row-content">
                <h2>{topic.title}</h2>
                <p>
                  {topic.key_points.length
                    ? `${learned} of ${topic.key_points.length} points learned`
                    : 'Ready to start'}
                </p>
                {topic.key_points.length > 0 && (
                  <span className="row-progress">
                    <span
                      style={{
                        width: `${(learned / topic.key_points.length) * 100}%`,
                      }}
                    />
                  </span>
                )}
              </span>
              <Icon name="arrow" size={18} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
