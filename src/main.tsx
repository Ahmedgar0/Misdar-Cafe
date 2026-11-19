import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminApp } from './admin/AdminApp';
import { Shell } from './components/Shell';
import { Cart } from './pages/Cart';
import { Home } from './pages/Home';
import { InvoicePage } from './pages/InvoicePage';
import { Login } from './pages/Login';
import { MenuPage } from './pages/MenuPage';
import { OrderPage } from './pages/OrderPage';
import { Pay, PayReturn } from './pages/Pay';
import { Rewards } from './pages/Rewards';
import { TableEntry } from './pages/TableEntry';
import { AppProvider } from './state';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/invoice/:id" element={<InvoicePage />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/t/:n" element={<TableEntry />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/login" element={<Login />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/pay/return" element={<PayReturn />} />
            <Route path="/pay/:id" element={<Pay />} />
            <Route path="/order/:id" element={<OrderPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
