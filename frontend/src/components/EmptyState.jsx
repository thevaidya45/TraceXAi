export default function EmptyState({ title, body, action }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {body ? <span>{body}</span> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
