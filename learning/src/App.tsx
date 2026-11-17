import { useEffect, useState } from 'react';
import { Confirmation } from './components/Confirmation';
import { Conversation } from './components/Conversation';
import { Icon } from './components/Icon';
import { MemoryEditor, MemoryList } from './components/Memory';
import { NewTopic } from './components/NewTopic';
import { ScreenHeader } from './components/ScreenHeader';
import { TopicActions } from './components/TopicActions';
import { TopicList } from './components/TopicList';
import { TopicOverview } from './components/TopicOverview';
import { useLearning } from './lib/useLearning';

type Screen = 'topics' | 'new_topic' | 'topic' | 'conversation' | 'memory';

export function App() {
  const learning = useLearning();
  const [screen, setScreen] = useState<Screen>('topics');
  const [memory_origin, setMemoryOrigin] = useState<{
    screen: 'topic' | 'conversation';
    point_id: string | null;
  }>({ screen: 'topic', point_id: null });
  const [actions_open, setActionsOpen] = useState(false);
  const { topic, point, platform, locked, memory_draft } = learning;
  const available = Boolean(platform?.guide.available);

  // Deletion or discarding a new topic's failed save returns to the library.
  useEffect(() => {
    if (
      !learning.loading &&
      !topic &&
      screen !== 'topics' &&
      screen !== 'new_topic'
    ) {
      setScreen('topics');
      setActionsOpen(false);
    }
  }, [learning.loading, topic, screen]);

  async function openTopic(id: string) {
    if (await learning.selectTopic(id)) setScreen('topic');
  }
  async function newTopic() {
    if (await learning.selectTopic(null)) setScreen('new_topic');
  }
  async function openPoint(id: string) {
    if (await learning.selectPoint(id)) setScreen('conversation');
  }
  function openMemory(origin: 'topic' | 'conversation') {
    setMemoryOrigin({ screen: origin, point_id: point?.id ?? null });
    setScreen('memory');
  }
  async function back() {
    if (memory_draft) {
      await learning.discardMemory();
      return;
    }
    if (screen === 'memory') {
      if (memory_origin.screen === 'conversation' && memory_origin.point_id) {
        if (await learning.selectPoint(memory_origin.point_id))
          setScreen('conversation');
      } else {
        setScreen('topic');
      }
      return;
    }
    if (screen === 'conversation') {
      if (await learning.leaveView()) setScreen('topic');
      return;
    }
    if (await learning.leaveView()) setScreen('topics');
  }

  if (learning.loading || !platform)
    return (
      <main className="loading-screen">
        {learning.loading ? (
          <p role="status">Loading topics…</p>
        ) : (
          <>
            <h1>Couldn’t open Learning</h1>
            <p role="alert">{learning.error}</p>
            <button className="primary" onClick={learning.reload}>
              Try again
            </button>
          </>
        )}
      </main>
    );

  const title = memory_draft
    ? 'Edit memory'
    : screen === 'topics'
      ? 'Topics'
      : screen === 'new_topic'
        ? 'New topic'
        : screen === 'conversation'
          ? (point?.title ?? 'Conversation')
          : screen === 'memory'
            ? 'Memory'
            : (topic?.title ?? 'Topic');
  const subtitle = memory_draft
    ? point?.title
    : screen === 'conversation' || screen === 'memory'
      ? topic?.title
      : undefined;
  const back_label = memory_draft
    ? 'Memory'
    : screen === 'conversation'
      ? 'Key points'
      : screen === 'memory'
        ? memory_origin.screen === 'conversation'
          ? 'Chat'
          : 'Key points'
        : 'Topics';
  const can_stop = [
    'Mapping your topic',
    'Exploring this point',
    'Remembering what you learned',
  ].includes(learning.busy);

  return (
    <div className="learning-app">
      {learning.confirmation && (
        <Confirmation
          request={learning.confirmation}
          resolve={learning.resolveConfirmation}
        />
      )}
      {actions_open && topic && (
        <TopicActions
          topic={topic}
          close={() => setActionsOpen(false)}
          remove={() => void learning.removeTopic()}
        />
      )}
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        back_label={back_label}
        onBack={screen === 'topics' ? undefined : () => void back()}
        locked={locked}
        action={
          screen === 'topics' ? (
            <button
              className="icon-button"
              aria-label="New topic"
              disabled={locked}
              onClick={() => void newTopic()}
            >
              <Icon name="plus" size={25} />
            </button>
          ) : screen === 'topic' ? (
            <button
              className="icon-button"
              aria-label="Topic options"
              disabled={locked}
              onClick={() => setActionsOpen(true)}
            >
              <Icon name="more" size={24} />
            </button>
          ) : screen === 'conversation' ? (
            <button
              className="icon-button"
              aria-label="Memory"
              disabled={locked}
              onClick={() => openMemory('conversation')}
            >
              <Icon name="leaf" size={23} />
            </button>
          ) : undefined
        }
      />
      {!platform.native && (
        <div className="preview-banner">
          Preview · Open in Apell to use the AI guide.
        </div>
      )}
      {learning.error && (
        <div
          className={`notice ${learning.pending_save ? 'save-error' : ''}`}
          role="alert"
        >
          <p>{learning.error}</p>
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
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      {learning.busy && (
        <div className="activity" role="status">
          <span className="activity-dot" />
          <span>{learning.busy}…</span>
          {can_stop && <button onClick={learning.cancel}>Stop</button>}
        </div>
      )}
      <main className="screen-area">
        {screen === 'topics' && (
          <TopicList
            topics={learning.topics}
            locked={locked}
            select={(id) => void openTopic(id)}
            create={() => void newTopic()}
          />
        )}
        {screen === 'new_topic' && (
          <NewTopic
            locked={locked}
            title={learning.new_title}
            goal={learning.new_goal}
            setTitle={learning.setNewTitle}
            setGoal={learning.setNewGoal}
            create={async (title, goal) => {
              const created = await learning.create(title, goal);
              if (created) setScreen('topic');
              return created;
            }}
          />
        )}
        {screen === 'topic' && topic && (
          <TopicOverview
            topic={topic}
            locked={locked}
            available={available}
            select={(id) => void openPoint(id)}
            memory={() => openMemory('topic')}
            chooseModel={() => void learning.chooseModel()}
            generate={() => void learning.generatePlan()}
          />
        )}
        {screen === 'conversation' && point && (
          <section className="conversation-screen" aria-label="Conversation">
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
          </section>
        )}
        {screen === 'memory' && topic && (
          <section className="memory-screen">
            {memory_draft ? (
              <MemoryEditor
                memory={memory_draft}
                setMemory={learning.setMemoryDraft}
                save={learning.saveMemory}
                cancel={() => void learning.discardMemory()}
                locked={locked}
              />
            ) : (
              <MemoryList
                topic={topic}
                locked={locked}
                select={(id) => void openPoint(id)}
                edit={(id) => void learning.editMemory(id)}
                revisit={(id) => void learning.revisit(id)}
              />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
