/**
 * Error Boundary: catches React rendering errors and shows a recovery UI
 * instead of crashing the entire app. Provides "Try Again" and "Copy Error"
 * actions, plus a fallback render prop for custom error UIs.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from '@space/ui';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly onReset?: () => void;
  readonly onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  readonly errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ error: null, errorInfo: null });
    this.props.onReset?.();
  };

  private handleCopy = (): void => {
    const { error, errorInfo } = this.state;
    if (!error) return;
    const text = [
      `Error: ${error.message}`,
      error.stack && `\nStack:\n${error.stack}`,
      errorInfo?.componentStack && `\nComponent Stack:\n${errorInfo.componentStack}`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(text);
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10">
            <AlertTriangle size={24} className="text-danger" />
          </div>
          <h3 className="text-sm font-semibold text-fg">Something went wrong</h3>
          <p className="mt-1 max-w-sm text-xs text-fg-muted">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={this.handleCopy}>
              <Copy size={12} className="mr-1" />
              Copy Error
            </Button>
            <Button variant="primary" size="sm" onClick={this.handleReset}>
              <RefreshCw size={12} className="mr-1" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
