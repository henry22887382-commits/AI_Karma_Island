const DEFAULT_LOCATION_NAMES: Readonly<Record<string, string>> = {
  '1': '西營地・西椰子海灘',
  '2': '西岬沙灘',
  '3': '西坡森林',
  '4': '西北白灘',
  '5': '西源河灣',
  '6': '北岸石堆',
  '7': '北風海岸',
  '8': '東營地・東椰子海灘',
  '9': '東岸森林',
  '10': '東部沙灘',
  '11': '河口森林',
  '12': '南灣沙灘',
  '13': '南營地',
  '14': '南岬沙灘',
  '15': '港口',
  '16': '西南白灘',
  '17': '西部森林',
  '18': '西部林間空地',
  '19': '西脊石坡',
  '20': '北坡石山',
  '21': '火山入口',
  '22': '東北石堆',
  '23': '東部森林',
  '24': '東側河流',
  '25': '中央營地',
  '26': '林畔河灘',
  '27': '紀念碑谷',
  '28': '內陸林間空地',
};

export function locationNameForNode(nodeId: string, sourceLabel: string | null | undefined): string | null {
  const configuredName = sourceLabel?.trim();
  return configuredName || DEFAULT_LOCATION_NAMES[nodeId] || null;
}

export function formatNodeLocationReference(nodeId: string, sourceLabel: string | null | undefined): string {
  const name = locationNameForNode(nodeId, sourceLabel);
  return name ? `Node ${nodeId} · ${name}` : `Node ${nodeId}`;
}
