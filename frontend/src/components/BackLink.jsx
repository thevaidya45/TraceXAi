import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function BackLink({ to, children }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Link
      to={to}
      onClick={(event) => {
        if (location.key && location.key !== 'default') {
          event.preventDefault();
          navigate(-1);
        }
      }}
    >
      {children}
    </Link>
  );
}
