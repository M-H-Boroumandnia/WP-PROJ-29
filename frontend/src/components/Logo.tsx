import { AudioLines } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to="/" className="logo" aria-label={t("sonoraHome")}>
      <span className="logo-mark">
        <AudioLines />
      </span>
      {!compact && <span>sonora</span>}
    </Link>
  );
}
