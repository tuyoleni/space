import { ToastProvider, TooltipProvider } from '@space/ui';
import { AppShell } from './AppShell';
import { OnboardingWizard } from './OnboardingWizard';
import { usePointerEventsGuard } from './use-pointer-events-guard';

export function App() {
  usePointerEventsGuard();
  const isOnboardingWindow = new URLSearchParams(window.location.search).has('onboarding');
  return (
    <TooltipProvider>
      <ToastProvider>
        {isOnboardingWindow ? <OnboardingWizard /> : <AppShell />}
      </ToastProvider>
    </TooltipProvider>
  );
}
