import { useEffect, useRef } from 'react';
import { needsMemoryUpdate } from '../lib/model';
import type { KeyPoint } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  point: KeyPoint;
  question: string;
  setQuestion: (value: string) => void;
  ask: (text?: string) => Promise<void>;
  summarize: () => Promise<void>;
  locked: boolean;
  available: boolean;
  busy: string;
  stream_text: string;
  partial_text: string;
}

export function Conversation({
  point,
  question,
  setQuestion,
  ask,
  summarize,
  locked,
  available,
  busy,
  stream_text,
  partial_text,
}: Props) {
  const history = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    following.current = true;
  }, [point.id]);
  useEffect(() => {
    if (history.current && following.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [point.id, point.turns.length, stream_text, partial_text]);
  const exploring = busy === 'Exploring this point';
  return (
    <>
      <div
        className="conversation"
        ref={history}
        onScroll={() => {
          const node = history.current;
          if (node)
            following.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="point-intro">
          <span className="guide-symbol">
            <Icon name="spark" />
          </span>
          <div>
            <p className="eyebrow">Let’s explore</p>
            <h3>{point.title}</h3>
            <p>{point.description}</p>
          </div>
        </div>
        {!point.turns.length && !exploring && (
          <div className="conversation-start">
            <p>There’s no wrong place to start.</p>
            <span>
              Ask a question, bring an example, or let your guide introduce the
              idea.
            </span>
            {!question.trim() && (
              <button
                className="starter"
                disabled={locked || !available}
                onClick={() =>
                  void ask(
                    'Introduce this idea with a simple example, then ask me a question to check my understanding.',
                  )
                }
              >
                <Icon name="spark" size={16} /> Start with the basics{' '}
                <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
        )}
        {point.turns.map((turn) => (
          <div className="exchange" key={turn.id}>
            <article className="message user">
              <span className="message-author">You</span>
              <p>{turn.user_text}</p>
            </article>
            <article className="message assistant">
              <span className="message-author">
                <Icon name="spark" size={14} /> Your guide
              </span>
              <div className="message-content">{turn.assistant_text}</div>
            </article>
          </div>
        ))}
        {exploring && (
          <div className="exchange">
            <article className="message user">
              <span className="message-author">You</span>
              <p>{question}</p>
            </article>
            <article className="message assistant">
              <span className="message-author">
                <Icon name="spark" size={14} /> Your guide
              </span>
              <div className="message-content">
                {stream_text || (
                  <span className="thinking">Thinking through it…</span>
                )}
              </div>
            </article>
          </div>
        )}
        {partial_text && (
          <article className="message incomplete">
            <span className="message-author">
              Incomplete response · not saved
            </span>
            <div className="message-content">{partial_text}</div>
          </article>
        )}
        {point.turns.length > 0 && !exploring && (
          <div className="reflect-prompt">
            <Icon name="leaf" size={18} />
            <span>
              {busy === 'Remembering what you learned'
                ? 'Updating your learning memory…'
                : needsMemoryUpdate(point)
                  ? 'Your latest exchange needs a memory update.'
                  : 'Learning memory updated automatically.'}
            </span>
            {needsMemoryUpdate(point) && (
              <button
                disabled={locked || !available}
                onClick={() => void summarize()}
              >
                Update memory <Icon name="arrow" size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="sr-only" htmlFor="question">
          Your question
        </label>
        <textarea
          id="question"
          rows={2}
          value={question}
          maxLength={120000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask, wonder, or try explaining it in your own words…"
          disabled={locked || !available}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (question.trim() && !locked && available) void ask();
            }
          }}
        />
        <div className="composer-bottom">
          <span>Curiosity is the curriculum.</span>
          <button
            type="button"
            className="send"
            aria-label="Send question"
            disabled={locked || !available || !question.trim()}
            onClick={() => void ask()}
          >
            <Icon name="send" size={19} />
          </button>
        </div>
      </form>
      <p className="guide-note">
        Your guide can make mistakes. Ask questions and check your
        understanding.
      </p>
    </>
  );
}
