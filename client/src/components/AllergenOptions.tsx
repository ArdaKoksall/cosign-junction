import { useI18n } from "../i18n";
import { useId } from "react";
import { allergenLabel, allergenOptions } from "../productRequirements";
import "./product-requirement-options.css";

export function AllergenOptions({ selected, onChange }: { selected: string[]; onChange: (values: string[]) => void }) {
  const { t, locale } = useI18n();
  const helpId = useId();
  return (
    <fieldset className="product-requirement-options" aria-describedby={helpId}>
      <legend>{t("Declared free from", "Ilmoituksen mukaan ei sisällä")}</legend>
      <p id={helpId}>{t("Every selection requires an explicit supplier declaration. Check the current package for allergy decisions.", "Jokainen valinta vaatii toimittajan merkinnän. Tarkista allergeenit tuotepakkauksesta.")}</p>
      <div>
        {Object.keys(allergenOptions).map((code) => (
          <label key={code}>
            <input type="checkbox" checked={selected.includes(code)} onChange={({ target }) => onChange(target.checked
              ? [...selected, code] : selected.filter((value) => value !== code))} />
            {allergenLabel(code, locale)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
