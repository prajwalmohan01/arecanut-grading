import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import API from '../api/axios';
import { useAuth } from './AuthContext';

const PolicyContext = createContext(null);

const FALLBACK_POLICY = {
  version: 1,
  masterEnabled: true,
  enabledLetters: ['A', 'B'],
  grades: { A: true, B: true, C: false, D: false },
  geminiEnabled: false,
  defectDetectionEnabled: false,
  defectCategories: {
    blackSpots: true,
    cracks: true,
    mold: true,
    discoloration: true,
  },
  enabledDefectCategories: [],
  defectGeminiEnabled: false,
  pricingMode: 'none',
  currency: 'INR',
  geminiConfigured: false,
  marketKeyConfigured: false,
};

const FALLBACK_VALUE = {
  policy: FALLBACK_POLICY,
  pricing: null,
  gemini: null,
  loading: false,
  error: '',
  refresh: () => {},
};

export function PolicyProvider({ children }) {
  const { isAuthenticated, token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await API.get('/settings');
      setData(response.data || null);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          'Prediction display settings could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load, token]);

  const value = useMemo(() => {
    if (!data) {
      return {
        ...FALLBACK_VALUE,
        loading,
        error,
        refresh: load,
      };
    }
    return {
      policy: { ...FALLBACK_POLICY, ...(data.policy || {}) },
      pricing: data.pricing || null,
      gemini: data.gemini || null,
      loading,
      error,
      refresh: load,
    };
  }, [data, error, load, loading]);

  return <PolicyContext.Provider value={value}>{children}</PolicyContext.Provider>;
}

export function usePolicy() {
  const context = useContext(PolicyContext);
  if (!context) throw new Error('usePolicy must be used inside PolicyProvider');
  return context;
}
