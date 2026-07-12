import { useEffect } from 'react';
import { useEdge } from '../context/edge';

export function useDashboardData(intervalMs: number = 5000) {
  const { setDashboard, setDiagnostics, setIsConnected, setIsLoading } = useEdge();

  useEffect(() => {
    let active = true;
    const fetchDashboard = async () => {
      try {
        const [dashRes, diagRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/diagnostics')
        ]);
        if (!active) return;
        if (dashRes.ok && diagRes.ok) {
          const dashData = await dashRes.json();
          const diagData = await diagRes.json();
          setDashboard(dashData);
          setDiagnostics(diagData);
          setIsConnected(true);
        } else {
          setIsConnected(false);
        }
      } catch (err) {
        console.error('Failed to poll dashboard data:', err);
        setIsConnected(false);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDashboard();
    const interval = setInterval(fetchDashboard, intervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [intervalMs, setDashboard, setDiagnostics, setIsConnected, setIsLoading]);
}
