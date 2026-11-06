import { Icon } from './Icon';

interface Props {
  locked: boolean;
  create: (title: string, goal: string) => Promise<boolean>;
  title: string;
  goal: string;
  setTitle: (value: string) => void;
  setGoal: (value: string) => void;
}

export function NewTopic({
  locked,
  create,
  title,
  goal,
  setTitle,
  setGoal,
}: Props) {
  async function submit() {
    if (!locked && title.trim()) await create(title, goal);
  }
  return (
    <section className="welcome">
      <div className="welcome-mark">
        <Icon name="leaf" size={42} />
      </div>
      <p className="eyebrow">A little curiosity. A lasting understanding.</p>
      <h1>
        What would you
        <br />
        <em>like to learn?</em>
      </h1>
      <p className="welcome-intro">
        Follow your curiosity with an AI guide. Break a topic into key points,
        explore at your own pace, and keep what you learn.
      </p>
      <form className="topic-form" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="topic-title">Your topic</label>
        <input
          id="topic-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          maxLength={160}
          required
          placeholder="e.g. How do neural networks learn?"
          disabled={locked}
        />
        <label htmlFor="topic-goal">
          What would you like to understand? <span>Optional</span>
        </label>
        <textarea
          id="topic-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Tell your guide what you already know and where you want to go."
          disabled={locked}
        />
        <button
          type="button"
          className="primary"
          disabled={locked || !title.trim()}
          onClick={() => void submit()}
        >
          Create topic <Icon name="arrow" size={17} />
        </button>
      </form>
      <div className="inspiration">
        <span>A spark to get started</span>
        <div>
          {[
            'Understanding the night sky',
            'Learning Rust',
            'How memory works',
          ].map((example) => (
            <button
              key={example}
              disabled={locked}
              onClick={() => setTitle(example)}
            >
              {example} <span>↗</span>
            </button>
          ))}
        </div>
      </div>
      <div className="learning-steps">
        <span>
          <b>01</b> Map it out
        </span>
        <span>
          <b>02</b> Explore together
        </span>
        <span>
          <b>03</b> Make it stick
        </span>
      </div>
    </section>
  );
}
