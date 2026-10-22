import axios from 'axios';

// Development: Vite proxies /api to the Express server.
// Production: VITE_API_URL points at the deployed API (without /api).
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

const API = axios.create({
  baseURL,
  timeout: 180000,
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isAuthAttempt =
      url.includes('/auth/login') || url.includes('/auth/signup');

    if (status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error?.response?.data?.error || error?.message || fallback;
}

export async function downloadApiFile(url, filename) {
  const response = await API.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}

export default API;
