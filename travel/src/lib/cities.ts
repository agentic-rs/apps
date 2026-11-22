import type { Trip } from './types';

export interface CatalogCity {
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

function city(name: string, region: string, ...aliases: string[]): CatalogCity {
  return { name, region, aliases };
}

export const suggested_cities = [
  city('Shanghai', 'China', '上海'),
  city('Tokyo', 'Japan', '東京', '东京', 'とうきょう'),
  city('Beijing', 'China', '北京', 'Peking'),
  city('Kyoto', 'Japan', '京都', 'きょうと'),
  city('Paris', 'France', '巴黎'),
  city('London', 'United Kingdom', '伦敦', '倫敦'),
];

export const more_cities = [
  city('Amsterdam', 'Netherlands', '阿姆斯特丹'),
  city('Bangkok', 'Thailand', 'กรุงเทพมหานคร', '曼谷'),
  city('Barcelona', 'Spain', '巴塞罗那', '巴塞隆納'),
  city('Berlin', 'Germany', '柏林'),
  city('Cairo', 'Egypt', 'القاهرة', '开罗', '開羅'),
  city('Cape Town', 'South Africa', 'Kaapstad', '开普敦', '開普敦'),
  city('Chengdu', 'China', '成都'),
  city('Chongqing', 'China', '重庆', '重慶'),
  city('Dubai', 'United Arab Emirates', 'دبي', '迪拜', '杜拜'),
  city('Florence', 'Italy', 'Firenze', '佛罗伦萨', '佛羅倫斯'),
  city('Fukuoka', 'Japan', '福岡', '福冈'),
  city('Guangzhou', 'China', '广州', '廣州', 'Canton'),
  city('Hangzhou', 'China', '杭州'),
  city('Hanoi', 'Vietnam', 'Hà Nội', '河内', '河內'),
  city('Hong Kong', 'China', '香港', 'Xianggang'),
  city('Istanbul', 'Türkiye', 'İstanbul', '伊斯坦布尔', '伊斯坦堡'),
  city('Kuala Lumpur', 'Malaysia', '吉隆坡'),
  city('Lisbon', 'Portugal', 'Lisboa', '里斯本'),
  city('Los Angeles', 'United States', '洛杉矶', '洛杉磯', 'LA'),
  city('Madrid', 'Spain', '马德里', '馬德里'),
  city('Melbourne', 'Australia', '墨尔本', '墨爾本'),
  city('Mexico City', 'Mexico', 'Ciudad de México', '墨西哥城'),
  city('Milan', 'Italy', 'Milano', '米兰', '米蘭'),
  city('Mumbai', 'India', 'मुंबई', 'Bombay', '孟买', '孟買'),
  city('Munich', 'Germany', 'München', '慕尼黑'),
  city('Nanjing', 'China', '南京', 'Nanking'),
  city('Nara', 'Japan', '奈良'),
  city('New York City', 'United States', 'New York', 'NYC', '纽约', '紐約'),
  city('Osaka', 'Japan', '大阪', 'おおさか'),
  city('Prague', 'Czechia', 'Praha', '布拉格'),
  city('Rio de Janeiro', 'Brazil', '里约热内卢', '里約熱內盧'),
  city('Rome', 'Italy', 'Roma', '罗马', '羅馬'),
  city('San Francisco', 'United States', '旧金山', '舊金山', '三藩市'),
  city('São Paulo', 'Brazil', '圣保罗', '聖保羅'),
  city('Sapporo', 'Japan', '札幌'),
  city('Seoul', 'South Korea', '서울', '首尔', '首爾'),
  city('Shenzhen', 'China', '深圳'),
  city('Singapore', 'Singapore', 'Singapura', '新加坡'),
  city('Suzhou', 'China', '苏州', '蘇州'),
  city('Sydney', 'Australia', '悉尼', '雪梨'),
  city('Taipei', 'Taiwan', '臺北', '台北'),
  city('Toronto', 'Canada', '多伦多', '多倫多'),
  city('Vancouver', 'Canada', '温哥华', '溫哥華'),
  city('Venice', 'Italy', 'Venezia', '威尼斯'),
  city('Vienna', 'Austria', 'Wien', '维也纳', '維也納'),
  city('Xi’an', 'China', "Xi'an", 'Xian', '西安'),
  city('Xiamen', 'China', '厦门', '廈門'),
];

export function cityKey(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const directory = [...suggested_cities, ...more_cities].map((place) => ({
  place,
  names: [place.name, ...place.aliases].map(cityKey),
  region: cityKey(place.region),
}));

export function searchCities(query: string) {
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
