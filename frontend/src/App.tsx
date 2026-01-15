import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Login from '@/pages/Login';
import AppLayout from '@/components/layout/AppLayout';
import { Loader2 } from 'lucide-react';

import Dashboard from '@/pages/Dashboard';
import ProductCalendar from '@/pages/ProductCalendar';
import Statements from '@/pages/Statements';
import ClusterManagement from '@/pages/ClusterManagement';
import Customers from '@/pages/Customers';
import Products from '@/pages/Products';
import Manufacturing from '@/pages/Manufacturing';
import InvoiceDebug from '@/pages/InvoiceDebug';
import DataMaintenance from '@/pages/DataMaintenance';
import CRM from '@/pages/CRM';
import EmailSubscriptions from '@/pages/EmailSubscriptions';
import UserManagement from '@/pages/UserManagement';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

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

  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
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
        </Routes>
      </AuthProvider>
    </BrowserRouter >
  );
}
