import { Icon } from './Icon';
import recorder_icon from '../../../shared/assets/recorder.svg';

export function WorkspaceWelcome({ mode, native }: { mode: 'document' | 'clip'; native: boolean }) {
  const channels = mode === 'clip';
  return (
    <section className="welcome">
      <div className="welcome-orbit">
        <span />
        <span />
        <div>
          <img src={recorder_icon} alt="" />
        </div>
      </div>
      <p className="eyebrow">
        {channels ? 'A place for the everyday' : 'From spoken words to written pages'}
      </p>
      <h2>
        {channels ? (
          <>
            Small thoughts.
            <br />A continuous story.
          </>
        ) : (
          <>
            Let the conversation
            <br />
            become a document.
          </>
        )}
      </h2>
      <p>
        {channels ? (
          <>
            Choose a channel for your quick voice notes.
            <br />
            Each moment keeps its own audio, words, and time.
          </>
        ) : (
          <>
            Record an interview, a meeting, or a longer thought.
            <br />
            Read, edit, and share the transcript in one workspace.
          </>
        )}
      </p>
      <div className="welcome-feature-row">
        <span>
          <Icon name={channels ? 'chat' : 'edit'} size={15} />
          {channels ? 'Separate voice notes' : 'Editable documents'}
        </span>
        <span>
          <Icon name="wave" size={15} />
          {!native
            ? 'Transcription in Apell'
            : channels
              ? 'Automatic transcription'
              : 'On-device transcription'}
        </span>
      </div>
      <div className="privacy-note">
        <Icon name="lock" size={14} />
        Private by design. Transcribed on device.
      </div>
    </section>
  );
}
