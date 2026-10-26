// Марки и модели для подсказок в карточке авто (то, что реально заезжает в сервис в Польше).
// Список не ограничивает ввод — любую марку/модель можно вписать руками.
export const CARS: Record<string, string[]> = {
  'Alfa Romeo': ['147', '156', '159', 'Brera', 'Giulia', 'Giulietta', 'MiTo', 'Stelvio', 'Tonale'],
  Audi: ['A1', 'A2', 'A3', 'A4', 'A4 Allroad', 'A5', 'A6', 'A6 Allroad', 'A7', 'A8', 'e-tron', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'RS3', 'RS4', 'RS6', 'S3', 'S4', 'S5', 'TT'],
  BMW: ['Seria 1', 'Seria 2', 'Seria 3', 'Seria 4', 'Seria 5', 'Seria 6', 'Seria 7', 'Seria 8', 'i3', 'i4', 'iX', 'iX3', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'M3', 'M5'],
  BYD: ['Atto 3', 'Dolphin', 'Han', 'Seal', 'Seal U', 'Tang'],
  Chevrolet: ['Aveo', 'Camaro', 'Captiva', 'Cruze', 'Lacetti', 'Orlando', 'Spark', 'Trax'],
  Chrysler: ['300C', 'Grand Voyager', 'Pacifica', 'PT Cruiser', 'Voyager'],
  Citroën: ['Berlingo', 'C1', 'C2', 'C3', 'C3 Aircross', 'C3 Picasso', 'C4', 'C4 Cactus', 'C4 Picasso', 'C5', 'C5 Aircross', 'C5 X', 'C-Elysée', 'DS3', 'Jumper', 'Jumpy', 'Nemo', 'Saxo', 'Xsara', 'Xsara Picasso'],
  Cupra: ['Ateca', 'Born', 'Formentor', 'Leon', 'Tavascan'],
  Dacia: ['Dokker', 'Duster', 'Jogger', 'Lodgy', 'Logan', 'Sandero', 'Sandero Stepway', 'Spring'],
  Daewoo: ['Lanos', 'Matiz', 'Nubira', 'Tico'],
  DS: ['DS 3', 'DS 4', 'DS 5', 'DS 7', 'DS 9'],
  Fiat: ['124 Spider', '500', '500L', '500X', 'Bravo', 'Croma', 'Doblo', 'Ducato', 'Fiorino', 'Freemont', 'Grande Punto', 'Panda', 'Punto', 'Qubo', 'Scudo', 'Sedici', 'Seicento', 'Stilo', 'Talento', 'Tipo'],
  Ford: ['B-Max', 'C-Max', 'EcoSport', 'Edge', 'Escape', 'Explorer', 'Fiesta', 'Focus', 'Fusion', 'Galaxy', 'Ka', 'Kuga', 'Mondeo', 'Mustang', 'Mustang Mach-E', 'Puma', 'Ranger', 'S-Max', 'Tourneo Connect', 'Tourneo Custom', 'Transit', 'Transit Connect', 'Transit Custom'],
  Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Jazz', 'ZR-V', 'e:Ny1'],
  Hyundai: ['Bayon', 'Elantra', 'i10', 'i20', 'i30', 'i40', 'Ioniq', 'Ioniq 5', 'Ioniq 6', 'ix20', 'ix35', 'Kona', 'Santa Fe', 'Tucson'],
  Infiniti: ['FX', 'Q30', 'Q50', 'QX70'],
  Jaguar: ['E-Pace', 'F-Pace', 'F-Type', 'I-Pace', 'XE', 'XF', 'XJ'],
  Jeep: ['Avenger', 'Cherokee', 'Compass', 'Grand Cherokee', 'Renegade', 'Wrangler'],
  Kia: ['Carens', 'Ceed', 'EV6', 'EV9', 'Niro', 'Optima', 'Picanto', 'ProCeed', 'Rio', 'Sorento', 'Soul', 'Sportage', 'Stinger', 'Stonic', 'Venga', 'XCeed'],
  Lancia: ['Delta', 'Musa', 'Ypsilon'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Freelander', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'],
  Lexus: ['CT', 'ES', 'GS', 'IS', 'LBX', 'NX', 'RX', 'UX'],
  Mazda: ['2', '3', '5', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'CX-7', 'MX-30', 'MX-5'],
  'Mercedes-Benz': ['A', 'B', 'C', 'CLA', 'CLK', 'CLS', 'E', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'G', 'GLA', 'GLB', 'GLC', 'GLE', 'GLK', 'GLS', 'ML', 'S', 'SL', 'SLK', 'Sprinter', 'V', 'Viano', 'Vito'],
  MG: ['3', '4', 'HS', 'MG5', 'ZS'],
  Mini: ['Clubman', 'Cooper', 'Countryman', 'One', 'Paceman'],
  Mitsubishi: ['ASX', 'Colt', 'Eclipse Cross', 'L200', 'Lancer', 'Outlander', 'Pajero', 'Space Star'],
  Nissan: ['Almera', 'Juke', 'Leaf', 'Micra', 'Navara', 'Note', 'Pathfinder', 'Primera', 'Qashqai', 'Qashqai+2', 'X-Trail'],
  Opel: ['Adam', 'Agila', 'Antara', 'Astra', 'Combo', 'Corsa', 'Crossland', 'Frontera', 'Grandland', 'Insignia', 'Karl', 'Meriva', 'Mokka', 'Movano', 'Omega', 'Signum', 'Vectra', 'Vivaro', 'Zafira'],
  Peugeot: ['106', '107', '108', '206', '207', '208', '2008', '301', '307', '308', '3008', '406', '407', '408', '508', '5008', '607', 'Bipper', 'Boxer', 'Expert', 'Partner', 'Rifter'],
  Porsche: ['911', 'Boxster', 'Cayenne', 'Cayman', 'Macan', 'Panamera', 'Taycan'],
  Renault: ['Arkana', 'Austral', 'Captur', 'Clio', 'Espace', 'Fluence', 'Kadjar', 'Kangoo', 'Koleos', 'Laguna', 'Master', 'Megane', 'Modus', 'Scenic', 'Grand Scenic', 'Talisman', 'Thalia', 'Trafic', 'Twingo', 'Zoe'],
  Saab: ['9-3', '9-5'],
  Seat: ['Alhambra', 'Altea', 'Arona', 'Ateca', 'Cordoba', 'Exeo', 'Ibiza', 'Leon', 'Mii', 'Tarraco', 'Toledo'],
  Škoda: ['Citigo', 'Enyaq', 'Fabia', 'Felicia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Rapid', 'Roomster', 'Scala', 'Superb', 'Yeti'],
  Smart: ['ForFour', 'ForTwo', '#1', '#3'],
  SsangYong: ['Korando', 'Kyron', 'Rexton', 'Tivoli'],
  Subaru: ['BRZ', 'Forester', 'Impreza', 'Legacy', 'Outback', 'XV'],
  Suzuki: ['Baleno', 'Grand Vitara', 'Ignis', 'Jimny', 'SX4', 'SX4 S-Cross', 'Splash', 'Swift', 'Vitara'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['Auris', 'Avensis', 'Aygo', 'Aygo X', 'bZ4X', 'C-HR', 'Camry', 'Corolla', 'Corolla Cross', 'Corolla Verso', 'GT86', 'Hilux', 'Land Cruiser', 'Prius', 'Proace', 'RAV4', 'Supra', 'Verso', 'Yaris', 'Yaris Cross'],
  Volkswagen: ['Amarok', 'Arteon', 'Caddy', 'Crafter', 'Eos', 'Fox', 'Golf', 'Golf Plus', 'Golf Sportsvan', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID.Buzz', 'Jetta', 'Lupo', 'Multivan', 'Passat', 'Passat CC', 'Phaeton', 'Polo', 'Scirocco', 'Sharan', 'T-Cross', 'T-Roc', 'Taigo', 'Tiguan', 'Tiguan Allspace', 'Touareg', 'Touran', 'Transporter', 'Up!'],
  Volvo: ['C30', 'C40', 'EX30', 'S40', 'S60', 'S80', 'S90', 'V40', 'V50', 'V60', 'V70', 'V90', 'XC40', 'XC60', 'XC70', 'XC90'],
}

export const MAKES = Object.keys(CARS).sort((a, b) => a.localeCompare(b))

const findMake = (make: string) => {
  const k = norm(make)
  return MAKES.find((m) => norm(m) === k)
}

export const modelsOf = (make: string): string[] => {
  const m = findMake(make)
  return m ? CARS[m] : []
}

export const isKnownModel = (make: string, model: string) => {
  const k = norm(model)
  return modelsOf(make).some((m) => norm(m) === k)
}

// без регистра, диакритики и разделителей: «sk» → Škoda, «cx5» → CX-5
export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s\-.!:]/g, '')

// Сначала то, что начинается с введённого, потом — где с него начинается любое слово
// («rov» → Land Rover, «sport» → Range Rover Sport).
export function suggest(items: string[], query: string, limit = 50): string[] {
  const q = norm(query)
  if (!q) return items.slice(0, limit)
  const head: string[] = []
  const word: string[] = []
  for (const it of items) {
    if (norm(it).startsWith(q)) head.push(it)
    else if (it.split(/[\s-]/).some((w) => norm(w).startsWith(q))) word.push(it)
  }
  return [...head, ...word].slice(0, limit)
}

/** «VOLKSWAGEN» → «Volkswagen», «SKODA» → «Škoda»; неизвестная марка — как есть, с заглавной */
export function canonMake(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const k = norm(s)
  const alias: Record<string, string> = { vw: 'Volkswagen', mercedes: 'Mercedes-Benz', mercedesbenz: 'Mercedes-Benz', landrover: 'Land Rover', alfa: 'Alfa Romeo' }
  return MAKES.find((m) => norm(m) === k) ?? alias[k] ?? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** Модель из документа — к написанию из справочника, если такая есть */
export function canonModel(make: string, raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const k = norm(s)
  const list = modelsOf(make)
  const exact = list.find((m) => norm(m) === k)
  if (exact) return exact
  // «GOLF VARIANT» → «Golf Variant»; короткие части с цифрами (A4, CX-5) не трогаем
  return s === s.toUpperCase() ? s.replace(/\p{L}+/gu, (w) => (w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w)) : s
}
