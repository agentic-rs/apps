import { useState } from 'react';
import type { Recording } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';
import { formatTime } from '../lib/recordings';
import { Icon } from './Icon';

export function AudioPlayer({
  recording,
  controller,
  compact = false,
}: {
  recording: Recording;
  controller: RecorderController;
  compact?: boolean;
}) {
  const [seek_ms, setSeekMs] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const current = controller.playing_id === recording.id;
  const playing = current && controller.audio.playing;
  const position_ms = current ? controller.audio.position_ms : 0;
  const duration_ms = recording.duration_ms || (current ? controller.audio.duration_ms : 0);
  const locked =
    !controller.capabilities.playback ||
    controller.busy ||
    controller.audio.recording_state !== 'idle';
  const seek = async (position: number) => {
    await controller.seek(recording, position);
    setSeeking(false);
  };
  return (
    <div className={`player ${compact ? 'player-compact' : ''}`}>
      <button
        className="play-button"
        aria-label={playing ? 'Pause playback' : 'Play recording'}
        disabled={locked}
        onClick={() => void controller.play(recording)}
      >
        <Icon name={playing ? 'pause' : 'play'} size={compact ? 18 : 22} />
      </button>
      <div className="player-track">
        <input
          aria-label="Playback position"
          aria-valuetext={`${formatTime(seeking ? seek_ms : position_ms)} of ${formatTime(duration_ms)}`}
          type="range"
          min="0"
          max={Math.max(duration_ms, 1)}
          step="100"
          value={Math.min(seeking ? seek_ms : position_ms, duration_ms)}
          disabled={locked || duration_ms === 0}
          onChange={(event) => {
            setSeekMs(Number(event.target.value));
            setSeeking(true);
          }}
          onPointerUp={(event) => void seek(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              void seek(Number(event.currentTarget.value));
          }}
          onBlur={() => {
            if (seeking) void seek(seek_ms);
          }}
        />
        <div className="player-time">
          <span>{formatTime(seeking ? seek_ms : position_ms)}</span>
          <span>{formatTime(duration_ms)}</span>
        </div>
      </div>
      <button
        className="icon-button"
        aria-label="Share audio"
        disabled={
          !controller.capabilities.sharing ||
          controller.busy ||
          controller.audio.recording_state !== 'idle'
        }
        onClick={() => void controller.shareAudio(recording)}
      >
        <Icon name="share" size={compact ? 17 : 20} />
      </button>
    </div>
  );
}
