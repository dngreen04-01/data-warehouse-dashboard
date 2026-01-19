import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Login from '@/pages/Login';
import ResetPassword from '@/pages/ResetPassword';
import AppLayout from '@/components/layout/AppLayout';
import { Loader2 } from 'lucide-react';

import Dashboard from '@/pages/Dashboard';
import ProductCalendar from '@/pages/ProductCalendar';
import Statements from '@/pages/Statements';
import ClusterManagement from '@/pages/ClusterManagement';
import ClusterAnalytics from '@/pages/ClusterAnalytics';
import Customers from '@/pages/Customers';
import Products from '@/pages/Products';
import Manufacturing from '@/pages/Manufacturing';
import InvoiceDebug from '@/pages/InvoiceDebug';
import DataMaintenance from '@/pages/DataMaintenance';
import CRM from '@/pages/CRM';
import EmailSubscriptions from '@/pages/EmailSubscriptions';
import UserManagement from '@/pages/UserManagement';
import SupplierStock from '@/pages/SupplierStock';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Redirect suppliers to their portal if they try to access internal pages
  const isSupplierRoute = location.pathname.startsWith('/supplier');
  if (role === 'supplier' && !isSupplierRoute) {
    return <Navigate to="/supplier/stock" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/product-calendar"
            element={
              <ProtectedRoute>
                <ProductCalendar />
              </ProtectedRoute>
            }
          />
          <Route
            path="/crm"
            element={
              <ProtectedRoute>
                <CRM />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clusters"
            element={
              <ProtectedRoute>
                <ClusterManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cluster-analytics"
            element={
              <ProtectedRoute>
                <ClusterAnalytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/statements"
            element={
              <ProtectedRoute>
                <Statements />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute>
                <Customers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <Products />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manufacturing"
            element={
              <ProtectedRoute>
                <Manufacturing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/maintenance"
            element={
              <ProtectedRoute>
                <DataMaintenance />
              </ProtectedRoute>
            }
          />
          <Route
            path="/debug/invoices"
            element={
              <ProtectedRoute>
                <InvoiceDebug />
              </ProtectedRoute>
            }
          />
          <Route
            path="/email-subscriptions"
            element={
              <ProtectedRoute>
                <EmailSubscriptions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <UserManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supplier/stock"
            element={
              <ProtectedRoute>
                <SupplierStock />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter >
  );
}
