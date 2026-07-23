import { Compass, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function ErrorPage({ forbidden = false }: { forbidden?: boolean }) {
  const { t } = useTranslation();
  const Icon = forbidden ? LockKeyhole : Compass;
  return (
    <div className="page error-page">
      <Icon />
      <span className="eyebrow">{forbidden ? "403" : "404"}</span>
      <h1>{t(forbidden ? "forbidden" : "notFound")}</h1>
      <Link to="/" className="button primary">
        {t("goHome")}
      </Link>
    </div>
  );
}
