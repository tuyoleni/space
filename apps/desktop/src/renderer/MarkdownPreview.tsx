/**
 * Markdown Preview: renders markdown content with syntax highlighting,
 * task lists, tables, and code blocks. Used for README preview,
 * commit message display, and documentation views.
 */
import { useMemo, type ReactNode } from 'react';
import { cn } from '@space/ui';

interface MarkdownPreviewProps {
  readonly content: string;
  readonly className?: string;
}

function parseInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="rounded bg-surface px-1 py-0.5 font-mono text-[11px] text-accent">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover underline">
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const nextSpecial = remaining.search(/[`*\[]/);
    if (nextSpecial === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (nextSpecial === 0) {
      parts.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      parts.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const elements = useMemo((): ReactNode[] => {
    const lines = content.split('\n');
    const result: ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';

      // Code block
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length) {
          const codeLine = lines[i] ?? '';
          if (codeLine.startsWith('```')) break;
          codeLines.push(codeLine);
          i++;
        }
        i++; // skip closing ```
        result.push(
          <pre key={result.length} className="my-2 overflow-x-auto rounded-lg bg-surface p-3 text-[11px] leading-relaxed text-fg">
            {lang && (
              <div className="mb-1 text-[9px] font-medium uppercase text-fg-faint">{lang}</div>
            )}
            <code className="font-mono">{codeLines.join('\n')}</code>
          </pre>,
        );
        continue;
      }

      // Heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1]?.length ?? 1;
        const headingText = headingMatch[2] ?? '';
        const sizes: Record<number, string> = {
          1: 'text-lg font-bold',
          2: 'text-base font-bold',
          3: 'text-sm font-semibold',
          4: 'text-xs font-semibold',
          5: 'text-xs font-medium',
          6: 'text-[11px] font-medium',
        };
        result.push(
          <div key={result.length} className={cn('mt-3 mb-1 text-fg', sizes[level] ?? 'text-xs')}>
            {parseInline(headingText)}
          </div>,
        );
        i++;
        continue;
      }

      // Task list
      const taskMatch = line.match(/^(\s*)- \[([ x])\]\s+(.+)/);
      if (taskMatch) {
        const checked = taskMatch[2] === 'x';
        const taskText = taskMatch[3] ?? '';
        result.push(
          <div key={result.length} className="flex items-center gap-2 py-0.5 text-xs">
            <input type="checkbox" checked={checked} readOnly className="h-3 w-3 rounded border-border" />
            <span className={cn(checked && 'line-through text-fg-faint')}>
              {parseInline(taskText)}
            </span>
          </div>,
        );
        i++;
        continue;
      }

      // Unordered list
      const listMatch = line.match(/^(\s*)[-*]\s+(.+)/);
      if (listMatch) {
        const listText = listMatch[2] ?? '';
        result.push(
          <div key={result.length} className="flex gap-2 py-0.5 pl-4 text-xs">
            <span className="text-fg-faint">•</span>
            <span>{parseInline(listText)}</span>
          </div>,
        );
        i++;
        continue;
      }

      // Table
      if (line.includes('|') && (lines[i + 1] ?? '').match(/^\|[\s-:|]+\|/)) {
        const headerCells = line.split('|').filter((c) => c.trim()).map((c) => c.trim());
        i += 2; // skip header and separator
        const rows: string[][] = [];
        while (i < lines.length && (lines[i] ?? '').includes('|')) {
          const currentLine = lines[i] ?? '';
          rows.push(currentLine.split('|').filter((c) => c.trim()).map((c) => c.trim()));
          i++;
        }
        result.push(
          <div key={result.length} className="my-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border">
                  {headerCells.map((cell, j) => (
                    <th key={j} className="px-2 py-1 text-left font-medium text-fg">{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, j) => (
                  <tr key={j} className="border-b border-border/30">
                    {row.map((cell, k) => (
                      <td key={k} className="px-2 py-1 text-fg-muted">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Horizontal rule
      if (/^[-*_]{3,}$/.test(line)) {
        result.push(<hr key={result.length} className="my-2 border-border" />);
        i++;
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        result.push(
          <blockquote key={result.length} className="my-1 border-l-2 border-accent/40 pl-3 text-xs text-fg-muted italic">
            {parseInline(line.slice(2))}
          </blockquote>,
        );
        i++;
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Paragraph
      const paraLines: string[] = [];
      while (i < lines.length) {
        const pLine = lines[i] ?? '';
        if (pLine.trim() === '' || pLine.startsWith('#') || pLine.startsWith('```') || pLine.startsWith('> ') || /^[-*]\s/.test(pLine)) break;
        paraLines.push(pLine);
        i++;
      }
      if (paraLines.length > 0) {
        result.push(
          <p key={result.length} className="my-1 text-xs leading-relaxed text-fg-muted">
            {parseInline(paraLines.join(' '))}
          </p>,
        );
      }
    }

    return result;
  }, [content]);

  return (
    <div className={cn('prose-sm', className)}>
      {elements}
    </div>
  );
}
