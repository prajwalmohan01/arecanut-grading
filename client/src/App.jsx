import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Result from './pages/Result';
import History from './pages/History';
import Lots from './pages/Lots';
import LotDetail from './pages/LotDetail';
import Compare from './pages/Compare';
import Performance from './pages/Performance';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';
import { LeafIcon } from './components/Icons';
import Spinner from './components/ui/Spinner';

const ManualDashboard = lazy(() => import('./pages/manual/ManualDashboard'));
const ManualNew = lazy(() => import('./pages/manual/ManualNew'));
const ManualRecords = lazy(() => import('./pages/manual/ManualRecords'));
const ManualRecordDetail = lazy(() => import('./pages/manual/ManualRecordDetail'));
const ManualBatches = lazy(() => import('./pages/manual/ManualBatches'));
const ManualBatchDetail = lazy(() => import('./pages/manual/ManualBatchDetail'));
const ManualCompare = lazy(() => import('./pages/manual/ManualCompare'));
const ManualGallery = lazy(() => import('./pages/manual/ManualGallery'));
const ManualCalculator = lazy(() => import('./pages/manual/ManualCalculator'));
const ManualActivity = lazy(() => import('./pages/manual/ManualActivity'));
const VerifyAssessment = lazy(() => import('./pages/VerifyAssessment'));


function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-emerald-600 text-white shadow-lg">
        <LeafIcon width={26} height={26} />
      </span>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner size={15} />
        Loading your workspace…
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, booting } = useAuth();
  const location = useLocation();
  if (booting) return <Splash />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function PublicOnlyRoute({ children }) {
  const { isAuthenticated, booting } = useAuth();
  const location = useLocation();
  if (booting) return <Splash />;
  if (isAuthenticated) {
    return <Navigate to={location.state?.from || '/home'} replace />;
  }
  return children;
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Suspense fallback={<Splash />}>
            <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <Login />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/signup"
              element={
                <PublicOnlyRoute>
                  <Signup />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/home"
              element={
                <ProtectedRoute>
                  <Home />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/upload"
              element={
                <ProtectedRoute>
                  <Upload />
                </ProtectedRoute>
              }
            />
            <Route
              path="/result"
              element={
                <ProtectedRoute>
                  <Result />
                </ProtectedRoute>
              }
            />
            <Route
              path="/result/:id"
              element={
                <ProtectedRoute>
                  <Result />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <History />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lots"
              element={
                <ProtectedRoute>
                  <Lots />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lots/:id"
              element={
                <ProtectedRoute>
                  <LotDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/compare"
              element={
                <ProtectedRoute>
                  <Compare />
                </ProtectedRoute>
              }
            />
            <Route
              path="/performance"
              element={
                <ProtectedRoute>
                  <Performance />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual"
              element={
                <ProtectedRoute>
                  <ManualDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/new"
              element={
                <ProtectedRoute>
                  <ManualNew />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/records"
              element={
                <ProtectedRoute>
                  <ManualRecords />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/records/:id"
              element={
                <ProtectedRoute>
                  <ManualRecordDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/batches"
              element={
                <ProtectedRoute>
                  <ManualBatches />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/batches/:id"
              element={
                <ProtectedRoute>
                  <ManualBatchDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/compare"
              element={
                <ProtectedRoute>
                  <ManualCompare />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/gallery"
              element={
                <ProtectedRoute>
                  <ManualGallery />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/calculator"
              element={
                <ProtectedRoute>
                  <ManualCalculator />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual/activity"
              element={
                <ProtectedRoute>
                  <ManualActivity />
                </ProtectedRoute>
              }
            />
            <Route
              path="/verify/:token"
              element={<VerifyAssessment />}
            />
            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
