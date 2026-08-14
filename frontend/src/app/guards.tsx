import { Navigate, Outlet } from "react-router-dom";
import { useAuthReady, useSession } from "../store/session";

function AuthPending() {
  return (
    <div className="auth-pending" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

export function RequireAuth() {
  const ready = useAuthReady();
  const user = useSession();
  if (!ready) return <AuthPending />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
export function GuestOnly() {
  const ready = useAuthReady();
  const user = useSession();
  if (!ready) return <AuthPending />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}
export function ArtistOnly() {
  const user = useSession();
  return user?.artistProfile ? (
    <Outlet />
  ) : (
    <Navigate to="/forbidden" replace />
  );
}
export function StaffOnly() {
  const user = useSession();
  return user?.kind === "support" || user?.kind === "admin" ? (
    <Outlet />
  ) : (
    <Navigate to="/forbidden" replace />
  );
}
export function AdminOnly() {
  return useSession()?.kind === "admin" ? (
    <Outlet />
  ) : (
    <Navigate to="/forbidden" replace />
  );
}
export function ConsumerOnly() {
  return useSession()?.kind === "consumer" ? (
    <Outlet />
  ) : (
    <Navigate to="/forbidden" replace />
  );
}
export function RoleHome() {
  const user = useSession();
  return user?.kind === "admin" ? (
    <Navigate to="/admin" replace />
  ) : user?.kind === "support" ? (
    <Navigate to="/support" replace />
  ) : (
    <Outlet />
  );
}
