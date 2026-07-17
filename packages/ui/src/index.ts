/**
 * @space/ui
 *
 * Shared renderer components (presentation only). Must not import Node
 * core modules, perform IPC calls directly, or contain business logic
 * (spec section 33) — components receive data and callbacks as props.
 *
 * `relative-time.ts` is pure formatting logic (spec 28's "relative times
 * expose exact accessible labels") deliberately kept dependency-free of
 * React/JSX so it stays testable under this repo's Node-only test runner;
 * the renderer itself does the actual `<time>` markup with it.
 */
export * from './relative-time';
export * from './identity-color';
export * from './cn';
export * from './components/Button';
export * from './components/IconButton';
export * from './components/Card';
export * from './components/Badge';
export * from './components/StatusDot';
export * from './components/Input';
export * from './components/Select';
export * from './components/Checkbox';
export * from './components/Tabs';
export * from './components/Tooltip';
export * from './components/Separator';
export * from './components/ScrollArea';
export * from './components/Dialog';
export * from './components/EmptyState';
export * from './components/InlineBanner';
export * from './components/Toast';
export * from './components/NavItem';
export * from './components/Topbar';
