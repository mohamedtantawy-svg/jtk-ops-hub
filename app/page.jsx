'use client';

import App from '../src/App';
import ErrorBoundary from '../src/components/ui/ErrorBoundary';

export default function Page() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
