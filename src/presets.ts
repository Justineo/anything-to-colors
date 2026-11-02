import type { Material } from "./materials";

export type Entry = { text: string; colors: string[]; material?: Material };

// Caption arrays in locales/*.json use this same order; keep every locale in sync when adding.
// Palettes are shared by all languages, so only the selected language carries any words.
export const presets: string[][] = [
  ["#2F4A46", "#55807A", "#8DB3A6", "#C3D9CC", "#EDF2EC"],
  ["#3B2A14", "#7B5422", "#C48A2C", "#E9B949", "#F6E1A0"],
  ["#080D1A", "#132239", "#28435F", "#5C7A93", "#D39A5E"],
  ["#0A0A14", "#1E1838", "#4B2A5E", "#B5476B", "#F2A65A", "#FCE3B0"],
  ["#1D6F6A", "#3FAE9C", "#7FD3C0", "#BDEBDD", "#EEF9F4"],
  ["#5E1A17", "#8F2A22", "#B8463A", "#D9D4CC", "#F4F2EE"],
  ["#05090A", "#0E1B16", "#1F3A2A", "#4E6B3A", "#D8F07A"],
  ["#04060B", "#0B1A2A", "#0F4C4A", "#2FB58C", "#A6F5C8", "#7A5BD6"],
  ["#2B3135", "#4A5559", "#6F7D7E", "#A3AFA9", "#D7DDD6"],
  ["#07070F", "#1A1530", "#3A1E5C", "#D6337A", "#39C5E0"],
  ["#FBEFF1", "#F6D6DE", "#EDB3C2", "#D98AA0", "#9C5B70"],
  ["#FFF7C2", "#FFE86B", "#F7D234", "#E0A91F", "#8A6A12"],
  ["#F2EFE6", "#C9D3DE", "#5A7AA0", "#24446E", "#13233D"],
  ["#F6D7A7", "#E9A866", "#C9713A", "#8C3B22", "#3D1A14"],
  ["#FBF8F1", "#F1EADB", "#DCD0B8", "#A89880", "#4A4239"],
  ["#FFFFFF", "#EEF2F5", "#9EC6E0", "#2E7BB8", "#123E6B"],
  ["#F4F0E2", "#D8DDB4", "#A9B970", "#6E8A3A", "#3E4F22"],
  ["#FFF1DC", "#FFC889", "#FF9A3C", "#E8661E", "#A13D12"],
  ["#E9D9B8", "#C9A46A", "#B5543C", "#3F7F78", "#2B3A55"],
  ["#02040A", "#071B33", "#0E3F66", "#5BD3F0", "#F2A3E8"],
  ["#F3E9F2", "#CDB6DD", "#9A7EC2", "#6B4F99", "#F0B87A"],
  ["#FBF6EC", "#EFE4CF", "#D9C6A3", "#B39B74", "#7A6650"],
  ["#0E2418", "#1F4A2C", "#3D7A3E", "#8DBF5A", "#D4E9A8"],
  ["#1A0F14", "#4A1C2C", "#C2364F", "#F2C14E", "#2FA3A0"],
  ["#2A1A14", "#5C3A28", "#93613F", "#D2A47A", "#F5E6D3"],
  ["#F4EDE1", "#F2B8A2", "#E06B5A", "#7FC4C9", "#2E6E86"],
  ["#F7F9FC", "#DDE6F2", "#F6C9A8", "#E58D74", "#4C5E86"],
  ["#F7E4C8", "#F2A65A", "#E06A1E", "#8A3A16", "#4A3A2A"],
  ["#0D0B10", "#2A2230", "#5A4A55", "#E8B46A", "#FFE7B8"],
  ["#0B3D4F", "#0F6E8C", "#1690A8", "#2AA7B8", "#8FD3DB"],
  ["#FFF5F5", "#FFD9DE", "#F7A8B8", "#E5738E", "#B04A63"],
  ["#1E2A1C", "#3A4F2E", "#6C8A4A", "#A8BF7F", "#DCE5C8"],
  ["#FBF7D9", "#F5E66B", "#E8C92E", "#7DA44A", "#3E6B3A"],
  ["#F2F4F5", "#D3DADF", "#9AA7AF", "#4F6158", "#1F2B25"],
  ["#F6F7F8", "#DCE3E6", "#A9B8BD", "#5E7378", "#2C3A3E"],
  ["#F4F1EA", "#D9D2C3", "#8E9C8A", "#4D5E52", "#2B2A28"],
  ["#FAFBFC", "#E4EAF2", "#8EA5C8", "#2F5596", "#162B57"],
  ["#F7F4EC", "#D8D3C8", "#8C877D", "#3D3A36", "#121110"],
  ["#F6EDE4", "#E7B9A4", "#C9543A", "#9A2E1F", "#4E1A12"],
  ["#3A2A12", "#8A5A12", "#D9A02A", "#F2CC5C", "#5E1A17"],
  ["#F2EEE6", "#3D5B8C", "#1F3466", "#B8463A", "#D9A441"],
  ["#EEF3E2", "#C5D8A4", "#8DB46A", "#4E7F3E", "#2A4A28"],
  ["#E8F0EC", "#A9C9BE", "#5E9488", "#2F5E57", "#16332F"],
  ["#F4E2C1", "#D9B07A", "#B07F48", "#5FA7A0", "#2C5E6E"],
  ["#2E2218", "#5E4430", "#9A7448", "#C9A15A", "#E6D2A8"],
  ["#F4F1EC", "#E9D9C3", "#8A2A22", "#2E5E9A", "#F2B83C"],
  ["#F5E9DC", "#E5B79A", "#C2715A", "#6E8C6A", "#3E4A3A"],
  ["#F2F8FC", "#CFE6F5", "#8CC4E8", "#3E8CC9", "#7A5BD6"],
  ["#0E1116", "#262C36", "#4E5866", "#E8A04A", "#E2405A"],
  ["#F8F6EC", "#EAE6C8", "#BFC79A", "#7C8C6A", "#5A4E46"],
  ["#EFE6D6", "#D6B48A", "#A86A3E", "#4E7A72", "#2A3A38"],
  ["#F1EFEA", "#D8D4CB", "#A9A396", "#5E6A55", "#2E3329"],
  ["#FBF4E8", "#F0D9B5", "#D9A86A", "#9A6A3A", "#4A3220"],
  ["#F2E3C9", "#D98C5A", "#2E6E8C", "#123A52", "#0A0D12"],
  ["#FFF6DD", "#F7D98A", "#E8AE3A", "#B5762A", "#9A7EC2"],
  ["#F2EFDF", "#C9C99A", "#8C9A5E", "#5E6E3A", "#B5763E"],
  ["#E8EAE6", "#B9C1B8", "#7E8C7E", "#5A4A6A", "#2E3530"],
  ["#F6E6D9", "#E8B7A6", "#8C9EBF", "#3E5A82", "#1A2840"],
  ["#F4F2EC", "#DCD8CC", "#2E6E5A", "#C9A23A", "#1E1E1E"],
  ["#1A0E1E", "#E2405A", "#F28C28", "#F7D23C", "#7A3FB5", "#2FB5A0"],
  ["#F2D6A0", "#E39A3A", "#C2541E", "#7A2A1A", "#2E5E5A"],
  ["#FDF3E7", "#F7C98E", "#EE8A5E", "#B5476B", "#2E4A7A"],
  ["#D9DBDA", "#A3A8A8", "#6E7676", "#B5281E", "#2A2E30"],
  ["#F2FBFC", "#C6EEF2", "#7FD3DE", "#2FA3B8", "#0E5466"],
  ["#0A0606", "#2E0E0A", "#7A1A0E", "#E2481E", "#FFB23C"],
  ["#F2DEC0", "#D9B58A", "#B08A5E", "#E2607A", "#6E8C4A"],
  ["#1A2226", "#2E3E44", "#4E6668", "#8CA3A0", "#D9E0DC"],
  ["#E9E2D6", "#B8AC98", "#7A7064", "#3E5A5E", "#1E2A2C"],
  ["#E8FAF6", "#7FE0D2", "#1FB0B8", "#FF7A6A", "#F7C04A"],
  ["#02030A", "#0A1024", "#16244A", "#3E5E9A", "#9AD8E8"],
  ["#0C1018", "#22283A", "#5E6478", "#C9B880", "#F4ECCB"],
  ["#03040C", "#0E1430", "#262E66", "#6A5ACD", "#F2F0FF"],
  ["#EEF3EF", "#C9D9CF", "#94B3A2", "#5E8270", "#34493F"],
  ["#1A1C24", "#3A3E52", "#6A6E8C", "#B8C0E0", "#F2E86A"],
  ["#F6F9F0", "#F2C6D2", "#E58AA6", "#5E9A5E", "#2A5A3A"],
  ["#FFFBE6", "#F7EA9A", "#C9D96A", "#6EA24A", "#2E5A2A"],
  ["#F4F2EC", "#E3DCC8", "#C2B48E", "#8C7E5E", "#5A6A72"],
  ["#F7E6D6", "#E8A06A", "#C9481E", "#8A1E14", "#3A1410"],
  ["#FBF6EE", "#F2E2CC", "#D9483A", "#9A1E1A", "#2E2420"],
  ["#1A0604", "#4E0E08", "#A81E14", "#E8482A", "#F7C24A"],
  ["#FFFDF8", "#F7EFE2", "#E8D6BE", "#9A6A4A", "#3A2418"],
  ["#EEF2DF", "#B8C98A", "#6E8C3A", "#3A5A22", "#8A6A3A"],
  ["#FFF8E1", "#F7E08A", "#E8B83A", "#B5832A", "#2E2A3A"],
  ["#FBF0DC", "#F0C988", "#D9963E", "#A8611E", "#5E3412"],
  ["#F4F1EC", "#D9CBB8", "#8A6A4E", "#3E2A1E", "#14100C"],
  ["#FBF8FB", "#E2D6EC", "#A898CC", "#5E5A9A", "#2E2A5A"],
  ["#FFF1F0", "#FFA8A0", "#F25A5A", "#2E7A3E", "#14301A"],
  ["#FFFBEE", "#FFE6A0", "#FFC23A", "#F2EADA", "#5E8A3A"],
  ["#FFF6F0", "#FFD9C9", "#FFB39A", "#F2846A", "#8CC9B8"],
  ["#F4F2EE", "#B8AEA6", "#5E4A3E", "#2E1E16", "#0E0806"],
  ["#F2E8E6", "#C98A96", "#7A1E34", "#3E0A18", "#14040A"],
  ["#F7F8EC", "#DDE5B8", "#B2C67A", "#7A964A", "#4A5E2A"],
  ["#FFF8E8", "#F7E2B0", "#E8B060", "#A8642A", "#4E2810"],
  ["#F8FCFC", "#DDF3EE", "#B8E6D2", "#F2E86A", "#5EBFC9"],
  ["#FFFBF0", "#F7EBC9", "#EBCF8A", "#C99A4A", "#7A5A2A"],
  ["#FFF7F2", "#FFD9E0", "#A8D8F0", "#F7D23C", "#F2846A"],
  ["#FFF2F4", "#F7C2CC", "#E5738E", "#9A3A5A", "#3A1A2A"],
  ["#F2FAFF", "#BFE3F7", "#6EBDE8", "#F7E46A", "#3E8C5A"],
  ["#06070C", "#121626", "#262C44", "#4E5670", "#8A90A8"],
  ["#FFF5EA", "#F7D2B0", "#E8A07A", "#B5636A", "#5A3A5E"],
  ["#FFFCF6", "#F7EEDC", "#EAD8C0", "#C9D9E2", "#8AA8BF"],
  ["#1A1612", "#3A3028", "#6E5E4A", "#E8B46A", "#F7EBD2"],
  ["#F6F1E7", "#E2D6BE", "#B5A27E", "#6E6A8C", "#3A3A5A"],
  ["#F4F8FC", "#CFE0F2", "#2E4A7A", "#E8C25A", "#A81E2A"],
  ["#EEEBE4", "#D2CBBF", "#A89C8A", "#6E6658", "#3E3A34"],
  ["#1A0806", "#5E140E", "#C2281E", "#F2702A", "#FFD24A"],
  ["#FFFAF7", "#FBE8E2", "#F2CFC9", "#D9AFB8", "#A898B8"],
  ["#0A0E14", "#1A2230", "#2E3A4E", "#5A6A80", "#C9D2DC"],
  ["#F2FAFF", "#B8E2F7", "#5EB8E8", "#1E7AC2", "#F7F2E6"],
  ["#F8FCF2", "#DDF0C2", "#A8D87A", "#5EAE4A", "#F7D86A"],
  ["#F3F4F2", "#DDE1DD", "#B8C0BB", "#8A948F", "#5A625E"],
  ["#FFF0F3", "#FFC2CF", "#FF7A9A", "#E2305E", "#7A1A3A"],
  ["#F2E6CF", "#D9B888", "#A87E52", "#5E7A72", "#2E2A26"],
  ["#05030C", "#1A0A30", "#5A0E8C", "#FF2AA8", "#2AF2F2", "#F7F23A"],
  ["#FFE8F4", "#FFB3DE", "#C98AF2", "#6EC9F2", "#2E3A8C"],
  ["#F4F0E6", "#E2302A", "#F7C21E", "#1E4AA8", "#141414"],
  ["#E8F0EE", "#B8D2D9", "#8CA8C9", "#C9A8C2", "#5E8A6A"],
  ["#0A1430", "#1E3A7A", "#3E6EB8", "#8CB8D9", "#F2D23A"],
  ["#F2FAFF", "#B8E0F7", "#FFFFFF", "#7AC25A", "#2E7A3E"],
  ["#0E0A08", "#3A1E14", "#8A2A1E", "#C9A23A", "#2E5A4A"],
  ["#F2F2F0", "#BDBDBA", "#7E7E7A", "#3E3E3C", "#121212"],
  ["#06080E", "#121A2E", "#1E3266", "#C98A3A", "#E8D2A0"],
  ["#1E140E", "#4A3020", "#8A5E3A", "#C9A07A", "#EFE2CC"],
  ["#0A0E1E", "#1E2A4E", "#4E6A9A", "#A8C2E2", "#F2F4FA"],
  ["#2A1A1E", "#5E3A42", "#9A6A6E", "#D9A8A0", "#F4E2D6"],
  ["#04020A", "#1A0E2E", "#4E1E6E", "#E2603A", "#F7D28A"],
  ["#F4F8FA", "#D2E4EC", "#9AC2D9", "#E8C2B8", "#4E6A8C"],
  ["#E8ECF0", "#B8C2CC", "#7A8A9A", "#F28CA8", "#5EC9E2"],
  ["#F2FBF8", "#C9EEE2", "#8AD8C2", "#5EA8C9", "#E8F2A8"],
  ["#06080A", "#14221E", "#2E4A3E", "#5EF2C2", "#C98AF2"],
  ["#FFF9EE", "#F7E2B8", "#E8B87A", "#C98A4A", "#6E5A4A"],
  ["#FBFAF8", "#EEECE6", "#D9D2C6", "#A89C8A", "#7FB8D9"],
  ["#F2FAFC", "#C9E8F2", "#FF8A3A", "#F25A2A", "#2E6E8C"],
  ["#06221E", "#0E5A52", "#1EA898", "#3E6EC9", "#D9C23A"],
  ["#FFF4F2", "#FFC9C2", "#FF8C8C", "#E2546A", "#5EA8B8"],
  ["#F8F8F6", "#E2E4DC", "#9AB87A", "#4E7A3E", "#141414"],
];

// The liquid each example is shown in, by its index; silk unless listed here. Mist, fog and milky
// drinks are milk; iridescent and fizzy things a film.
const textures: Partial<Record<number, Material>> = {
  7: "film", // Aurora over Iceland's black sand
  9: "film", // Neon streets on a stormy night
  10: "milk", // Cherry blossoms falling through morning mist
  16: "milk", // Latte art on matcha
  17: "film", // The orange soda of childhood summers
  19: "film", // Glowing jellyfish in the deep sea
  21: "milk", // A bowl of oatmeal at dawn
  24: "milk", // Hot cocoa by a winter window
  29: "film", // Peacock-blue velvet
  30: "milk", // Strawberry milk
  33: "milk", // A pine above Huangshan's sea of clouds
  47: "film", // Ice sculptures in Harbin
  53: "film", // A gondola in Venice
  56: "milk", // Mist over the Scottish Highlands
  62: "milk", // A London phone box in the fog
  68: "film", // Noon on a coral reef
  84: "milk", // An iced Americano
  85: "milk", // Blueberry yogurt
  88: "film", // Peach soda
  91: "milk", // Matcha ice cream
  92: "milk", // Caramel custard
  93: "film", // Sea-salt lemon soda
  113: "film", // Cyberpunk
  114: "film", // A vaporwave beach
  128: "film", // A forest made of glass
  132: "film", // A goldfish in a glass bowl
  133: "film", // A peacock spreading its feathers
};

export const textureOf = (index: number): Material => textures[index] ?? "silk";
