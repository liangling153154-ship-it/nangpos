import { useEffect, useState } from 'react';
import { CustomerPage } from './pages/CustomerPage';
import { AdminPage } from './pages/AdminPage';

export function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (pathname.startsWith('/admin')) {
    return <AdminPage />;
  }
  return <CustomerPage />;
}
