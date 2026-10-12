import { useNavigate } from 'react-router-dom';

export default function ClickableRow({ to, label, children }) {
  const navigate = useNavigate();

  function open(event) {
    if (event.defaultPrevented) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.button === 1) {
      window.open(to, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(to);
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      navigate(to);
    }
  }

  return (
    <tr
      className="clickable-row"
      tabIndex={0}
      role="link"
      aria-label={label}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      {children}
    </tr>
  );
}

export function RowActions({ children }) {
  return (
    <td
      className="row-action-cell"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </td>
  );
}
