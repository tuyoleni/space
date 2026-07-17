export interface DiffPreviewProps {
  readonly patchText: string;
}

const MAX_LINES = 400;

/**
 * A colored unified-diff view — hunk headers in accent, additions in success,
 * removals in danger, context muted — extracted verbatim from ChangesView so
 * every diff surface in the app (change detail, conflict resolver) renders
 * identically. Caps at {@link MAX_LINES} rows and marks the rest truncated.
 */
export function DiffPreview({ patchText }: DiffPreviewProps) {
  const allLines = patchText.split('\n');
  const lines = allLines.slice(0, MAX_LINES);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-app-bg p-3 text-[11px] leading-relaxed">
      {lines.map((line, index) => {
        const tone =
          line.startsWith('+++') || line.startsWith('---')
            ? 'text-fg-muted'
            : line.startsWith('@@')
              ? 'text-accent'
              : line.startsWith('+')
                ? 'text-success'
                : line.startsWith('-')
                  ? 'text-danger'
                  : 'text-fg-muted';
        return (
          <div key={index} className={tone}>
            {line || ' '}
          </div>
        );
      })}
      {allLines.length > MAX_LINES && <div className="text-fg-faint">… truncated</div>}
    </pre>
  );
}
