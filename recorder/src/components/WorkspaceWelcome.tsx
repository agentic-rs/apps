import { Icon } from './Icon';

export function WorkspaceWelcome({ mode }: { mode: 'document' | 'clip' }) {
  const channels = mode === 'clip';
  return (
    <section className="welcome">
      <Icon name={channels ? 'chat' : 'text'} size={32} />
      <h2>{channels ? 'Select a channel' : 'Select a document'}</h2>
      <p>
        {channels
          ? 'Open a channel to write a message or record a voice note.'
          : 'Choose a document from your library, or record or import audio to create one.'}
      </p>
    </section>
  );
}
