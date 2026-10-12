import BackLink from './BackLink.jsx';

export default function RecordNotFound({ title, to, backLabel }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="muted-text">This record is not available, or you do not have access to it.</p>
      <p className="lede">
        <BackLink to={to}>{backLabel}</BackLink>
      </p>
    </section>
  );
}
