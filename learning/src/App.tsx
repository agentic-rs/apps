import { useState } from 'react';
import { Conversation } from './components/Conversation';
import { Confirmation } from './components/Confirmation';
import { Icon } from './components/Icon';
import { MemoryList, MemoryEditor, SavedMemory } from './components/Memory';
import { NewTopic } from './components/NewTopic';
import { learnedCount } from './lib/model';
import { useLearning } from './lib/useLearning';

export function App() {
  const learning = useLearning();
  const [library_open, setLibraryOpen] = useState(false);
  const [tab, setTab] = useState<'explore' | 'memory'>('explore');
  const { topic, point, locked, platform, memory_draft } = learning;
  const learned = topic ? learnedCount(topic) : 0;
  const editing = memory_draft !== null;
  const available = Boolean(platform?.guide.available);

  async function selectTopic(id: string | null) {
    if (await learning.selectTopic(id)) {
      setLibraryOpen(false);
      setTab('explore');
    }
  }

  if (learning.loading || !platform)
    return (
      <main className="loading-screen">
        <div className="brand-icon">
          <Icon name="leaf" size={30} />
        </div>
        <h1>Learning</h1>
        {learning.loading ? (
          <p>Opening your learning space…</p>
        ) : (
          <>
            <p role="alert">{learning.error}</p>
            <button className="primary" onClick={learning.reload}>
              Try again
            </button>
          </>
        )}
      </main>
    );

  return (
    <div className={`app-shell ${topic?.key_points.length ? 'has-path' : ''}`}>
      {learning.confirmation && (
        <Confirmation
          request={learning.confirmation}
          resolve={learning.resolveConfirmation}
        />
      )}
      {library_open && (
        <button
          className="sidebar-scrim"
          aria-label="Close topics"
          onClick={() => setLibraryOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${library_open ? 'open' : ''}`}
        aria-label="Topic library"
      >
        <div className="brand">
          <span className="brand-icon">
            <Icon name="leaf" size={25} />
          </span>
          <span>
            Learning<span className="brand-subtitle">Stay curious.</span>
          </span>
          <button
            className="mobile-only icon-button"
            aria-label="Close topics"
            onClick={() => setLibraryOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <button
          className="new-topic"
          disabled={locked}
          onClick={() => selectTopic(null)}
        >
          <Icon name="plus" size={18} /> New topic
        </button>
        <div className="library-label">
          <span>Your topics</span>
          <span>{learning.topics.length.toString().padStart(2, '0')}</span>
        </div>
        <nav className="topic-list">
          {learning.topics.length ? (
            learning.topics.map((item) => {
              const count = learnedCount(item);
              return (
                <button
                  key={item.id}
                  disabled={locked}
                  className={`topic-item ${item.id === topic?.id ? 'active' : ''}`}
                  aria-current={item.id === topic?.id ? 'page' : undefined}
                  onClick={() => selectTopic(item.id)}
                >
                  <span className="topic-item-title">{item.title}</span>
                  <span className="topic-item-meta">
                    {item.key_points.length
                      ? `${count} of ${item.key_points.length} points learned`
                      : 'Ready to map out'}
                  </span>
                  {item.key_points.length > 0 && (
                    <span className="mini-progress">
                      <span
                        style={{
                          width: `${(count / item.key_points.length) * 100}%`,
                        }}
                      />
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="library-empty">
              Your next discovery
              <br />
              starts with a topic.
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <Icon name="book" size={19} />
          <p>
            A space for understanding.
            <span>Saved on this device.</span>
          </p>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-bar">
          <div>
            <button
              className="mobile-only topics-toggle"
              onClick={() => setLibraryOpen(true)}
            >
              <Icon name="book" size={18} /> Topics
            </button>
            <span className="workspace-breadcrumb">
              Your learning space
              {topic && (
                <>
                  <span>/</span>
                  <b>{topic.title}</b>
                </>
              )}
            </span>
          </div>
          <span className="local-label">
            <span />
            {platform.native ? 'Personal learning guide' : 'Browser preview'}
          </span>
        </header>
        {!platform.native && (
          <div className="preview-banner">
            Create and save topics here. Open Learning in Apell to choose a
            model and explore with AI.
          </div>
        )}
        {learning.error && (
          <div
            className={`notice ${learning.pending_save ? 'save-error' : ''}`}
            role="alert"
          >
            <div>{learning.error}</div>
            {learning.pending_save ? (
              <div className="save-recovery">
                <button
                  disabled={Boolean(learning.busy || learning.confirmation)}
                  onClick={() => void learning.retrySave()}
                >
                  Retry save
                </button>
                <button
                  disabled={Boolean(learning.busy || learning.confirmation)}
                  onClick={() => void learning.discardPending()}
                >
                  Discard unsaved changes
                </button>
              </div>
            ) : (
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={learning.clearError}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        )}
        {learning.busy && (
          <div className="activity" role="status">
            <span className="activity-dot" />
            {learning.busy}…
            {!learning.busy.toLowerCase().includes('sav') &&
              !learning.busy.toLowerCase().includes('remov') &&
              !learning.busy.toLowerCase().includes('updat') && (
                <button onClick={learning.cancel}>Stop</button>
              )}
          </div>
        )}
        {!topic ? (
          <NewTopic
            locked={locked}
            create={learning.create}
            title={learning.new_title}
            goal={learning.new_goal}
            setTitle={learning.setNewTitle}
            setGoal={learning.setNewGoal}
          />
        ) : (
          <>
            <section className="topic-header">
              <div>
                <p className="eyebrow">Follow your curiosity</p>
                <h1>{topic.title}</h1>
                {topic.goal && <p className="topic-goal">{topic.goal}</p>}
                <div className="topic-meta">
                  <span>
                    <Icon name="book" size={15} />
                    {topic.key_points.length
                      ? `${topic.key_points.length} key points`
                      : 'A new beginning'}
                  </span>
                  {topic.key_points.length > 0 && (
                    <span>
                      <Icon name="check" size={15} />
                      {learned} learned
                    </span>
                  )}
                </div>
              </div>
              <div className="topic-tools">
                <button
                  className="model-chip"
                  title={
                    topic.key_points.length
                      ? 'This topic keeps its original model so conversations can resume reliably.'
                      : 'Choose the AI model for this topic'
                  }
                  disabled={locked || !available || topic.key_points.length > 0}
                  onClick={() => void learning.chooseModel()}
                >
                  <Icon name="spark" size={14} />
                  {topic.model?.model_id ?? 'Choose model'}
                </button>
                <button
                  className="text-button danger"
                  disabled={locked}
                  onClick={() => void learning.removeTopic()}
                >
                  Delete topic
                </button>
              </div>
            </section>
            {!topic.key_points.length ? (
              <section className="plan-welcome">
                <div className="plan-illustration">
                  <span>01</span>
                  <i />
                  <span>02</span>
                  <i />
                  <span>03</span>
                </div>
                <p className="eyebrow">A starting point, not a syllabus</p>
                <h2>Let’s find a way into this.</h2>
                <p>
                  Your guide will suggest a handful of key points.
                  <br />
                  Start with any one that sparks your interest.
                </p>
                <button
                  className="primary"
                  disabled={locked || !available}
                  onClick={() => void learning.generatePlan()}
                >
                  <Icon name="spark" size={18} /> Generate key points
                </button>
              </section>
            ) : (
              <div className="learning-workspace">
                <section className="point-panel" aria-label="Key points">
                  <div className="point-panel-title">
                    <h2>Your path</h2>
                    <span>
                      {learned}/{topic.key_points.length}
                    </span>
                  </div>
                  <p className="point-panel-subtitle">
                    Take it one idea at a time.
                  </p>
                  <div
                    className="path-progress"
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
                  <div className="point-list">
                    {topic.key_points.map((item, index) => (
                      <button
                        key={item.id}
                        disabled={locked}
                        aria-pressed={item.id === point?.id}
                        className={`point-item ${item.id === point?.id ? 'selected' : ''} ${item.memory?.learned ? 'learned' : ''}`}
                        onClick={() => {
                          void learning
                            .selectPoint(item.id)
                            .then((selected) => {
                              if (selected) setTab('explore');
                            });
                        }}
                      >
                        <span className="point-number">
                          {item.memory?.learned ? (
                            <Icon name="check" size={15} />
                          ) : (
                            String(index + 1).padStart(2, '0')
                          )}
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {item.memory?.learned
                              ? 'Learned'
                              : item.turns.length
                                ? 'Exploring'
                                : 'Ready to explore'}
                          </small>
                        </span>
                        <Icon name="arrow" size={14} />
                      </button>
                    ))}
                  </div>
                  <div className="path-note">
                    <Icon name="leaf" size={20} />
                    <p>
                      Understanding grows
                      <br />
                      one good question at a time.
                    </p>
                  </div>
                </section>
                <section
                  className="exploration-panel"
                  aria-label="Learning guide"
                >
                  <div
                    className="exploration-tabs"
                    role="tablist"
                    aria-label="Learning views"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === 'explore'}
                      disabled={editing}
                      onClick={() => setTab('explore')}
                    >
                      <Icon name="spark" size={16} /> Explore
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === 'memory'}
                      disabled={editing}
                      onClick={() => setTab('memory')}
                    >
                      <Icon name="book" size={16} /> Memory{' '}
                      <span>
                        {topic.key_points.filter((item) => item.memory).length}
                      </span>
                    </button>
                    <span className="tab-caption">
                      {editing
                        ? 'Edit your learning memory'
                        : 'Memory updates as you learn.'}
                    </span>
                  </div>
                  {editing ? (
                    <MemoryEditor
                      memory={memory_draft}
                      setMemory={learning.setMemoryDraft}
                      save={learning.saveMemory}
                      cancel={() => void learning.discardMemory()}
                      locked={locked}
                    />
                  ) : tab === 'memory' ? (
                    <MemoryList
                      topic={topic}
                      locked={locked}
                      select={(id) => {
                        void learning.selectPoint(id).then((selected) => {
                          if (selected) setTab('explore');
                        });
                      }}
                    />
                  ) : (
                    point && (
                      <>
                        <SavedMemory
                          point={point}
                          locked={locked}
                          edit={() => learning.setMemoryDraft(point.memory!)}
                          revisit={learning.revisit}
                        />
                        <Conversation
                          point={point}
                          question={learning.question}
                          setQuestion={learning.setQuestion}
                          ask={learning.ask}
                          summarize={learning.summarize}
                          locked={locked}
                          available={available}
                          busy={learning.busy}
                          stream_text={learning.stream_text}
                          partial_text={learning.partial_text}
                        />
                      </>
                    )
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
