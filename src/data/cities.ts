import type { CityFocus, RegionId } from '../engine/types'

/** A real city a country can grow. Its share is how much of the country's people live there. */
export interface CityDef {
  name: string
  /** Share of the country's workforce, before growth. */
  share: number
  /** Whether it sits on the coast, so a harbor focus works. */
  port: boolean
  lat?: number
  lng?: number
}

/** Capitals of every country in the game. A country with nothing else has just this one city. */
const CAPITALS: Record<RegionId, string> = {
  afghanistan: 'Kabul', albania: 'Tirana', algeria: 'Algiers', angola: 'Luanda', argentina: 'Buenos Aires', armenia: 'Yerevan', australia: 'Canberra', austria: 'Vienna',
  azerbaijan: 'Baku', bahamas: 'Nassau', bangladesh: 'Dhaka', belarus: 'Minsk', belgium: 'Brussels', belize: 'Belmopan', benin: 'Porto-Novo', bhutan: 'Thimphu',
  bolivia: 'La Paz', 'bosnia-and-herz': 'Sarajevo', botswana: 'Gaborone', brazil: 'Brasilia', brunei: 'Bandar Seri Begawan', bulgaria: 'Sofia', 'burkina-faso': 'Ouagadougou',
  burundi: 'Gitega', cambodia: 'Phnom Penh', cameroon: 'Yaounde', canada: 'Ottawa', 'central-african-rep': 'Bangui', chad: "N'Djamena", chile: 'Santiago', china: 'Beijing',
  colombia: 'Bogota', congo: 'Brazzaville', 'costa-rica': 'San Jose', 'cote-d-ivoire': 'Yamoussoukro', croatia: 'Zagreb', cuba: 'Havana', cyprus: 'Nicosia', czechia: 'Prague',
  'dem-rep-congo': 'Kinshasa', denmark: 'Copenhagen', djibouti: 'Djibouti', 'dominican-rep': 'Santo Domingo', ecuador: 'Quito', egypt: 'Cairo', 'el-salvador': 'San Salvador',
  'eq-guinea': 'Malabo', eritrea: 'Asmara', estonia: 'Tallinn', eswatini: 'Mbabane', ethiopia: 'Addis Ababa', 'falkland-is': 'Stanley', fiji: 'Suva', finland: 'Helsinki',
  france: 'Paris', gabon: 'Libreville', gambia: 'Banjul', georgia: 'Tbilisi', germany: 'Berlin', ghana: 'Accra', greece: 'Athens', greenland: 'Nuuk', guatemala: 'Guatemala City',
  guinea: 'Conakry', 'guinea-bissau': 'Bissau', guyana: 'Georgetown', haiti: 'Port-au-Prince', honduras: 'Tegucigalpa', hungary: 'Budapest', iceland: 'Reykjavik', india: 'New Delhi',
  indonesia: 'Jakarta', iran: 'Tehran', iraq: 'Baghdad', ireland: 'Dublin', israel: 'Jerusalem', italy: 'Rome', jamaica: 'Kingston', japan: 'Tokyo', jordan: 'Amman',
  kazakhstan: 'Astana', kenya: 'Nairobi', kosovo: 'Pristina', kuwait: 'Kuwait City', kyrgyzstan: 'Bishkek', laos: 'Vientiane', latvia: 'Riga', lebanon: 'Beirut', lesotho: 'Maseru',
  liberia: 'Monrovia', libya: 'Tripoli', lithuania: 'Vilnius', luxembourg: 'Luxembourg City', macedonia: 'Skopje', madagascar: 'Antananarivo', malawi: 'Lilongwe', malaysia: 'Kuala Lumpur',
  mali: 'Bamako', mauritania: 'Nouakchott', mexico: 'Mexico City', moldova: 'Chisinau', mongolia: 'Ulaanbaatar', montenegro: 'Podgorica', morocco: 'Rabat', mozambique: 'Maputo',
  myanmar: 'Naypyidaw', 'n-cyprus': 'North Nicosia', namibia: 'Windhoek', nepal: 'Kathmandu', netherlands: 'Amsterdam', 'new-caledonia': 'Noumea', 'new-zealand': 'Wellington',
  nicaragua: 'Managua', niger: 'Niamey', nigeria: 'Abuja', 'north-korea': 'Pyongyang', norway: 'Oslo', oman: 'Muscat', pakistan: 'Islamabad', palestine: 'Ramallah', panama: 'Panama City',
  'papua-new-guinea': 'Port Moresby', paraguay: 'Asuncion', peru: 'Lima', philippines: 'Manila', poland: 'Warsaw', portugal: 'Lisbon', 'puerto-rico': 'San Juan', qatar: 'Doha',
  romania: 'Bucharest', russia: 'Moscow', rwanda: 'Kigali', 's-sudan': 'Juba', 'saudi-arabia': 'Riyadh', senegal: 'Dakar', serbia: 'Belgrade', 'sierra-leone': 'Freetown',
  slovakia: 'Bratislava', slovenia: 'Ljubljana', 'solomon-is': 'Honiara', somalia: 'Mogadishu', somaliland: 'Hargeisa', 'south-africa': 'Pretoria', 'south-korea': 'Seoul',
  spain: 'Madrid', 'sri-lanka': 'Colombo', sudan: 'Khartoum', suriname: 'Paramaribo', sweden: 'Stockholm', switzerland: 'Bern', syria: 'Damascus', taiwan: 'Taipei',
  tajikistan: 'Dushanbe', tanzania: 'Dodoma', thailand: 'Bangkok', 'timor-leste': 'Dili', togo: 'Lome', 'trinidad-and-tobago': 'Port of Spain', tunisia: 'Tunis', turkey: 'Ankara',
  turkmenistan: 'Ashgabat', uganda: 'Kampala', ukraine: 'Kyiv', 'united-arab-emirates': 'Abu Dhabi', 'united-kingdom': 'London', 'united-states-of-america': 'Washington',
  uruguay: 'Montevideo', uzbekistan: 'Tashkent', vanuatu: 'Port Vila', venezuela: 'Caracas', vietnam: 'Hanoi', 'w-sahara': 'Laayoune', yemen: "Sana'a", zambia: 'Lusaka', zimbabwe: 'Harare',
}

/** The other big cities of the larger countries, with where they are. The capital always comes first. */
const MORE: Record<RegionId, CityDef[]> = {
  'united-states-of-america': [
    { name: 'New York', share: 0.12, port: true, lat: 40.7, lng: -74 },
    { name: 'Los Angeles', share: 0.1, port: true, lat: 34, lng: -118.2 },
    { name: 'Chicago', share: 0.08, port: false, lat: 41.9, lng: -87.6 },
  ],
  china: [
    { name: 'Shanghai', share: 0.12, port: true, lat: 31.2, lng: 121.5 },
    { name: 'Guangzhou', share: 0.1, port: true, lat: 23.1, lng: 113.3 },
    { name: 'Chongqing', share: 0.08, port: false, lat: 29.6, lng: 106.5 },
  ],
  india: [
    { name: 'Mumbai', share: 0.12, port: true, lat: 19.1, lng: 72.9 },
    { name: 'Kolkata', share: 0.09, port: true, lat: 22.6, lng: 88.4 },
    { name: 'Bangalore', share: 0.08, port: false, lat: 13, lng: 77.6 },
  ],
  russia: [
    { name: 'Saint Petersburg', share: 0.1, port: true, lat: 59.9, lng: 30.3 },
    { name: 'Novosibirsk', share: 0.06, port: false, lat: 55, lng: 82.9 },
    { name: 'Vladivostok', share: 0.04, port: true, lat: 43.1, lng: 131.9 },
  ],
  brazil: [
    { name: 'Sao Paulo', share: 0.14, port: false, lat: -23.5, lng: -46.6 },
    { name: 'Rio de Janeiro', share: 0.1, port: true, lat: -22.9, lng: -43.2 },
    { name: 'Salvador', share: 0.06, port: true, lat: -13, lng: -38.5 },
  ],
  germany: [
    { name: 'Hamburg', share: 0.1, port: true, lat: 53.6, lng: 10 },
    { name: 'Munich', share: 0.09, port: false, lat: 48.1, lng: 11.6 },
    { name: 'Frankfurt', share: 0.08, port: false, lat: 50.1, lng: 8.7 },
  ],
  'united-kingdom': [
    { name: 'Manchester', share: 0.1, port: false, lat: 53.5, lng: -2.2 },
    { name: 'Glasgow', share: 0.07, port: true, lat: 55.9, lng: -4.3 },
    { name: 'Liverpool', share: 0.06, port: true, lat: 53.4, lng: -3 },
  ],
  france: [
    { name: 'Marseille', share: 0.1, port: true, lat: 43.3, lng: 5.4 },
    { name: 'Lyon', share: 0.09, port: false, lat: 45.8, lng: 4.8 },
    { name: 'Toulouse', share: 0.06, port: false, lat: 43.6, lng: 1.4 },
  ],
  japan: [
    { name: 'Osaka', share: 0.14, port: true, lat: 34.7, lng: 135.5 },
    { name: 'Nagoya', share: 0.09, port: true, lat: 35.2, lng: 136.9 },
    { name: 'Sapporo', share: 0.05, port: true, lat: 43.1, lng: 141.4 },
  ],
  italy: [
    { name: 'Milan', share: 0.12, port: false, lat: 45.5, lng: 9.2 },
    { name: 'Naples', share: 0.09, port: true, lat: 40.9, lng: 14.3 },
    { name: 'Turin', share: 0.06, port: false, lat: 45.1, lng: 7.7 },
  ],
  spain: [
    { name: 'Barcelona', share: 0.14, port: true, lat: 41.4, lng: 2.2 },
    { name: 'Valencia', share: 0.08, port: true, lat: 39.5, lng: -0.4 },
    { name: 'Seville', share: 0.06, port: false, lat: 37.4, lng: -6 },
  ],
  turkey: [
    { name: 'Istanbul', share: 0.2, port: true, lat: 41, lng: 29 },
    { name: 'Izmir', share: 0.08, port: true, lat: 38.4, lng: 27.1 },
  ],
  mexico: [
    { name: 'Guadalajara', share: 0.09, port: false, lat: 20.7, lng: -103.4 },
    { name: 'Monterrey', share: 0.09, port: false, lat: 25.7, lng: -100.3 },
  ],
  canada: [
    { name: 'Toronto', share: 0.16, port: false, lat: 43.7, lng: -79.4 },
    { name: 'Vancouver', share: 0.09, port: true, lat: 49.3, lng: -123.1 },
    { name: 'Montreal', share: 0.1, port: false, lat: 45.5, lng: -73.6 },
  ],
  australia: [
    { name: 'Sydney', share: 0.2, port: true, lat: -33.9, lng: 151.2 },
    { name: 'Melbourne', share: 0.18, port: true, lat: -37.8, lng: 145 },
    { name: 'Perth', share: 0.08, port: true, lat: -32, lng: 115.9 },
  ],
  indonesia: [
    { name: 'Surabaya', share: 0.08, port: true, lat: -7.3, lng: 112.7 },
    { name: 'Bandung', share: 0.07, port: false, lat: -6.9, lng: 107.6 },
  ],
  nigeria: [
    { name: 'Lagos', share: 0.18, port: true, lat: 6.5, lng: 3.4 },
    { name: 'Kano', share: 0.08, port: false, lat: 12, lng: 8.5 },
  ],
  egypt: [
    { name: 'Alexandria', share: 0.14, port: true, lat: 31.2, lng: 29.9 },
    { name: 'Luxor', share: 0.04, port: false, lat: 25.7, lng: 32.6 },
  ],
  'south-africa': [
    { name: 'Johannesburg', share: 0.16, port: false, lat: -26.2, lng: 28 },
    { name: 'Cape Town', share: 0.1, port: true, lat: -33.9, lng: 18.4 },
    { name: 'Durban', share: 0.07, port: true, lat: -29.9, lng: 31 },
  ],
  argentina: [
    { name: 'Cordoba', share: 0.07, port: false, lat: -31.4, lng: -64.2 },
    { name: 'Rosario', share: 0.06, port: false, lat: -32.9, lng: -60.7 },
  ],
  poland: [
    { name: 'Krakow', share: 0.07, port: false, lat: 50.1, lng: 19.9 },
    { name: 'Gdansk', share: 0.06, port: true, lat: 54.4, lng: 18.6 },
  ],
  ukraine: [
    { name: 'Odesa', share: 0.07, port: true, lat: 46.5, lng: 30.7 },
    { name: 'Kharkiv', share: 0.07, port: false, lat: 50, lng: 36.2 },
  ],
  'saudi-arabia': [
    { name: 'Jeddah', share: 0.15, port: true, lat: 21.5, lng: 39.2 },
    { name: 'Dammam', share: 0.08, port: true, lat: 26.4, lng: 50.1 },
  ],
  iran: [
    { name: 'Isfahan', share: 0.07, port: false, lat: 32.7, lng: 51.7 },
    { name: 'Bandar Abbas', share: 0.04, port: true, lat: 27.2, lng: 56.3 },
  ],
  pakistan: [
    { name: 'Karachi', share: 0.16, port: true, lat: 24.9, lng: 67 },
    { name: 'Lahore', share: 0.12, port: false, lat: 31.5, lng: 74.3 },
  ],
  'south-korea': [
    { name: 'Busan', share: 0.12, port: true, lat: 35.2, lng: 129.1 },
    { name: 'Incheon', share: 0.06, port: true, lat: 37.5, lng: 126.7 },
  ],
  thailand: [{ name: 'Chiang Mai', share: 0.05, port: false, lat: 18.8, lng: 99 }],
  vietnam: [
    { name: 'Ho Chi Minh City', share: 0.14, port: true, lat: 10.8, lng: 106.7 },
    { name: 'Da Nang', share: 0.04, port: true, lat: 16.1, lng: 108.2 },
  ],
  philippines: [{ name: 'Cebu', share: 0.06, port: true, lat: 10.3, lng: 123.9 }],
  colombia: [
    { name: 'Medellin', share: 0.09, port: false, lat: 6.2, lng: -75.6 },
    { name: 'Cartagena', share: 0.05, port: true, lat: 10.4, lng: -75.5 },
  ],
  peru: [{ name: 'Cusco', share: 0.05, port: false, lat: -13.5, lng: -72 }],
  chile: [{ name: 'Valparaiso', share: 0.08, port: true, lat: -33, lng: -71.6 }],
  netherlands: [{ name: 'Rotterdam', share: 0.12, port: true, lat: 51.9, lng: 4.5 }],
  belgium: [{ name: 'Antwerp', share: 0.14, port: true, lat: 51.2, lng: 4.4 }],
  sweden: [{ name: 'Gothenburg', share: 0.12, port: true, lat: 57.7, lng: 12 }],
  greece: [{ name: 'Thessaloniki', share: 0.1, port: true, lat: 40.6, lng: 22.9 }],
  portugal: [{ name: 'Porto', share: 0.15, port: true, lat: 41.2, lng: -8.6 }],
  morocco: [{ name: 'Casablanca', share: 0.2, port: true, lat: 33.6, lng: -7.6 }],
  ethiopia: [{ name: 'Dire Dawa', share: 0.04, port: false, lat: 9.6, lng: 41.9 }],
  kenya: [{ name: 'Mombasa', share: 0.1, port: true, lat: -4, lng: 39.7 }],
  tanzania: [{ name: 'Dar es Salaam', share: 0.18, port: true, lat: -6.8, lng: 39.3 }],
  iraq: [{ name: 'Basra', share: 0.1, port: true, lat: 30.5, lng: 47.8 }],
  israel: [{ name: 'Tel Aviv', share: 0.25, port: true, lat: 32.1, lng: 34.8 }],
  'united-arab-emirates': [{ name: 'Dubai', share: 0.3, port: true, lat: 25.2, lng: 55.3 }],
  malaysia: [{ name: 'Penang', share: 0.06, port: true, lat: 5.4, lng: 100.3 }],
  bangladesh: [{ name: 'Chittagong', share: 0.1, port: true, lat: 22.4, lng: 91.8 }],
  switzerland: [{ name: 'Zurich', share: 0.18, port: false, lat: 47.4, lng: 8.5 }],
  austria: [{ name: 'Graz', share: 0.06, port: false, lat: 47.1, lng: 15.4 }],
  romania: [{ name: 'Cluj', share: 0.06, port: false, lat: 46.8, lng: 23.6 }],
  taiwan: [{ name: 'Kaohsiung', share: 0.14, port: true, lat: 22.6, lng: 120.3 }],
  venezuela: [{ name: 'Maracaibo', share: 0.1, port: true, lat: 10.6, lng: -71.6 }],
  'new-zealand': [{ name: 'Auckland', share: 0.3, port: true, lat: -36.8, lng: 174.8 }],
}

export const CITY_RULES = {
  /** Highest level a city reaches. */
  maxLevel: 5,
  /** Money to raise a city from level N: this times N. */
  developCost: 60,
  focusCost: 20,
  /** Each level above 1 adds this to the country's workforce, to a limit. */
  workforcePerLevel: 0.06,
  workforceCap: 0.4,
}

export interface FocusSpec {
  name: string
  blurb: string
  /** Per city level. */
  food: number
  money: number
  research: number
  factory: number
  steel: number
  tradeCapacity: number
  line: number
  credit: number
  needsPort?: boolean
}

export const FOCUS: Record<CityFocus, FocusSpec> = {
  balanced: { name: 'Balanced', blurb: 'A little food, money and research.', food: 0.15, money: 0.25, research: 0.08, factory: 0, steel: 0, tradeCapacity: 0, line: 0, credit: 0 },
  industry: { name: 'Industry', blurb: 'Factories and steel mills. Factory output and steel.', food: 0, money: 0.1, research: 0, factory: 0.04, steel: 0.3, tradeCapacity: 0, line: 0, credit: 0 },
  farming: { name: 'Farming', blurb: 'Markets and storehouses. Much more food.', food: 0.45, money: 0.1, research: 0, factory: 0, steel: 0, tradeCapacity: 0, line: 0, credit: 0 },
  harbor: { name: 'Harbor', blurb: 'A trading port. More money from trade and room on the market.', food: 0, money: 0.5, research: 0, factory: 0, steel: 0, tradeCapacity: 3, line: 0, credit: 0, needsPort: true },
  research: { name: 'Research', blurb: 'Universities and labs. More research.', food: 0, money: 0, research: 0.4, factory: 0, steel: 0, tradeCapacity: 0, line: 0, credit: 0 },
  fortress: { name: 'Fortress', blurb: 'Walls and garrisons. A longer Defense Line against invaders.', food: 0, money: 0, research: 0, factory: 0, steel: 0, tradeCapacity: 0, line: 0.9, credit: 0 },
  finance: { name: 'Finance', blurb: 'Banks and exchanges. More money and better credit.', food: 0, money: 0.6, research: 0, factory: 0, steel: 0, tradeCapacity: 0, line: 0, credit: 1.2 },
}

export const FOCUS_IDS = Object.keys(FOCUS) as CityFocus[]

/** Whether the game knows this country's capital by name. */
export const hasCityData = (regionId: RegionId) => regionId in CAPITALS

/** Every city a country has at the start: its capital and any other big cities. */
export function cityDefs(regionId: RegionId, regionName: string): CityDef[] {
  const capital: CityDef = { name: CAPITALS[regionId] ?? `${regionName} City`, share: 0.3, port: false }
  return [capital, ...(MORE[regionId] ?? [])]
}
