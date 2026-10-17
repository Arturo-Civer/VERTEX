import { useState } from 'react';
import { AuthFlow } from './modules/auth/AuthFlow';
import { getStoredToken, logout } from './modules/auth/auth.service';
import { DashboardPage } from './modules/dashboard/DashboardPage';

type View = 'login' | 'dashboard';

function App() {
  // A valid (not expired) token of this tab (e.g. after F5) skips the login;
  // a new tab or window always starts at the login
  const [view, setView] = useState<View>(() => (getStoredToken() ? 'dashboard' : 'login'));

  if (view === 'login') {
    // auth.service already stored the token in sessionStorage (vx_token)
    return <AuthFlow onSuccess={() => setView('dashboard')} />;
  }

  return (
    <DashboardPage
      onLogout={() => {
        logout();
        setView('login');
      }}
    />
  );
}

export default App;
