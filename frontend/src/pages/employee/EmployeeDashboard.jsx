import { useCallback, useEffect, useState } from 'react';
import AppShell from '../../components/AppShell.jsx';
import DashboardHome from '../../components/DashboardHome.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { getDashboard } from '../../services/dashboardService.js';
import { getMyReports } from '../../services/reportService.js';
import { getSightings } from '../../services/sightingService.js';
import { getErrorMessage } from '../../services/api.js';
import { EMPLOYEE_NAV } from '../../nav.js';

function summarize(reports) {
  return {
    total: reports.length,
    lost: reports.filter((item) => item.reportType === 'lost').length,
    found: reports.filter((item) => item.reportType === 'found').length,
    active: reports.filter((item) => item.status === 'active').length
  };
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reportSummary, setReportSummary] = useState({ total: 0, lost: 0, found: 0, active: 0 });
  const [recentReports, setRecentReports] = useState([]);
  const [sightingCount, setSightingCount] = useState(0);

  const load = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    Promise.all([getDashboard('employee'), getMyReports(), getSightings()])
      .then(([, reportsRes, sightingsRes]) => {
        if (!active) return;
        const reports = reportsRes.data.reports || [];
        setReportSummary(summarize(reports));
        setRecentReports(reports);
        setSightingCount((sightingsRes.data.sightings || []).length);
        setReady(true);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load the dashboard. Please try again.'));
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const communityName = user && user.community ? user.community.name : '';

  return (
    <AppShell items={EMPLOYEE_NAV} active="Dashboard" title="Dashboard">
      <DashboardHome
        user={user}
        communityName={communityName}
        variant="employee"
        error={error}
        onRetry={load}
        ready={ready}
        reportSummary={reportSummary}
        recentReports={recentReports}
        sightingCount={sightingCount}
      />
    </AppShell>
  );
}
