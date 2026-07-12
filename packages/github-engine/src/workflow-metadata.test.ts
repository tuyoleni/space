import { describe, expect, it } from 'vitest';
import { parseWorkflowDispatchInputs } from './workflow-metadata';

const RELEASE_WORKFLOW_YAML = `
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release'
        required: true
        type: string
      environment:
        description: 'Target environment'
        required: true
        default: production
        type: choice
        options:
          - production
          - staging
      dry_run:
        description: 'Dry run only'
        required: false
        type: boolean
        default: 'false'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

const NO_DISPATCH_WORKFLOW_YAML = `
name: CI
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
`;

const DISPATCH_NO_INPUTS_YAML = `
name: Manual
on:
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
`;

describe('parseWorkflowDispatchInputs', () => {
  it('reads real input metadata: names, descriptions, required, defaults, types, and options', () => {
    const inputs = parseWorkflowDispatchInputs(RELEASE_WORKFLOW_YAML);
    expect(inputs).toEqual([
      { name: 'version', description: 'Version to release', required: true, default: null, type: 'string', options: null },
      {
        name: 'environment',
        description: 'Target environment',
        required: true,
        default: 'production',
        type: 'choice',
        options: ['production', 'staging'],
      },
      { name: 'dry_run', description: 'Dry run only', required: false, default: 'false', type: 'boolean', options: null },
    ]);
  });

  it('returns an empty array when the workflow has no workflow_dispatch trigger', () => {
    expect(parseWorkflowDispatchInputs(NO_DISPATCH_WORKFLOW_YAML)).toEqual([]);
  });

  it('returns an empty array when workflow_dispatch has no inputs block', () => {
    expect(parseWorkflowDispatchInputs(DISPATCH_NO_INPUTS_YAML)).toEqual([]);
  });

  it('never fabricates an input for malformed or empty YAML', () => {
    expect(parseWorkflowDispatchInputs('')).toEqual([]);
    expect(parseWorkflowDispatchInputs('not: yaml: at: all: :::')).toEqual([]);
  });
});
