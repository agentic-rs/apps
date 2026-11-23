import type { Trip, TripCityLocation } from './types';
import type { DirectoryCity } from './offline-directory';

export interface CatalogCity {
  id: string;
  name: string;
  region: string;
  aliases: string[];
}

export function titleForCity(city: string): string {
  return `${city} trip`;
}

export function tripCitySummary({ title, cities }: Trip): string | undefined {
  if (cities?.length === 1 && (title === cities[0] || title === titleForCity(cities[0]))) {
    return undefined;
  }
  return cities?.join(' → ');
}

function city(id: number, name: string, region: string, ...aliases: string[]): CatalogCity {
  return { id: `geonames:${id}`, name, region, aliases };
}

export const suggested_cities = [
  city(1796236, 'Shanghai', 'China', '上海'),
  city(1850147, 'Tokyo', 'Japan', '東京', '东京', 'とうきょう'),
  city(1816670, 'Beijing', 'China', '北京', 'Peking'),
  city(1857910, 'Kyoto', 'Japan', '京都', 'きょうと'),
  city(2988507, 'Paris', 'France', '巴黎'),
  city(2643743, 'London', 'United Kingdom', '伦敦', '倫敦'),
];

export const more_cities = [
  city(2759794, 'Amsterdam', 'Netherlands', '阿姆斯特丹'),
  city(1609350, 'Bangkok', 'Thailand', 'กรุงเทพมหานคร', '曼谷'),
  city(3128760, 'Barcelona', 'Spain', '巴塞罗那', '巴塞隆納'),
  city(2950159, 'Berlin', 'Germany', '柏林'),
  city(360630, 'Cairo', 'Egypt', 'القاهرة', '开罗', '開羅'),
  city(3369157, 'Cape Town', 'South Africa', 'Kaapstad', '开普敦', '開普敦'),
  city(1815286, 'Chengdu', 'China', '成都'),
  city(1814906, 'Chongqing', 'China', '重庆', '重慶'),
  city(292223, 'Dubai', 'United Arab Emirates', 'دبي', '迪拜', '杜拜'),
  city(3176959, 'Florence', 'Italy', 'Firenze', '佛罗伦萨', '佛羅倫斯'),
  city(1863967, 'Fukuoka', 'Japan', '福岡', '福冈'),
  city(1809858, 'Guangzhou', 'China', '广州', '廣州', 'Canton'),
  city(1808926, 'Hangzhou', 'China', '杭州'),
  city(1581130, 'Hanoi', 'Vietnam', 'Hà Nội', '河内', '河內'),
  city(1819729, 'Hong Kong', 'China', '香港', 'Xianggang'),
  city(745044, 'Istanbul', 'Türkiye', 'İstanbul', '伊斯坦布尔', '伊斯坦堡'),
  city(1735161, 'Kuala Lumpur', 'Malaysia', '吉隆坡'),
  city(2267057, 'Lisbon', 'Portugal', 'Lisboa', '里斯本'),
  city(5368361, 'Los Angeles', 'United States', '洛杉矶', '洛杉磯', 'LA'),
  city(3117735, 'Madrid', 'Spain', '马德里', '馬德里'),
  city(2158177, 'Melbourne', 'Australia', '墨尔本', '墨爾本'),
  city(3530597, 'Mexico City', 'Mexico', 'Ciudad de México', '墨西哥城'),
  city(3173435, 'Milan', 'Italy', 'Milano', '米兰', '米蘭'),
  city(1275339, 'Mumbai', 'India', 'मुंबई', 'Bombay', '孟买', '孟買'),
  city(2867714, 'Munich', 'Germany', 'München', '慕尼黑'),
  city(1799962, 'Nanjing', 'China', '南京', 'Nanking'),
  city(1855612, 'Nara', 'Japan', '奈良'),
  city(5128581, 'New York City', 'United States', 'New York', 'NYC', '纽约', '紐約'),
  city(1853909, 'Osaka', 'Japan', '大阪', 'おおさか'),
  city(3067696, 'Prague', 'Czechia', 'Praha', '布拉格'),
  city(3451190, 'Rio de Janeiro', 'Brazil', '里约热内卢', '里約熱內盧'),
  city(3169070, 'Rome', 'Italy', 'Roma', '罗马', '羅馬'),
  city(5391959, 'San Francisco', 'United States', '旧金山', '舊金山', '三藩市'),
  city(3448439, 'São Paulo', 'Brazil', '圣保罗', '聖保羅'),
  city(2128295, 'Sapporo', 'Japan', '札幌'),
  city(1835848, 'Seoul', 'South Korea', '서울', '首尔', '首爾'),
  city(1795565, 'Shenzhen', 'China', '深圳'),
  city(1880252, 'Singapore', 'Singapore', 'Singapura', '新加坡'),
  city(1886760, 'Suzhou', 'China', '苏州', '蘇州'),
  city(2147714, 'Sydney', 'Australia', '悉尼', '雪梨'),
  city(1668341, 'Taipei', 'Taiwan', '臺北', '台北'),
  city(6167865, 'Toronto', 'Canada', '多伦多', '多倫多'),
  city(6173331, 'Vancouver', 'Canada', '温哥华', '溫哥華'),
  city(3164603, 'Venice', 'Italy', 'Venezia', '威尼斯'),
  city(2761369, 'Vienna', 'Austria', 'Wien', '维也纳', '維也納'),
  city(1790630, 'Xi’an', 'China', "Xi'an", 'Xian', '西安'),
  city(1790645, 'Xiamen', 'China', '厦门', '廈門'),
];

export function cityKey(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function sameTripCity(
  first_name: string,
  first_location: Pick<TripCityLocation, 'id'> | null | undefined,
  second_name: string,
  second_location: Pick<TripCityLocation, 'id'> | null | undefined,
): boolean {
  if (first_location && second_location) return first_location.id === second_location.id;
  return cityKey(first_name) === cityKey(second_name);
}

const directory = [...suggested_cities, ...more_cities].map((place) => ({
  place,
  names: [place.name, ...place.aliases].map(cityKey),
  region: cityKey(place.region),
}));

const featured_by_id = new Map(directory.map(({ place }) => [place.id, place]));
const country_names = new Intl.DisplayNames(['en'], { type: 'region' });

// Include only stable, offline fields in the trip. A directory result also carries search metadata.
export function tripCityLocation({
  id,
  country_code,
  latitude,
  longitude,
}: DirectoryCity): TripCityLocation {
  return { id, country_code, latitude, longitude };
}

export interface CityOption {
  name: string;
  region: string;
  id?: string;
  location?: TripCityLocation;
}

export function directoryCityOptions(cities: DirectoryCity[]): CityOption[] {
  const options = cities.map((city) => {
    const name = featured_by_id.get(city.id)?.name ?? city.name;
    const country = country_names.of(city.country_code) ?? city.country_code;
    return { city, name, country };
  });
  return options.map(({ city, name, country }) => {
    const namesakes = options.filter(
      (option) => option.name === name && option.country === country,
    );
    let region = country;
    if (namesakes.length > 1) {
      const area = city.admin1;
      const same_area = namesakes.filter((option) => option.city.admin1 === area);
      region = [
        area,
        same_area.length > 1 && `${city.latitude.toFixed(2)}°, ${city.longitude.toFixed(2)}°`,
        country,
      ]
        .filter(Boolean)
        .join(', ');
    }
    return { id: city.id, name, region, location: tripCityLocation(city) };
  });
}

export function searchFeaturedCities(query: string) {
  const key = cityKey(query);
  if (!key) return { matches: [], custom_name: '' };
  const terms = key.split(' ');
  const matches = directory.filter(({ names, region }) =>
    terms.every((term) => region.includes(term) || names.some((name) => name.includes(term))),
  );
  const exact = matches.find(({ names }) => names.includes(key));
  return {
    matches: (exact ? [exact, ...matches.filter((entry) => entry !== exact)] : matches).map(
      ({ place }) => place,
    ),
    custom_name: exact ? '' : query.trim(),
  };
}
