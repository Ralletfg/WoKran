// Zugangsdaten für die gemeinsame Datenbank (Supabase).
// Leer lassen = Demo-Modus: Daten bleiben nur auf diesem Gerät.
window.APP_CONFIG = {
  SUPABASE_URL: "https://iprqpjisgfwmoimcblae.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_MY7H8TtXgGqnBkQ0yKpDXQ_aMWdEIZ6",
  // Lageplan (Werk Faunberg, Lauf an der Pegnitz), an OpenStreetMap-Gebäudeumrisse angepasst.
  // tl/tr/bl: Koordinaten der Bildecken oben links, oben rechts, unten links.
  // boundary: Geländegrenze in Bildpixeln, wird daraus in Koordinaten umgerechnet.
  // Fahrzeugtypen: erkannt am Anfang des Kostenträgers (QR-Etiketten-Seite)
  TYPES: [
    { name: "FA080", prefix: "2080" },
    { name: "P086", prefix: "3086" },
    { name: "FA273", prefix: "2273" },
    { name: "AC45 City", prefix: "2071" },
    { name: "AC80", prefix: "3057" },
    { name: "AC70", prefix: "3060" },
    { name: "AC130", prefix: "3035" },
    { name: "AC160", prefix: "3038" },
  ],
  // Erst auf true setzen, wenn Microsoft (Azure) in Supabase eingerichtet ist
  MICROSOFT_LOGIN: false,
  PLAN: {
    image: "lageplan.png?v=3",
    size: [1234, 953],
    tl: [49.521198, 11.3108785],
    tr: [49.5194385, 11.3180543],
    bl: [49.5175884, 11.3088713],
    boundary: [[1175, 89], [1115, 7], [1073, 4], [955, 102], [586, 262], [73, 537], [20, 546], [4, 793], [568, 798], [577, 932], [593, 945], [913, 948], [1059, 915], [1096, 888], [1096, 810], [1178, 635], [1203, 339], [1229, 234], [1229, 225]],
  },
};
