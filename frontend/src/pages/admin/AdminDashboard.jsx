import { useCallback, useEffect, useState } from 'react';
import AppShell from '../../components/AppShell.jsx';
import DashboardHome from '../../components/DashboardHome.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { getDashboard } from '../../services/dashboardService.js';
import { getAdminReports } from '../../services/reportService.js';
import { getInvestigations } from '../../services/investigationService.js';
import { getAdminUsers, getAdminCommunities } from '../../services/adminService.js';
import { getAdminSightings } from '../../services/sightingService.js';
import { getErrorMessage } from '../../services/api.js';
import { ADMIN_NAV } from '../../nav.js';

function summarize(reports) {
  return {
    total: reports.length,
    lost: reports.filter((item) => item.reportType === 'lost').length,
    found: reports.filter((item) => item.reportType === 'found').length,
    active: reports.filter((item) => item.status === 'active').length
  };
}

function summarizeInvestigations(rows) {
  const open = rows.filter((item) => item.status !== 'CLOSED').length;
  return {
    total: rows.length,
    open
  };
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reportSummary, setReportSummary] = useState({ total: 0, lost: 0, found: 0, active: 0 });
  const [investigationSummary, setInvestigationSummary] = useState({ total: 0, open: 0 });
  const [adminCounts, setAdminCounts] = useState({ users: 0, communities: 0, sightings: 0 });
  const [recentReports, setRecentReports] = useState([]);

  const load = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    Promise.all([
      getDashboard('admin'),
      getAdminReports(),
      getInvestigations(),
      getAdminUsers(),
      getAdminCommunities(),
      getAdminSightings()
    ])
      .then(([, reportsRes, investigationsRes, usersRes, communitiesRes, sightingsRes]) => {
        if (!active) return;
        const reports = reportsRes.data.reports || [];
        setReportSummary(summarize(reports));
        setRecentReports(reports);
        setInvestigationSummary(summarizeInvestigations(investigationsRes.data.investigations || []));
        setAdminCounts({
          users: (usersRes.data.users || []).length,
          communities: (communitiesRes.data.communities || []).length,
          sightings: (sightingsRes.data.sightings || []).length
        });
        setReady(true);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load the dashboard. Please try again.'));
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <AppShell items={ADMIN_NAV} active="Dashboard" title="Dashboard">
      <DashboardHome
        user={user}
        variant="admin"
        error={error}
        onRetry={load}
        ready={ready}
        reportSummary={reportSummary}
        investigationSummary={investigationSummary}
        adminCounts={adminCounts}
        recentReports={recentReports}
      />
    </AppShell>
  );
}
