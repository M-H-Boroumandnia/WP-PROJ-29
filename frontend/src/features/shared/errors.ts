import type { TFunction } from "i18next";
import { RepositoryError } from "../../repositories/localRepository";

export function uiError(reason: unknown, t: TFunction): string {
  if (reason instanceof RepositoryError) {
    const translated = t(reason.code);
    if (translated !== reason.code) return translated;
    if (reason.code === "network_error" || reason.code === "api_unavailable")
      return reason.message;
    return t("error");
  }
  return t("error");
}
