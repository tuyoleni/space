import { ToastProvider, TooltipProvider } from '@space/ui';
import { AppShell } from './AppShell';

export function App() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </TooltipProvider>
  );
}
