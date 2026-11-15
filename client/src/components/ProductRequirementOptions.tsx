import { useI18n } from "../i18n";
import { useId } from "react";
import { productRequirementLabel, productRequirementLabels } from "../productRequirements";
import type { ProductRequirement } from "../types";
import "./product-requirement-options.css";

const options = Object.keys(productRequirementLabels) as ProductRequirement[];

export function ProductRequirementOptions({ selected, onChange, disabled, help }: {
  selected: ProductRequirement[];
  onChange: (value: ProductRequirement[]) => void;
  disabled?: boolean;
  help?: string;
}) {
  const { t, locale } = useI18n();
  const helpId = useId();
  return (
    <fieldset className="product-requirement-options" aria-describedby={helpId} disabled={disabled}>
      <legend>{t("Product requirements", "Tuotevaatimukset")}</legend>
      <p id={helpId}>{help ?? t("Products must have a catalog declaration for every selection.", "Tuoteluettelossa on oltava merkintä jokaisesta valitusta vaatimuksesta.")}</p>
      <div>
        {options.map((requirement) => (
          <label key={requirement}>
            <input type="checkbox" checked={selected.includes(requirement)} onChange={({ target }) => onChange(target.checked
              ? [...selected, requirement] : selected.filter((item) => item !== requirement))} />
            {productRequirementLabel(requirement, locale)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
