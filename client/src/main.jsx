import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Apply the persisted theme before the first paint to avoid a flash.
try {
  const stored = localStorage.getItem('theme');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const theme = stored || user?.theme || 'light';
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
