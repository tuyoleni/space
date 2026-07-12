import { randomUUID } from 'node:crypto';
import type { OperationRepository, OperationRisk, OperationRow } from './repositories/operation-repository';

export interface ReceiptContext {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly type: string;
  readonly risk: OperationRisk;
  readonly humanSummary: string;
}

export interface ReceiptedResult<T> {
  readonly result: T;
  readonly operation: OperationRow;
}

/**
 * Runs `action`, recording a durable Operation receipt around it: a
 * 'running' row is written before the action starts, and a terminal row
 * (succeeded/failed) is written after — even on throw. This is the
 * operation/receipt framework required by spec section 33 ("every
 * mutating command has a corresponding receipt").
 */
export async function withReceipt<T>(
  operations: OperationRepository,
  context: ReceiptContext,
  action: () => Promise<T> | T,
): Promise<ReceiptedResult<T>> {
  const operationId = randomUUID();
  operations.start({
    id: operationId,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    type: context.type,
    risk: context.risk,
    humanSummary: context.humanSummary,
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await action();
    const operation = operations.complete(operationId, {
      state: 'succeeded',
      endedAt: new Date().toISOString(),
      exitCode: 0,
    });
    return { result, operation };
  } catch (error) {
    operations.complete(operationId, {
      state: 'failed',
      endedAt: new Date().toISOString(),
      exitCode: 1,
      partialState: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
