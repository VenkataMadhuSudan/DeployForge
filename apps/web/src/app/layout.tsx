import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'DeployForge | Automated Website Deployment & Management',
  description: 'Fast, secure and automated website deployments from Git',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <Link href="/dashboard" className="flex items-center space-x-2">
                <span className="text-xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                  DeployForge
                </span>
              </Link>
              <nav className="flex space-x-4 text-sm font-medium">
                <Link href="/dashboard" className="text-slate-300 hover:text-white transition">
                  Projects
                </Link>
                <Link href="/projects/new" className="text-slate-300 hover:text-white transition">
                  New Project
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4 text-sm">
              <Link
                href="/login"
                className="text-slate-400 hover:text-slate-200 transition"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-3.5 py-1.5 rounded-md transition"
              >
                Get Started
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
          DeployForge &copy; 2026. Automated Website Deployment Platform.
        </footer>
      </body>
    </html>
  );
}
