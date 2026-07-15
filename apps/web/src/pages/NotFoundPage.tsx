import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="page narrow-page">
      <h1>Coordinate not found</h1>
      <p>This route is outside the current voice atlas.</p>
      <Link className="button button--primary" to="/">
        Return home
      </Link>
    </div>
  );
}
