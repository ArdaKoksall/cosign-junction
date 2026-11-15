import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, MessageCircle, Search } from "lucide-react";
import marketPhoto from "../assets/aimo-market.webp";
import { CoSignBrand } from "../components/CoSignBrand";
import { DisplayPreferences } from "../components/DisplayPreferences";
import { Button } from "../components/ui";
import { useI18n } from "../i18n";
import { catalogShortcuts, planningPrompt, questions, readSetup, saveSetup, type SetupProfile } from "./profile";
import "./onboarding.css";

const ProfileContext = createContext<SetupProfile>({});

export function usePreferredCatalogQuery() {
  return catalogShortcuts(useContext(ProfileContext))[0]?.query;
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [setup, setSetup] = useState(readSetup);
  if (setup.completed) {
    return <ProfileContext.Provider value={setup.profile}>{children}</ProfileContext.Provider>;
  }
  return <Onboarding onFinish={(profile) => {
    saveSetup(profile);
    setSetup({ completed: true, profile });
  }} />;
}

function Onboarding({ onFinish }: { onFinish: (profile: SetupProfile) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<SetupProfile>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const question = questions[step];
  const finalStep = step === questions.length - 1;

  useEffect(() => { heading.current?.focus({ preventScroll: step === 0 }); }, [step]);

  function advance(answer?: string) {
    const answers = { ...profile };
    if (answer) answers[question.field] = answer;
    else delete answers[question.field];
    if (finalStep) onFinish(answers);
    else {
      setProfile(answers);
      setStep(step + 1);
    }
  }

  return (
    <main className="onboarding">
      <aside className="onboarding-art">
        <CoSignBrand inverse />
        <p className="onboarding-art-title">
          {t("Set up your purchasing workspace", "Mukauta hankintatyötilasi")}
        </p>
        <img src={marketPhoto} alt="" />
      </aside>
      <section className="onboarding-main" aria-labelledby="onboarding-question">
        <div className="onboarding-top">
          <DisplayPreferences />
          <Button variant="secondary" onClick={() => onFinish({})}>
            {t("Skip setup", "Ohita asetukset")}
          </Button>
        </div>
        <form className="onboarding-form" onSubmit={(event) => {
          event.preventDefault();
          if (profile[question.field]) advance(profile[question.field]);
        }}>
          <p className="onboarding-count">
            {t(`Question ${step + 1} of ${questions.length}`, `Kysymys ${step + 1}/${questions.length}`)}
          </p>
          <progress value={step + 1} max={questions.length} aria-label={t("Setup progress", "Asetusten edistyminen")} />
          <h1 ref={heading} tabIndex={-1} id="onboarding-question">
            {t(question.title[0], question.title[1])}
          </h1>
          <fieldset className="onboarding-choices" aria-labelledby="onboarding-question">
            {Object.entries(question.choices).map(([id, label]) => (
              <label key={id}>
                <input
                  type="radio"
                  name={question.field}
                  value={id}
                  checked={profile[question.field] === id}
                  onChange={() => setProfile({ ...profile, [question.field]: id })}
                />
                {t(label[0], label[1])}
              </label>
            ))}
          </fieldset>
          <div className="onboarding-actions">
            {step > 0 && (
              <button className="onboarding-text-button" type="button" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={17} />
                {t("Back", "Takaisin")}
              </button>
            )}
            <button className="onboarding-text-button" type="button" onClick={() => advance()}>
              {t("Skip question", "Ohita kysymys")}
            </button>
            <Button type="submit" disabled={!profile[question.field]}>
              {finalStep ? t("Finish setup", "Viimeistele asetukset") : t("Next", "Seuraava")}
              <ArrowRight size={17} />
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

export function ProfileRecommendations({
  onSearch,
  onAsk,
}: {
  onSearch: (query: string) => void;
  onAsk: (instruction: string) => void;
}) {
  const profile = useContext(ProfileContext);
  const { t } = useI18n();
  if (!Object.keys(profile).length) return null;
  return (
    <section className="profile-recommendations" aria-labelledby="profile-recommendations-title">
      <div>
        <h2 id="profile-recommendations-title">
          {t("Recommended for your kitchen", "Suositukset keittiöllesi")}
        </h2>
        <p>
          {t("Browse suggested products or plan your next purchase with the assistant.", "Selaa ehdotettuja tuotteita tai suunnittele seuraava hankinta avustajan kanssa.")}
        </p>
      </div>
      <div className="profile-recommendation-actions">
        {catalogShortcuts(profile).map(({ label, query }) => (
          <Button key={query} variant="secondary" onClick={() => onSearch(query)}>
            <Search size={16} />
            {t(...label)}
          </Button>
        ))}
        <Button onClick={() => onAsk(planningPrompt(profile, t))}>
          <MessageCircle size={17} />
          {t("Plan my next purchase", "Suunnittele seuraava hankinta")}
        </Button>
      </div>
    </section>
  );
}
