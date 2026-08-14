import { useTranslation } from "react-i18next";

export function RewardFormula() {
  const { t } = useTranslation();
  return (
    <div className="reward-equation" aria-label={t("rewardFormulaHint")}>
      <span className="reward-equation-lhs">{t("artistReward")}</span>
      <span className="reward-equation-op">=</span>
      <span className="reward-equation-fn">round</span>
      <span className="reward-equation-paren">(</span>
      <span className="reward-equation-frac">
        <span className="reward-equation-num">
          ({t("uniqueListeners")} × 150) + ({t("validStreams")} × 25)
        </span>
        <span className="reward-equation-den">1000</span>
      </span>
      <span className="reward-equation-paren">)</span>
      <span className="reward-equation-op">×</span>
      <span>1000 {t("toman")}</span>
    </div>
  );
}
