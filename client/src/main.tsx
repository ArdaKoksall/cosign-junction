import { StrictMode, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/dm-sans";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "@fontsource/barlow-semi-condensed/latin-800.css";
import "./styles.css";
import { App } from "./App";
import { DisplayPreferences } from "./components/DisplayPreferences";
import { DisplayProvider, useI18n } from "./i18n";
import { OnboardingGate } from "./onboarding/Onboarding";
const ProductionApp = lazy(() => import("./trade/ProductionApp").then(module => ({ default: module.ProductionApp })));
function Root() {
  const { t } = useI18n();
  const [mode,setMode] = useState<string | null>(null);
  const [error,setError] = useState(false);
  useEffect(() => { fetch("/api/capabilities").then(response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>setMode(value.mode)).catch(()=>setError(true)); },[]);
  if(error)return <main className="app-startup"><DisplayPreferences /><p role="alert">{t("The purchasing service is unavailable. Please retry when the connection is restored.", "Hankintapalvelu ei ole käytettävissä. Yritä uudelleen, kun yhteys on palautunut.")}</p></main>;
  if(!mode)return <main className="app-startup"><p role="status">{t("Connecting to your workspace…", "Yhdistetään työtilaan…")}</p></main>;
  return mode==="production"?<Suspense fallback={<main className="app-startup"><p role="status">{t("Opening your workspace…", "Avataan työtilaa…")}</p></main>}><ProductionApp/></Suspense>:<App/>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <DisplayProvider><OnboardingGate><Root /></OnboardingGate></DisplayProvider>
    </MotionConfig>
  </StrictMode>,
);
