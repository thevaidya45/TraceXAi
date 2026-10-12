import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ReportForm from '../../components/ReportForm.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';

export default function NewReportPage() {
  const { type } = useParams();
  const { user } = useAuth();
  const reportType = type === 'found' ? 'found' : 'lost';
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const communityName = user && user.community && user.community.name ? user.community.name : '';
  const title = useMemo(
    () => (reportType === 'found' ? 'Report Found Item' : 'Report Lost Item'),
    [reportType]
  );

  return (
    <AppShell items={nav} active="Lost & Found" title={title}>
      <section className="panel">
        <ReportForm
          reportType={reportType}
          basePath={basePath}
          communityName={communityName}
        />
      </section>
    </AppShell>
  );
}
