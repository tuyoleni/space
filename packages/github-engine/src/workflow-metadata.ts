/**
 * Reads real `workflow_dispatch` input metadata out of a workflow file's
 * YAML so GH-006 (spec 14.8) never has to invent inputs — `gh workflow
 * view --json` does not expose a workflow's `on.workflow_dispatch.inputs`
 * block, so the only way to get the real shape is to read the file
 * content itself (fetched via `gh api .../contents/...`, spec 14.5's
 * "structured JSON output" — the file bytes, not colored CLI text) and
 * parse it.
 *
 * This is a deliberately narrow parser for exactly one shape —
 * `on.workflow_dispatch.inputs`, one level of 2-space-indented mapping
 * keys under each input name — not a general-purpose YAML engine. A
 * workflow using flow-style YAML (`inputs: {name: {...}}`) or anchors
 * will not parse; that is an explicit, documented limitation rather than
 * a silent wrong answer, and it fails by returning fewer inputs, never by
 * inventing one.
 */

export type WorkflowDispatchInputType = 'string' | 'boolean' | 'choice' | 'environment' | 'number';

export interface WorkflowDispatchInputDefinition {
  readonly name: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly default: string | null;
  readonly type: WorkflowDispatchInputType;
  readonly options: readonly string[] | null;
}

interface Line {
  readonly indent: number;
  readonly text: string;
}

function toLines(yamlText: string): Line[] {
  return yamlText
    .split('\n')
    .map((raw) => {
      const withoutComment = raw.replace(/\s+#.*$/, '');
      const indent = withoutComment.length - withoutComment.trimStart().length;
      return { indent, text: withoutComment.trim() };
    })
    .filter((line) => line.text.length > 0);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Finds the first block of lines strictly more indented than `headerIndent`, starting right after `headerLineIndex`. */
function childBlock(lines: readonly Line[], headerLineIndex: number, headerIndent: number): Line[] {
  const block: Line[] = [];
  for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.indent <= headerIndent) {
      break;
    }
    block.push(line);
  }
  return block;
}

function parseInputBlock(name: string, block: readonly Line[]): WorkflowDispatchInputDefinition {
  let description: string | null = null;
  let required = false;
  let defaultValue: string | null = null;
  let type: WorkflowDispatchInputType = 'string';
  let options: string[] | null = null;

  if (block.length === 0) {
    return { name, description, required, default: defaultValue, type, options };
  }
  const fieldIndent = block[0]?.indent ?? 0;

  for (let i = 0; i < block.length; i += 1) {
    const line = block[i];
    if (!line || line.indent !== fieldIndent) {
      continue;
    }
    const colonIndex = line.text.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.text.slice(0, colonIndex).trim();
    const value = line.text.slice(colonIndex + 1).trim();

    switch (key) {
      case 'description':
        description = unquote(value);
        break;
      case 'required':
        required = value === 'true';
        break;
      case 'default':
        defaultValue = value.length > 0 ? unquote(value) : defaultValue;
        break;
      case 'type':
        type = (value as WorkflowDispatchInputType) || 'string';
        break;
      case 'options': {
        const optionLines = childBlock(block, i, fieldIndent).filter((l) => l.text.startsWith('-'));
        options = optionLines.map((l) => unquote(l.text.slice(1).trim()));
        break;
      }
      default:
        break;
    }
  }

  return { name, description, required, default: defaultValue, type, options };
}

/** Parses `on.workflow_dispatch.inputs` out of a workflow YAML file's raw text. Returns an empty array (not an error) when the workflow has no `workflow_dispatch` trigger or no `inputs`. */
export function parseWorkflowDispatchInputs(yamlText: string): WorkflowDispatchInputDefinition[] {
  const lines = toLines(yamlText);
  const dispatchIndex = lines.findIndex((line) => /^workflow_dispatch:?$/.test(line.text));
  if (dispatchIndex === -1) {
    return [];
  }
  const dispatchIndent = lines[dispatchIndex]?.indent ?? 0;
  const dispatchBlock = childBlock(lines, dispatchIndex, dispatchIndent);

  const inputsLocalIndex = dispatchBlock.findIndex((line) => /^inputs:?$/.test(line.text));
  if (inputsLocalIndex === -1) {
    return [];
  }
  const inputsIndent = dispatchBlock[inputsLocalIndex]?.indent ?? 0;
  const inputsBlock = childBlock(dispatchBlock, inputsLocalIndex, inputsIndent);
  if (inputsBlock.length === 0) {
    return [];
  }
  const nameIndent = inputsBlock[0]?.indent ?? 0;

  const definitions: WorkflowDispatchInputDefinition[] = [];
  for (let i = 0; i < inputsBlock.length; i += 1) {
    const line = inputsBlock[i];
    if (!line || line.indent !== nameIndent || !line.text.endsWith(':')) {
      continue;
    }
    const name = line.text.slice(0, -1).trim();
    const block = childBlock(inputsBlock, i, nameIndent);
    definitions.push(parseInputBlock(name, block));
  }
  return definitions;
}
