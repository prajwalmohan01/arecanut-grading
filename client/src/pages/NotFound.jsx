import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-7xl font-semibold text-accent/30">404</p>
      <h1 className="mt-3 font-display text-2xl font-semibold text-main">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        The page you requested does not exist or has moved.
      </p>
      <Link to="/home" className="btn-primary mt-6">
        Back to home
      </Link>
    </div>
  );
}
