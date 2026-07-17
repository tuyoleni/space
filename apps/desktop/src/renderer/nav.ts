/**
 * Sidebar nav shows the first four ('changes' is labelled "GitHub" — it
 * carries the GitHub account card alongside the rest of the change-tracking
 * workflow); 'projects' and 'system' are reachable from in-content links
 * (Open All Projects, Open Activity Monitor) rather than the nav rail.
 */
export type NavView =
  | 'home'
  | 'changes'
  | 'terminal'
  | 'environment'
  | 'projects'
  | 'system';
