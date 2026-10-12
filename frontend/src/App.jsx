import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RoleProtectedRoute from './components/RoleProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import VerifyOtp from './pages/VerifyOtp.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import AccessDenied from './pages/AccessDenied.jsx';
import StudentDashboard from './pages/student/StudentDashboard.jsx';
import EmployeeDashboard from './pages/employee/EmployeeDashboard.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import UserManagement from './pages/admin/UserManagement.jsx';
import AdminUserDetailsPage from './pages/admin/AdminUserDetailsPage.jsx';
import CommunityManagement from './pages/admin/CommunityManagement.jsx';
import AdminCommunityDetailsPage from './pages/admin/AdminCommunityDetailsPage.jsx';
import Account from './pages/Account.jsx';
import CommunityPage from './pages/CommunityPage.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import LostFoundHub from './pages/reports/LostFoundHub.jsx';
import NewReportPage from './pages/reports/NewReportPage.jsx';
import MyReportsPage from './pages/reports/MyReportsPage.jsx';
import ReportDetailsPage from './pages/reports/ReportDetailsPage.jsx';
import AdminReportsPage from './pages/admin/AdminReportsPage.jsx';
import AdminReportDetailsPage from './pages/admin/AdminReportDetailsPage.jsx';
import AdminSightingsPage from './pages/admin/AdminSightingsPage.jsx';
import AdminSightingDetailsPage from './pages/admin/AdminSightingDetailsPage.jsx';
import AdminInvestigationDetailsPage from './pages/admin/AdminInvestigationDetailsPage.jsx';
import AdminInvestigationsPage from './pages/admin/AdminInvestigationsPage.jsx';
import AdminInvestigationCreatePage from './pages/admin/AdminInvestigationCreatePage.jsx';
import SightingsPage from './pages/sightings/SightingsPage.jsx';
import SightingFormPage from './pages/sightings/SightingFormPage.jsx';
import SightingDetailsPage from './pages/sightings/SightingDetailsPage.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Landing from './pages/Landing.jsx';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }
  if (!user) {
    return <Landing />;
  }
  if (user.role === 'student') {
    return <Navigate to="/student/dashboard" replace />;
  }
  if (user.role === 'employee') {
    return <Navigate to="/employee/dashboard" replace />;
  }
  if (user.role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/verify-otp" element={<VerifyOtp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/access-denied" element={<AccessDenied />} />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/community"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <CommunityPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/community"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <CommunityPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/dashboard"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <StudentDashboard />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/dashboard"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <EmployeeDashboard />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminDashboard />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminUserDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <UserManagement />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/communities/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminCommunityDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/communities"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <CommunityManagement />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/lost-found"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <LostFoundHub />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/reports/new/:type"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <NewReportPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/reports/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <ReportDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/reports"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <MyReportsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/lost-found"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <LostFoundHub />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/reports/new/:type"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <NewReportPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/reports/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <ReportDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/reports"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <MyReportsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/sightings/new"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <SightingFormPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/sightings/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <SightingDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/sightings"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['student']}>
              <SightingsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/sightings/new"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <SightingFormPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/sightings/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <SightingDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee/sightings"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['employee']}>
              <SightingsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/sightings/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminSightingDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/sightings"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminSightingsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/investigations/new"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminInvestigationCreatePage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/investigations/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminInvestigationDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/investigations"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminInvestigationsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reports/:id"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminReportDetailsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute roles={['admin']}>
              <AdminReportsPage />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
