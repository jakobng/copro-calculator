const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

export const API_BASE_URL =
  configuredApiBaseUrl ?? (isLocalhost ? '' : 'https://copro-backend-56z5.onrender.com')
