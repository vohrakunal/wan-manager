import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach JWT to every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Redirect to login on 401
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const login = (username, password) =>
  axios.post('/api/auth/login', { username, password });

// WAN
export const getWanStatus     = ()   => api.get('/wan/status');
export const getWanPublicIp   = ()   => api.get('/wan/publicip');
export const getWanLatency    = ()   => api.get('/wan/latency');
export const getThroughputHistory = (limit = 150) => api.get(`/wan/throughput/history?limit=${limit}`);

// Failover
export const setECMP          = ()        => api.post('/failover/ecmp');
export const setZteOnly       = ()        => api.post('/failover/zte-only');
export const setDigisolOnly   = ()        => api.post('/failover/digisol-only');
export const runSetup         = ()        => api.post('/failover/run-setup');
export const setHashPolicy    = (policy)  => api.post('/failover/hash-policy', { policy });
export const restartService   = (service) => api.post('/failover/restart-service', { service });

// Routing
export const getAllRoutes      = ()   => api.get('/routing/all');
export const getRoutingRules  = ()   => api.get('/routing/rules');
export const fixRoutes        = ()   => api.post('/routing/fix');

// DHCP
export const getDhcpLeases        = ()    => api.get('/dhcp/leases');
export const getDhcpReservations  = ()    => api.get('/dhcp/reservations');
export const addReservation       = (data) => api.post('/dhcp/reservations', data);
export const deleteReservation    = (mac)  => api.delete(`/dhcp/reservations/${encodeURIComponent(mac)}`);
export const restartDhcp          = ()    => api.post('/dhcp/restart');

// Logs
export const getFailoverLog  = (lines = 200) => api.get(`/logs/failover?lines=${lines}`);
export const getManagerLog   = (lines = 200) => api.get(`/logs/manager?lines=${lines}`);
export const getActionLogs   = (limit = 50)  => api.get(`/logs/actions?limit=${limit}`);

// Services
export const getServices        = ()                       => api.get('/services');
export const serviceAction      = (name, action)           => api.post(`/services/${encodeURIComponent(name)}/${action}`);

export default api;
