import { useState } from 'react';
import { AuthFlow } from './modules/auth/AuthFlow';
import { getStoredToken, logout } from './modules/auth/auth.service';
import { DashboardPage } from './modules/dashboard/DashboardPage';

type View = 'login' | 'dashboard';

function App() {
  // A valid (not expired) token from a previous visit skips the login
  const [view, setView] = useState<View>(() => (getStoredToken() ? 'dashboard' : 'login'));

  if (view === 'login') {
    // auth.service already stored the token in localStorage (vx_token)
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
