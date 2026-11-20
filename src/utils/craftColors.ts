export const CRAFT_COLORS: Record<string, string> = {
  Woodworking: "#8fd18f",
  Smithing: "#b6c7db",
  Goldsmithing: "#e8d47e",
  Clothcraft: "#c9a2ff",
  Leathercraft: "#efa975",
  Bonecraft: "#eee2c6",
  Alchemy: "#70d8ce",
  Cooking: "#f19bb5",
};

// Item-catalog Auction House categories; Cooking spans the food subcategories.
export const AH_CRAFT_CATEGORY: Record<number, keyof typeof CRAFT_COLORS> = {
  38: "Smithing",
  39: "Goldsmithing",
  40: "Clothcraft",
  41: "Leathercraft",
  42: "Bonecraft",
  43: "Woodworking",
  44: "Alchemy",
  51: "Cooking",
  52: "Cooking",
  53: "Cooking",
  54: "Cooking",
  55: "Cooking",
  56: "Cooking",
  57: "Cooking",
  58: "Cooking",
  59: "Cooking",
  63: "Alchemy",
};
