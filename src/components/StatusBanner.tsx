type StatusBannerProps = {
  status: string;
  error: string | null;
  parseConfidence: number;
  dictionaryWordCount?: number;
};

function statusMessage(status: string): string {
  switch (status) {
    case 'loadingDictionary':
      return 'Loading dictionary...';
    case 'parsing':
      return 'Parsing screenshot...';
    case 'readyToConfirm':
      return 'Review OCR output, then solve or export.';
    case 'solving':
      return 'Computing best moves...';
    case 'done':
      return 'Moves computed.';
    case 'error':
      return 'An error occurred.';
    default:
      return 'Ready.';
  }
}

export function StatusBanner({
  status,
  error,
  parseConfidence,
  dictionaryWordCount,
}: StatusBannerProps): JSX.Element {
  const hasMeta = Boolean(dictionaryWordCount) || parseConfidence > 0;

  return (
    <section className={`status-banner ${status === 'error' ? 'error' : ''}`}>
      <p className="status-main">{statusMessage(status)}</p>
      {hasMeta ? (
        <div className="status-metrics">
          {dictionaryWordCount ? <p>Dictionary words: {dictionaryWordCount.toLocaleString()}</p> : null}
          {parseConfidence > 0 ? <p>OCR confidence: {(parseConfidence * 100).toFixed(1)}%</p> : null}
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
