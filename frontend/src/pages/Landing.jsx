import { Link } from 'react-router-dom';
import PublicNav from '../components/PublicNav.jsx';

export default function Landing() {
  return (
    <div className="landing-page">
      <PublicNav />
      <main>
        <section className="landing-hero">
          <p className="status-badge">Campus platform</p>
          <p className="landing-kicker">TraceX AI</p>
          <h1>AI-Based Missing Item Detection System</h1>
          <p className="landing-lead">
            Manage lost and found reports and investigate missing items through a centralized campus
            platform.
          </p>
          <div className="landing-cta">
            <Link className="btn btn-primary" to="/register">
              Get Started
            </Link>
            <Link className="btn btn-secondary" to="/login">
              Sign In
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
