/**
 * Environment precedence model (spec section 5.3).
 *
 * The final environment for a process is assembled in a fixed order, where
 * later layers may override approved keys from earlier layers:
 *   1. Sanitised operating-system base environment.
 *   2. Space machine-tool paths.
 *   3. Workspace tool paths and configuration variables.
 *   4. Workspace non-secret variables.
 *   5. Project runtime and project non-secret variables.
 *   6. Approved secure-secret values.
 *   7. Temporary operation-specific variables.
 *
 * The runner maintains an allow/deny policy for inherited host variables:
 * sensitive host values that do not belong to the workspace are never
 * inherited blindly.
 */

export type EnvironmentLayer = Readonly<Record<string, string>>;

export interface EnvironmentPolicy {
  /**
   * Host variables copied from the OS base environment. Anything not
   * listed is dropped before workspace layers apply.
   */
  readonly inheritAllowList: readonly string[];
  /**
   * Explicitly banned keys: never present in the final environment even if
   * a later layer tries to set them (defence in depth for host secrets).
   */
  readonly denyList: readonly string[];
}

export interface EnvironmentInput {
  readonly osBase: EnvironmentLayer;
  readonly machineToolPaths: EnvironmentLayer;
  readonly workspaceToolConfig: EnvironmentLayer;
  readonly workspaceVars: EnvironmentLayer;
  readonly projectVars: EnvironmentLayer;
  readonly secrets: EnvironmentLayer;
  readonly operationVars: EnvironmentLayer;
  readonly policy: EnvironmentPolicy;
}

/**
 * Deterministically assemble the final child-process environment.
 * Pure function: same input always produces the same output (P0-C).
 */
export function buildEnvironment(input: EnvironmentInput): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of input.policy.inheritAllowList) {
    const value = input.osBase[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }

  const layers: readonly EnvironmentLayer[] = [
    input.machineToolPaths,
    input.workspaceToolConfig,
    input.workspaceVars,
    input.projectVars,
    input.secrets,
    input.operationVars,
  ];
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      result[key] = value;
    }
  }

  for (const banned of input.policy.denyList) {
    delete result[banned];
  }

  return result;
}
