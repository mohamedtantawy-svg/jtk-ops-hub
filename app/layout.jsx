import 'bootstrap-icons/font/bootstrap-icons.min.css';
import '../src/index.css';

export const metadata = {
  title: 'Deel Ops Hub',
  description: 'Deel Ops Hub — HR Operations command center. Unified task queue, escalations, calendar and knowledge base for HR Ops teams.',
  robots: 'noindex,nofollow',
  openGraph: {
    title: 'Deel Ops Hub',
    description: 'HR Operations command center — unified task management for Deel HRX teams.',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23ed5e2a'/><text x='16' y='22' text-anchor='middle' font-size='18' font-family='sans-serif' fill='%231b1b1b'>⊞</text></svg>" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a href="#main" style={{position:'absolute',left:'-9999px',top:'auto',width:'1px',height:'1px',overflow:'hidden'}}>Skip to content</a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
