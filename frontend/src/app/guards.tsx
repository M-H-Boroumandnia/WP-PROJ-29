import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../store/session";

export function RequireAuth() {
  return useSession() ? <Outlet /> : <Navigate to="/login" replace />;
}
export function GuestOnly() {
  return useSession() ? <Navigate to="/" replace /> : <Outlet />;
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
