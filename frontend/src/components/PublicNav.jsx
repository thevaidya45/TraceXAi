import { Link } from 'react-router-dom';

export default function PublicNav() {
  return (
    <header className="public-nav">
      <div className="public-nav-inner">
        <Link to="/" className="brand-mark">
          TraceX AI
        </Link>
      </div>
    </header>
  );
}
