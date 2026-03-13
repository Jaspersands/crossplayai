import { useRef, type ChangeEvent } from 'react';
import type { ProfileType } from '../types/game';

type UploadPanelProps = {
  onUpload: (file: File) => Promise<void> | void;
  profileHint?: ProfileType;
  onProfileHintChange: (hint?: ProfileType) => void;
  disabled?: boolean;
};

export function UploadPanel({
  onUpload,
  profileHint,
  onProfileHintChange,
  disabled = false,
}: UploadPanelProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await onUpload(file);

    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <section className="panel">
      <h2>1. Upload Crossplay Screenshot</h2>
      <p className="panel-note">
        Use a full mobile screenshot that contains the whole board and your rack.
      </p>

      <div className="upload-controls">
        <label className="field">
          <span className="field-label">Profile hint</span>
          <select
            value={profileHint ?? 'auto'}
            onChange={(event) => {
              const value = event.target.value;
              onProfileHintChange(value === 'auto' ? undefined : (value as ProfileType));
            }}
            disabled={disabled}
          >
            <option value="auto">Auto-detect</option>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
          </select>
        </label>

        <label className="upload-input">
          <span className="field-label">Choose screenshot</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFile}
            disabled={disabled}
          />
        </label>
      </div>
    </section>
  );
}
