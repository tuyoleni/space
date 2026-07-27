import { ToastProvider, TooltipProvider } from '@space/ui';
import { AppShell } from './AppShell';
import { OnboardingWizard } from './OnboardingWizard';

export function App() {
  const isOnboardingWindow = new URLSearchParams(window.location.search).has('onboarding');
  return (
    <TooltipProvider>
      <ToastProvider>
        {isOnboardingWindow ? <OnboardingWizard /> : <AppShell />}
      </ToastProvider>
    </TooltipProvider>
  );
}
