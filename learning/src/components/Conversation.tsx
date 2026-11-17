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
    if (history.current && following.current) {
      history.current.scrollTop = history.current.scrollHeight;
    }
  }, [point.id, point.turns.length, stream_text, partial_text]);

  const exploring = busy === 'Exploring this point';
  const remembering = busy === 'Remembering what you learned';
  const needs_memory = needsMemoryUpdate(point);
  const can_send = !locked && available && Boolean(question.trim());

  return (
    <>
      <div
        className="conversation"
        ref={history}
        onScroll={() => {
          const node = history.current;
          if (node) {
            following.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }
        }}
      >
        {!point.turns.length && (
          <section className="conversation-intro" aria-label="About this point">
            <p>{point.description}</p>
            {!exploring && !question.trim() && (
              <button
                type="button"
                className="starter"
                disabled={locked || !available}
                onClick={() =>
                  void ask(
                    'Introduce this idea with a simple example, then ask me a question to check my understanding.',
                  )
                }
              >
                <Icon name="spark" size={18} /> Start with the basics
              </button>
            )}
          </section>
        )}
        {point.turns.map((turn) => (
          <div className="exchange" key={turn.id}>
            <article className="message user">
              <span className="message-author">You</span>
              <p>{turn.user_text}</p>
            </article>
            <article className="message assistant">
              <span className="message-author">Guide</span>
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
            <article className="message assistant" aria-busy="true">
              <span className="message-author">Guide</span>
              <div className="message-content">
                {stream_text || <span className="thinking">Thinking…</span>}
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
          <div className="memory-status">
            <Icon name="leaf" size={16} />
            <span>
              {remembering
                ? 'Updating memory…'
                : needs_memory
                  ? 'Memory update needed'
                  : 'Memory saved'}
            </span>
            {needs_memory && !remembering && (
              <button
                type="button"
                disabled={locked || !available}
                onClick={() => void summarize()}
              >
                Update memory
              </button>
            )}
          </div>
        )}
      </div>
      <form className="composer" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="question">
          Your question
        </label>
        <textarea
          id="question"
          rows={2}
          value={question}
          maxLength={120000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask or explain what you understand…"
          disabled={locked || !available}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (can_send) void ask();
            }
          }}
        />
        <button
          type="button"
          className="send"
          aria-label="Send question"
          disabled={!can_send}
          onClick={() => void ask()}
        >
          <Icon name="send" size={22} />
        </button>
      </form>
    </>
  );
}
