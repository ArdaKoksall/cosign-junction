import type { Translate } from "../i18n";

type Copy = readonly [string, string];
type Question = {
  field: string;
  title: Copy;
  choices: Readonly<Record<string, Copy>>;
};

export const questions = [
  {
    field: "businessType",
    title: ["What kind of business do you buy for?", "Millaiselle yritykselle teet hankintoja?"],
    choices: {
      restaurant: ["Restaurant", "Ravintola"],
      cafe: ["Café", "Kahvila"],
      bakery: ["Bakery", "Leipomo"],
      catering: ["Catering", "Pitopalvelu"],
      store: ["Grocery store", "Ruokakauppa"],
      other: ["Other", "Muu"],
    },
  },
  {
    field: "needs",
    title: ["What do you need help with most often?", "Mihin tarvitset hankinnoissa useimmin apua?"],
    choices: {
      restock: ["Restocking staples", "Perustuotteiden täydentäminen"],
      compare: ["Comparing prices and availability", "Hintojen ja saatavuuden vertailu"],
      menu: ["Planning for a menu or event", "Ruokalistan tai tapahtuman suunnittelu"],
      approve: ["Preparing purchases for approval", "Hankintojen valmistelu hyväksyttäväksi"],
    },
  },
  {
    field: "monthlyBudget",
    title: ["What’s your usual monthly purchasing budget?", "Mikä on tavallinen kuukausibudjettisi hankinnoille?"],
    choices: {
      under500: ["Under €500", "Alle 500 €"],
      "500to2000": ["€500–1,999", "500–1 999 €"],
      "2000to5000": ["€2,000–4,999", "2 000–4 999 €"],
      over5000: ["€5,000 or more", "5 000 € tai enemmän"],
    },
  },
  {
    field: "orderCadence",
    title: ["How often do you typically order?", "Kuinka usein yleensä tilaat?"],
    choices: {
      daily: ["Daily", "Päivittäin"],
      weekly: ["Weekly", "Viikoittain"],
      monthly: ["Monthly", "Kuukausittain"],
      irregular: ["As needed", "Tarpeen mukaan"],
    },
  },
  {
    field: "dietaryPriority",
    title: ["Which dietary need should we prioritize?", "Minkä ruokavaliotarpeen haluat nostaa esiin?"],
    choices: {
      vegetarian: ["Vegetarian", "Kasvisruoka"],
      vegan: ["Vegan", "Vegaaninen"],
      "gluten-free": ["Gluten-free", "Gluteeniton"],
      "lactose-free": ["Lactose-free", "Laktoositon"],
    },
  },
] as const satisfies readonly Question[];

type ProfileField = typeof questions[number]["field"];
export type SetupProfile = Partial<Record<ProfileField, string>>;
type Setup = { completed: boolean; profile: SetupProfile };

const storageKey = "cosign-onboarding-v1";

export function readSetup(): Setup {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved?.completed === true) {
      const profile: SetupProfile = {};
      for (const question of questions) {
        const answer = saved.profile?.[question.field];
        if (typeof answer === "string" && Object.hasOwn(question.choices, answer)) {
          profile[question.field] = answer;
        }
      }
      return { completed: true, profile };
    }
  } catch {
    // A new session can continue when browser storage is unavailable.
  }
  return { completed: false, profile: {} };
}

export function saveSetup(profile: SetupProfile) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ completed: true, profile }));
  } catch {
    // The current visit can still use the answers.
  }
}

type Shortcut = { label: Copy; query: string };

const businessShortcuts: Record<string, readonly Shortcut[]> = {
  restaurant: [
    { label: ["Tomatoes", "Tomaatit"], query: "tomato" },
    { label: ["Cooking stocks", "Keittoliemet"], query: "stock" },
  ],
  cafe: [
    { label: ["Milk", "Maito"], query: "milk" },
    { label: ["Coffee", "Kahvi"], query: "coffee" },
  ],
  bakery: [
    { label: ["Flour", "Jauhot"], query: "flour" },
    { label: ["Butter", "Voi"], query: "butter" },
  ],
  catering: [
    { label: ["Rice", "Riisi"], query: "rice" },
    { label: ["Potatoes", "Perunat"], query: "potato" },
  ],
  store: [
    { label: ["Bread", "Leipä"], query: "bread" },
    { label: ["Juice", "Mehu"], query: "juice" },
  ],
};

const dietaryShortcuts: Record<string, Shortcut> = {
  vegan: { label: ["Oat drinks", "Kaurajuomat"], query: "vegan oat drink" },
  vegetarian: { label: ["Lentils", "Linssit"], query: "lentil" },
  "gluten-free": { label: ["Gluten-free options", "Gluteenittomat vaihtoehdot"], query: "gluten-free" },
  "lactose-free": { label: ["Lactose-free options", "Laktoosittomat vaihtoehdot"], query: "lactose-free" },
};

const lessRelevant: Record<string, readonly string[]> = {
  vegan: ["milk", "butter"],
  "gluten-free": ["flour", "bread"],
  "lactose-free": ["milk", "butter"],
};

export function catalogShortcuts(profile: SetupProfile) {
  const priority = profile.dietaryPriority ?? "";
  const dietary = dietaryShortcuts[priority];
  const excluded = lessRelevant[priority] ?? [];
  const business = (businessShortcuts[profile.businessType ?? ""] ?? [])
    .filter(({ query }) => !excluded.includes(query));
  return [...(dietary ? [dietary] : []), ...business];
}

const planningAims: Record<string, Copy> = {
  restock: ["Help me plan a restock order for my kitchen.", "Auta suunnittelemaan keittiöni täydennystilaus."],
  compare: ["Help me find suitable products to compare for my next order.", "Auta löytämään seuraavaan tilaukseeni sopivia tuotteita vertailua varten."],
  menu: ["Help me plan an ingredient order for my menu.", "Auta suunnittelemaan ruokalistani raaka-ainetilaus."],
  approve: ["Help me plan a purchase request for approval.", "Auta suunnittelemaan hyväksyttävä hankintapyyntö."],
};

function answerLabel(profile: SetupProfile, field: ProfileField, t: Translate) {
  const question = questions.find((entry) => entry.field === field);
  const choices: Readonly<Record<string, Copy>> = question?.choices ?? {};
  const answer = choices[profile[field] ?? ""];
  return answer ? t(...answer) : undefined;
}

export function planningPrompt(profile: SetupProfile, t: Translate) {
  const business = answerLabel(profile, "businessType", t);
  const budget = answerLabel(profile, "monthlyBudget", t);
  const cadence = answerLabel(profile, "orderCadence", t);
  const dietary = answerLabel(profile, "dietaryPriority", t);
  return [
    t(...(planningAims[profile.needs ?? ""] ?? ["Help me plan my next purchase.", "Auta suunnittelemaan seuraava hankintani."])),
    ...(business ? [t(`My business type is “${business}”.`, `Yritystyyppini on ”${business}”.`)] : []),
    ...(budget ? [t(`Use “${budget}” as my approximate monthly purchasing budget when planning.`, `Huomioi suunnittelussa kuukausibudjettini ”${budget}”.`)] : []),
    ...(cadence ? [t(`My usual order frequency is “${cadence}”.`, `Tavallinen tilausväli on ”${cadence}”.`)] : []),
    ...(dietary ? [t(`Consider my dietary preference “${dietary}”.`, `Huomioi ruokavaliotoive ”${dietary}”.`)] : []),
    t(
      "Suggest suitable catalog items and ask me for products, quantities, delivery date and per-order budget before creating a request.",
      "Ehdota sopivia valikoiman tuotteita ja kysy tuotteet, määrät, toimituspäivä sekä tilauskohtainen budjetti ennen pyynnön luomista.",
    ),
  ].join("\n");
}
