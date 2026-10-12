export default function AuthSplit({ kicker, title, lead, children }) {
  return (
    <div className="login-page">
      <a className="skip-link" href="#auth-form">
        Skip to form
      </a>
      <div className="login-shell">
        <header className="login-branding">
          <p className="login-logo">TraceX AI</p>
          <p className="login-subtitle">AI-Based Missing Item Detection System</p>
        </header>
        <section className="login-card" id="auth-form">
          {kicker ? <p className="login-kicker">{kicker}</p> : null}
          {title ? <h1>{title}</h1> : null}
          {lead ? <p className="login-lead">{lead}</p> : null}
          {children}
        </section>
      </div>
    </div>
  );
}
