/**
 * Request/response protocol between the main process and the storage
 * worker (ADR-003). Type-only and free of Node/Electron I/O, so it is safe
 * to import from both sides of the process boundary.
 */
export type StorageMethod =
  | 'workspace.list'
  | 'workspace.create'
  | 'workspace.activate'
  | 'project.list'
  | 'project.inspectFolder'
  | 'project.add'
  // M4
  | 'project.detect'
  | 'project.detectPackageManager'
  | 'project.trustDecision'
  | 'project.get'
  | 'terminal.recordSession'
  | 'terminal.recordOutput'
  | 'terminal.markExited'
  | 'terminal.list'
  | 'devProcess.recordStart'
  | 'devProcess.setDetectedUrl'
  | 'devProcess.markStopped'
  | 'devProcess.list'
  | 'operation.recordCompleted'
  | 'activity.listRange'
  | 'system.reconcileOrphans'
  // M6: GitHub credential bookkeeping (spec 23.2.5/23.2.6) — reference-only, never the secret value.
  | 'githubSecretRef.upsert'
  | 'githubSecretRef.delete'
  | 'githubConnection.upsert'
  | 'githubConnection.get'
  | 'githubConnection.list'
  // M7: agent standing permissions (spec 19.2.3/19.2.4)
  | 'agentPermission.grant'
  | 'agentPermission.revoke'
  | 'agentPermission.list'
  | 'agentPermission.findActiveGrant'
  // M8: automations (spec section 18)
  | 'automation.create'
  | 'automation.list'
  | 'automation.setEnabled'
  | 'automation.setLastExecutionId'
  | 'automation.delete'
  | 'automationRun.start'
  | 'automationRun.complete'
  | 'automationRun.listByAutomation'
  | 'automationSettings.isAllEnabled'
  | 'automationSettings.setAllEnabled'
  // M8: app-level settings (spec 29.2 telemetry opt-in)
  | 'appSettings.isTelemetryEnabled'
  | 'appSettings.setTelemetryEnabled';

export interface StorageRequest {
  readonly id: string;
  readonly method: StorageMethod;
  readonly payload: unknown;
}

export type StorageResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };
