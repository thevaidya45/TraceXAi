import { Link } from 'react-router-dom';

export default function Navbar({ items, active, onNavigate }) {
  return (
    <nav className="primary-nav" aria-label="Main">
      {items.map((item) => {
        const label = typeof item === 'string' ? item : item.label;
        const to = typeof item === 'object' ? item.to : null;
        const className = label === active ? 'nav-link is-active' : 'nav-link';
        if (to) {
          return (
            <Link key={label} to={to} className={className} onClick={onNavigate}>
              {label}
            </Link>
          );
        }
        return (
          <span key={label} className={`${className} is-static`}>
            {label}
          </span>
        );
      })}
    </nav>
  );
}
