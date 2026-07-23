import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Eye, EyeOff, Music2 } from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormSetError } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "../../components/Logo";
import { DEMO_PASSWORD } from "../../data/seed";
import type { Locale, RegistrationInput } from "../../domain/types";
import { locales } from "../../i18n";
import { RepositoryError } from "../../repositories/errors";
import { repository } from "../../repositories/localRepository";
import { uiError } from "../shared/errors";

const demoUsers = [
  { email: "listener.basic@sonora.demo", name: "Nila", labelKey: "demoBasic" },
  {
    email: "listener.silver@sonora.demo",
    name: "Milo",
    labelKey: "demoSilver",
  },
  { email: "listener.gold@sonora.demo", name: "Ari", labelKey: "demoGold" },
  {
    email: "artist.unverified@sonora.demo",
    name: "Cedar",
    labelKey: "demoArtist",
  },
  {
    email: "artist.verified@sonora.demo",
    name: "Nova",
    labelKey: "demoVerifiedArtist",
  },
  { email: "support@sonora.demo", name: "Sonora", labelKey: "supportRole" },
  { email: "admin@sonora.demo", name: "Sonora", labelKey: "adminRole" },
];

const fieldFromServer = (field: string): keyof RegisterForm | null => {
  const mapping: Record<string, keyof RegisterForm> = {
    displayName: "displayName",
    stageName: "stageName",
    email: "email",
    password: "password",
    birthDate: "birthDate",
    gender: "gender",
    locale: "locale",
    timezone: "locale",
  };
  return mapping[field] ?? null;
};

const codeFromDetail = (detail: unknown, fallback: string): string => {
  const first = Array.isArray(detail) ? detail[0] : detail;
  if (first && typeof first === "object" && "code" in first)
    return String(first.code);
  return fallback;
};

const applyRegistrationServerErrors = (
  reason: unknown,
  setFieldError: UseFormSetError<RegisterForm>,
): boolean => {
  if (!(reason instanceof RepositoryError)) return false;
  const details = reason.details;
  let applied = false;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const [field, detail] of Object.entries(details)) {
      const formField = fieldFromServer(field);
      if (!formField) continue;
      setFieldError(formField, {
        type: "server",
        message: codeFromDetail(detail, reason.code),
      });
      applied = true;
    }
  }
  if (!applied && reason.code === "email_exists") {
    setFieldError("email", { type: "server", message: "email_exists" });
    applied = true;
  }
  return applied;
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [error, setError] = useState("");
  const [toastKey] = useState(() => {
    const routed = (location.state as { toastKey?: string } | null)?.toastKey;
    const stored = sessionStorage.getItem("sonora:logout-toast");
    if (stored) sessionStorage.removeItem("sonora:logout-toast");
    return routed ?? stored;
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string; password: string }>({
    defaultValues: { email: "", password: "" },
  });
  const login = async (email: string, password: string) => {
    setError("");
    try {
      await Promise.resolve(repository.login(email, password));
      navigate("/");
    } catch (reason) {
      setError(uiError(reason, t));
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Logo />
        <div className="auth-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="sound-core">
            <Music2 />
          </div>
        </div>
        <div>
          <span className="eyebrow">SONORA</span>
          <h1>{t("brandTagline")}</h1>
          <p>{t("loginSubtitle")}</p>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <h2>{t("welcomeBack")}</h2>
          <p>{t("loginSubtitle")}</p>
          <form
            onSubmit={handleSubmit((data) => login(data.email, data.password))}
            noValidate
          >
            <label htmlFor="login-email">
              {t("email")}
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                {...register("email", { required: t("emailRequired") })}
              />
            </label>
            {errors.email && (
              <span className="field-error">{errors.email.message}</span>
            )}
            <label htmlFor="login-password">
              {t("password")}
              <span className="password-field">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  {...register("password", { required: t("passwordRequired") })}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={t("password")}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </label>
            {errors.password && (
              <span className="field-error">{errors.password.message}</span>
            )}
            {toastKey && (
              <div className="auth-toast" role="status" aria-live="polite">
                {t(toastKey)}
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="form-row">
              <Link to="/forgot-password">{t("forgotPassword")}</Link>
            </div>
            <button
              className="button primary wide"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("loading") : t("login")}
            </button>
          </form>
          <button
            className="demo-toggle"
            onClick={() => setDemoOpen(!demoOpen)}
            aria-expanded={demoOpen}
          >
            <span>{t("demoAccounts")}</span>
            <ChevronDown className={demoOpen ? "rotated" : ""} />
          </button>
          {demoOpen && (
            <div className="demo-list">
              <p>
                {t("demoPassword")}: <code>{DEMO_PASSWORD}</code>
              </p>
              {demoUsers.map((demo) => (
                <button
                  key={demo.email}
                  onClick={() => login(demo.email, DEMO_PASSWORD)}
                >
                  <span>
                    {demo.labelKey.startsWith("demo")
                      ? t(demo.labelKey, { name: demo.name })
                      : `${demo.name} · ${t(demo.labelKey)}`}
                  </span>
                  <small>{demo.email}</small>
                </button>
              ))}
            </div>
          )}
          <p className="auth-switch">
            {t("noAccount")} <Link to="/register">{t("listenerRegister")}</Link>{" "}
            · <Link to="/register/artist">{t("artistAccount")}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const schema = z
  .object({
    displayName: z.string().trim().min(2, { message: "displayNameRequired" }),
    stageName: z.string().optional(),
    email: z
      .string()
      .trim()
      .min(1, { message: "emailRequired" })
      .email({ message: "invalidEmail" }),
    password: z
      .string()
      .min(1, { message: "passwordRequired" })
      .min(10, { message: "passwordMin" }),
    confirmPassword: z.string().min(1, { message: "confirmPasswordRequired" }),
    birthDate: z.string().min(1, { message: "birthDateRequired" }),
    gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]),
    locale: z.enum(["en", "es", "de", "fr", "ru", "zh-CN"]),
    privacy: z.boolean().refine(Boolean, { message: "privacyRequired" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordsMismatch",
  });
type RegisterForm = z.infer<typeof schema>;

export function RegisterPage({ artist }: { artist: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const browserLocale = locales.some(
    (item) => item.value === navigator.language,
  )
    ? (navigator.language as Locale)
    : "en";
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: "",
      stageName: "",
      email: "",
      password: "",
      confirmPassword: "",
      birthDate: "",
      gender: "prefer_not_to_say",
      locale: browserLocale,
      privacy: false,
    },
  });
  const message = (key?: string) => (key ? t(key) : "");
  const submit = async (data: RegisterForm) => {
    setError("");
    clearErrors();
    if (artist && !data.stageName?.trim()) {
      setFieldError("stageName", {
        type: "manual",
        message: "stageNameRequired",
      });
      return;
    }
    const input: RegistrationInput = {
      displayName: data.displayName,
      stageName: data.stageName,
      email: data.email,
      password: data.password,
      birthDate: data.birthDate,
      gender: data.gender,
      locale: data.locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    try {
      await Promise.resolve(repository.register(input, artist));
      await i18n.changeLanguage(data.locale);
      navigate("/");
    } catch (reason) {
      if (!applyRegistrationServerErrors(reason, setFieldError))
        setError(uiError(reason, t));
    }
  };
  return (
    <div className="register-page">
      <header>
        <Logo />
        <Link to="/login">{t("login")}</Link>
      </header>
      <main>
        <div className="register-intro">
          <span className="eyebrow">
            {artist ? t("artist") : t("consumer")}
          </span>
          <h1>{t(artist ? "artistRegister" : "register")}</h1>
          <p>{t("brandTagline")}</p>
        </div>
        <form
          className="register-card"
          onSubmit={handleSubmit(submit)}
          noValidate
        >
          <div className="form-grid">
            <label>
              {t("displayName")}
              <input
                id="displayName"
                autoComplete="name"
                {...register("displayName")}
              />
              {errors.displayName && (
                <span className="field-error">
                  {message(errors.displayName.message)}
                </span>
              )}
            </label>
            {artist && (
              <label>
                {t("stageName")}
                <input
                  id="stageName"
                  autoComplete="organization-title"
                  {...register("stageName")}
                />
                {errors.stageName && (
                  <span className="field-error">
                    {message(errors.stageName.message)}
                  </span>
                )}
              </label>
            )}
            <label>
              {t("email")}
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <span className="field-error">
                  {message(errors.email.message)}
                </span>
              )}
            </label>
            <label>
              {t("birthDate")}
              <input
                id="birthDate"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                {...register("birthDate")}
              />
              {errors.birthDate && (
                <span className="field-error">
                  {message(errors.birthDate.message)}
                </span>
              )}
            </label>
            <label>
              {t("gender")}
              <select id="gender" {...register("gender")}>
                <option value="female">{t("female")}</option>
                <option value="male">{t("male")}</option>
                <option value="non_binary">{t("nonBinary")}</option>
                <option value="prefer_not_to_say">{t("preferNot")}</option>
              </select>
              {errors.gender && (
                <span className="field-error">
                  {message(errors.gender.message)}
                </span>
              )}
            </label>
            <label>
              {t("language")}
              <select id="locale" {...register("locale")}>
                {locales.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </select>
              {errors.locale && (
                <span className="field-error">
                  {message(errors.locale.message)}
                </span>
              )}
            </label>
            <label>
              {t("password")}
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
              {errors.password && (
                <span className="field-error">
                  {message(errors.password.message)}
                </span>
              )}
            </label>
            <label>
              {t("confirmPassword")}
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <span className="field-error">
                  {message(errors.confirmPassword.message)}
                </span>
              )}
            </label>
          </div>
          <label className="check-row">
            <input id="privacy" type="checkbox" {...register("privacy")} />
            <span>
              {t("privacyAccept")}{" "}
              <Link to="/privacy" target="_blank">
                {t("privacyPolicy")}
              </Link>
            </span>
          </label>
          {errors.privacy && (
            <span className="field-error">
              {message(errors.privacy.message)}
            </span>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("loading") : t("createAccount")}
          </button>
          <p>
            {t("accountExists")} <Link to="/login">{t("login")}</Link>
          </p>
        </form>
      </main>
    </div>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ defaultValues: { email: "" } });
  const submit = async ({ email }: { email: string }) => {
    setMessage("");
    setError("");
    try {
      await Promise.resolve(repository.requestPasswordReset(email));
      setMessage(t("resetRequestSent"));
    } catch (reason) {
      setError(uiError(reason, t));
    }
  };
  return (
    <div className="simple-public">
      <Logo />
      <div className="public-card">
        <h1>{t("resetTitle")}</h1>
        <p>{t("resetHelp")}</p>
        <form
          className="stacked-form"
          onSubmit={handleSubmit(submit)}
          noValidate
        >
          <label htmlFor="reset-email">
            {t("email")}
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              {...register("email", {
                required: t("emailRequired"),
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: t("invalidEmail"),
                },
              })}
            />
            {errors.email && (
              <span className="field-error">{errors.email.message}</span>
            )}
          </label>
          {message && (
            <div className="auth-toast" role="status">
              {message}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("loading") : t("sendReset")}
          </button>
        </form>
        <Link className="button ghost" to="/login">
          {t("backToLogin")}
        </Link>
      </div>
    </div>
  );
}
export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <div className="simple-public privacy-copy">
      <Logo />
      <article className="public-card">
        <span className="eyebrow">SONORA</span>
        <h1>{t("privacyPolicy")}</h1>
        <p>{t("privacyLocal")}</p>
        <p>{t("privacyServer")}</p>
        <p>{t("privacyStaff")}</p>
      </article>
    </div>
  );
}
