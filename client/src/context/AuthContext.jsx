import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import API from '../api/axios';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(readStoredUser);
  const [booting, setBooting] = useState(Boolean(token));
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    if (readStoredUser()?.theme) return readStoredUser().theme;
    return 'light';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    function expire() {
      setToken(null);
      setUser(null);
    }
    window.addEventListener('auth:expired', expire);
    return () => window.removeEventListener('auth:expired', expire);
  }, []);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setBooting(false);
      return () => {
        alive = false;
      };
    }
    setBooting(true);
    API.get('/auth/me')
      .then((response) => {
        if (!alive) return;
        const nextUser = response.data.user;
        setUser(nextUser);
        localStorage.setItem('user', JSON.stringify(nextUser));
        if (nextUser.theme && nextUser.theme !== theme) {
          setThemeState(nextUser.theme);
          localStorage.setItem('theme', nextUser.theme);
        }
      })
      .catch(() => {
        if (!alive) return;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
    // Theme is read once during session bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const adoptSession = useCallback((data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setBooting(false);
    if (data.user?.theme) {
      setThemeState(data.user.theme);
      localStorage.setItem('theme', data.user.theme);
    }
  }, []);

  const login = useCallback(
    async (username, password) => {
      const response = await API.post('/auth/login', { username, password });
      adoptSession(response.data);
      return response.data.user;
    },
    [adoptSession]
  );

  const signup = useCallback(
    async (payload) => {
      const response = await API.post('/auth/signup', payload);
      adoptSession(response.data);
      return response.data.user;
    },
    [adoptSession]
  );

  const logout = useCallback(async () => {
    try {
      await API.post('/auth/logout');
    } catch {
      // Stateless JWT logout: clearing local credentials is sufficient.
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }
  }, []);

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser);
    localStorage.setItem('user', JSON.stringify(nextUser));
  }, []);

  const setTheme = useCallback(
    async (nextTheme) => {
      const value = nextTheme === 'dark' ? 'dark' : 'light';
      setThemeState(value);
      localStorage.setItem('theme', value);
      applyTheme(value);
      if (token) {
        try {
          const response = await API.put('/auth/profile', { theme: value });
          setUser(response.data.user);
          localStorage.setItem('user', JSON.stringify(response.data.user));
        } catch {
          // Local theme still applies if the preference cannot be saved.
        }
      }
    },
    [token]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      booting,
      theme,
      isAuthenticated: Boolean(token),
      login,
      signup,
      logout,
      updateUser,
      setTheme,
      toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    }),
    [token, user, booting, theme, login, signup, logout, updateUser, setTheme]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
