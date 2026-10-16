import { RAISING } from "./utils/chocoboRaising";

const foodNames = RAISING.foods.map(food => food.name).sort((a, b) => b.length - a.length);
const foodAliases = new Map<string, string>();
for (const name of foodNames) {
  foodAliases.set(name.toLowerCase(), name);
  if (!name.endsWith("s")) foodAliases.set(`${name}s`.toLowerCase(), name);
}
for (const [alias, name] of Object.entries({
  "Gausebit Wildgrass": "Clump of Gausebit Wildgrass",
  "Tokopekko Wildgrass": "Clump of Tokopekko Wildgrass",
  Tokopekko: "Clump of Tokopekko Wildgrass",
  Garidav: "Garidav Wildgrass",
  "Chick Herb Paste": "Ball of Herb Paste",
  Celerity: "Celerity Salad",
  Tornado: "Tornado Salad",
})) foodAliases.set(alias.toLowerCase(), name);
const foodPattern = new RegExp(
  `(${[...foodAliases.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "gi",
);

const foodTones: Record<string, string> = {
  "Azouph Greens": "azouph-greens",
  "Bag of La Theine Millet": "la-theine-millet",
  "Ball of Carrot Paste": "carrot-paste",
  "Ball of Herb Paste": "herb-paste",
  "Ball of Vegetable Paste": "vegetable-paste",
  "Ball of Worm Paste": "worm-paste",
  "Bowl of Lethe Consomme": "lethe-consomme",
  "Bowl of Lethe Potage": "lethe-potage",
  "Bunch of Gysahl Greens": "gysahl-greens",
  "Celerity Salad": "celerity-salad",
  Chocolixir: "chocolixir",
  Chocotonic: "chocotonic",
  "Clump of Gausebit Wildgrass": "gausebit-wildgrass",
  "Clump of Tokopekko Wildgrass": "tokopekko-wildgrass",
  "Cupid Worm": "cupid-worm",
  "Garidav Wildgrass": "garidav-wildgrass",
  "Gregarious Worm": "gregarious-worm",
  "Hi-Chocolixir": "hi-chocolixir",
  "Parasite Worm": "parasite-worm",
  "San Dorian Carrot": "san-dorian-carrot",
  "Sharug Greens": "sharug-greens",
  "Tornado Salad": "tornado-salad",
  "Vomp Carrot": "vomp-carrot",
  "Zegham Carrot": "zegham-carrot",
};

function foodTone(name: string) {
  const tone = foodTones[name];
  if (!tone) throw new Error(`Missing a color for raising food "${name}".`);
  return tone;
}

export default function RaisingFoodText({ text }: { text: string }) {
  return <>{text.split(foodPattern).map((part, index) => {
    const name = foodAliases.get(part.toLowerCase());
    return name
      ? <span key={index} className={`raising-food raising-food-${foodTone(name)}`}>{part}</span>
      : part;
  })}</>;
}
