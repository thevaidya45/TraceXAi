import { Link } from 'react-router-dom';
import ClickableRow from './ClickableRow.jsx';
import EmptyState from './EmptyState.jsx';
import ErrorRetry from './ErrorRetry.jsx';
import { formatReportDate, statusLabel, typeLabel } from '../services/reportService.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function reportHref(variant, id) {
  if (variant === 'admin') return `/admin/reports/${id}`;
  if (variant === 'employee') return `/employee/reports/${id}`;
  return `/student/reports/${id}`;
}

function MetricCard({ label, value, to, cta }) {
  return (
    <article className="metric-card">
      <h2>{label}</h2>
      <p className="metric-value">{value}</p>
      {to ? (
        <Link to={to} className="card-link">
          {cta}
        </Link>
      ) : null}
    </article>
  );
}

export default function DashboardHome({
  user,
  communityName,
  variant,
  error,
  onRetry,
  ready,
  reportSummary,
  investigationSummary,
  adminCounts,
  recentReports,
  sightingCount
}) {
  const firstName = user && user.name ? user.name.split(' ')[0] : '';
  const isAdmin = variant === 'admin';
  const isEmployee = variant === 'employee';
  const basePath = isAdmin ? '/admin' : isEmployee ? '/employee' : '/student';
  const lostCount = reportSummary ? reportSummary.lost : 0;
  const foundCount = reportSummary ? reportSummary.found : 0;
  const activeCount = reportSummary ? reportSummary.active : 0;
  const totalCount = reportSummary ? reportSummary.total : 0;
  const investigationTotal = investigationSummary ? investigationSummary.total : 0;
  const investigationOpen = investigationSummary ? investigationSummary.open : 0;
  const counts = adminCounts || { users: 0, communities: 0, sightings: 0 };
  const reports = Array.isArray(recentReports) ? recentReports.slice(0, 8) : [];

  return (
    <>
      <p className="lede">
        {greeting()}
        {firstName ? `, ${firstName}` : ''}.
        {!isAdmin && communityName ? ` You are signed in to ${communityName}.` : ''}
      </p>
      <ErrorRetry message={error} onRetry={onRetry} />
      {!ready && !error ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : null}
      {ready && !error && (
        <>
          {isAdmin ? (
            <>
              <section className="metric-grid" aria-label="Overview">
                <MetricCard
                  label="Users"
                  value={counts.users}
                  to="/admin/users"
                  cta="Open users"
                />
                <MetricCard
                  label="Communities"
                  value={counts.communities}
                  to="/admin/communities"
                  cta="Open communities"
                />
                <MetricCard
                  label="Lost & Found"
                  value={totalCount}
                  to="/admin/reports"
                  cta="Manage reports"
                />
                <MetricCard
                  label="Sightings"
                  value={counts.sightings}
                  to="/admin/sightings"
                  cta="Open sightings"
                />
                <MetricCard
                  label="Investigations"
                  value={investigationTotal}
                  to="/admin/investigations"
                  cta="Open investigations"
                />
              </section>
              <p className="muted-text dashboard-note">
                {activeCount} active report{activeCount === 1 ? '' : 's'}. {investigationOpen} open
                investigation{investigationOpen === 1 ? '' : 's'}. Automated CCTV analysis is not run here.
              </p>
            </>
          ) : (
            <section className="metric-grid" aria-label="Overview">
              <MetricCard
                label="Lost reports"
                value={lostCount}
                to={`${basePath}/reports/new/lost`}
                cta="Report lost item"
              />
              <MetricCard
                label="Found reports"
                value={foundCount}
                to={`${basePath}/reports/new/found`}
                cta="Report found item"
              />
              <MetricCard
                label="Sightings"
                value={typeof sightingCount === 'number' ? sightingCount : '—'}
                to={`${basePath}/sightings`}
                cta="View sightings"
              />
            </section>
          )}

          <section className="section-block">
            <header className="section-head">
              <h2>Recent reports</h2>
            </header>
            {reports.length === 0 ? (
              <EmptyState
                title="No lost or found reports"
                body={
                  isAdmin
                    ? 'Reports from campus communities will appear here.'
                    : `Submit a report for ${communityName || 'your community'} to start tracking an item.`
                }
                action={
                  isAdmin ? (
                    <Link to="/admin/reports" className="btn btn-secondary btn-small">
                      Open Lost &amp; Found
                    </Link>
                  ) : (
                    <Link to={`${basePath}/lost-found`} className="btn btn-primary btn-small">
                      Report an item
                    </Link>
                  )
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Community</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <ClickableRow
                        key={report.id}
                        to={reportHref(variant, report.id)}
                        label={`Open ${report.itemName || 'report'}`}
                      >
                        <td>{report.itemName}</td>
                        <td>{typeLabel(report.reportType)}</td>
                        <td>{report.community && report.community.name ? report.community.name : '—'}</td>
                        <td>
                          <span className={`badge ${report.status === 'active' ? 'badge-ok' : report.status === 'invalid' ? 'badge-error' : 'badge-warn'}`}>
                            {statusLabel(report.status)}
                          </span>
                        </td>
                        <td>{formatReportDate(report.createdAt || report.approximateDate)}</td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
