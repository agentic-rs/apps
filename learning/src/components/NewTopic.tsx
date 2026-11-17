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
    <section className="new-topic-screen">
      <form
        className="screen-body"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="field">
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
            autoFocus
            required
            placeholder="What do you want to learn?"
            disabled={locked}
          />
        </div>
        <div className="field">
          <label htmlFor="topic-goal">
            Your goal <span>Optional</span>
          </label>
          <textarea
            id="topic-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={4000}
            rows={5}
            placeholder="What do you already know? What would you like to understand?"
            disabled={locked}
          />
        </div>
        <p className="form-note">
          Next, your AI guide will suggest key points to explore.
        </p>
      </form>
      <footer className="screen-footer">
        <button
          type="button"
          className="primary"
          disabled={locked || !title.trim()}
          onClick={() => void submit()}
        >
          Create topic
        </button>
      </footer>
    </section>
  );
}
